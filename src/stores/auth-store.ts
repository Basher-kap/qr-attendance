import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// Google sign-in through Supabase. Signing in is optional: guests can use every feature,
// and their data is saved on the device. Without Supabase settings (no .env), the sign-in
// button is hidden and the app works as a guest app only.
export const useAuthStore = defineStore('auth', () => {
  const enabled = supabase !== null;
  const session = ref<Session | null>(null);
  const ready = ref(!enabled);
  const errorMessage = ref('');
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

  async function init() {
    if (!supabase || started) return;
    started = true;
    try {
      const { data } = await supabase.auth.getSession();
      session.value = data.session;
    } catch (e) {
      errorMessage.value = e instanceof Error ? e.message : 'Could not check the sign-in.';
    } finally {
      ready.value = true;
    }
    supabase.auth.onAuthStateChange((_event, next) => {
      session.value = next;
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
    signIn,
    signOut,
    clearError,
  };
});
