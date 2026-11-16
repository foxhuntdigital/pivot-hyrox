/** Training history. */
import React from 'react';
import { useScreenView } from '@/lib/useScreenView';

import { HistoryView } from '@/components/progress/HistoryView';

export default function HistoryScreen() {
  useScreenView('history');
  return <HistoryView />;
}
