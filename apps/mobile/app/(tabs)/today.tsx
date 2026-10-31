/**
 * The Today tab.
 *
 * The redesign (`TodayView`, the session as the hero) is the default. The tab
 * it replaces stays one tap away at the bottom of the screen, so the two can
 * be compared on a phone before the old one is deleted.
 */
import React from 'react';

import { LayoutSwitch } from '@/components/LayoutSwitch';
import { TodayView } from '@/components/today/TodayView';
import { TodayLegacy } from '@/components/today/TodayLegacy';
import { useLayout } from '@/state/uiPrefs';

export default function TodayScreen() {
  const [layout, choose] = useLayout('today');
  return layout === 'old'
    ? <TodayLegacy footer={<LayoutSwitch tab="Today" to="new" onPress={() => choose('new')} />} />
    : <TodayView footer={<LayoutSwitch tab="Today" to="old" onPress={() => choose('old')} />} />;
}
