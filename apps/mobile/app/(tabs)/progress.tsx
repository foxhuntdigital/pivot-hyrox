/**
 * D18 Progress overview + D19 Metric detail.
 *
 * The readiness score is a product score, not a medical one (PRD §9.5): it
 * shows whole numbers, exposes its components, and surfaces its confidence
 * rather than implying precision it does not have.
 */
import React, { useCallback } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { color, numeralTrim, type as t, space } from '@/theme/tokens';
import { Rule, Label, InkPanel } from '@/components/primitives';
import { useApp } from '@/state/store';
import { track } from '@/lib/analytics';



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

  /**
   * Whether the screen has enough behind it to rank anything.
   *
   * "Biggest opportunity" is a comparison, and a comparison needs something to
   * compare. It used to appear as soon as a single component was measured —
   * which for a brand-new athlete is `consistency`, scored 0 against a week
   * they have not had yet — and named that the thing to work on. Half the
   * components is the floor for calling one of them the limiter.
   */
  const canRank = measured.length >= Math.ceil(entries.length / 2);

  /**
   * §16 pairs the score's confidence with its weakest component, which is the
   * combination that says whether the number is worth showing at all — a low
   * confidence with no measured component is an athlete who has logged nothing,
   * not an athlete who is unready. On focus, for the same reason as Today.
   */
  const confidence = readiness.confidence;
  const componentLowest = lowest?.[0] ?? null;
  useFocusEffect(
    useCallback(() => {
      track({
        name: 'readiness_viewed',
        confidence,
        component_lowest: componentLowest,
      });
    }, [confidence, componentLowest]),
  );

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
          {/* What the number actually rests on. "last 30 days" claimed a
              window of training behind a score that may be resting on one
              measured component; the count cannot overstate itself. */}
          <Text style={[t.meta, { color: color.muted }]}>
            {readiness.overall === null
              ? 'nothing logged yet'
              : `from ${measured.length} of ${entries.length} measures`}
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

              {/* What this row will be read from, said without waiting for a tap.
                  
                  An empty bar and a dash are honest but say nothing, and a new
                  athlete had to open each row to find out what any of them
                  meant. The description is the only true thing there is to show
                  before the athlete has trained, so it is shown. */}
              {!observed.has(key) && meta && (
                <Text style={[t.meta, { color: color.muted3, marginTop: 7 }]}>
                  {meta.detail}
                </Text>
              )}

              {open && meta && (
                <View style={{ paddingTop: 12 }}>
                  {/* The sentence is already under the bar when nothing has been
                      measured, so expanding repeats it. What the disclosure adds
                      there is why there is no number, not the description again. */}
                  {observed.has(key) ? (
                    <Text style={[t.bodySm, { color: color.muted2 }]}>{meta.detail}</Text>
                  ) : (
                    <Text style={[t.bodySm, { color: color.muted2 }]}>
                      Nothing logged against this yet, so it is not counted in the
                      score above rather than counted as a zero.
                    </Text>
                  )}
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

      {/* The two states that cannot carry a "biggest opportunity", said plainly
          rather than left as six dashes with no explanation. */}
      {!canRank && (
        <InkPanel
          label={measured.length ? 'Still building' : 'No readiness yet'}
          style={{ margin: 20, marginHorizontal: space.gutter }}
        >
          <Text style={[t.bodySm, { color: color.onDarkSoft }]}>
            {measured.length
              ? `${measured.length} of ${entries.length} measures have data behind them. `
                + 'The rest fill in as you train, and there is no weakest link to '
                + 'name until enough of them do.'
              : 'Nothing has been logged yet, so there is no score to show and '
                + 'nothing to say about where you stand. Finish a session or a '
                + 'check-in and these start filling in.'}
          </Text>
        </InkPanel>
      )}

      {lowest && canRank && (
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
