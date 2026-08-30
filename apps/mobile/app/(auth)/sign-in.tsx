/**
 * D01 Sign in / create account / recover (PRD §6.1).
 *
 * Email and password only. Apple and Google are configured in the Supabase
 * project but disabled there, so they are not offered here — an inert provider
 * button is worse than an absent one.
 *
 * Recovery is a third mode rather than a second screen. It is the same two
 * fields plus a code, it is reached from a moment of being stuck, and a route
 * change there costs the athlete the email address they already typed.
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, ActionButton } from '@/components/primitives';
import { useSession } from '@/state/session';
import { isSupabaseConfigured } from '@/lib/supabase';

function Field({
  label, value, onChangeText, ...rest
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Label tone="ink" style={{ marginBottom: 7 }}>{label}</Label>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={color.muted3}
        style={{
          borderWidth: 1, borderColor: color.chipBorder,
          paddingHorizontal: 13, paddingVertical: 14,
          fontFamily: t.rowTitle.fontFamily, fontSize: 14, color: color.ink,
        }}
        {...rest}
      />
    </View>
  );
}

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const {
    signIn, signUp, requestPasswordReset, confirmPasswordReset, resendConfirmation,
  } = useSession();

  const [mode, setMode] = useState<'sign_in' | 'sign_up' | 'recover'>('sign_in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Separate from `error`: a pending confirmation is a successful signup, and
  // reads as one. Reusing the error banner would call it a failure.
  const [notice, setNotice] = useState<string | null>(null);
  // Offered only after a signup that needs one, so it is not a permanent
  // invitation to send mail to an address nobody has registered.
  const [canResend, setCanResend] = useState(false);

  const isSignUp = mode === 'sign_up';
  const isRecover = mode === 'recover';
  const hasEmail = email.trim().length > 0;

  const canSubmit = !busy && hasEmail && (
    isRecover
      // Before the code is sent, the address is all that is needed. After, the
      // code and the new password are what the button acts on.
      ? (!codeSent || (code.trim().length > 0 && password.length > 0))
      : password.length > 0 && (!isSignUp || name.trim().length > 0));

  function go(next: 'sign_in' | 'sign_up' | 'recover') {
    setMode(next);
    setError(null);
    setNotice(null);
    setCode('');
    setCodeSent(false);
    if (next !== 'sign_in') setCanResend(false);
    if (next === 'recover') setPassword('');
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (isRecover && !codeSent) {
        await requestPasswordReset(email);
        setCodeSent(true);
        // Worded so it says the same thing whether or not the address has an
        // account: the screen must not become a way to test which do.
        setNotice(`If ${email.trim()} has an account, a six-digit code is on its way. `
          + 'Enter it below with the password you want.');
      } else if (isRecover) {
        await confirmPasswordReset(email, code, password);
        // Signed in as a side effect of the reset; the gate takes it from here.
      } else if (isSignUp) {
        const { needsConfirmation } = await signUp(email, password, name);
        // The account exists either way. When a session came back the listener
        // takes over; when it did not, this is the only thing that will tell
        // the athlete the signup worked.
        if (needsConfirmation) {
          setNotice(`Account created. Check ${email.trim()} for a confirmation link, then sign in.`);
          setMode('sign_in');
          setPassword('');
          setCanResend(true);
        }
      } else {
        await signIn(email, password);
      }
      // No navigation here: the session listener flips status and AuthGate
      // redirects, so there is one path into the app rather than two.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await resendConfirmation(email);
      setNotice(`Confirmation sent again to ${email.trim()}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend the confirmation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 28, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          paddingHorizontal: space.gutter, paddingBottom: 22,
        }}>
          <View style={{ width: 12, height: 12, backgroundColor: color.red }} />
          <Text style={[t.eyebrow, { color: color.ink }]}>PIVOT ENGINE</Text>
        </View>

        <View style={{ paddingHorizontal: space.gutter, paddingBottom: 18 }}>
          <Text style={[t.h1, { color: color.ink }]}>
            {isSignUp ? 'Create your\naccount'
              : isRecover ? 'Reset your\npassword'
                : 'Welcome\nback'}
          </Text>
          <Text style={[t.bodySm, { color: color.muted2, marginTop: 10 }]}>
            {isSignUp
              ? 'Training that adapts to your life without losing the objective.'
              : isRecover
                ? 'We will email you a six-digit code. Enter it with the password you want.'
                : 'Sign in to pick your plan back up.'}
          </Text>
        </View>
        <Rule heavy />

        {!isSupabaseConfigured ? (
          <View style={{ paddingHorizontal: space.gutter, paddingTop: 20 }}>
            <Label tone="ink" style={{ marginBottom: 8 }}>Not connected</Label>
            <Text style={[t.bodySm, { color: color.muted2 }]}>
              No Supabase project is configured for this build, so accounts are
              unavailable. Copy <Text style={{ fontFamily: t.rowTitle.fontFamily }}>.env.example</Text>{' '}
              to <Text style={{ fontFamily: t.rowTitle.fontFamily }}>.env</Text>, add your project
              URL and anon key, then restart the dev server.
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: space.gutter, paddingTop: 20 }}>
            {isSignUp ? (
              <Field
                label="Name" value={name} onChangeText={setName}
                autoCapitalize="words" autoComplete="name" placeholder="Ashley Kerr"
              />
            ) : null}
            <Field
              label="Email" value={email} onChangeText={setEmail}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
              autoComplete="email" placeholder="you@example.com"
            />
            {/* In recovery the password field is what the athlete is setting,
                so it appears only once there is a code to set it against. */}
            {isRecover && codeSent ? (
              <Field
                label="Code from your email" value={code} onChangeText={setCode}
                keyboardType="number-pad" autoCapitalize="none" autoComplete="one-time-code"
                maxLength={8} placeholder="123456"
              />
            ) : null}

            {!isRecover || codeSent ? (
              <Field
                label={isRecover ? 'New password' : 'Password'}
                value={password} onChangeText={setPassword}
                secureTextEntry autoCapitalize="none"
                autoComplete={isSignUp || isRecover ? 'new-password' : 'current-password'}
                placeholder="••••••••"
                onSubmitEditing={submit} returnKeyType="go"
              />
            ) : null}

            {notice ? (
              <View style={{
                backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
                paddingHorizontal: 13, paddingVertical: 12, marginBottom: 16,
              }}>
                <Text style={[t.bodySm, { color: color.ink }]}>{notice}</Text>
              </View>
            ) : null}

            {error ? (
              <View style={{
                backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
                paddingHorizontal: 13, paddingVertical: 12, marginBottom: 16,
              }}>
                <Text style={[t.bodySm, { color: color.redDeep }]}>{error}</Text>
              </View>
            ) : null}

            <ActionButton
              label={busy ? 'Working…'
                : isRecover ? (codeSent ? 'Set new password' : 'Email me a code')
                  : isSignUp ? 'Create account' : 'Sign in'}
              variant="primary"
              onPress={submit}
              style={{ opacity: canSubmit ? 1 : 0.45 }}
            />

            {/* Offered where being locked out is felt, and only there. */}
            {mode === 'sign_in' ? (
              <Pressable onPress={() => go('recover')} style={{ paddingTop: 16 }}>
                <Text style={[t.bodySm, {
                  color: color.ink, textAlign: 'center', fontFamily: t.rowTitle.fontFamily,
                }]}>
                  Forgot your password?
                </Text>
              </Pressable>
            ) : null}

            {/* Only after a signup that actually needs confirming. */}
            {mode === 'sign_in' && canResend ? (
              <Pressable onPress={busy ? undefined : resend} style={{ paddingTop: 14 }}>
                <Text style={[t.bodySm, { color: color.muted2, textAlign: 'center' }]}>
                  Confirmation email not arrived?{' '}
                  <Text style={{ fontFamily: t.rowTitle.fontFamily, color: color.ink }}>
                    Send it again
                  </Text>
                </Text>
              </Pressable>
            ) : null}

            {isRecover && codeSent ? (
              <Pressable
                onPress={busy ? undefined : () => { setCodeSent(false); setCode(''); setNotice(null); }}
                style={{ paddingTop: 14 }}
              >
                <Text style={[t.bodySm, { color: color.muted2, textAlign: 'center' }]}>
                  Code did not arrive?{' '}
                  <Text style={{ fontFamily: t.rowTitle.fontFamily, color: color.ink }}>
                    Send another
                  </Text>
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => go(isRecover ? 'sign_in' : isSignUp ? 'sign_in' : 'sign_up')}
              style={{ paddingVertical: 18 }}
            >
              <Text style={[t.bodySm, { color: color.muted2, textAlign: 'center' }]}>
                {isRecover ? 'Remembered it? ' : isSignUp ? 'Already have an account? ' : 'New here? '}
                <Text style={{ fontFamily: t.rowTitle.fontFamily, color: color.ink }}>
                  {isRecover || isSignUp ? 'Sign in' : 'Create one'}
                </Text>
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
