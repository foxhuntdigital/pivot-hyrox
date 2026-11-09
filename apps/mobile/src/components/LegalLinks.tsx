/**
 * Privacy policy and Terms of Use, as two text links. Used under the paywall
 * and on Settings › Account, the two places review looks for them.
 */
import React from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';

import { color, type as t } from '@/theme/tokens';
import { PRIVACY_POLICY_URL, TERMS_URL, openLegal } from '@/lib/legal';

export function LegalLinks({ style }: { style?: ViewStyle }) {
  const links = [
    PRIVACY_POLICY_URL ? { label: 'Privacy Policy', url: PRIVACY_POLICY_URL } : null,
    { label: 'Terms of Use', url: TERMS_URL },
  ].filter((l): l is { label: string; url: string } => l !== null);

  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }, style]}>
      {links.map(l => (
        <Pressable key={l.label} onPress={() => openLegal(l.url)} hitSlop={10}
          accessibilityRole="link" accessibilityLabel={l.label}>
          <Text style={[t.meta, { color: color.ink, textDecorationLine: 'underline' }]}>{l.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
