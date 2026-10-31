/**
 * Layout choices a person makes on this device while a redesign is compared
 * with what it replaces. Device-only on purpose: it is a preview switch, not a
 * setting, and it goes when the old layout does.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Layout = 'new' | 'old';

/** A redesigned tab's layout. New unless this device chose the old one. */
export function useLayout(tab: 'plan' | 'today' | 'coach' | 'progress'): [Layout, (next: Layout) => void] {
  const key = `pivot.ui.${tab}-layout`;
  const [layout, setLayout] = useState<Layout>('new');

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key)
      .then(v => { if (alive && (v === 'old' || v === 'new')) setLayout(v); })
      .catch(() => { /* unreadable storage: keep the default */ });
    return () => { alive = false; };
  }, [key]);

  const choose = useCallback((next: Layout) => {
    setLayout(next);
    AsyncStorage.setItem(key, next).catch(() => { /* the choice still holds for this session */ });
  }, [key]);

  return [layout, choose];
}
