/**
 * Supabase client.
 *
 * Credentials come from the environment, never from the repo. When they are
 * absent the app runs against the bundled content library and the seeded
 * athlete instead of failing to start — the same posture the app takes toward
 * an unconnected health source (PRD §8.3): show an honest disconnected state
 * rather than invent one.
 */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Null when unconfigured. Callers check `isSupabaseConfigured` rather than
 * receiving a client that throws on first use.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        // There is no URL to read a session back from in a native app; leaving
        // this on makes the client wait on a browser redirect that never comes.
        detectSessionInUrl: false,
      },
    })
  : null;
