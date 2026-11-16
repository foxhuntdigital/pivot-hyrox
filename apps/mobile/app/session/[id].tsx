import React from 'react';

import { SessionView } from '@/components/progress/SessionView';
import { useScreenView } from '@/lib/useScreenView';

export default function Screen() {
  useScreenView('session_detail');
  return <SessionView />;
}
