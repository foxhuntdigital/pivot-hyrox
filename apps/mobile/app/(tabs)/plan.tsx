/**
 * The Plan tab.
 *
 * Direction A of the redesign (`PlanWeekView`) is the default. The tab it
 * replaces stays one tap away at the bottom of the screen, so the two can be
 * compared on a phone before the old one is deleted.
 */
import React from 'react';

import { LayoutSwitch } from '@/components/LayoutSwitch';
import { PlanWeekView } from '@/components/plan/PlanWeekView';
import { PlanLegacy } from '@/components/plan/PlanLegacy';
import { useLayout } from '@/state/uiPrefs';

export default function PlanScreen() {
  const [layout, choose] = useLayout('plan');
  return layout === 'old'
    ? <PlanLegacy footer={<LayoutSwitch tab="Plan" to="new" onPress={() => choose('new')} />} />
    : <PlanWeekView footer={<LayoutSwitch tab="Plan" to="old" onPress={() => choose('old')} />} />;
}
