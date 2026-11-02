/**
 * The two capacity questions, opened from Today's "Two questions we didn't
 * ask" card. The page itself is Profile's Fitness and experience page
 * (`SettingsPages.tsx`), so the questions are asked and saved one way
 * wherever they are reached; only the back link differs.
 */
import React from 'react';

import { SettingsPage } from '@/components/profile/SettingsPages';

export default function CapacityScreen() {
  return <SettingsPage page="fitness" backTo="Today" />;
}
