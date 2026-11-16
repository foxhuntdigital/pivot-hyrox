/** The Plan tab. */
import React from 'react';
import { useScreenView } from '@/lib/useScreenView';

import { PlanWeekView } from '@/components/plan/PlanWeekView';

export default function PlanScreen() {
  useScreenView('plan');
  return <PlanWeekView />;
}
