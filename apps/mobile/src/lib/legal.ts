/**
 * Where the privacy policy and terms live, for the links Apple requires in a
 * subscription app (guideline 3.1.2) and that Settings › Account carries.
 *
 * Both are build-time settings so they can change without a code change. The
 * terms default to Apple's standard EULA, which App Store Connect uses when no
 * custom licence is set. The privacy policy has no default: a link to a page
 * that does not exist is worse than none, so it is hidden until it is set.
 */
import { Linking } from 'react-native';

export const APPLE_STANDARD_EULA = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

export const PRIVACY_POLICY_URL: string | null =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim() || null;

export const TERMS_URL: string =
  process.env.EXPO_PUBLIC_TERMS_URL?.trim() || APPLE_STANDARD_EULA;

export function openLegal(url: string): void {
  Linking.openURL(url).catch(() => {});
}
