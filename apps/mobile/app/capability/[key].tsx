import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { CapabilityView } from '@/components/progress/CapabilityView';
import { useScreenView } from '@/lib/useScreenView';

export default function Screen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  useScreenView('capability', key);
  return <CapabilityView />;
}
