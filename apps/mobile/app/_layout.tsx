import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, ActivityIndicator } from 'react-native';
import {
  useFonts,
  Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold,
  Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black,
} from '@expo-google-fonts/archivo';

import { Splash } from '@/components/Splash';
import { AppProvider } from '@/state/store';
import { CoachProvider } from '@/state/coach';
import { SessionProvider, useSession } from '@/state/session';
import { OnboardingProvider, useOnboarding } from '@/state/onboarding';
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
  const { status: onboarding } = useOnboarding();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';

    if (status === 'signed_out' && !inAuthGroup) {
      router.replace('/sign-in' as never);
      return;
    }
    if (status !== 'signed_in') return;

    // A signed-in athlete with no program has nothing for Today to show, so the
    // flow that creates one comes before the app rather than after it.
    if (onboarding === 'needed' && !inOnboarding) {
      router.replace('/goal' as never);
    } else if (onboarding === 'complete' && (inAuthGroup || inOnboarding)) {
      router.replace('/today' as never);
    }
  }, [status, onboarding, segments, router]);

  // Holding rather than the app: rendering tabs for an unresolved session would
  // flash athlete data that may belong to a signed-out user, and rendering them
  // before the program lookup returns would flash an empty plan.
  if (status === 'loading') return <Holding />;
  if (status === 'signed_in' && onboarding === 'checking') return <Holding />;
  return <>{children}</>;
}

/**
 * Holds the splash open until there is something worth opening onto: the font
 * family, the session, and — for a signed-in athlete — the program lookup.
 * Without this the lane could finish drawing and part onto the spinner.
 */
function SplashGate({ fontsLoaded, onDone }: { fontsLoaded: boolean; onDone: () => void }) {
  const { status } = useSession();
  const { status: onboarding } = useOnboarding();
  const ready =
    fontsLoaded && status !== 'loading' && !(status === 'signed_in' && onboarding === 'checking');

  return <Splash ready={ready} onDone={onDone} />;
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold,
    Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black,
  });
  const [splashDone, setSplashDone] = useState(false);

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <OnboardingProvider>
        <AppProvider>
          <CoachProvider>
          <StatusBar style="dark" />
          <AuthGate>
            {/* The whole system is Archivo weights; rendering in a fallback face
                first would reflow every screen, so hold until the family is ready. */}
            {!loaded ? <Holding /> : <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: color.paper },
                animation: 'fade',
              }}
            >
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
              {/* A sheet over Today, not a screen instead of it — the same
                  presentation the Adapt sheet uses. */}
              <Stack.Screen
                name="checkin"
                options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }}
              />
              <Stack.Screen name="active" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
              <Stack.Screen name="done" options={{ animation: 'fade', gestureEnabled: false }} />
            </Stack>}
          </AuthGate>
          {!splashDone && <SplashGate fontsLoaded={loaded} onDone={() => setSplashDone(true)} />}
          </CoachProvider>
        </AppProvider>
        </OnboardingProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
