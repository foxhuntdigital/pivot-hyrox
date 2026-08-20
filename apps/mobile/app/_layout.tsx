import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, ActivityIndicator } from 'react-native';
import {
  useFonts,
  Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold,
  Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black,
} from '@expo-google-fonts/archivo';

import { AppProvider } from '@/state/store';
import { SessionProvider, useSession } from '@/state/session';
import { color } from '@/theme/tokens';

function Holding() {
  return (
    <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center' }}>
      <ActivityIndicator color={color.red} />
    </View>
  );
}

/**
 * Routes on the session (PRD §6.1).
 *
 * `unconfigured` deliberately falls through to the app: with no Supabase
 * project attached the build runs on the seeded athlete, and gating it behind a
 * sign-in screen that cannot succeed would make the app unusable rather than
 * honest about what is connected.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const inAuthGroup = segments[0] === '(auth)';
    if (status === 'signed_out' && !inAuthGroup) {
      router.replace('/sign-in' as never);
    } else if (status === 'signed_in' && inAuthGroup) {
      router.replace('/today' as never);
    }
  }, [status, segments, router]);

  // Holding rather than the app: rendering tabs for an unresolved session would
  // flash athlete data that may belong to a signed-out user.
  if (status === 'loading') return <Holding />;
  return <>{children}</>;
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold,
    Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black,
  });

  // The whole system is Archivo weights; rendering in a fallback face first
  // would reflow every screen, so hold until the family is ready.
  if (!loaded) return <Holding />;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <AppProvider>
          <StatusBar style="dark" />
          <AuthGate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: color.paper },
                animation: 'fade',
              }}
            >
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="active" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
              <Stack.Screen name="done" options={{ animation: 'fade', gestureEnabled: false }} />
            </Stack>
          </AuthGate>
        </AppProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
