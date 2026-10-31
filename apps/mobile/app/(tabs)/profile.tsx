/**
 * The Profile tab.
 *
 * The redesign (`ProfileView`, what you have told the app in plain words, with
 * an edit page behind each row) is the default. The tab it replaces stays one
 * tap away at the bottom of the screen until the new one is settled.
 */
import React from 'react';

import { LayoutSwitch } from '@/components/LayoutSwitch';
import { ProfileLegacy } from '@/components/profile/ProfileLegacy';
import { ProfileView } from '@/components/profile/ProfileView';
import { useLayout } from '@/state/uiPrefs';

export default function ProfileScreen() {
  const [layout, choose] = useLayout('profile');
  return layout === 'old'
    ? <ProfileLegacy footer={<LayoutSwitch tab="Profile" to="new" onPress={() => choose('new')} />} />
    : <ProfileView footer={<LayoutSwitch tab="Profile" to="old" onPress={() => choose('old')} />} />;
}
