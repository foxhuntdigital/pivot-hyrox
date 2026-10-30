/**
 * The Plan tab.
 *
 * Direction A of the redesign (`PlanWeekView`) is the default. The tab it
 * replaces stays one tap away at the bottom of the screen, so the two can be
 * compared on a phone before the old one is deleted.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';

import { color, space, type as t } from '@/theme/tokens';
import { PlanWeekView } from '@/components/plan/PlanWeekView';
import { PlanLegacy } from '@/components/plan/PlanLegacy';
import { usePlanLayout, type PlanLayout } from '@/state/uiPrefs';

function SwitchLayout({ to, onPress }: { to: PlanLayout; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        marginHorizontal: space.gutter, marginTop: 28, paddingVertical: 12,
        alignItems: 'center', opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={[t.bodySm, {
        fontFamily: t.rowTitle.fontFamily, color: color.muted2, textDecorationLine: 'underline',
      }]}>
        {to === 'old' ? 'Preview: back to the old Plan layout' : 'Preview: try the new Plan layout'}
      </Text>
    </Pressable>
  );
}

export default function PlanScreen() {
  const [layout, choose] = usePlanLayout();
  return layout === 'old'
    ? <PlanLegacy footer={<SwitchLayout to="new" onPress={() => choose('new')} />} />
    : <PlanWeekView footer={<SwitchLayout to="old" onPress={() => choose('old')} />} />;
}
