/**
 * C07 Plan change review.
 *
 * The confirmation gate for a meaningful weekly change (Coach brief §5.6). It
 * is a full screen rather than an alert because the athlete has to be able to
 * read what moves, what drops and what that costs before agreeing — and because
 * nothing here is applied until they do.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { color, type as t, space } from '@/theme/tokens';
import { Label, Rule, ActionButton } from '@/components/primitives';
import type { PlanProposal } from '@/state/coachAnswer';

export function PlanChangeReview({ proposal, visible, onApply, onCancel }: {
  proposal: PlanProposal | null;
  visible: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!proposal) return null;

  const apply = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onApply();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: insets.top }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: space.gutter, paddingVertical: 12,
        }}>
          <Text style={[t.eyebrow, { fontSize: 11, letterSpacing: 1.54, color: color.ink }]}>
            Review plan change
          </Text>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Close without applying"
            hitSlop={10}
            style={({ pressed }) => ({
              width: 32, height: 32, borderWidth: 1, borderColor: color.ink,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: pressed ? color.hover : 'transparent',
            })}
          >
            <Text style={{ fontFamily: t.rowTitle.fontFamily, fontSize: 13, color: color.ink }}>✕</Text>
          </Pressable>
        </View>
        <Rule heavy />

        <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
          <Text style={[t.h2, {
            fontSize: 22, lineHeight: 24, letterSpacing: -0.55,
            paddingHorizontal: space.gutter, paddingTop: 16, color: color.ink,
          }]}>
            {proposal.title}
          </Text>
          <Text style={[t.bodySm, {
            fontSize: 12.5, lineHeight: 18.75, color: color.muted2,
            paddingHorizontal: space.gutter, paddingTop: 6, paddingBottom: 14,
          }]}>
            {proposal.lede} Nothing below is applied until you confirm.
          </Text>

          <Label size="sm" style={{ paddingHorizontal: space.gutter, paddingBottom: 6, letterSpacing: 1.4 }}>
            Affected sessions
          </Label>
          <View style={{ paddingHorizontal: space.gutter }}>
            {proposal.rows.map(row => (
              <View
                key={`${row.name}-${row.verb}-${row.detail}`}
                style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.ruleFaint }}
                accessibilityLabel={`${row.name}. ${row.verb}. ${row.detail}`}
              >
                <View style={{
                  flexDirection: 'row', alignItems: 'baseline',
                  justifyContent: 'space-between', gap: 10,
                }}>
                  <Text style={[t.rowTitle, { fontSize: 13.5, color: color.ink, flexShrink: 1 }]}>
                    {row.name}
                  </Text>
                  {/* The verb is text, not a colour, so "Drops" reads as
                      "Drops" with colour turned off (brief §13). */}
                  <View style={{
                    borderWidth: 1,
                    borderColor: row.emphasis ? color.redDark : color.muted2,
                    paddingVertical: 3, paddingHorizontal: 6,
                  }}>
                    <Text style={[t.labelSm, {
                      fontSize: 9, letterSpacing: 1.08,
                      color: row.emphasis ? color.redDark : color.muted2,
                    }]}>
                      {row.verb}
                    </Text>
                  </View>
                </View>
                <Text style={[t.meta, { fontSize: 11.5, color: color.muted, marginTop: 3 }]}>
                  {row.detail}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ paddingHorizontal: space.gutter, paddingTop: 18 }}>
            <Rule heavy />
          </View>
          <Label size="sm" style={{
            paddingHorizontal: space.gutter, paddingTop: 14, paddingBottom: 2, letterSpacing: 1.4,
          }}>
            Training impact
          </Label>
          <View style={{ paddingHorizontal: space.gutter }}>
            {proposal.impact.map(row => (
              <View
                key={`${row.text}-${row.tag}`}
                style={{
                  flexDirection: 'row', alignItems: 'baseline', gap: 12,
                  paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
                }}
              >
                <Text style={[t.bodySm, { flex: 1, fontSize: 12.5, lineHeight: 17.5, color: color.ink }]}>
                  {row.text}
                </Text>
                <Text style={[t.labelSm, {
                  fontSize: 9, letterSpacing: 1.08,
                  color: row.reduced ? color.redDark : color.ink,
                }]}>
                  {row.tag}
                </Text>
              </View>
            ))}
          </View>

          <View style={{
            marginHorizontal: space.gutter, marginTop: 16,
            borderWidth: 1, borderColor: color.rule, backgroundColor: color.card,
            paddingVertical: 12, paddingHorizontal: 14,
          }}>
            <Text style={[t.bodySm, { fontSize: 12.5, lineHeight: 18, color: color.muted2 }]}>
              {proposal.consequence}
            </Text>
          </View>

          <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, gap: 8 }}>
            <ActionButton label="Apply changes" onPress={apply} style={{ paddingVertical: 18 }} />
            <ActionButton
              label="Cancel" variant="outline" arrow={null}
              onPress={onCancel} style={{ paddingVertical: 18 }}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
