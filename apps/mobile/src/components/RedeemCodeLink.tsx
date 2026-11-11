/**
 * "Have a code?": opens Apple's offer-code sheet. Shown only where a code can
 * actually be redeemed (iOS, with purchases in the build). What happens after
 * is the caller's business: a redemption arrives as a RevenueCat update, not as
 * a result from the sheet.
 */
import React from 'react';
import { Pressable, Text, type ViewStyle } from 'react-native';

import { color, type as t } from '@/theme/tokens';
import { canRedeemCodes } from '@/lib/purchases';

export function RedeemCodeLink({ onPress, style }: { onPress: () => void; style?: ViewStyle }) {
  if (!canRedeemCodes()) return null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Redeem an offer code"
      style={[{ paddingVertical: 12, alignItems: 'center' }, style]}
    >
      <Text style={[t.bodySm, { color: color.muted2 }]}>
        Have a code?{' '}
        <Text style={{ fontFamily: t.rowTitle.fontFamily, color: color.ink }}>Redeem it</Text>
      </Text>
    </Pressable>
  );
}
