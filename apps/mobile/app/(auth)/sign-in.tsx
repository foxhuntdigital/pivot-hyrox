/**
 * D01 Sign in / create account (PRD §6.1).
 *
 * Email and password only. Apple and Google are configured in the Supabase
 * project but disabled there, so they are not offered here — an inert provider
 * button is worse than an absent one.
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
  const { signIn, signUp } = useSession();

  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === 'sign_up';
  const canSubmit =
    email.trim().length > 0 && password.length > 0 &&
    (!isSignUp || name.trim().length > 0) && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (isSignUp) await signUp(email, password, name);
      else await signIn(email, password);
      // No navigation here: the session listener flips status and AuthGate
      // redirects, so there is one path into the app rather than two.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
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
          <Text style={[t.eyebrow, { color: color.ink }]}>PIVOT</Text>
        </View>

        <View style={{ paddingHorizontal: space.gutter, paddingBottom: 18 }}>
          <Text style={[t.h1, { color: color.ink }]}>
            {isSignUp ? 'Create your\naccount' : 'Welcome\nback'}
          </Text>
          <Text style={[t.bodySm, { color: color.muted2, marginTop: 10 }]}>
            {isSignUp
              ? 'Training that adapts to your life without losing the objective.'
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
            <Field
              label="Password" value={password} onChangeText={setPassword}
              secureTextEntry autoCapitalize="none"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              placeholder="••••••••"
              onSubmitEditing={submit} returnKeyType="go"
            />

            {error ? (
              <View style={{
                backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
                paddingHorizontal: 13, paddingVertical: 12, marginBottom: 16,
              }}>
                <Text style={[t.bodySm, { color: color.redDeep }]}>{error}</Text>
              </View>
            ) : null}

            <ActionButton
              label={busy ? 'Working…' : isSignUp ? 'Create account' : 'Sign in'}
              variant="primary"
              onPress={submit}
              style={{ opacity: canSubmit ? 1 : 0.45 }}
            />

            <Pressable
              onPress={() => { setMode(isSignUp ? 'sign_in' : 'sign_up'); setError(null); }}
              style={{ paddingVertical: 18 }}
            >
              <Text style={[t.bodySm, { color: color.muted2, textAlign: 'center' }]}>
                {isSignUp ? 'Already have an account? ' : 'New here? '}
                <Text style={{ fontFamily: t.rowTitle.fontFamily, color: color.ink }}>
                  {isSignUp ? 'Sign in' : 'Create one'}
                </Text>
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
