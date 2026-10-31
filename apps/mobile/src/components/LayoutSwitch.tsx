/**
 * The preview link at the bottom of a redesigned tab: flips between the new
 * layout and the one it replaces, so the two can be compared on a phone.
 * Goes when the old layouts do.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';

import { color, space, type as t } from '@/theme/tokens';
import type { Layout } from '@/state/uiPrefs';

export function LayoutSwitch({ tab, to, onPress }: { tab: string; to: Layout; onPress: () => void }) {
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
        {to === 'old' ? `Preview: back to the old ${tab} layout` : `Preview: try the new ${tab} layout`}
      </Text>
    </Pressable>
  );
}
