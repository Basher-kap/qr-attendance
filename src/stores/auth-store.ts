import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { passwordProblem } from '../utils/limits';

export interface AuthResult {
  ok: boolean;
  message: string; // what to tell the person (an error, or what happens next)
}

// Sign-in through Supabase, two ways: with Google, or with an email address and a password made
// for this app. The app never sees a Google password: Google sign-in happens on Google's own
// page, and the email option is a separate login kept by Supabase Auth (the password is stored
// there as a hash, never in this app). Signing in is optional: guests can use every feature,
// and their data is saved on the device. Without Supabase settings (no .env), the sign-in
// button is hidden and the app works as a guest app only.
export const useAuthStore = defineStore('auth', () => {
  const enabled = supabase !== null;
  const session = ref<Session | null>(null);
  const ready = ref(!enabled);
  const errorMessage = ref('');
  const recovering = ref(false); // opened from a password-reset email: a new password is due
  let started = false;

  const user = computed(() => session.value?.user ?? null);
  const userId = computed(() => user.value?.id ?? '');
  const email = computed(() => user.value?.email ?? '');
  const signedIn = computed(() => session.value !== null);

  const meta = computed(() => (user.value?.user_metadata ?? {}) as Record<string, unknown>);
  const displayName = computed(() => {
    const name = meta.value.full_name ?? meta.value.name;
    return typeof name === 'string' && name ? name : email.value;
  });
  const avatarUrl = computed(() => {
    const url = meta.value.avatar_url ?? meta.value.picture;
    return typeof url === 'string' ? url : '';
  });

  // After a sign-in, Supabase returns to the app with a one-time ?code=... in the address. It is
  // already used by then (and useless without the key that only this browser holds), but it would
  // stay in the address bar, the history and any screenshot or shared link, so it is removed.
  function removeSignInCodeFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('code')) return;
      url.searchParams.delete('code');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch {
      /* the address stays as it is */
    }
  }

  async function init() {
    if (!supabase || started) return;
    started = true;
    try {
      const { data } = await supabase.auth.getSession(); // finishes the sign-in from the ?code=
      session.value = data.session;
    } catch (e) {
      errorMessage.value = e instanceof Error ? e.message : 'Could not check the sign-in.';
    } finally {
      removeSignInCodeFromUrl();
      ready.value = true;
    }
    supabase.auth.onAuthStateChange((event, next) => {
      session.value = next;
      if (event === 'PASSWORD_RECOVERY') recovering.value = true;
    });
  }

  // prompt: 'select_account' makes Google show the account chooser every time,
  // including the "Use another account" option.
  async function signIn() {
    if (!supabase) return;
    errorMessage.value = '';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) errorMessage.value = error.message;
  }

  // ---- Email and password ----
  // Friendlier wording for the errors people actually meet.
  function friendly(message: string) {
    if (/invalid login credentials/i.test(message)) {
      return 'The email or password is not right. If you only used Google before, create an app password with "Create account" or "Forgot password".';
    }
    if (/email not confirmed/i.test(message)) {
      return 'This email is not confirmed yet. Open the confirmation email we sent and try again.';
    }
    if (/rate limit|too many/i.test(message)) {
      return 'Too many attempts. Please wait a few minutes and try again.';
    }
    // Supabase's own password rules (length, letters, digits, symbols, known leaked passwords).
    if (
      /password/i.test(message) &&
      /(weak|short|least|characters|pwned|leak|should contain)/i.test(message)
    ) {
      return `That password is not accepted: ${message}`;
    }
    return message;
  }

  async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
    if (!supabase) return { ok: false, message: 'Sign-in is not set up.' };
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return error ? { ok: false, message: friendly(error.message) } : { ok: true, message: '' };
    } catch (e) {
      return {
        ok: false,
        message: friendly(e instanceof Error ? e.message : 'Could not sign in.'),
      };
    }
  }

  async function signUpWithPassword(email: string, password: string): Promise<AuthResult> {
    if (!supabase) return { ok: false, message: 'Sign-in is not set up.' };
    const problem = passwordProblem(password);
    if (problem) return { ok: false, message: problem };
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) return { ok: false, message: friendly(error.message) };
      // Supabase hides whether an address is taken: an existing address comes back with no identities.
      if (data.user && data.user.identities?.length === 0) {
        return {
          ok: false,
          message:
            'An account with this email already exists. Use "Sign in", or "Forgot password".',
        };
      }
      if (data.session) return { ok: true, message: '' }; // confirmation is switched off: signed in
      return {
        ok: true,
        message: 'Check your email and open the confirmation link, then sign in here.',
      };
    } catch (e) {
      return {
        ok: false,
        message: friendly(e instanceof Error ? e.message : 'Could not sign up.'),
      };
    }
  }

  async function sendPasswordReset(email: string): Promise<AuthResult> {
    if (!supabase) return { ok: false, message: 'Sign-in is not set up.' };
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/`,
      });
      if (error) return { ok: false, message: friendly(error.message) };
      return { ok: true, message: 'If this email has an account, a reset link is on its way.' };
    } catch (e) {
      return { ok: false, message: friendly(e instanceof Error ? e.message : 'Could not send.') };
    }
  }

  // Used after the reset link is opened (recovering is true).
  async function setNewPassword(password: string): Promise<AuthResult> {
    if (!supabase) return { ok: false, message: 'Sign-in is not set up.' };
    const problem = passwordProblem(password);
    if (problem) return { ok: false, message: problem };
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return { ok: false, message: friendly(error.message) };
      recovering.value = false;
      return { ok: true, message: '' };
    } catch (e) {
      return { ok: false, message: friendly(e instanceof Error ? e.message : 'Could not save.') };
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    session.value = null;
  }

  function clearError() {
    errorMessage.value = '';
  }

  return {
    enabled,
    ready,
    errorMessage,
    userId,
    email,
    signedIn,
    displayName,
    avatarUrl,
    init,
    recovering,
    signIn,
    signInWithPassword,
    signUpWithPassword,
    sendPasswordReset,
    setNewPassword,
    signOut,
    clearError,
  };
});
