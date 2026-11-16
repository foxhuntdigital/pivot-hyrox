/**
 * Records a screen view each time the screen comes into focus.
 *
 * Autocapture's screen views are off (see `initAnalytics`), so the screens
 * that matter are named here instead, with an optional detail that is never
 * athlete data (a settings page key, a capability key).
 */
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

import { track } from '@/lib/analytics';

export function useScreenView(screen: string, detail?: string | null): void {
  useFocusEffect(useCallback(() => {
    track({ name: 'screen_viewed', screen, detail: detail ?? null });
  }, [screen, detail]));
}
