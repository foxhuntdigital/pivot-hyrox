/**
 * Training history.
 *
 * Follows the Progress tab's layout choice: the redesigned list when Progress
 * shows the new layout, the old screen when it shows the old one.
 */
import React from 'react';

import { HistoryLegacy } from '@/components/progress/HistoryLegacy';
import { HistoryView } from '@/components/progress/HistoryView';
import { useLayout } from '@/state/uiPrefs';

export default function HistoryScreen() {
  const [layout] = useLayout('progress');
  return layout === 'old' ? <HistoryLegacy /> : <HistoryView />;
}
