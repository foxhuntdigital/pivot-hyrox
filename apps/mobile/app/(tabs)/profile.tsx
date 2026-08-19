/**
 * D22 Profile + D23 Equipment profiles.
 *
 * The considerations section is the sensitive one. It is used only to constrain
 * programming, is stored owner-only under RLS, and is excluded from analytics
 * (PRD §16) and from the AI coach's context beyond its granted purpose
 * (PRD §13.2). The copy says exactly that, and the copy is accurate.
 */
import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';

import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, Chip, SquareCheck } from '@/components/primitives';
import { useApp } from '@/state/store';
import { ATHLETE, CONSIDERATION_CHOICES } from '@/data/athlete';
import { EQUIPMENT_CHOICES } from '@/data/content';

const TIME_CHOICES = [15, 30, 45, 60, 90];

export default function ProfileScreen() {
  const { state, dispatch } = useApp();

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 16,
      }}>
        <View style={{
          width: 56, height: 56, backgroundColor: color.ink,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={[t.h4, { fontSize: 20, color: color.onDark }]}>{ATHLETE.initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[t.h4, { fontSize: 20, color: color.ink }]}>{ATHLETE.full_name}</Text>
          <Text style={[t.bodySm, { color: color.muted2 }]}>{ATHLETE.descriptor}</Text>
        </View>
      </View>
      <Rule heavy />

      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 16, paddingBottom: 6 }}>
        Equipment
      </Label>
      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 8,
        paddingHorizontal: space.gutter, paddingBottom: 4,
      }}>
        {EQUIPMENT_CHOICES.map(e => {
          const on = state.equipment.includes(e.id);
          return (
            <Pressable
              key={e.id}
              onPress={() => dispatch({ type: 'toggle_equipment', id: e.id })}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={e.name}
              style={{
                width: '31.5%', minHeight: 56, padding: 12, paddingHorizontal: 10,
                justifyContent: 'flex-end',
                borderWidth: 1, borderColor: on ? color.ink : color.chipBorder,
                backgroundColor: on ? color.ink : 'transparent',
              }}
            >
              <Text style={{
                fontFamily: t.rowTitle.fontFamily, fontSize: 11.5,
                color: on ? color.onDark : color.muted,
              }}>
                {e.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[t.meta, { paddingHorizontal: space.gutter, paddingTop: 10, color: color.muted }]}>
        {state.equipment.length} selected · tap to toggle what you have this week
      </Text>

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6 }}>
        <Rule />
      </View>
      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 6 }}>
        Schedule predictability
      </Label>
      <View style={{ paddingHorizontal: space.gutter }}>
        <View style={{ height: 8, backgroundColor: color.rule, marginVertical: 8 }}>
          <View style={{
            height: 8, width: `${state.typical_minutes > 45 ? 60 : 28}%`,
            backgroundColor: color.ink,
          }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Label size="xs" style={{ letterSpacing: 0.6 }}>Very predictable</Label>
          <Label size="xs" style={{ letterSpacing: 0.6 }}>Unpredictable</Label>
        </View>
        <Text style={[t.bodySm, { color: color.muted2, marginTop: 10 }]}>
          Set to <Text style={{ fontFamily: t.rowTitle.fontFamily }}>mostly unpredictable</Text>.
          Plans are generated with an Express and a Micro version of every session in advance.
        </Text>
      </View>

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6 }}>
        <Rule />
      </View>
      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 6 }}>
        Typical session length
      </Label>
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter }}>
        {TIME_CHOICES.map(v => (
          <Chip
            key={v} flex label={v === 90 ? '90+' : String(v)}
            active={state.typical_minutes === v}
            onPress={() => dispatch({ type: 'set_typical', minutes: v })}
            style={{ paddingVertical: 12 }}
          />
        ))}
      </View>

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6 }}>
        <Rule />
      </View>
      <View style={{
        flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
        paddingHorizontal: space.gutter, paddingTop: 8, paddingBottom: 6,
      }}>
        <Label tone="ink">Considerations</Label>
        <Label size="sm" style={{ letterSpacing: 0.9 }}>Private</Label>
      </View>
      <View style={{ paddingHorizontal: space.gutter }}>
        {CONSIDERATION_CHOICES.map(name => {
          const on = state.considerations.includes(name);
          return (
            <Pressable
              key={name}
              onPress={() => dispatch({ type: 'toggle_consideration', name })}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={name}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
              }}
            >
              <Text style={{
                fontFamily: t.greeting.fontFamily, fontSize: 13.5,
                color: on ? color.ink : color.muted2,
              }}>
                {name}
              </Text>
              <SquareCheck on={on} />
            </Pressable>
          );
        })}
        <Text style={[t.meta, { fontSize: 11.5, lineHeight: 17, color: color.muted, marginTop: 12 }]}>
          Used only to shape programming. Never shown in feeds, shared, or used for
          recommendations outside your plan.
        </Text>
      </View>
    </ScrollView>
  );
}
