/**
 * The Progress tab.
 *
 * The redesign (`ProgressView`, glanceable cards with subpages behind them) is
 * the default. The tab it replaces stays one tap away at the bottom of the
 * screen, so the two can be compared on a phone before the old one is deleted.
 */
import React from 'react';

import { LayoutSwitch } from '@/components/LayoutSwitch';
import { ProgressLegacy } from '@/components/progress/ProgressLegacy';
import { ProgressView } from '@/components/progress/ProgressView';
import { useLayout } from '@/state/uiPrefs';

export default function ProgressScreen() {
  const [layout, choose] = useLayout('progress');
  return layout === 'old'
    ? <ProgressLegacy footer={<LayoutSwitch tab="Progress" to="new" onPress={() => choose('new')} />} />
    : <ProgressView footer={<LayoutSwitch tab="Progress" to="old" onPress={() => choose('old')} />} />;
}
