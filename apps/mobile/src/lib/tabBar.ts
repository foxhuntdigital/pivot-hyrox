/**
 * The height of the tab bar, in one place.
 *
 * The tab bar is not the navigator's. `(tabs)/_layout` passes
 * `tabBar={() => null}` and renders its own as a SIBLING of `<Tabs>`, so a tab
 * screen's frame ends where the bar begins and nothing inside that screen can
 * measure what sits below it. `useBottomTabBarHeight` would answer for a bar
 * that is not being drawn.
 *
 * That matters for the keyboard. A screen with a text field at its bottom edge
 * has to lift it by the part of the keyboard that actually covers the screen —
 * the keyboard's height minus this — and `KeyboardAvoidingView` cannot work
 * that out from inside a frame that excludes the bar.
 *
 * So the measurements live here and the bar is built from them, rather than the
 * bar owning them and every other screen guessing.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { rule } from '@/theme/tokens';

/** The touch target of one tab. */
export const TAB_ROW_HEIGHT = 52;

/** The floor under the home-indicator inset, so the bar is never cramped. */
export const TAB_BOTTOM_MIN = 12;

/** Total height of the bar, including its rule and the safe-area inset. */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return rule.heavy + TAB_ROW_HEIGHT + Math.max(insets.bottom, TAB_BOTTOM_MIN);
}
