/**
 * Onboarding stack (D02–D08).
 *
 * Gestures stay enabled so back-swipe works, but there is no header: each step
 * carries its own progress bar and Back affordance.
 */
import { Stack } from 'expo-router';

import { color } from '@/theme/tokens';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.paper },
        animation: 'slide_from_right',
      }}
    />
  );
}
