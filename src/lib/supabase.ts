import { createClient } from '@supabase/supabase-js';

// Quasar only exposes env variables that start with QCLI_ to the app.
// Put them in a local .env file (see .env.example). Use the publishable key only.
const env = import.meta.env as unknown as Record<string, string | undefined>;
const url = env.QCLI_SUPABASE_URL;
const key = env.QCLI_SUPABASE_KEY;

// Stays null when the variables are missing, so the app still runs with sample data.
export const supabase = url && key ? createClient(url, key) : null;

export type ConnectionStatus = {
  status: 'not-configured' | 'connected' | 'error';
  message?: string;
};

// A harmless read to prove the URL and key work. With no signed-in user the
// access rules return zero rows, which still counts as connected.
export async function checkConnection(): Promise<ConnectionStatus> {
  if (!supabase) return { status: 'not-configured' };
  const { error } = await supabase.from('classes').select('id').limit(1);
  return error ? { status: 'error', message: error.message } : { status: 'connected' };
}
