/**
 * Rewrites incoming links before Expo Router matches them. Only auth-email
 * redirects are touched (see `isAuthCallback`): opening one now lands on the
 * app's start, where the auth gate sends the athlete to sign-in or Today,
 * rather than on "Unmatched Route".
 */
import { isAuthCallback } from '@/lib/authLinks';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    if (isAuthCallback(path)) return initial ? '/' : null;
    return path;
  } catch {
    return initial ? '/' : null;
  }
}
