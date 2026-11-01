import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import * as offline from '../lib/offline-store';

// Google sign-in through Supabase. Signing in is optional: guests can use every feature,
// and their data is saved on the device. Without Supabase settings (no .env), the sign-in
// button is hidden and the app works as a guest app only.
export const useAuthStore = defineStore('auth', () => {
  const enabled = supabase !== null;
  const session = ref<Session | null>(null);
  const ready = ref(!enabled);
  const errorMessage = ref('');
  let started = false;

  // Who is signed in. When the sign-in cannot be renewed because there is no connection,
  // the account that was signed in last is used, so the data kept on the device stays open.
  const offlineUser = ref<offline.CachedProfile | null>(null);
  const user = computed(() => session.value?.user ?? null);
  const profile = computed<offline.CachedProfile | null>(() => {
    const u = user.value;
    if (!u) return offlineUser.value;
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = meta[k];
        if (typeof v === 'string' && v) return v;
      }
      return '';
    };
    const email = u.email ?? '';
    return {
      id: u.id,
      email,
      name: pick('full_name', 'name') || email,
      avatarUrl: pick('avatar_url', 'picture'),
    };
  });
  const userId = computed(() => profile.value?.id ?? '');
  const email = computed(() => profile.value?.email ?? '');
  const signedIn = computed(() => profile.value !== null);
  const displayName = computed(() => profile.value?.name ?? '');
  const avatarUrl = computed(() => profile.value?.avatarUrl ?? '');

  function remember(next: Session | null) {
    session.value = next;
    if (next) {
      offlineUser.value = null;
      if (profile.value) offline.saveProfile(profile.value);
    }
  }

  async function init() {
    if (!supabase || started) return;
    started = true;
    try {
      const { data, error } = await supabase.auth.getSession();
      remember(data.session);
      // No session although someone was signed in: with no connection the sign-in cannot be
      // renewed, which is not the same as being signed out.
      const last = offline.loadProfile();
      if (!data.session && last && (error || !navigator.onLine)) offlineUser.value = last;
    } catch (e) {
      errorMessage.value = e instanceof Error ? e.message : 'Could not check the sign-in.';
    } finally {
      ready.value = true;
    }
    supabase.auth.onAuthStateChange((event, next) => {
      remember(next);
      if (event === 'SIGNED_OUT') {
        offlineUser.value = null;
        offline.clearProfile();
      }
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
    offlineUser.value = null;
    offline.clearProfile();
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
