/**
 * D09 Today — the daily decision surface.
 *
 * Acceptance criteria (PRD §8.3): race and days remaining above the fold;
 * recommendation name, purpose, duration and variant visible without
 * scrolling; Start is the dominant CTA and Adapt is obviously available; a
 * neutral state instead of fabricated precision when data is thin.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { VARIANT_LABEL } from '@pivot/engine';
import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, ActionButton, InkPanel } from '@/components/primitives';
import { AdaptSheet } from '@/components/AdaptSheet';
import { useApp } from '@/state/store';
import { ATHLETE, PHASE, PHASE_SEQUENCE, RACE, WEEK_STIMULI } from '@/data/athlete';
import { exerciseById } from '@/data/content';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** The phase ribbon: completed dark, current red, upcoming grey. */
function PhaseBars() {
  const currentIndex = PHASE_SEQUENCE.findIndex(p => p.key === PHASE.type);
  return (
    <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter, paddingBottom: 16 }}>
      {PHASE_SEQUENCE.map((p, i) => {
        const isCurrent = i === currentIndex;
        const isDone = i < currentIndex;
        return (
          <View key={p.key} style={{ flex: 1, gap: 5 }}>
            <View style={{
              height: 4,
              backgroundColor: isCurrent ? color.red : isDone ? color.ink : color.rule,
            }} />
            <Text style={[t.labelXs, {
              color: isCurrent ? color.red : isDone ? color.ink : color.muted3,
            }]}>
              {p.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function StatCell({ label, children, last }: {
  label: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <View style={{
      flex: 1, paddingTop: 12, paddingBottom: 14, paddingHorizontal: 14,
      borderRightWidth: last ? 0 : 1, borderRightColor: color.rule,
    }}>
      <Label size="sm">{label}</Label>
      <View style={{ marginTop: 4 }}>{children}</View>
    </View>
  );
}

export default function TodayScreen() {
  const router = useRouter();
  const { state, dispatch, session, readiness } = useApp();
  const [sheetOpen, setSheetOpen] = useState(false);

  const weekDone = WEEK_STIMULI.reduce((n, r) => n + r.completed_exposures, 0)
    + (state.completed_today ? 1 : 0);
  const weekTarget = WEEK_STIMULI.reduce((n, r) => n + r.target_exposures, 0);

  const start = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    dispatch({ type: 'start_workout' });
    router.push('/active');
  };

  return (
    <>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        <View style={{ paddingHorizontal: space.gutter, paddingTop: 20, paddingBottom: 16 }}>
          <Text style={[t.greeting, { color: color.ink }]}>
            {greeting()}, {ATHLETE.first_name}
          </Text>
        </View>
        <Rule />

        {/* Race + countdown, above the fold by construction. */}
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end', gap: 12,
          paddingHorizontal: space.gutter, paddingTop: 16, paddingBottom: 14,
        }}>
          <View style={{ flex: 1 }}>
            <Label style={{ marginBottom: 6 }}>Next goal</Label>
            <Text style={[t.h4, { color: color.ink, lineHeight: 21 }]}>{RACE.name}</Text>
            <Text style={[t.bodySm, { color: color.muted2, marginTop: 2 }]}>
              {RACE.date} · {RACE.division}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[t.countdown, { color: color.ink }]}>{RACE.days_remaining}</Text>
            <Label>Days</Label>
          </View>
        </View>

        <PhaseBars />
        <Rule heavy />

        <View style={{ flexDirection: 'row' }}>
          <StatCell label="Status">
            <Text style={[t.h4, { fontSize: 15, color: color.ink }]}>ON TRACK</Text>
          </StatCell>
          <StatCell label="Readiness">
            <Text style={[t.h4, { fontSize: 15, color: color.ink }]}>
              {readiness.overall}
              <Text style={[t.meta, { color: color.muted }]}>/100</Text>
            </Text>
          </StatCell>
          <StatCell label="Sleep" last>
            <Text style={[t.h4, { fontSize: 15, color: color.red }]}>4:10</Text>
          </StatCell>
        </View>
        <Rule />

        {/* The nudge only appears while the athlete has not yet adapted. */}
        {!state.adapted && !state.completed_today && (
          <InkPanel label="Check in" style={{ paddingHorizontal: space.gutter }}>
            <Text style={[t.body, { color: color.onDarkSoft, maxWidth: 300 }]}>
              Sleep was low last night and today's session is long. Tell me what you
              actually have and I'll rebuild it.
            </Text>
            <ActionButton
              label="Check in & adapt"
              onPress={() => setSheetOpen(true)}
              style={{ marginTop: 14 }}
            />
          </InkPanel>
        )}

        <View style={{ paddingHorizontal: space.gutter, paddingTop: 18 }}>
          <Label>Today's training</Label>
        </View>

        {session.kind === 'session' ? (
          <>
            <View style={{
              margin: 10, marginHorizontal: space.gutter, marginBottom: 0,
              borderWidth: 2, borderColor: color.ink,
            }}>
              <View style={{
                flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: color.rule,
              }}>
                <View style={{ flex: 1, padding: 14, paddingHorizontal: 16 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <View style={{
                      width: 8, height: 8,
                      backgroundColor: state.adapted ? color.red : color.ink,
                    }} />
                    <Text style={[t.labelSm, {
                      fontSize: 9, letterSpacing: 1.44,
                      color: state.adapted ? color.red : color.ink,
                    }]}>
                      {VARIANT_LABEL[session.variant.variant_code]}
                    </Text>
                  </View>
                  <Text style={[t.h3, { color: color.ink }]}>{session.template.name}</Text>
                  <Text style={[t.bodySm, { color: color.muted2, marginTop: 3 }]}>
                    {session.primary_stimulus.replace(/_/g, ' ')} · {session.template.description}
                  </Text>
                </View>
                <View style={{
                  width: 92, borderLeftWidth: 1, borderLeftColor: color.rule,
                  justifyContent: 'center', paddingLeft: 14,
                }}>
                  <Text style={[t.sessionMins, { color: color.ink }]}>
                    {session.estimated_minutes}
                  </Text>
                  <Label size="sm" style={{ letterSpacing: 1.26 }}>Min</Label>
                </View>
              </View>

              {/* Rationale. Every adaptation must explain itself (PRD §2). */}
              {state.adapted && (
                <View style={{
                  backgroundColor: color.tint, borderBottomWidth: 1,
                  borderBottomColor: color.tintBorder, padding: 12, paddingHorizontal: 16,
                }}>
                  <Label tone="redDark" size="sm" style={{ letterSpacing: 1.26, marginBottom: 4 }}>
                    Adapted · still on track
                  </Label>
                  <Text style={[t.bodySm, { color: color.redDeep, fontSize: 12.5 }]}>
                    {session.rationale}
                  </Text>
                </View>
              )}

              <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 }}>
                {session.blocks.map((b, i) => (
                  <View key={b.id ?? i} style={{
                    flexDirection: 'row', gap: 12, paddingVertical: 9,
                    borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
                  }}>
                    <Text style={[t.rowTitle, { fontSize: 13, width: 56, color: color.ink }]}>
                      {b.rounds && b.rounds > 1 ? `${b.rounds} ×` : `${b.duration_minutes ?? ''} min`}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[t.body, { fontFamily: t.greeting.fontFamily, fontSize: 13, color: color.ink }]}>
                        {b.title ?? b.block_type}
                      </Text>
                      <Text style={[t.meta, { color: color.muted }]}>
                        {b.exercises.map(e =>
                          exerciseById.get(e.exercise_id)?.name ?? e.exercise_id).join(' · ')}
                      </Text>
                    </View>
                  </View>
                ))}
                <Label style={{ paddingTop: 10, letterSpacing: 1.32, fontSize: 11 }}>
                  Total {session.estimated_minutes} min · {session.template.coaching_notes}
                </Label>
              </View>
            </View>

            <View style={{
              flexDirection: 'row', gap: 10,
              paddingHorizontal: space.gutter, paddingTop: 14,
            }}>
              <ActionButton label="Start workout" onPress={start} style={{ flex: 1 }} />
              <ActionButton
                label="Adapt" variant="outline" arrow={null}
                onPress={() => setSheetOpen(true)}
              />
            </View>
          </>
        ) : (
          /* No valid session. Recovery guidance, not a forced recommendation. */
          <View style={{ marginHorizontal: space.gutter, marginTop: 10 }}>
            <InkPanel label="No session today">
              <Text style={[t.body, { color: color.onDarkSoft }]}>{session.guidance}</Text>
            </InkPanel>
            <ActionButton
              label="Adjust what I have" variant="outline"
              onPress={() => setSheetOpen(true)} style={{ marginTop: 10 }}
            />
          </View>
        )}

        <View style={{ paddingHorizontal: space.gutter, paddingTop: 22, paddingBottom: 8 }}>
          <Rule heavy />
        </View>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: color.rule }}>
          <View style={{
            flex: 1, paddingTop: 12, paddingBottom: 14, paddingHorizontal: space.gutter,
            borderRightWidth: 1, borderRightColor: color.rule,
          }}>
            <Label size="sm">This week</Label>
            <Text style={[t.h4, { fontSize: 20, marginTop: 4, color: color.ink }]}>
              {weekDone}
              <Text style={[t.bodySm, { color: color.muted }]}> / {weekTarget} stimuli</Text>
            </Text>
          </View>
          <View style={{ flex: 1, paddingTop: 12, paddingBottom: 14, paddingHorizontal: space.gutter }}>
            <Label size="sm">Load 7d</Label>
            <Text style={[t.h4, { fontSize: 20, marginTop: 4, color: color.ink }]}>
              412<Text style={[t.bodySm, { color: color.muted }]}> au</Text>
            </Text>
          </View>
        </View>

        <Text style={[t.bodySm, {
          paddingHorizontal: space.gutter, paddingTop: 14, color: color.muted2,
        }]}>
          Last night's sleep and Tuesday's session are both factored into today's
          options. Nothing is marked missed.
        </Text>
      </ScrollView>

      <AdaptSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
