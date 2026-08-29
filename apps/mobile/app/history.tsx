/**
 * Training history — every completed session, newest first.
 *
 * The record of what an athlete actually did, as opposed to Progress, which is
 * six numbers derived from it. Each row shows the prescription next to the
 * performance, because "500 m prescribed, 450 done" is the useful fact and
 * either number alone is not.
 *
 * Read from `history`, which touches only stored sessions and their logs. It is
 * the surface that survives a lapsed subscription, so it must never depend on
 * the engine or on today's plan.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label } from '@/components/primitives';
import { fetchHistory, type HistorySession } from '@/data/historyRepo';
import { mmss } from '@/lib/format';

/** "Thu 20 Feb" — the day an athlete recognises, not an ISO string. */
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US',
    { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Sessions grouped under the month they happened in. */
function byMonth(sessions: HistorySession[]) {
  const groups: { label: string; items: HistorySession[] }[] = [];
  for (const s of sessions) {
    const d = new Date(`${s.date}T00:00:00Z`);
    const label = Number.isNaN(d.getTime())
      ? 'Earlier'
      : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(s);
    else groups.push({ label, items: [s] });
  }
  return groups;
}

export default function HistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<HistorySession[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (before?: string | null) => {
    const page = await fetchHistory(before);
    if (!page) { setSessions(prev => prev ?? []); return; }
    setSessions(prev => (before ? [...(prev ?? []), ...page.sessions] : page.sessions));
    setHasMore(page.has_more);
    setCursor(page.next_before);
  }, []);

  useEffect(() => { load(); }, [load]);

  const groups = byMonth(sessions ?? []);

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <View style={{
        paddingTop: insets.top + 12, paddingBottom: 14,
        paddingHorizontal: space.gutter,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Label tone="ink">Training history</Label>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Label tone="muted">Close</Label>
        </Pressable>
      </View>
      <Rule heavy />

      {sessions === null ? (
        <View style={{ paddingVertical: 60 }}><ActivityIndicator color={color.red} /></View>
      ) : sessions.length === 0 ? (
        <View style={{ padding: space.gutter, paddingTop: 40 }}>
          <Text style={[t.h4, { color: color.ink, fontSize: 17 }]}>Nothing completed yet</Text>
          <Text style={[t.bodySm, { color: color.muted2, marginTop: 8 }]}>
            Sessions appear here once you finish them. Every one keeps the prescription
            it was performed under, so this stays accurate even as the plan changes.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
          {groups.map(group => (
            <View key={group.label}>
              <View style={{
                paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 8,
              }}>
                <Label>{group.label}</Label>
              </View>
              {group.items.map(s => {
                const expanded = open === s.id;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setOpen(expanded ? null : s.id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${s.name}, ${formatDate(s.date)}`}
                    style={({ pressed }) => ({
                      paddingHorizontal: space.gutter, paddingVertical: 13,
                      borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
                      backgroundColor: pressed ? color.hover : 'transparent',
                    })}
                  >
                    <View style={{
                      flexDirection: 'row', alignItems: 'baseline',
                      justifyContent: 'space-between',
                    }}>
                      <Text style={[t.rowTitle, { fontSize: 14, color: color.ink, flex: 1 }]}>
                        {s.name}
                      </Text>
                      <Text style={[t.meta, { color: color.muted }]}>{formatDate(s.date)}</Text>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 5 }}>
                      {s.variant_label ? (
                        <Text style={[t.meta, { color: color.muted2 }]}>{s.variant_label}</Text>
                      ) : null}
                      {s.minutes != null ? (
                        <Text style={[t.meta, { color: color.muted2 }]}>{s.minutes} min</Text>
                      ) : null}
                      {s.session_rpe != null ? (
                        <Text style={[t.meta, { color: color.muted2 }]}>RPE {s.session_rpe}</Text>
                      ) : null}
                      {/* Ending early is a fact about the session, not a failure
                          — the plan adapts rather than keeping score (PRD §2). */}
                      {s.ended_early ? (
                        <Text style={[t.meta, { color: color.redDark }]}>ended early</Text>
                      ) : null}
                    </View>

                    {/* Splits, when the session recorded them.
                        
                        Above the movement totals on purpose: totals say what
                        was covered, splits say how it went, and how it went is
                        what an athlete opens an old session to remember. A
                        session finished before splits existed simply has none —
                        no empty table, no zeroes. */}
                    {expanded && (s.splits?.length ?? 0) > 0 && (
                      <View style={{
                        marginTop: 11, paddingTop: 10,
                        borderTopWidth: 1, borderTopColor: color.rule,
                      }}>
                        <Label style={{ paddingBottom: 4 }}>Splits</Label>
                        {s.splits.map(sp => (
                          <View key={sp.index} style={{
                            flexDirection: 'row', alignItems: 'baseline', gap: 10,
                            paddingVertical: 3,
                          }}>
                            <Text style={[t.meta, { width: 16, color: color.muted }]}>
                              {sp.index + 1}
                            </Text>
                            <Text style={[t.bodySm, {
                              flex: 1, color: sp.rest ? color.muted : color.muted2,
                            }]}>
                              {sp.rest ? 'Rest' : sp.label}
                              {sp.prescribed && !sp.rest ? ` · ${sp.prescribed}` : ''}
                            </Text>
                            <Text style={[t.bodySm, {
                              color: sp.rest ? color.muted : color.ink,
                            }]}>
                              {mmss(sp.seconds)}
                            </Text>
                            <Text style={[t.meta, {
                              width: 44, textAlign: 'right', color: color.muted,
                            }]}>
                              {mmss(sp.cumulative_seconds)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {expanded && s.movements.length > 0 && (
                      <View style={{
                        marginTop: 11, paddingTop: 10,
                        borderTopWidth: 1, borderTopColor: color.rule,
                      }}>
                        {s.movements.map(m => (
                          <View key={m.exercise_id} style={{
                            flexDirection: 'row', justifyContent: 'space-between',
                            paddingVertical: 3,
                          }}>
                            <Text style={[t.bodySm, { color: color.muted2, flex: 1 }]}>
                              {m.exercise}
                            </Text>
                            <Text style={[t.bodySm, { color: color.ink }]}>
                              {/* Prescribed only when it differs from what was
                                  done, so a session performed as written reads
                                  as one number rather than two identical ones. */}
                              {m.actual && m.prescribed && m.actual !== m.prescribed
                                ? `${m.prescribed} → ${m.actual}`
                                : m.actual ?? m.prescribed ?? '—'}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}

          {hasMore ? (
            <Pressable
              onPress={async () => {
                setLoadingMore(true);
                await load(cursor);
                setLoadingMore(false);
              }}
              style={{ padding: 20, alignItems: 'center' }}
              accessibilityRole="button"
            >
              {loadingMore
                ? <ActivityIndicator color={color.red} />
                : <Label tone="ink">Load earlier</Label>}
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
