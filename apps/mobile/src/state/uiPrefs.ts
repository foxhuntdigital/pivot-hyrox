/**
 * Layout choices a person makes on this device while a redesign is compared
 * with what it replaces. Device-only on purpose: it is a preview switch, not a
 * setting, and it goes when the old layout does.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PLAN_KEY = 'pivot.ui.plan-layout';

export type PlanLayout = 'new' | 'old';

/** The Plan tab's layout. New unless this device chose the old one. */
export function usePlanLayout(): [PlanLayout, (next: PlanLayout) => void] {
  const [layout, setLayout] = useState<PlanLayout>('new');

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(PLAN_KEY)
      .then(v => { if (alive && (v === 'old' || v === 'new')) setLayout(v); })
      .catch(() => { /* unreadable storage: keep the default */ });
    return () => { alive = false; };
  }, []);

  const choose = useCallback((next: PlanLayout) => {
    setLayout(next);
    AsyncStorage.setItem(PLAN_KEY, next).catch(() => { /* the choice still holds for this session */ });
  }, []);

  return [layout, choose];
}
