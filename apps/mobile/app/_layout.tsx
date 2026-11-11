import React, { useEffect, useState } from 'react';
import * as Sentry from '@sentry/react-native';
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
import { initAnalytics } from '@/lib/analytics';
import { initMonitoring } from '@/lib/monitoring';
import { AppProvider } from '@/state/store';
import { CoachProvider } from '@/state/coach';
import { SessionProvider, useSession } from '@/state/session';
import { EntitlementProvider, useEntitlement } from '@/state/entitlement';
import { OnboardingProvider, useOnboarding } from '@/state/onboarding';
import { TourProvider } from '@/state/tour';
import { DialogProvider } from '@/components/Dialog';
import { color } from '@/theme/tokens';

/**
 * Started at module scope rather than in an effect: the SDK queues events until
 * it is ready, so starting it before the first render means an event fired by a
 * provider's mount effect is held rather than dropped.
 *
 * Monitoring goes first, and for a stronger reason than ordering tidiness: a
 * crash while the providers mount is exactly the crash worth having, and an
 * `init` that ran after them would miss it.
 */
initMonitoring();
initAnalytics();

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
  const { lapsed, neverSubscribed, entitlement } = useEntitlement();
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
    // flow that creates one comes before the app rather than after it. It opens
    // on the explainer rather than the first question: the seven steps ask what
    // the athlete's constraints are without ever saying what is done with them.
    if (onboarding === 'needed' && !inOnboarding) {
      router.replace('/intro' as never);
      return;
    }
    if (onboarding !== 'complete') return;

    const route = segments as string[];
    const page = route[0] === '(onboarding)' ? route[1] : route[0];
    const onSubscribe = page === 'subscribe';

    // A plan exists but the athlete has never subscribed: they built it and
    // left at the trial offer (ready → trial). Back to the offer, with the
    // plan screen they just saw and Settings still open.
    if (neverSubscribed) {
      if (!['ready', 'trial', 'settings'].includes(page ?? '')) router.replace('/trial' as never);
      return;
    }

    // A subscription that has ended goes to the screen that says so, rather
    // than leaving the athlete in an app whose every request is refused.
    // Settings stays open (deleting an account must not need a subscription),
    // and so does a workout already under way, so it can be finished.
    if (lapsed) {
      if (!['subscribe', 'settings', 'active', 'done'].includes(page ?? '')) {
        router.replace('/subscribe' as never);
      }
      return;
    }

    // Not yet known (a read that failed or is still in flight): leave an
    // athlete inside onboarding where they are, rather than skipping them past
    // the plan and the offer on a guess.
    if (entitlement === null && inOnboarding) return;

    if (onSubscribe || inAuthGroup || inOnboarding) router.replace('/today' as never);
  }, [status, onboarding, lapsed, neverSubscribed, entitlement, segments, router]);

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

  return <Splash ready={ready} fontsLoaded={fontsLoaded} onDone={onDone} />;
}

function RootLayout() {
  const [loaded] = useFonts({
    Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold,
    Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black,
  });
  const [splashDone, setSplashDone] = useState(false);

  return (
    <SafeAreaProvider>
      <DialogProvider>
      <SessionProvider>
        <EntitlementProvider>
        <OnboardingProvider>
        <AppProvider>
          <CoachProvider>
          <TourProvider>
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
              <Stack.Screen name="history" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="readiness" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="capability/[key]" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="session/[id]" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="settings/[page]" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="active" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
              <Stack.Screen name="done" options={{ animation: 'fade', gestureEnabled: false }} />
              <Stack.Screen name="subscribe" options={{ animation: 'fade', gestureEnabled: false }} />
            </Stack>}
          </AuthGate>
          {!splashDone && <SplashGate fontsLoaded={loaded} onDone={() => setSplashDone(true)} />}
          </TourProvider>
          </CoachProvider>
        </AppProvider>
        </OnboardingProvider>
        </EntitlementProvider>
      </SessionProvider>
      </DialogProvider>
    </SafeAreaProvider>
  );
}

/**
 * Wrapped so the SDK sees what the app cannot report for itself: app-start
 * timing, navigation context, and a JS crash during the first render — the one
 * case where there is no mounted component left to catch it.
 */
export default Sentry.wrap(RootLayout);
