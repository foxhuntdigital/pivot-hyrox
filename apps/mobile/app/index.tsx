/**
 * Entry redirect.
 *
 * The four tabs are named routes (`today`, `plan`, `progress`, `profile`), so
 * nothing matches `/` on a cold launch or deep link. Today is the app's home
 * surface, so `/` resolves there rather than rendering an unmatched route.
 */
import React from 'react';
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/today" />;
}
