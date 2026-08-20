/**
 * Auth session (PRD §6.1, D01–D08).
 *
 * The session is the app's outermost state: the athlete's own rows are all
 * owner-scoped under RLS, so which rows exist at all depends on who is signed
 * in. It therefore sits above AppProvider rather than beside it.
 *
 * `unconfigured` is a first-class status, not an error. Without credentials the
 * app runs on the bundled library and the seeded athlete, so the build stays
 * usable before a Supabase project is attached.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type AuthStatus = 'loading' | 'signed_in' | 'signed_out' | 'unconfigured';

interface SessionStore {
  status: AuthStatus;
  session: Session | null;
  email: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<SessionStore | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(
    isSupabaseConfigured ? 'loading' : 'unconfigured');

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    // Resolve the persisted session first so a returning athlete is not shown
    // the sign-in screen for a frame before their token is read from storage.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setStatus(data.session ? 'signed_in' : 'signed_out');
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setStatus(next ? 'signed_in' : 'signed_out');
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(), password,
    });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    // display_name rides along in user metadata so the provisioning trigger can
    // seed athlete_profiles in the same transaction as the auth insert.
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() } },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo<SessionStore>(() => ({
    status,
    session,
    email: session?.user.email ?? null,
    signIn, signUp, signOut,
  }), [status, session, signIn, signUp, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
