/**
 * Readiness, in detail (redesign plan, Readiness subpage, approved).
 *
 * The score with its change and what its confidence rests on; the line toward
 * race day; the biggest gap with the reason in numbers and a session from the
 * week that closes it; then the six areas, each with its share of the score,
 * its line and, opened, every input against the model's own full-marks target.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMPONENT_WEIGHTS, HYROX_STATION_EXERCISES } from '@pivot/engine';

import { color, kindColor, numeralTrim, space, type as t } from '@/theme/tokens';
import { ActionButton, Label } from '@/components/primitives';
import { Chevron, SessionShape, SubpageHeader, TypeTag } from '@/components/system';
import { lookOf, templateById, useWeek } from '@/components/plan/weekData';
import { useDoToday } from '@/components/plan/useDoToday';
import { ReadinessChart, Sparkline } from '@/components/progress/charts';
import { readinessSpan, TARGETS, useProgressModel } from '@/components/progress/model';
import { EXERCISES } from '@/data/content';
import { displayName } from '@/data/planWeek';
import type { ProgressPayload } from '@/data/progressRepo';
import {
  AREAS, areaInputs, gapReason, readinessChange, weekOf, weeklyReadiness,
} from '@/data/progressView';
import { readinessLine } from '@/data/todayView';
import { useApp } from '@/state/store';
import { useCoach } from '@/state/coach';

const exerciseName = new Map(EXERCISES.map(e => [e.id, e.name]));
const stationName = (id: string) => exerciseName.get(id) ?? id;

/** The template's race stations, by exercise id. */
function stationsIn(templateId: string): Set<string> {
  const tpl = templateById.get(templateId);
  const found = new Set<string>();
  for (const b of tpl?.blocks ?? []) {
    for (const e of b.exercises ?? []) {
      if ((HYROX_STATION_EXERCISES as readonly string[]).includes(e.exercise_id)) found.add(e.exercise_id);
    }
  }
  return found;
}

const list = (xs: string[]) =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

export function ReadinessView() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { payload } = useProgressModel();

  return (
    <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: insets.top }}>
      <SubpageHeader backTo="Progress" onBack={() => router.back()} />
      {payload ? <Body p={payload} /> : null}
    </View>
  );
}

function Body({ p }: { p: ProgressPayload }) {
  const r = p.readiness;
  const line = readinessLine(r);
  const building = line.headline === 'Building a baseline';
  const change = readinessChange(p.trend, p.today);
  const span = readinessSpan(p);
  const observed = new Set(r.observed);
  const measured = AREAS.filter(a => observed.has(a.key)).length;
  const gap = r.lowest && measured >= 3 ? r.lowest : null;
  const [open, setOpen] = useState<string | null>(gap);

  const weekly = weeklyReadiness(p.trend);
  const areaHistory = (key: string) => {
    const weeks = new Map<string, number[]>();
    for (const pt of p.trend) {
      if (!pt.observed.includes(key) || pt.components[key] == null) continue;
      const w = weekOf(pt.date);
      weeks.set(w, [...(weeks.get(w) ?? []), pt.components[key]]);
    }
    return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-8)
      .map(([, xs]) => xs.reduce((a, b) => a + b, 0) / xs.length);
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, gap: 6 }}>
        <Label tone="ink">Race readiness</Label>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          {building ? (
            <Text style={[t.h2, { color: color.ink }]}>Building a baseline</Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
              <Text style={[t.hero, numeralTrim.hero, { color: color.ink }]}>{r.overall}</Text>
              {change ? (
                <Text style={[t.rowTitle, { fontSize: 13, color: change.delta < 0 ? color.redDark : color.ink, paddingBottom: 6 }]}>
                  {change.delta === 0 ? 'No change' : `${change.delta > 0 ? '↑' : '↓'} ${Math.abs(change.delta)}`}
                  {` from ${change.from}, ${change.weeks} weeks ago`}
                </Text>
              ) : null}
            </View>
          )}
          {!building ? (
            <Text style={[t.rowTitle, { color: color.ink, paddingBottom: 6 }]}>{line.headline.split(' · ')[0]}</Text>
          ) : null}
        </View>
        <Text style={[t.bodySm, { color: color.muted2 }]}>
          {r.confidence.charAt(0).toUpperCase() + r.confidence.slice(1)} confidence
          {r.inputs ? ` · trained on ${r.inputs.observed_days} of the last 30 days` : ` · ${line.detail}`}
        </Text>
      </View>

      <View style={{ paddingHorizontal: space.gutter, marginTop: 12 }}>
        <ReadinessChart
          {...span}
          large
          height={190}
          label={weekly.length
            ? `Readiness by week, ${weekly[0].overall} to ${weekly[weekly.length - 1].overall} now`
            : 'Readiness line, no points yet'}
        />
        {weekly.length <= 1 ? (
          <Text style={[t.meta, { color: color.muted2, marginTop: 6 }]}>
            The line starts with your first measured day and adds a point every day you open the app.
          </Text>
        ) : null}
      </View>

      {gap && r.inputs ? <GapCard p={p} gap={gap} /> : null}

      <View style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
        marginHorizontal: space.gutter, marginTop: 26, paddingBottom: 8,
        borderBottomWidth: 2, borderBottomColor: color.ink,
      }}>
        <Label tone="ink">What it's made of</Label>
        <Text style={[t.meta, { color: color.muted2 }]}>Share of score · last 8 weeks</Text>
      </View>
      <View style={{ paddingHorizontal: space.gutter }}>
        {AREAS.map(a => (
          <AreaRow
            key={a.key} p={p} areaKey={a.key} label={a.label}
            known={observed.has(a.key)} isGap={a.key === gap}
            history={areaHistory(a.key)}
            open={open === a.key} onToggle={() => setOpen(open === a.key ? null : a.key)}
          />
        ))}
      </View>
      <Text style={[t.bodySm, { color: color.muted2, marginHorizontal: space.gutter, marginTop: 16 }]}>
        Readiness measures whether your training covers what race day asks for. It is not a fitness test.
      </Text>
    </ScrollView>
  );
}

/** Where an area's action goes. */
function useAreaAction() {
  const router = useRouter();
  const coach = useCoach();
  return (key: string, missing: string[]): { label: string; run: () => void } => {
    switch (key) {
      case 'stations': return {
        label: 'Ask Coach for a station session',
        run: () => {
          coach.send(missing.length
            ? `Build me a 30-minute session that covers ${list(missing.slice(0, 3).map(s => s.toLowerCase()))}`
            : 'Build me a 30-minute station session');
          router.push('/coach' as never);
        },
      };
      case 'recovery': return { label: 'Check in', run: () => router.push('/checkin' as never) };
      default: return { label: 'See the week', run: () => router.push('/plan' as never) };
    }
  };
}

function AreaRow({ p, areaKey, label, known, isGap, history, open, onToggle }: {
  p: ProgressPayload; areaKey: string; label: string; known: boolean; isGap: boolean;
  history: number[]; open: boolean; onToggle: () => void;
}) {
  const action = useAreaAction();
  const weight = Math.round((COMPONENT_WEIGHTS as Record<string, number>)[areaKey] * 100);
  const score = p.readiness.components[areaKey];
  const detail = p.readiness.inputs ? areaInputs(areaKey, p.readiness.inputs, TARGETS) : null;
  const covered = new Set(p.readiness.stations_covered);
  const missing = HYROX_STATION_EXERCISES.filter(id => !covered.has(id)).map(stationName);
  const act = action(areaKey, missing);

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: color.rule }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}${isGap ? ', biggest gap' : ''}, ${known ? score : 'not measured yet'}, ${weight}% of the score`}
        style={({ pressed }) => ({
          minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: pressed ? color.hover : 'transparent',
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[t.rowTitle, { fontSize: 14, color: isGap ? color.redDark : color.ink }]}>
            {label}{isGap ? ' · biggest gap' : ''}
          </Text>
          <Text style={[t.meta, { color: color.muted2 }]}>{weight}% of the score</Text>
        </View>
        <Sparkline values={history} width={70} height={26} stroke={isGap ? color.red : color.ink} />
        <Text style={[t.h4, { width: 40, textAlign: 'right', fontSize: 18, color: known ? (isGap ? color.redDark : color.ink) : color.muted }]}>
          {known ? score : '—'}
        </Text>
        <Chevron dir={open ? 'up' : 'down'} size={7} />
      </Pressable>
      {open ? (
        <View style={{ paddingBottom: 14, gap: 10 }}>
          {!known ? (
            <Text style={[t.bodySm, { color: color.muted2 }]}>
              Not measured yet, so it is left out of the score rather than counted as a zero.
            </Text>
          ) : null}
          {detail?.inputs.map(i => (
            <View key={i.label} style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <Text style={[t.bodySm, { flex: 1, color: color.ink }]}>{i.label}</Text>
                <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>{i.value}</Text>
              </View>
              <View style={{ height: 5, backgroundColor: color.paperEdge }}>
                <View style={{ height: 5, width: `${i.pct}%`, backgroundColor: isGap ? color.red : color.ink }} />
              </View>
            </View>
          ))}
          {areaKey === 'stations' && p.readiness.inputs ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {HYROX_STATION_EXERCISES.map(id => {
                const done = covered.has(id);
                return (
                  <View key={id} style={{
                    paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: kindColor.station,
                    backgroundColor: done ? kindColor.station : 'transparent',
                  }}>
                    <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: done ? color.paper : kindColor.station }]}>
                      {done ? '✓' : '+'} {stationName(id)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          {detail?.full ? <Text style={[t.meta, { color: color.muted2 }]}>{detail.full}</Text> : null}
          <Pressable onPress={act.run} accessibilityRole="link" hitSlop={6}>
            <Text style={[t.rowTitle, { fontSize: 13, color: color.ink, textDecorationLine: 'underline' }]}>{act.label}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The biggest gap: the reason in numbers and a session from this week that
 * closes it, with "Use for today". The session is the week's own, so using it
 * is Plan's Do today, with Plan's warnings.
 */
function GapCard({ p, gap }: { p: ProgressPayload; gap: string }) {
  const { plan } = useApp();
  const { claimedToday } = useWeek();
  const doToday = useDoToday();
  const area = AREAS.find(a => a.key === gap)!;
  const action = useAreaAction();
  const covered = new Set(p.readiness.stations_covered);
  const missing = HYROX_STATION_EXERCISES.filter(id => !covered.has(id));

  const upNext = plan.week.queue.filter(q =>
    q.id !== claimedToday?.id && (q.state === 'queued' || q.state === 'recommended'));
  const scored = upNext.map(q => {
    const tpl = templateById.get(q.template_id);
    const look = lookOf(q.template_id);
    let score = 0;
    let why = '';
    if (gap === 'stations') {
      const hits = [...stationsIn(q.template_id)].filter(id => missing.includes(id as never));
      score = hits.length;
      why = hits.length ? `Covers ${hits.length} missing station${hits.length === 1 ? '' : 's'}: ${list(hits.map(h => stationName(h).toLowerCase()))}` : '';
    } else if (gap === 'aerobic') {
      score = tpl?.primary_goal === 'aerobic_durability' || tpl?.primary_goal === 'threshold' ? 1 : 0;
      why = 'Adds aerobic minutes from your week';
    } else if (gap === 'running') {
      score = tpl?.requires_running ? 1 : 0;
      why = 'A run from your week';
    } else if (gap === 'strength') {
      score = look?.kind === 'strength' ? 1 : 0;
      why = 'Strength sets from your week';
    }
    return { q, look, score, why };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  const pick = scored[0];
  const act = action(gap, missing.map(stationName));

  return (
    <View style={{
      marginHorizontal: space.gutter, marginTop: 22, padding: 14, gap: 8,
      borderWidth: 2, borderColor: color.red, backgroundColor: color.paper,
    }}>
      <Label tone="redDark">Biggest gap</Label>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={[t.h4, { fontSize: 22, color: color.ink }]}>{area.label}</Text>
        <Text style={[t.h4, { fontSize: 22, color: color.redDark }]}>{p.readiness.components[gap]}</Text>
      </View>
      <Text style={[t.bodySm, { fontSize: 13, color: color.ink }]}>{gapReason(gap, p.readiness.inputs!, TARGETS)}</Text>

      {pick && pick.look ? (
        <>
          <Label size="sm" style={{ marginTop: 6 }}>Suggested for today</Label>
          <View style={{ borderWidth: 1, borderColor: color.rule, padding: 12, gap: 8 }}>
            <TypeTag kind={pick.look.kind} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <Text style={[t.rowTitle, { flex: 1, fontSize: 15, color: color.ink }]}>{displayName(pick.q.name)}</Text>
              {pick.q.estimated_minutes ? (
                <Text style={[t.h4, { fontSize: 17, color: color.ink }]}>
                  {pick.q.estimated_minutes}<Text style={[t.labelSm, { color: color.muted }]}> MIN</Text>
                </Text>
              ) : null}
            </View>
            <Text style={[t.bodySm, { color: color.muted2 }]}>{pick.why}</Text>
            <SessionShape bars={pick.look.bars} kind={pick.look.kind} height={30} />
          </View>
          <ActionButton label="Use for today" arrow={null} onPress={() => { doToday(pick.q.template_id, pick.q.name); }} />
          <Pressable onPress={act.run} accessibilityRole="link" hitSlop={6} style={{ alignSelf: 'center', paddingVertical: 6 }}>
            <Text style={[t.rowTitle, { fontSize: 13, color: color.ink, textDecorationLine: 'underline' }]}>
              Not this one? Ask Coach
            </Text>
          </Pressable>
        </>
      ) : (
        <Pressable onPress={act.run} accessibilityRole="link" hitSlop={6} style={{ paddingTop: 4 }}>
          <Text style={[t.rowTitle, { fontSize: 13, color: color.ink, textDecorationLine: 'underline' }]}>{act.label}</Text>
        </Pressable>
      )}
    </View>
  );
}
