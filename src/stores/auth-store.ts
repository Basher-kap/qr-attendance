import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// Every allowed account is a clerk for now. A student role is planned for later.
export type Role = 'clerk';
export type AuthStatus = 'loading' | 'signed-out' | 'not-authorized' | 'ready' | 'error';

// Google sign-in through Supabase, plus the allow-list check against app_users.
// Without Supabase settings (no .env), the app stays open and uses sample data.
export const useAuthStore = defineStore('auth', () => {
  const enabled = supabase !== null;
  const session = ref<Session | null>(null);
  const role = ref<Role | null>(null);
  const status = ref<AuthStatus>(enabled ? 'loading' : 'ready');
  const errorMessage = ref('');
  let started = false;

  const user = computed(() => session.value?.user ?? null);
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

  // The app opens only for allowed accounts (or always in sample-data mode).
  const canUse = computed(() => !enabled || status.value === 'ready');

  async function refreshRole() {
    if (!supabase) return;
    if (!session.value) {
      role.value = null;
      status.value = 'signed-out';
      return;
    }
    const { data, error } = await supabase
      .from('app_users')
      .select('email')
      .eq('email', email.value.toLowerCase())
      .maybeSingle();
    if (error) {
      errorMessage.value = error.message;
      status.value = 'error';
      return;
    }
    if (data) {
      // On the allow-list. Everyone is a clerk for now; student access will read the role column later.
      role.value = 'clerk';
      status.value = 'ready';
    } else {
      role.value = null;
      status.value = 'not-authorized';
    }
  }

  async function init() {
    if (!supabase || started) return;
    started = true;
    const { data } = await supabase.auth.getSession();
    session.value = data.session;
    await refreshRole();
    supabase.auth.onAuthStateChange((_event, next) => {
      session.value = next;
      // Do not call Supabase straight from this callback; defer it.
      setTimeout(() => {
        void refreshRole();
      }, 0);
    });
  }

  // prompt: 'select_account' makes Google show the account chooser every time,
  // including the "Use another account" option.
  async function signIn() {
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) {
      errorMessage.value = error.message;
      status.value = 'error';
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    session.value = null;
    role.value = null;
    status.value = 'signed-out';
  }

  return {
    enabled,
    status,
    role,
    errorMessage,
    email,
    signedIn,
    displayName,
    avatarUrl,
    canUse,
    init,
    refreshRole,
    signIn,
    signOut,
  };
});
