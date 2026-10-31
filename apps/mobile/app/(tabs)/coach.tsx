/**
 * The Coach tab. The redesign (`CoachView`) is the default, with the layout it
 * replaces one tap away on Coach home while the two are compared on a phone.
 * Both run the same behaviour (`useCoachController`).
 */
import React from 'react';

import { LayoutSwitch } from '@/components/LayoutSwitch';
import { CoachLegacy } from '@/components/coach/CoachLegacy';
import { CoachView } from '@/components/coach/CoachView';
import { useLayout } from '@/state/uiPrefs';

export default function CoachScreen() {
  const [layout, choose] = useLayout('coach');
  return layout === 'old'
    ? <CoachLegacy footer={<LayoutSwitch tab="Coach" to="new" onPress={() => choose('new')} />} />
    : <CoachView footer={<LayoutSwitch tab="Coach" to="old" onPress={() => choose('old')} />} />;
}
