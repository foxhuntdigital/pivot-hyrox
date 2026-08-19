/**
 * D18 Progress overview + D19 Metric detail.
 *
 * The readiness score is a product score, not a medical one (PRD §9.5): it
 * shows whole numbers, exposes its components, and surfaces its confidence
 * rather than implying precision it does not have.
 */
import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';

import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, InkPanel } from '@/components/primitives';
import { useApp } from '@/state/store';
import { METRIC_DETAIL } from '@/data/athlete';

/** Components the engine flags as limiters get the accent treatment. */
const LIMITERS = new Set(['running', 'recovery']);

export default function ProgressScreen() {
  const { state, dispatch, readiness } = useApp();

  const entries = Object.entries(readiness.components) as [keyof typeof readiness.components, number][];
  const lowest = entries.reduce((a, b) => (b[1] < a[1] ? b : a));

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6 }}>
        <Label>HYROX readiness</Label>
      </View>

      <View style={{
        flexDirection: 'row', alignItems: 'flex-end', gap: 14,
        paddingHorizontal: space.gutter, paddingBottom: 16,
      }}>
        <Text style={[t.hero, { color: color.ink }]}>{readiness.overall}</Text>
        <View style={{ paddingBottom: 8 }}>
          {/* Confidence is shown next to the score, never hidden behind it. */}
          <Text style={[t.rowTitle, { fontSize: 13, color: color.red }]}>
            {readiness.confidence} confidence
          </Text>
          <Text style={[t.meta, { color: color.muted }]}>
            {readiness.confidence === 'low' ? 'building baseline' : 'last 30 days'}
          </Text>
        </View>
      </View>
      <Rule heavy />

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 6 }}>
        {entries.map(([key, value]) => {
          const meta = METRIC_DETAIL[key];
          const open = state.open_metric === key;
          return (
            <Pressable
              key={key}
              onPress={() => dispatch({ type: 'toggle_metric', key })}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${meta?.label ?? key}, ${value} out of 100`}
              style={({ pressed }) => ({
                paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
                backgroundColor: pressed ? color.hover : 'transparent',
              })}
            >
              <View style={{
                flexDirection: 'row', alignItems: 'baseline',
                justifyContent: 'space-between', marginBottom: 7,
              }}>
                <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>
                  {meta?.label ?? key}
                </Text>
                <Text style={[t.h4, { fontSize: 15, color: color.ink }]}>{value}</Text>
              </View>
              {/* The bar is labelled by the number above it, so the meaning does
                  not rest on the fill colour alone (PRD §18). */}
              <View style={{ height: 8, backgroundColor: color.rule }}>
                <View style={{
                  height: 8, width: `${value}%`,
                  backgroundColor: LIMITERS.has(key) ? color.red : color.ink,
                }} />
              </View>

              {open && meta && (
                <View style={{ paddingTop: 12 }}>
                  <Text style={[t.bodySm, { color: color.muted2 }]}>{meta.detail}</Text>
                  <View style={{
                    flexDirection: 'row', marginTop: 10,
                    borderTopWidth: 1, borderTopColor: color.rule,
                  }}>
                    {meta.stats.map((st, i) => (
                      <View key={st.k} style={{
                        flex: 1, paddingTop: 9, paddingHorizontal: 10,
                        borderRightWidth: i === meta.stats.length - 1 ? 0 : 1,
                        borderRightColor: color.ruleFaint,
                      }}>
                        <Label size="xs">{st.k}</Label>
                        <Text style={[t.rowTitle, { marginTop: 2, color: color.ink }]}>{st.v}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <InkPanel
        label="Biggest opportunity"
        style={{ margin: 20, marginHorizontal: space.gutter }}
      >
        <Text style={[t.h4, { fontSize: 18, color: color.onDark }]}>
          {METRIC_DETAIL[lowest[0]]?.label ?? lowest[0]}
        </Text>
        <Text style={[t.bodySm, { color: color.rule, marginTop: 6, fontSize: 12.5 }]}>
          {METRIC_DETAIL[lowest[0]]?.detail}
        </Text>
      </InkPanel>
    </ScrollView>
  );
}
