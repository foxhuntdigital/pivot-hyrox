/** One of Profile's edit pages, by name (`SettingsPages.tsx`). */
import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { PAGES, SettingsPage, type Page } from '@/components/profile/SettingsPages';
import { useScreenView } from '@/lib/useScreenView';

export default function SettingsScreen() {
  const { page } = useLocalSearchParams<{ page: string }>();
  useScreenView('settings', page);
  if (!(PAGES as readonly string[]).includes(page)) return <Redirect href={'/profile' as never} />;
  return <SettingsPage page={page as Page} />;
}
