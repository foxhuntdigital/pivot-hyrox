/** The Coach tab. */
import React from 'react';
import { useScreenView } from '@/lib/useScreenView';

import { CoachView } from '@/components/coach/CoachView';

export default function CoachScreen() {
  useScreenView('coach');
  return <CoachView />;
}
