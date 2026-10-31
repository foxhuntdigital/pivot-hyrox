/**
 * The profile read or write that failed, said as which one it was.
 *
 * A failed read is news about this device, not about the athlete's answers:
 * the rows still show the last good read, and a retry is offered. A failed
 * write says the change was not saved, without snapping the field back.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';

import { color, space, type as t } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import { useApp } from '@/state/store';

export function ProfileError() {
  const { profileError, refreshProfile } = useApp();
  if (!profileError) return null;
  return (
    <View style={{
      marginHorizontal: space.gutter, marginBottom: 14,
      backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
      paddingHorizontal: 13, paddingVertical: 12,
    }}>
      <Label tone="redDark" size="sm" style={{ marginBottom: 4 }}>
        {profileError.kind === 'save' ? 'Not saved' : "Couldn't refresh"}
      </Label>
      <Text style={[t.bodySm, { color: color.redDeep }]}>{profileError.message}</Text>
      {profileError.kind === 'load' ? (
        <>
          <Text style={[t.bodySm, { color: color.redDeep, marginTop: 6 }]}>
            What is shown is the last version this device read. Nothing you have saved has been lost.
          </Text>
          <Pressable onPress={refreshProfile} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: 8 }}>
            <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, color: color.redDeep }]}>Try again</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
