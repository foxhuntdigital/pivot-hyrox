/**
 * Training history, redesigned (redesign plan, Training history, approved).
 *
 * Opens from the calendar's History link. A count of everything trained, type
 * filters, the sessions-waiting banner, and month headers with that month's
 * count and time. Each row is a session at a glance: the day, its type, its
 * shape, minutes and RPE, whether it ended early or was extra, and any best it
 * set. A row opens the session. The error and empty states are the old
 * screen's, kept as they were: a failed read is never shown as an empty record.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, kindColor, kindLabel, space, type as t, type SessionKind } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import { Chevron, SessionShape, SubpageHeader, TypeTag } from '@/components/system';
import { lookOf } from '@/components/plan/weekData';
import { kindOf, useProgressModel } from '@/components/progress/model';
import { fetchHistory, type HistorySession } from '@/data/historyRepo';
import { displayName } from '@/data/planWeek';
import { monthName, monthTotals, shortDate, weekday } from '@/data/progressView';
import { rememberSessions } from '@/state/progress';
import { useApp } from '@/state/store';

const FILTERS: (SessionKind | 'all')[] = ['all', 'run', 'erg', 'station', 'strength', 'hybrid'];
const fmtLoad = (n: number, unit: string | null) => `${Number.isInteger(n) ? n : n.toFixed(1)}${unit ? ` ${unit}` : ''}`;

/** A history entry's kind and shape, from the blocks it was performed under. */
export function entryLook(s: HistorySession) {
  if (!s.template_id) return null;
  return lookOf(s.template_id, s.blocks?.length ? s.blocks : undefined);
}

export function bestLine(r: NonNullable<HistorySession['records']>[number]): string {
  return r.kind === 'load'
    ? `${r.exercise} ${fmtLoad(r.value, r.unit)} (was ${fmtLoad(r.previous, r.unit)})`
    : `${r.exercise} ${r.value} reps (was ${r.previous})`;
}

export function HistoryView() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pendingSync } = useApp();
  const { payload } = useProgressModel();
  const [sessions, setSessions] = useState<HistorySession[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SessionKind | 'all'>('all');

  const load = useCallback(async (before?: string | null) => {
    const result = await fetchHistory(before);
    if (result.status === 'error') { setError(result.message); return; }
    setError(null);
    if (result.status === 'unconfigured') { setSessions(prev => prev ?? []); return; }
    const { page } = result;
    rememberSessions(page.sessions);
    setSessions(prev => (before ? [...(prev ?? []), ...page.sessions] : page.sessions));
    setHasMore(page.has_more);
    setCursor(page.next_before);
  }, []);

  useEffect(() => { load(); }, [load]);

  const retry = useCallback(() => { setError(null); setSessions(null); load(); }, [load]);
  const more = async () => { setLoadingMore(true); await load(cursor); setLoadingMore(false); };

  const today = payload?.today ?? new Date().toISOString().slice(0, 10);
  const index = payload?.sessions ?? [];
  const oldest = index[index.length - 1];

  const groups = useMemo(() => {
    const shown = (sessions ?? []).filter(s => filter === 'all' || (entryLook(s)?.kind ?? kindOf({ template_id: s.template_id ?? '' })) === filter);
    const out: { month: string; items: HistorySession[] }[] = [];
    for (const s of shown) {
      const month = s.date.slice(0, 7);
      const last = out[out.length - 1];
      if (last?.month === month) last.items.push(s);
      else out.push({ month, items: [s] });
    }
    return out;
  }, [sessions, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: insets.top }}>
      <SubpageHeader backTo="Progress" onBack={() => router.back()} />
      {error && sessions === null ? (
        <View style={{ padding: space.gutter, paddingTop: 40 }}>
          <Text style={[t.h4, { color: color.ink, fontSize: 17 }]}>Couldn't load your history</Text>
          <Text style={[t.bodySm, { color: color.muted2, marginTop: 8 }]}>
            Your sessions are safe — this device just couldn't reach them. Check your
            connection and try again.
          </Text>
          <Text style={[t.meta, { color: color.muted3, marginTop: 8 }]}>{error}</Text>
          <Pressable
            onPress={retry}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginTop: 16, alignSelf: 'flex-start', paddingHorizontal: 18, paddingVertical: 13,
              backgroundColor: pressed ? color.redPressed : color.red,
            })}
          >
            <Text style={[t.button, { color: color.onDark }]}>Try again</Text>
          </Pressable>
        </View>
      ) : sessions === null ? (
        <View style={{ paddingVertical: 60 }}><ActivityIndicator color={color.red} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
          <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, gap: 4 }}>
            <Text style={[t.h2, { color: color.ink }]}>Training history</Text>
            {index.length ? (
              <Text style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>
                {index.length} {index.length === 1 ? 'session' : 'sessions'} since {shortDate(oldest.date)}.
              </Text>
            ) : null}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingHorizontal: space.gutter, paddingVertical: 14 }}
            accessibilityRole="radiogroup" accessibilityLabel="Filter by type">
            {FILTERS.map(f => {
              const on = f === filter;
              return (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 12, minHeight: 34,
                    borderWidth: 1, borderColor: on ? color.ink : color.chipBorder,
                    backgroundColor: on ? color.ink : 'transparent',
                  }}
                >
                  {f !== 'all' ? <View style={{ width: 7, height: 7, backgroundColor: on ? color.paper : kindColor[f] }} /> : null}
                  <Text style={[t.rowTitle, { fontSize: 13, color: on ? color.paper : color.ink }]}>
                    {f === 'all' ? 'All' : kindLabel[f]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {pendingSync.blocked > 0 ? (
            <View style={{
              marginHorizontal: space.gutter, marginBottom: 6, backgroundColor: color.tint,
              borderWidth: 1, borderColor: color.tintBorder, paddingHorizontal: 13, paddingVertical: 12,
            }}>
              <Label tone="redDark" size="sm" style={{ paddingBottom: 6 }}>
                {pendingSync.blocked === 1 ? '1 session waiting' : `${pendingSync.blocked} sessions waiting`}
              </Label>
              <Text style={[t.bodySm, { color: color.redDeep }]}>
                {pendingSync.blocked === 1 ? 'It is' : 'They are'} saved on this device and will be
                added here as soon as your subscription is active again. Nothing has been lost.
              </Text>
            </View>
          ) : null}

          {sessions.length === 0 ? (
            <View style={{ padding: space.gutter, paddingTop: 30 }}>
              <Text style={[t.h4, { color: color.ink, fontSize: 17 }]}>Nothing completed yet</Text>
              <Text style={[t.bodySm, { color: color.muted2, marginTop: 8 }]}>
                Sessions appear here once you finish them. Every one keeps the prescription
                it was performed under, so this stays accurate even as the plan changes.
              </Text>
            </View>
          ) : groups.length === 0 ? (
            <Text style={[t.bodySm, { color: color.muted2, marginHorizontal: space.gutter, marginTop: 10 }]}>
              No {filter === 'all' ? '' : kindLabel[filter].toLowerCase()} sessions in what has loaded so far.
              {hasMore ? ' Earlier ones load below.' : ''}
            </Text>
          ) : groups.map(g => (
            <View key={g.month}>
              <View style={{
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
                marginHorizontal: space.gutter, paddingTop: 16, paddingBottom: 8,
                borderBottomWidth: 2, borderBottomColor: color.ink,
              }}>
                <Label tone="ink">{monthName(g.month)}{g.month.slice(0, 4) !== today.slice(0, 4) ? ` ${g.month.slice(0, 4)}` : ''}</Label>
                <Text style={[t.meta, { color: color.muted2 }]}>
                  {index.length ? monthTotals(g.month, index, kindOf, filter) : ''}
                </Text>
              </View>
              {g.items.map(s => <Row key={s.id} s={s} today={today} />)}
            </View>
          ))}

          {hasMore ? (
            <Pressable
              onPress={loadingMore ? undefined : more}
              accessibilityRole="button"
              style={({ pressed }) => ({
                marginHorizontal: space.gutter, marginTop: 18, minHeight: 48,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: color.ink, backgroundColor: pressed ? color.hover : 'transparent',
              })}
            >
              {loadingMore ? <ActivityIndicator color={color.ink} />
                : <Text style={[t.rowTitle, { color: color.ink }]}>Show earlier sessions</Text>}
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Row({ s, today }: { s: HistorySession; today: string }) {
  const router = useRouter();
  const look = entryLook(s);
  const kind = look?.kind ?? 'hybrid';
  const isToday = s.date === today;
  const meta = [s.minutes != null ? `${s.minutes} min` : null, s.session_rpe != null ? `RPE ${s.session_rpe}` : null]
    .filter(Boolean).join(' · ');
  const best = s.records?.[0];

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/session/[id]', params: { id: s.id } } as never)}
      accessibilityRole="button"
      accessibilityLabel={`${displayName(s.name)}, ${weekday(s.date)} ${shortDate(s.date)}, open session`}
      style={({ pressed }) => ({
        flexDirection: 'row', gap: 12, alignItems: 'center',
        marginHorizontal: space.gutter, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: color.rule,
        backgroundColor: pressed ? color.hover : 'transparent',
      })}
    >
      <View style={{ width: 38, alignItems: 'center' }}>
        <Text style={[t.labelXs, { color: isToday ? color.redDark : color.muted }]}>{isToday ? 'Today' : weekday(s.date)}</Text>
        <Text style={[t.h4, { fontSize: 18, color: color.ink }]}>{Number(s.date.slice(8, 10))}</Text>
      </View>
      <View style={{ flex: 1, gap: 5 }}>
        <TypeTag kind={kind} />
        <Text style={[t.rowTitle, { fontSize: 14.5, color: color.ink }]} numberOfLines={2}>{displayName(s.name)}</Text>
        {look ? <SessionShape bars={look.bars} kind={kind} height={18} /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {meta ? <Text style={[t.meta, { color: color.muted2 }]}>{meta}</Text> : null}
          {s.ended_early ? <Text style={[t.meta, { fontFamily: t.eyebrow.fontFamily, color: color.redDark }]}>Ended early</Text> : null}
          {s.supplemental ? <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted2 }]}>Extra session</Text> : null}
        </View>
        {best ? (
          <Text style={[t.meta, { color: color.ink }]}>
            <Text style={[t.labelXs, { color: color.redDark }]}>NEW BEST  </Text>{bestLine(best)}
          </Text>
        ) : null}
      </View>
      <Chevron dir="right" />
    </Pressable>
  );
}
