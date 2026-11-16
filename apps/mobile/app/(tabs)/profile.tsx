/** The Profile tab. */
import React from 'react';
import { useScreenView } from '@/lib/useScreenView';

import { ProfileView } from '@/components/profile/ProfileView';

export default function ProfileScreen() {
  useScreenView('profile');
  return <ProfileView />;
}
