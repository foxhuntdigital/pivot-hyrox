/**
 * One completed session (redesign plan, Session detail, approved).
 *
 * Opens from a History row, or from the calendar's "Open session" (then the
 * back link says Progress). The type, date and name; time, RPE and work time,
 * each with a short note; the session's shape as performed; any best it set;
 * round splits with a bar per round, so a fade is visible, and one sentence on
 * where the time went; then "What you did", planned → done only where the two
 * differ. Replaces the inline expand on the old History rows.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, space, type as t } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import { SessionShape, SubpageHeader, TypeTag } from '@/components/system';
import { templateById } from '@/components/plan/weekData';
import { bestLine, entryLook } from '@/components/progress/HistoryView';
import { EXERCISES } from '@/data/content';
import { fetchHistorySession, type HistorySession } from '@/data/historyRepo';
import { displayName } from '@/data/planWeek';
import { mmss, roundTable, shortDate, weekday, type SplitLike } from '@/data/progressView';
import { movementKind } from '@/data/sessionShape';
import { localToday } from '@/lib/format';
import { rememberedSession, rememberSessions, useProgress } from '@/state/progress';

const exercises = new Map(EXERCISES.map(e => [e.id, e]));

/** The column a lap goes in: what the athlete would group it under. */
function columnOf(s: SplitLike): string {
  const ex = s.exercise_id ? exercises.get(s.exercise_id) : undefined;
  const kind = movementKind(ex);
  if (kind === 'run') return 'Run';
  if (kind === 'erg') return ex?.id === 'ex_skierg' ? 'Ski' : ex?.id === 'ex_rowerg' ? 'Row' : 'Erg';
  if (kind === 'station') return 'Stations';
  return 'Other';
}

const rpeWord = (n: number) => (n <= 3 ? 'Easy' : n <= 6 ? 'Moderate' : n <= 8 ? 'Hard' : 'Max');

export function SessionView() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const [session, setSession] = useState<HistorySession | null | undefined>(() => rememberedSession(id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) return;
    let live = true;
    fetchHistorySession(id).then(r => {
      if (!live) return;
      if (r.status === 'ok') { if (r.session) rememberSessions([r.session]); setSession(r.session); }
      else if (r.status === 'error') setError(r.message);
      else setSession(null);
    });
    return () => { live = false; };
  }, [id, session]);

  return (
    <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: insets.top }}>
      <SubpageHeader backTo={from === 'Progress' ? 'Progress' : 'Training history'} onBack={() => router.back()} />
      {session ? <Body s={session} /> : error ? (
        <View style={{ padding: space.gutter, paddingTop: 40, gap: 8 }}>
          <Text style={[t.h4, { fontSize: 17, color: color.ink }]}>Couldn't load this session</Text>
          <Text style={[t.bodySm, { color: color.muted2 }]}>It is safe; this device just couldn't reach it. {error}</Text>
          <Pressable onPress={() => { setError(null); setSession(undefined); }} accessibilityRole="button" hitSlop={8}>
            <Text style={[t.rowTitle, { color: color.ink, textDecorationLine: 'underline' }]}>Try again</Text>
          </Pressable>
        </View>
      ) : session === null ? (
        <Text style={[t.bodySm, { color: color.muted2, padding: space.gutter }]}>This session isn't in your history.</Text>
      ) : <ActivityIndicator color={color.ink} style={{ marginTop: 60 }} />}
    </View>
  );
}

function Body({ s }: { s: HistorySession }) {
  const look = entryLook(s);
  const kind = look?.kind ?? 'hybrid';
  const tpl = s.template_id ? templateById.get(s.template_id) : undefined;
  const { data } = useProgress();
  const isToday = s.date === (data?.today ?? localToday());
  const work = s.splits.filter(x => !x.rest).reduce((a, x) => a + x.seconds, 0);
  const table = roundTable(s.splits, columnOf);
  const maxRound = table ? Math.max(...table.rows.map(r => r.total)) : 0;

  const stats = [
    { k: 'Time', v: s.minutes != null ? `${s.minutes} min` : '—',
      note: s.planned_minutes ? `${s.planned_minutes} planned` : s.ended_early ? 'ended early' : '' },
    { k: 'RPE', v: s.session_rpe != null ? String(s.session_rpe) : '—',
      note: s.session_rpe != null ? rpeWord(s.session_rpe) : 'not logged' },
    { k: 'Work', v: work ? mmss(work) : '—',
      note: table ? `across ${table.rows.length} rounds` : work ? 'moving time' : 'no splits' },
  ];

  const moves = s.movements.map(m => ({
    name: m.exercise,
    changed: !!m.prescribed && !!m.actual && m.prescribed !== m.actual,
    planned: m.prescribed,
    done: m.actual ?? m.prescribed ?? '—',
  }));

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TypeTag kind={kind} size="md" />
          <Text style={[t.labelSm, { color: color.muted }]}>
            · {isToday ? 'Today, ' : ''}{weekday(s.date)} {shortDate(s.date)}
          </Text>
        </View>
        <Text style={[t.h2, { color: color.ink }]}>{displayName(s.name)}</Text>
        {tpl?.description ? <Text style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>{tpl.description}</Text> : null}
      </View>

      <View style={{ flexDirection: 'row', marginHorizontal: space.gutter, marginTop: 16, borderTopWidth: 2, borderBottomWidth: 1, borderTopColor: color.ink, borderBottomColor: color.rule }}>
        {stats.map((x, i) => (
          <View key={x.k} style={{ flex: 1, paddingVertical: 10, paddingLeft: i ? 12 : 0, borderLeftWidth: i ? 1 : 0, borderLeftColor: color.rule }}>
            <Label size="sm">{x.k}</Label>
            <Text style={[t.h4, { fontSize: 20, color: color.ink, marginTop: 2 }]}>{x.v}</Text>
            {x.note ? <Text style={[t.meta, { color: color.muted2 }]}>{x.note}</Text> : null}
          </View>
        ))}
      </View>

      {look ? (
        <View style={{ marginHorizontal: space.gutter, marginTop: 18 }}>
          <SessionShape bars={look.bars} kind={kind} height={64} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={[t.meta, { color: color.muted }]}>Start</Text>
            <Text style={[t.meta, { color: color.muted }]}>Height is effort, width is time</Text>
            <Text style={[t.meta, { color: color.muted }]}>{s.minutes != null ? `${s.minutes} min` : ''}</Text>
          </View>
        </View>
      ) : null}

      {(s.records ?? []).map((r, i) => (
        <View key={i} style={{ marginHorizontal: space.gutter, marginTop: 14, padding: 12, gap: 2, borderLeftWidth: 4, borderLeftColor: color.red, backgroundColor: color.tint }}>
          <Label size="sm" tone="redDark">New best</Label>
          <Text style={[t.rowTitle, { fontSize: 15, color: color.ink }]}>{bestLine(r)}</Text>
        </View>
      ))}

      {table ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginHorizontal: space.gutter, marginTop: 24, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: color.ink }}>
            <Label tone="ink">Round splits</Label>
            <Text style={[t.meta, { color: color.muted2 }]}>Bar is the round's total time</Text>
          </View>
          <View style={{ marginHorizontal: space.gutter }}>
            <View style={{ flexDirection: 'row', paddingVertical: 8 }}>
              <Text style={[t.labelXs, { width: 30, color: color.muted }]} />
              {table.columns.map(c => <Text key={c} style={[t.labelXs, { flex: 1, color: color.muted }]}>{c}</Text>)}
              <Text style={[t.labelXs, { width: 52, textAlign: 'right', color: color.ink }]}>Round</Text>
            </View>
            {table.rows.map((r, i) => (
              <View key={r.round} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: color.rule, gap: 6 }}>
                <View style={{ flexDirection: 'row' }}>
                  <Text style={[t.rowTitle, { width: 30, fontSize: 13, color: color.muted }]}>R{r.round}</Text>
                  {table.columns.map(c => (
                    <Text key={c} style={[t.bodySm, { flex: 1, fontSize: 13, color: color.ink }]}>
                      {r.cells[c] != null ? mmss(r.cells[c]) : '—'}
                    </Text>
                  ))}
                  <Text style={[t.rowTitle, { width: 52, textAlign: 'right', fontSize: 13, color: color.ink }]}>{mmss(r.total)}</Text>
                </View>
                <View style={{ height: 5, backgroundColor: color.paperEdge }}>
                  <View style={{
                    height: 5, width: `${Math.round((r.total / maxRound) * 100)}%`,
                    backgroundColor: i === table.rows.length - 1 && r.total === maxRound && table.rows.length > 1 ? color.red : color.ink,
                  }} />
                </View>
              </View>
            ))}
          </View>
          {table.summary ? (
            <Text style={[t.bodySm, { fontSize: 13, color: color.ink, marginHorizontal: space.gutter, marginTop: 10 }]}>{table.summary}</Text>
          ) : null}
        </>
      ) : s.splits.length === 0 ? (
        <Text style={[t.meta, { color: color.muted2, marginHorizontal: space.gutter, marginTop: 18 }]}>
          Splits weren't recorded for this session.
        </Text>
      ) : null}

      {moves.length ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginHorizontal: space.gutter, marginTop: 24, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: color.ink }}>
            <Label tone="ink">What you did</Label>
            <Text style={[t.meta, { color: color.muted2 }]}>Planned → done, where they differ</Text>
          </View>
          {moves.map(m => (
            <View key={m.name} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginHorizontal: space.gutter, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.rule }}>
              <Text style={[t.rowTitle, { fontSize: 13.5, color: color.ink }]}>{m.name}</Text>
              <Text style={[t.bodySm, { fontSize: 13, color: color.ink, textAlign: 'right', flexShrink: 1 }]}>
                {m.changed ? <Text style={{ color: color.muted }}>{m.planned} → </Text> : null}{m.done}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
