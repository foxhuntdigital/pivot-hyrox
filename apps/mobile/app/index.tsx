/**
 * Entry redirect.
 *
 * The four tabs are named routes (`today`, `plan`, `progress`, `profile`), so
 * nothing matches `/` on a cold launch or deep link. Where `/` resolves to
 * depends on the session, so it is decided here rather than pointing blindly at
 * Today and letting the auth gate bounce the athlete back out.
 */
import React from 'react';
import { Redirect } from 'expo-router';
import { View } from 'react-native';

import { useSession } from '@/state/session';
import { color } from '@/theme/tokens';

export default function Index() {
  const { status } = useSession();

  if (status === 'loading') return <View style={{ flex: 1, backgroundColor: color.paper }} />;
  if (status === 'signed_out') return <Redirect href="/sign-in" />;
  return <Redirect href="/today" />;
}
