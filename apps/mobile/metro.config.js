/**
 * Metro config, wrapped by Sentry.
 *
 * The project had no `metro.config.js` — Expo's default was fine. It needs one
 * now for two reasons, both about crash reports being readable:
 *
 *   * `getSentryExpoConfig` installs the serializer that stamps a debug id into
 *     the bundle and emits the matching source map. Without it the uploaded map
 *     cannot be tied to the bundle that crashed, and every production frame
 *     reads as `index.android.bundle:1:284619`.
 *   * `autoWrapExpoRouterErrorBoundary` rewrites each route's
 *     `export { ErrorBoundary } from 'expo-router'` at build time. Expo Router
 *     catches a render error per route and shows its own screen; the error is
 *     handled, so nothing reaches Sentry. Wrapping is what makes a screen that
 *     fails to render an issue rather than a silent fallback.
 *
 * `includeWebReplay` / `includeWebFeedback` are off because the app ships to
 * iOS and Android only — they would add the web replay bundles to the native
 * build for nothing.
 */
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname, {
  autoWrapExpoRouterErrorBoundary: true,
  includeWebReplay: false,
  includeWebFeedback: false,
});

module.exports = config;
