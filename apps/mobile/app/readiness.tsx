import React from 'react';

import { ReadinessView } from '@/components/progress/ReadinessView';
import { useScreenView } from '@/lib/useScreenView';

export default function Screen() {
  useScreenView('readiness');
  return <ReadinessView />;
}
