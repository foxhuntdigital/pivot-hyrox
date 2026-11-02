/**
 * Progress, redesigned: glanceable cards with the detail one tap behind each
 * (redesign plan, Progress tab).
 *
 * In order: race readiness (its line toward race day and the six areas), the
 * month's training calendar, weekly training time, strengths and weaknesses,
 * and highlights. Every number comes from the `progress` read; this file only
 * lays it out. New athletes see what each empty section needs to fill in,
 * built from the same rules the sections are read by.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { color, kindColor, kindLabel, numeralTrim, space, type as t, type SessionKind } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import { Chevron, EffortMeter, TypeTag } from '@/components/system';
import { lookOf } from '@/components/plan/weekData';
import { effortOf } from '@/data/planWeek';
import { ReadinessChart, Sparkline } from '@/components/progress/charts';
import {
  CAPABILITIES, capabilityOfExercise, directionLabel, kindOf, readinessSpan, useProgressModel,
} from '@/components/progress/model';
import type { IndexSession, ProgressPayload } from '@/data/progressRepo';
import {
  AREAS, capabilityTile, changeText, hoursText, KIND_ORDER, monthGrid, monthName, monthSummary,
  addDays, barLabel, monthRange, readinessChange, shiftMonth, shortDate, weekday, weekOf, weeklyMinutes,
  type CapabilityTile,
} from '@/data/progressView';
import { readinessLine } from '@/data/todayView';
import { track } from '@/lib/analytics';
import { mmss } from '@/lib/format';

const card = {
  marginHorizontal: space.gutter, marginTop: 14,
  borderWidth: 1, borderColor: color.rule, backgroundColor: color.paper, padding: 14,
} as const;

export function ProgressView({ footer }: { footer?: React.ReactNode }) {
  const { payload, status, message, refresh } = useProgressModel();

  const confidence = payload?.readiness.confidence ?? null;
  const lowest = payload?.readiness.lowest ?? null;
  useFocusEffect(useCallback(() => {
    refresh();
    if (confidence) track({ name: 'readiness_viewed', confidence, component_lowest: lowest });
  }, [confidence, lowest, refresh]));

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={{
        paddingHorizontal: space.gutter, paddingTop: 20, paddingBottom: 4,
        flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <Text style={[t.h2, { fontSize: 32, lineHeight: 36, color: color.ink }]}>Progress</Text>
        {payload?.program.week && payload.program.total_weeks ? (
          <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, fontSize: 13, color: color.muted2 }]}>
            Week {payload.program.week} of {payload.program.total_weeks}
          </Text>
        ) : null}
      </View>

      {!payload ? (
        <View style={{ padding: space.gutter, gap: 10 }}>
          {status === 'error' ? (
            <>
              <Text style={[t.h4, { fontSize: 17, color: color.ink }]}>Progress didn’t load</Text>
              <Text style={[t.bodySm, { color: color.muted2 }]}>
                Your training is safe; this screen couldn’t read it just now.{message ? ` (${message})` : ''}
              </Text>
              <Pressable onPress={refresh} accessibilityRole="button" hitSlop={8}>
                <Text style={[t.rowTitle, { color: color.ink, textDecorationLine: 'underline' }]}>Try again</Text>
              </Pressable>
            </>
          ) : <ActivityIndicator color={color.ink} style={{ marginTop: 40 }} />}
        </View>
      ) : (
        <>
          <ReadinessCard p={payload} />
          <CalendarCard p={payload} />
          <TrainingTime p={payload} />
          <Strengths p={payload} />
          <Highlights p={payload} />
        </>
      )}
      {footer}
    </ScrollView>
  );
}

/* ── readiness ───────────────────────────────────────────────────────── */

function ReadinessCard({ p }: { p: ProgressPayload }) {
  const router = useRouter();
  const r = p.readiness;
  const line = readinessLine(r);
  const building = line.headline === 'Building a baseline';
  const word = building ? null : line.headline.split(' · ')[0];
  const change = readinessChange(p.trend, p.today);
  const span = readinessSpan(p);
  const observed = new Set(r.observed);
  const measured = AREAS.filter(a => observed.has(a.key)).length;

  return (
    <Pressable
      onPress={() => router.push('/readiness' as never)}
      accessibilityRole="button"
      accessibilityLabel={`Race readiness. ${building ? line.headline : `${r.overall}, ${word}`}. Opens the detail.`}
      style={({ pressed }) => [card, { borderWidth: 2, borderColor: color.ink, backgroundColor: pressed ? color.hover : color.paper }]}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Label tone="ink">Race readiness</Label>
          {building ? (
            <>
              <Text style={[t.h4, { fontSize: 22, color: color.ink }]}>Building a baseline</Text>
              <Text style={[t.bodySm, { color: color.muted2 }]}>
                {measured} of 6 areas measured. Each day you train or check in adds a point to the line.
              </Text>
            </>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
              <Text style={[t.hero, numeralTrim.hero, { fontSize: 56, lineHeight: 64, color: color.ink }]}>
                {r.overall}
              </Text>
              {change ? (
                <Text style={[t.rowTitle, { fontSize: 13, color: change.delta < 0 ? color.redDark : color.ink, paddingBottom: 4 }]}>
                  {changeText(change)}
                </Text>
              ) : null}
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {word ? <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>{word}</Text> : null}
          <Chevron dir="right" />
        </View>
      </View>

      <ReadinessChart
        {...span}
        label={span.points.length
          ? `Readiness by week, ${span.points[0].v} to ${span.points[span.points.length - 1].v} now`
          : 'Readiness line, no points yet'}
      />

      <View style={{ gap: 7, marginTop: 8 }}>
        {AREAS.map(a => {
          const known = observed.has(a.key);
          const score = r.components[a.key] ?? 0;
          const gap = known && r.lowest === a.key && measured >= 3;
          return (
            <View key={a.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 84 }}>
                <Text style={[t.bodySm, { fontSize: 12, color: gap ? color.redDark : color.ink, fontFamily: t.rowTitle.fontFamily }]}>
                  {a.label}
                </Text>
                {gap ? <Text style={[t.labelXs, { color: color.redDark }]}>Biggest gap</Text> : null}
              </View>
              <View style={{
                flex: 1, height: 7,
                backgroundColor: known ? color.paperEdge : 'transparent',
                borderWidth: known ? 0 : 1, borderColor: color.muted3, borderStyle: 'dashed',
              }}>
                {known ? <View style={{ height: 7, width: `${score}%`, backgroundColor: gap ? color.red : color.ink }} /> : null}
              </View>
              <Text style={[t.bodySm, {
                minWidth: 44, textAlign: 'right', fontSize: 12,
                color: gap ? color.redDark : known ? color.ink : color.muted,
                fontFamily: gap ? t.eyebrow.fontFamily : t.rowTitle.fontFamily,
              }]}>
                {known ? String(score) : 'Not yet'}
              </Text>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

/* ── calendar ────────────────────────────────────────────────────────── */

function CalendarCard({ p }: { p: ProgressPayload }) {
  const router = useRouter();
  const programStart = p.program.week ? addDays(weekOf(p.today), -7 * (p.program.week - 1)) : null;
  const range = monthRange(p.sessions, p.today, programStart);
  const [month, setMonth] = useState(range.last);
  const cells = useMemo(() => monthGrid(month, p.sessions, p.today), [month, p.sessions, p.today]);
  const summary = monthSummary(month, p.sessions);
  const [picked, setPicked] = useState<string | null>(null);
  const go = (delta: number) => { setPicked(null); setMonth(m => shiftMonth(m, delta)); };
  const canBack = month > range.first;
  const canForward = month < range.last;
  const title = `${monthName(month)}${month.slice(0, 4) !== p.today.slice(0, 4) ? ` ${month.slice(0, 4)}` : ''}`;
  const day = cells.find(c => c.date === picked);
  const first = p.sessions[p.sessions.length - 1];
  const firstWeek = first && Date.parse(p.today) - Date.parse(first.date) < 7 * 86_400_000;
  const kinds = KIND_ORDER.filter(k => p.sessions.some(s => s.date.startsWith(month) && kindOf(s) === k));

  return (
    <View style={card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ gap: 3, flexShrink: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -8 }}>
            <Pressable
              onPress={canBack ? () => go(-1) : undefined}
              disabled={!canBack}
              accessibilityRole="button"
              accessibilityLabel={`Previous month, ${monthName(shiftMonth(month, -1))}`}
              accessibilityState={{ disabled: !canBack }}
              hitSlop={8}
              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', opacity: canBack ? 1 : 0.25 }}
            >
              <Chevron dir="left" size={8} tint={color.ink} weight={1.8} />
            </Pressable>
            <Label tone="ink" style={{ minWidth: 92, textAlign: 'center' }}>{title}</Label>
            <Pressable
              onPress={canForward ? () => go(1) : undefined}
              disabled={!canForward}
              accessibilityRole="button"
              accessibilityLabel={`Next month, ${monthName(shiftMonth(month, 1))}`}
              accessibilityState={{ disabled: !canForward }}
              hitSlop={8}
              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', opacity: canForward ? 1 : 0.25 }}
            >
              <Chevron dir="right" size={8} tint={color.ink} weight={1.8} />
            </Pressable>
          </View>
          <Text style={[t.bodySm, { color: color.muted2 }]}>
            {summary.text}{firstWeek && summary.count && month === range.last ? ' · your first week' : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/history' as never)}
          accessibilityRole="link"
          accessibilityLabel="Training history"
          hitSlop={10}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
        >
          <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>History</Text>
          <Chevron dir="right" size={7} tint={color.ink} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <View key={`h${i}`} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingBottom: 6 }}>
            <Text style={[t.labelXs, { color: color.muted }]}>{d}</Text>
          </View>
        ))}
        {cells.map((c, i) => {
          const trained = c.sessions.length > 0;
          const kind = trained ? kindOf(c.sessions[c.sessions.length - 1]) : null;
          const selected = picked != null && c.date === picked;
          return (
            <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
              {c.day == null ? null : (
                <Pressable
                  disabled={!trained}
                  onPress={() => setPicked(selected ? null : c.date)}
                  accessibilityRole={trained ? 'button' : undefined}
                  accessibilityState={trained ? { selected } : undefined}
                  accessibilityLabel={`${monthName(month)} ${c.day}, ${trained
                    ? c.sessions.map(s => s.name).join(', ') : 'no session'}`}
                  style={{
                    flex: 1, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: kind ? kindColor[kind] : 'transparent',
                    borderWidth: selected || c.isToday ? 2 : kind ? 0 : 1,
                    borderColor: selected ? color.ink : c.isToday ? color.red
                      : c.future ? color.ruleFaint : color.rule,
                  }}
                >
                  <Text style={[t.bodySm, {
                    fontSize: 12, fontFamily: t.rowTitle.fontFamily,
                    color: kind ? color.paper : c.future ? color.muted3 : color.muted,
                  }]}>
                    {c.day}
                  </Text>
                  {c.sessions.length > 1 ? (
                    <Text style={[t.labelXs, { fontSize: 7, color: color.paper, position: 'absolute', top: 2, right: 3 }]}>
                      ×{c.sessions.length}
                    </Text>
                  ) : null}
                </Pressable>
              )}
            </View>
          );
        })}
      </View>

      {day?.date ? (
        <View style={{ marginTop: 10, borderTopWidth: 2, borderTopColor: color.ink, paddingTop: 10, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label tone="ink">
              {day.isToday ? 'Today · ' : `${weekday(day.date)} · `}{shortDate(day.date)}
            </Label>
            <Pressable onPress={() => setPicked(null)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
              <Text style={[t.rowTitle, { color: color.muted }]}>✕</Text>
            </Pressable>
          </View>
          {day.sessions.map(s => <PickedSession key={s.id} s={s} />)}
        </View>
      ) : null}

      {kinds.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
          {kinds.map(k => <TypeTag key={k} kind={k} />)}
        </View>
      ) : null}
    </View>
  );
}

function PickedSession({ s }: { s: IndexSession }) {
  const router = useRouter();
  const look = lookOf(s.template_id);
  const kind = look?.kind ?? kindOf(s);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/session/[id]', params: { id: s.id, from: 'Progress' } } as never)}
      accessibilityRole="button"
      accessibilityLabel={`${s.name}, ${directionLabel(s)}. Open session.`}
      style={({ pressed }) => ({ gap: 8, backgroundColor: pressed ? color.hover : 'transparent' })}
    >
      <TypeTag kind={kind} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[t.rowTitle, { fontSize: 15, color: color.ink }]}>{s.name}</Text>
          <Text style={[t.meta, { color: color.muted2 }]}>{directionLabel(s)}</Text>
        </View>
        {look || s.rpe != null ? (
          <EffortMeter effort={s.rpe != null ? effortOf(s.rpe) : look!.effort} kind={kind} />
        ) : null}
      </View>
      <Text style={[t.rowTitle, { fontSize: 13, color: color.ink, textDecorationLine: 'underline' }]}>
        Open session
      </Text>
    </Pressable>
  );
}

/* ── training time ───────────────────────────────────────────────────── */

/**
 * Minutes trained each week, eight weeks at a time.
 *
 * Opens on the eight weeks ending this one; the arrows page back eight at a
 * time, as far as the first week with training (or the program's start), and
 * forward to this week. Each bar names its week and carries its minutes, so
 * nothing has to be read off an axis, and tapping one opens that week's
 * sessions and minutes by kind underneath.
 */
function TrainingTime({ p }: { p: ProgressPayload }) {
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const end = addDays(p.today, -56 * page);
  const weeks = useMemo(() => weeklyMinutes(p.sessions, end, kindOf), [p.sessions, end]);
  const programStart = p.program.week ? addDays(weekOf(p.today), -7 * (p.program.week - 1)) : null;
  const firstSession = p.sessions[p.sessions.length - 1]?.date ?? null;
  const earliest = [programStart, firstSession && weekOf(firstSession)].filter(Boolean).sort()[0] as string | undefined;
  const canBack = !!earliest && weeks[0].week > earliest;
  const best = Math.max(...weeks.map(w => w.total));
  const scale = Math.max(best, 60);
  const thisWeek = weeks[weeks.length - 1];
  const chosen = weeks.find(w => w.week === picked) ?? null;
  const kinds = KIND_ORDER.filter(k => weeks.some(w => w.byKind.some(b => b.kind === k)));
  const turn = (delta: number) => { setPicked(null); setPage(n => Math.max(0, n + delta)); };
  const BAR = 110;

  return (
    <View style={card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <Label tone="ink">Training time</Label>
        <Text style={[t.bodySm, { color: color.muted2, flexShrink: 1, textAlign: 'right' }]}>
          {page === 0 ? <>This week <Text style={{ color: color.ink, fontFamily: t.rowTitle.fontFamily }}>{hoursText(thisWeek.total)}</Text> · </> : null}
          {best ? `best ${hoursText(best)}` : 'no training in these weeks'}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <Pressable onPress={canBack ? () => turn(1) : undefined} disabled={!canBack} hitSlop={8}
          accessibilityRole="button" accessibilityLabel="Earlier eight weeks" accessibilityState={{ disabled: !canBack }}
          style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', opacity: canBack ? 1 : 0.25 }}>
          <Chevron dir="left" size={8} tint={color.ink} weight={1.8} />
        </Pressable>
        <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted2 }]}>
          {shortDate(weeks[0].week)} to {page === 0 ? 'this week' : shortDate(addDays(thisWeek.week, 6))}
        </Text>
        <Pressable onPress={page > 0 ? () => turn(-1) : undefined} disabled={page === 0} hitSlop={8}
          accessibilityRole="button" accessibilityLabel="Later eight weeks" accessibilityState={{ disabled: page === 0 }}
          style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', opacity: page > 0 ? 1 : 0.25 }}>
          <Chevron dir="right" size={8} tint={color.ink} weight={1.8} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
        {weeks.map((w, i) => {
          const isThis = page === 0 && i === weeks.length - 1;
          const selected = w.week === picked;
          return (
            <Pressable
              key={w.week}
              onPress={() => setPicked(selected ? null : w.week)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Week of ${shortDate(w.week)}: ${w.total ? hoursText(w.total) : 'no training'}`}
              style={{ flex: 1, minWidth: 0 }}
            >
              <Text style={[t.meta, { fontSize: 10, textAlign: 'center', fontFamily: t.eyebrow.fontFamily, color: w.total ? color.ink : color.muted3 }]}>
                {w.total ? barLabel(w.total) : '–'}
              </Text>
              <View style={{ height: BAR, justifyContent: 'flex-end', marginTop: 4 }}>
                {w.total === 0 ? (
                  <View style={{ height: 3, backgroundColor: selected ? color.red : color.rule }} />
                ) : (
                  <View style={{ height: Math.max(14, (w.total / scale) * BAR), borderWidth: selected ? 2 : 0, borderColor: color.red }}>
                    {w.byKind.slice().reverse().map(k => (
                      <View key={k.kind} style={{
                        flex: k.minutes, backgroundColor: kindColor[k.kind],
                        borderTopWidth: 1, borderTopColor: color.paper,
                      }} />
                    ))}
                  </View>
                )}
              </View>
              <Text numberOfLines={1} style={[t.meta, {
                fontSize: 9, textAlign: 'center', marginTop: 6,
                fontFamily: isThis ? t.eyebrow.fontFamily : t.rowTitle.fontFamily,
                color: isThis ? color.ink : color.muted,
              }]}>
                {isThis ? 'This wk' : shortDate(w.week)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {chosen ? (
        <View style={{ marginTop: 12, padding: 12, gap: 3, backgroundColor: color.card }}>
          <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>
            Week of {shortDate(chosen.week)} · {chosen.total ? hoursText(chosen.total) : 'no training'}
            {chosen.sessions ? ` · ${chosen.sessions} ${chosen.sessions === 1 ? 'session' : 'sessions'}` : ''}
          </Text>
          {chosen.byKind.length ? (
            <Text style={[t.bodySm, { color: color.ink }]}>
              {chosen.byKind.map(k => `${kindLabel[k.kind]} ${hoursText(k.minutes)}`).join(' · ')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {kinds.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
          {kinds.map(k => <TypeTag key={k} kind={k} />)}
        </View>
      ) : null}
      <Text style={[t.bodySm, { color: color.muted2, marginTop: 10 }]}>
        Minutes trained each week, coloured by the kind of session. Tap a week to see it.
      </Text>
    </View>
  );
}

/* ── strengths and weaknesses ────────────────────────────────────────── */

export function DirectionMark({ tile, size = 16 }: { tile: CapabilityTile; size?: number }) {
  if (tile.kind !== 'direction') return null;
  const glyph = tile.dir === 'up' ? '↗' : tile.dir === 'down' ? '↘' : '→';
  return (
    <Text style={{
      fontSize: size, lineHeight: size + 2, fontWeight: '700',
      color: tile.dir === 'down' ? color.redDark : tile.dir === 'up' ? color.ink : color.muted,
    }}>
      {glyph}
    </Text>
  );
}

export function ConfidenceDots({ dots }: { dots: 1 | 2 | 3 }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }} accessibilityLabel={`${['low', 'medium', 'high'][dots - 1]} confidence`}>
      {[1, 2, 3].map(i => (
        <View key={i} style={{
          width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: color.ink,
          backgroundColor: i <= dots ? color.ink : 'transparent',
        }} />
      ))}
    </View>
  );
}

export function Steps({ steps }: { steps: 0 | 1 | 2 }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[1, 2, 3].map(i => (
        <View key={i} style={{ width: 14, height: 4, backgroundColor: i <= steps ? color.ink : color.rule }} />
      ))}
    </View>
  );
}

function Strengths({ p }: { p: ProgressPayload }) {
  const router = useRouter();
  const flagged = new Set(p.capabilities.perceived);
  const anyDirection = CAPABILITIES.some(c =>
    capabilityTile(p.capabilities.state.find(s => s.capability_key === c.key), p.capabilities.detail[c.key]).kind === 'direction');

  return (
    <>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
        marginHorizontal: space.gutter, marginTop: 26, paddingBottom: 8,
        borderBottomWidth: 2, borderBottomColor: color.ink,
      }}>
        <Label tone="ink">Strengths and weaknesses</Label>
        <Text style={[t.meta, { color: color.muted2 }]}>
          {anyDirection ? 'From your logged training'
            : flagged.size ? `You said ${flagged.size} need${flagged.size === 1 ? 's' : ''} work` : 'Fills in as you train'}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: space.gutter - 4, marginTop: 6 }}>
        {CAPABILITIES.map(c => {
          const tile = capabilityTile(
            p.capabilities.state.find(s => s.capability_key === c.key), p.capabilities.detail[c.key]);
          const said = flagged.has(c.key);
          return (
            <View key={c.key} style={{ width: '50%', padding: 4 }}>
              <Pressable
                onPress={() => router.push({ pathname: '/capability/[key]', params: { key: c.key } } as never)}
                accessibilityRole="button"
                accessibilityLabel={`${c.label}, ${tile.kind === 'direction' ? tile.word : tile.note}${said ? '. You said this needs work' : ''}`}
                style={({ pressed }) => ({
                  minHeight: 92, borderWidth: 1, borderColor: color.rule, padding: 10, gap: 8,
                  justifyContent: 'space-between',
                  backgroundColor: pressed ? color.hover : color.paper,
                })}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>{c.label}</Text>
                    {said ? <Text style={[t.meta, { fontSize: 10.5, color: color.muted2 }]}>You said this needs work</Text> : null}
                  </View>
                  <DirectionMark tile={tile} />
                </View>
                {tile.kind === 'direction' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={[t.rowTitle, { fontSize: 13, color: tile.dir === 'down' ? color.redDark : color.ink }]}>
                      {tile.word}
                    </Text>
                    <ConfidenceDots dots={tile.dots} />
                  </View>
                ) : (
                  <View style={{ gap: 6 }}>
                    <Steps steps={tile.steps} />
                    <Text style={[t.meta, { fontSize: 10.5, color: color.muted2 }]}>{tile.note}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          );
        })}
      </View>
    </>
  );
}

/* ── highlights ──────────────────────────────────────────────────────── */

function Highlights({ p }: { p: ProgressPayload }) {
  const router = useRouter();
  const { pace, lift, record } = p.highlights;
  const fmtLoad = (n: number, unit: string | null) => `${Number.isInteger(n) ? n : n.toFixed(1)}${unit ? ` ${unit}` : ''}`;

  const cards: { kind: SessionKind; title: string; value: string; note: string; values: number[]; invert?: boolean; to: string }[] = [];
  if (pace) {
    const first = pace.points[0].seconds;
    const last = pace.points[pace.points.length - 1].seconds;
    const diff = first - last;
    cards.push({
      kind: 'run',
      title: `${pace.distance_meters >= 1000 ? `${pace.distance_meters / 1000} km` : `${pace.distance_meters} m`} pace`,
      value: `${mmss(last)} /km`,
      note: diff === 0 ? `Level over ${pace.points.length} sessions`
        : `${Math.abs(diff)} s ${diff > 0 ? 'faster' : 'slower'} over ${pace.points.length} sessions`,
      values: pace.points.map(x => x.seconds), invert: true, to: 'running_threshold',
    });
  }
  if (lift) {
    const first = lift.points[0].load;
    const last = lift.points[lift.points.length - 1].load;
    cards.push({
      kind: 'strength',
      title: `${lift.name}${lift.reps ? `, ${lift.reps} reps` : ''}`,
      value: fmtLoad(last, lift.unit),
      note: last === first ? `Level over ${lift.points.length} sessions`
        : `${last > first ? '↑' : '↓'} ${fmtLoad(Math.abs(last - first), lift.unit)} over ${lift.points.length} sessions`,
      values: lift.points.map(x => x.load),
      to: capabilityOfExercise(lift.exercise_id) ?? 'lower_body_strength',
    });
  }

  const unlocks = [
    !pace ? { kind: 'run' as SessionKind, title: 'Pace trend', how: 'Two run repeat sessions at the same distance and a similar effort' } : null,
    !lift ? { kind: 'strength' as SessionKind, title: 'Strength progress', how: 'Log weights on two strength sessions with the same lift' } : null,
  ].filter(Boolean) as { kind: SessionKind; title: string; how: string }[];

  return (
    <>
      {cards.length || record ? (
        <>
          <View style={{ marginHorizontal: space.gutter, marginTop: 26, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: color.ink }}>
            <Label tone="ink">Highlights</Label>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: space.gutter, marginTop: 10 }}>
            {cards.map(c => (
              <Pressable
                key={c.title}
                onPress={() => router.push({ pathname: '/capability/[key]', params: { key: c.to } } as never)}
                accessibilityRole="button"
                accessibilityLabel={`${c.title}, ${c.value}. ${c.note}`}
                style={({ pressed }) => ({
                  flex: 1, borderWidth: 1, borderColor: color.rule, padding: 10, gap: 4,
                  backgroundColor: pressed ? color.hover : color.paper,
                })}
              >
                <TypeTag kind={c.kind} />
                <Text style={[t.bodySm, { fontSize: 12, color: color.muted2 }]} numberOfLines={1}>{c.title}</Text>
                <Text style={[t.h4, { fontSize: 20, color: color.ink }]}>{c.value}</Text>
                <Sparkline values={c.values} invert={c.invert} stroke={kindColor[c.kind]} height={30} />
                <Text style={[t.meta, { color: color.muted2 }]}>{c.note}</Text>
              </Pressable>
            ))}
          </View>
          {record ? (
            <Pressable
              onPress={() => router.push({ pathname: '/session/[id]', params: { id: record.session_id, from: 'Progress' } } as never)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                marginHorizontal: space.gutter, marginTop: 8, padding: 12, gap: 2,
                borderLeftWidth: 4, borderLeftColor: color.red,
                backgroundColor: pressed ? color.hover : color.tint,
              })}
            >
              <Label size="sm" tone="redDark">New best</Label>
              <Text style={[t.rowTitle, { fontSize: 15, color: color.ink }]}>
                {record.exercise} · {record.kind === 'load' ? fmtLoad(record.value, record.unit) : `${record.value} reps`}
              </Text>
              <Text style={[t.meta, { color: color.muted2 }]}>
                {shortDate(record.date)} · was {record.kind === 'load' ? fmtLoad(record.previous, record.unit) : `${record.previous} reps`}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {unlocks.length ? (
        <>
          <View style={{ marginHorizontal: space.gutter, marginTop: 26, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: color.ink }}>
            <Label tone="ink">Unlocks next</Label>
          </View>
          {unlocks.map(u => (
            <View key={u.title} style={{
              marginHorizontal: space.gutter, paddingVertical: 12, flexDirection: 'row', gap: 10,
              borderBottomWidth: 1, borderBottomColor: color.rule,
            }}>
              <View style={{ width: 8, height: 8, marginTop: 5, backgroundColor: kindColor[u.kind] }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[t.rowTitle, { color: color.ink }]}>{u.title}</Text>
                <Text style={[t.bodySm, { color: color.muted2 }]}>{u.how}</Text>
              </View>
            </View>
          ))}
        </>
      ) : null}
    </>
  );
}

