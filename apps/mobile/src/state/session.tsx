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

/**
 * What `signUp` could not communicate by throwing. With email confirmation on,
 * Supabase creates the user but withholds the session until the emailed link is
 * clicked: no error is raised and no auth event fires, so the status never
 * leaves `signed_out` and the route gate has nothing to redirect on. The caller
 * has to be told, or the screen waits on a redirect that will never come.
 */
export interface SignUpResult {
  needsConfirmation: boolean;
}

interface SessionStore {
  status: AuthStatus;
  session: Session | null;
  email: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<SignUpResult>;
  signOut(): Promise<void>;
  /**
   * Sends a recovery code. Resolves the same way whether or not the address has
   * an account — see the implementation for why.
   */
  requestPasswordReset(email: string): Promise<void>;
  /** Exchanges the emailed code for a session, then sets the new password. */
  confirmPasswordReset(email: string, code: string, password: string): Promise<void>;
  /** Sends the signup confirmation again, for the one that never arrived. */
  resendConfirmation(email: string): Promise<void>;
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
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() } },
    });
    if (error) throw error;
    // A null session here means confirmation is pending, not that signup failed.
    return { needsConfirmation: data.session === null };
  }, []);

  /**
   * Password recovery, by code rather than by link.
   *
   * Supabase's recovery email can carry either. A link has to come back into a
   * native app through a registered scheme and an allowlisted redirect, and it
   * fails silently and unhelpfully when either is missing. A six-digit code the
   * athlete types has one failure mode and it says what it is.
   *
   * Requires the recovery email template to render `{{ .Token }}` — the default
   * template sends only the link.
   */
  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    // A wrong address is not an error the caller should see differently from a
    // right one: answering "no account here" to an unauthenticated request
    // tells a stranger which addresses are registered.
    if (error && error.status !== 400) throw error;
  }, []);

  const confirmPasswordReset = useCallback(
    async (email: string, code: string, password: string) => {
      if (!supabase) throw new Error('Supabase is not configured.');
      // The code proves the athlete holds the inbox, which is what earns the
      // session the password change is then made under.
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(), token: code.trim(), type: 'recovery',
      });
      if (verifyError) throw verifyError;

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      // They are signed in now; the auth listener flips status and the gate
      // takes them into the app, so there is no second sign-in to perform.
    }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
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
    requestPasswordReset, confirmPasswordReset, resendConfirmation,
  }), [status, session, signIn, signUp, signOut,
       requestPasswordReset, confirmPasswordReset, resendConfirmation]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
