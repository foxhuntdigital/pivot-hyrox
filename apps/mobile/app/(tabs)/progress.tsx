/**
 * D18 Progress overview + D19 Metric detail.
 *
 * The readiness score is a product score, not a medical one (PRD §9.5): it
 * shows whole numbers, exposes its components, and surfaces its confidence
 * rather than implying precision it does not have.
 */
import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';

import { color, numeralTrim, type as t, space } from '@/theme/tokens';
import { Rule, Label, InkPanel } from '@/components/primitives';
import { useApp } from '@/state/store';



export default function ProgressScreen() {
  const { state, dispatch, readiness, metricDetail } = useApp();

  const entries = Object.entries(readiness.components) as [keyof typeof readiness.components, number][];
  // Only measured components are scored, so only they can be the limiter — an
  // athlete who has never logged a strength set does not have strength as their
  // weakness, they have it as an unknown.
  const observed = new Set<string>(readiness.observed);
  const measured = entries.filter(([k]) => observed.has(k));
  const lowest = measured.length
    ? measured.reduce((a, b) => (b[1] < a[1] ? b : a))
    : null;
  // The accent marks the athlete's actual limiter. It used to be a fixed pair
  // of components, so it stayed red on a strong runner and never appeared on a
  // weak one, contradicting the score beside it.
  const isLimiter = (key: string) => key === lowest?.[0];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6 }}>
        <Label>HYROX readiness</Label>
      </View>

      <View style={{
        flexDirection: 'row', alignItems: 'flex-end', gap: 14,
        paddingHorizontal: space.gutter, paddingBottom: 16,
      }}>
        <Text style={[t.hero, numeralTrim.hero, { color: color.ink }]}>
          {readiness.overall ?? '—'}
        </Text>
        <View style={{ paddingBottom: 8 }}>
          {/* Confidence is shown next to the score, never hidden behind it. */}
          <Text style={[t.rowTitle, { fontSize: 13, color: color.red }]}>
            {readiness.confidence} confidence
          </Text>
          <Text style={[t.meta, { color: color.muted }]}>
            {readiness.overall === null ? 'nothing logged yet'
              : readiness.confidence === 'low' ? 'building baseline' : 'last 30 days'}
          </Text>
        </View>
      </View>
      <Rule heavy />

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 6 }}>
        {entries.map(([key, value]) => {
          const meta = metricDetail[key];
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
                <Text style={[t.h4, {
                  fontSize: 15, color: observed.has(key) ? color.ink : color.muted,
                }]}>
                  {observed.has(key) ? value : '—'}
                </Text>
              </View>
              {/* The bar is labelled by the number above it, so the meaning does
                  not rest on the fill colour alone (PRD §18). */}
              <View style={{ height: 8, backgroundColor: color.rule }}>
                {/* An unmeasured component gets no fill: an empty bar would
                    read as a score of zero rather than as no data. */}
                {observed.has(key) && <View style={{
                  height: 8, width: `${value}%`,
                  backgroundColor: isLimiter(key) ? color.red : color.ink,
                }} />}
              </View>

              {open && meta && (
                <View style={{ paddingTop: 12 }}>
                  <Text style={[t.bodySm, { color: color.muted2 }]}>{meta.detail}</Text>
                  {meta.stats.length > 0 && <View style={{
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
                  </View>}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {lowest && (
        <InkPanel
          label="Biggest opportunity"
          style={{ margin: 20, marginHorizontal: space.gutter }}
        >
          <Text style={[t.h4, { fontSize: 18, color: color.onDark }]}>
            {metricDetail[lowest[0]]?.label ?? lowest[0]}
          </Text>
          <Text style={[t.bodySm, { color: color.rule, marginTop: 6, fontSize: 12.5 }]}>
            {metricDetail[lowest[0]]?.detail}
          </Text>
        </InkPanel>
      )}
    </ScrollView>
  );
}
