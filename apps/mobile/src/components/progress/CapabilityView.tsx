/**
 * One capability, in detail (redesign plan, Capability subpage, approved).
 *
 * The direction with one plain sentence on why; "Stronger than when you
 * started", the percent on baseline week by week across the area's lifts,
 * with the tapped week's session and numbers; the lifts behind it; the next
 * session in the week that trains it; and how the reading works.
 *
 * Before two readings agree there is no direction to show, so the page is a
 * tracker instead: baseline set, a first reading, a direction.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HYROX_STATION_EXERCISES } from '@pivot/engine';

import { color, space, type as t } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import { Chevron, Disclosure, SubpageHeader } from '@/components/system';
import { templateById, useWeek } from '@/components/plan/weekData';
import { Dot, Measured, Polyline } from '@/components/progress/charts';
import { ConfidenceDots, DirectionMark } from '@/components/progress/ProgressView';
import { CAPABILITIES, capabilityOfExercise, useProgressModel } from '@/components/progress/model';
import { displayName } from '@/data/planWeek';
import type { CapabilityDetail, CapabilityKey, ProgressPayload } from '@/data/progressRepo';
import { capabilityTile, mmss, shortDate } from '@/data/progressView';
import { useApp } from '@/state/store';
import { useCoach } from '@/state/coach';

const RULES = [
  'Each session is compared with your last comparable one: the same lift at an overlapping rep range, or the same run distance at a similar effort.',
  'The first time you do a lift or a distance is a baseline, not a reading.',
  'The direction only changes when two readings agree, so one good or bad day never moves it.',
  'Express and Micro sessions are lighter on purpose, so they never count.',
];

const DESCRIBE: Record<CapabilityKey, string> = {
  lower_body_strength: 'Your squat, hinge and lunge loads, compared at the same reps.',
  upper_body_strength: 'Your press, pull and row loads, compared at the same reps.',
  running_threshold: 'How fast you hold run repeats from 400 m to 2 km, compared at a similar effort.',
  aerobic_durability: 'How your longer, steadier efforts hold up, compared at a similar effort.',
  loaded_movement: 'Your carry and sled loads over the same distances.',
  muscular_endurance: 'Reps you hold at the same load on trunk and accessory work.',
  station_proficiency: 'Your work on the eight race stations, compared session to session.',
};

const list = (xs: string[]) =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const fmt = (n: number, unit: string | null) => `${Number.isInteger(n) ? n : n.toFixed(1)}${unit ? ` ${unit}` : ''}`;

export function CapabilityView() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { payload } = useProgressModel();
  const cap = CAPABILITIES.find(c => c.key === key);

  return (
    <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: insets.top }}>
      <SubpageHeader backTo="Progress" onBack={() => router.back()} />
      {payload && cap ? <Body p={payload} capKey={cap.key} label={cap.label} /> : null}
    </View>
  );
}

function Body({ p, capKey, label }: { p: ProgressPayload; capKey: CapabilityKey; label: string }) {
  const router = useRouter();
  const coach = useCoach();
  const state = p.capabilities.state.find(s => s.capability_key === capKey);
  const detail: CapabilityDetail = p.capabilities.detail[capKey] ?? { readings: [], lifts: [], series: [], baseline: null };
  const tile = capabilityTile(state, detail);
  const said = p.capabilities.perceived.includes(capKey);
  const [howOpen, setHowOpen] = useState(false);
  const next = useNextSession(capKey, detail);

  const profile = () => router.push('/profile?open=weaknesses' as never);
  const ask = (text: string) => { coach.send(text); router.push('/coach' as never); };

  if (tile.kind === 'building') {
    const steps = [
      { title: 'Baseline set', done: tile.steps >= 1,
        body: detail.baseline
          ? `${shortDate(detail.baseline.date)}, ${displayName(detail.baseline.session_name)}. Your first session is what later ones are measured against.`
          : 'Your first session with this work is what later ones are measured against.' },
      { title: 'First reading', done: tile.steps >= 2,
        body: 'Your next comparable session is compared with the baseline: better, the same, or worse.' },
      { title: 'A direction', done: false,
        body: `When two readings agree, ${label} shows Improving, Holding or Slipping.` },
    ];
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Header label={label} said={said} onSaid={profile}>
          <Text style={[t.rowTitle, { fontSize: 15, color: color.ink }]}>Building a baseline</Text>
        </Header>
        <Text style={[t.bodySm, { fontSize: 13, color: color.muted2, marginHorizontal: space.gutter, marginTop: 6 }]}>
          {DESCRIBE[capKey]}
        </Text>

        <View style={{ marginHorizontal: space.gutter, marginTop: 20, borderTopWidth: 2, borderTopColor: color.ink, paddingTop: 12 }}>
          <Label tone="ink">{tile.steps === 0 ? 'Three steps to a direction' : `${3 - tile.steps} more step${tile.steps === 2 ? '' : 's'} to a direction`}</Label>
          {steps.map((s, i) => (
            <View key={s.title} style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <View style={{ alignItems: 'center' }}>
                <View style={{
                  width: 18, height: 18, borderWidth: 2, borderColor: color.ink,
                  backgroundColor: s.done ? color.ink : 'transparent', alignItems: 'center', justifyContent: 'center',
                }}>
                  {s.done ? <Text style={{ color: color.paper, fontSize: 11, fontWeight: '800' }}>✓</Text> : null}
                </View>
                {i < steps.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: s.done ? color.ink : color.rule }} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2, paddingBottom: 4 }}>
                <Text style={[t.rowTitle, { color: color.ink }]}>{s.title}</Text>
                <Text style={[t.bodySm, { color: color.muted2 }]}>{s.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ marginHorizontal: space.gutter, marginTop: 20, padding: 14, gap: 6, backgroundColor: color.ink }}>
          <Label tone="salmon">Next step</Label>
          <Text style={[t.body, { fontSize: 15, lineHeight: 22, color: color.onDark }]}>
            {next ? `${displayName(next.name)} is in your week and counts.` : 'Any session with this work counts. Your plan brings one in a later week.'}
          </Text>
          <Pressable onPress={() => ask(`Build me a session that trains ${label.toLowerCase()}`)} accessibilityRole="link" hitSlop={6}>
            <Text style={[t.rowTitle, { fontSize: 13, color: color.onDark, textDecorationLine: 'underline' }]}>
              Want one sooner? Ask Coach
            </Text>
          </Pressable>
        </View>

        <Disclosure title="How this is read" open={howOpen} onToggle={() => setHowOpen(!howOpen)}
          style={{ marginHorizontal: space.gutter, marginTop: 22 }}>
          <Rules />
        </Disclosure>
      </ScrollView>
    );
  }

  /** Running speed has no lifts; its chart is the repeat pace, faster read as up. */
  const pace = capKey === 'running_threshold' ? p.highlights.pace : null;
  const paceSeries = pace && pace.points.length >= 2 ? pace.points.map(pt => ({
    week: pt.date, pct: Math.round((pace.points[0].seconds / pt.seconds - 1) * 100),
    session_id: '', session_name: '', detail: `${mmss(pt.seconds)} /km at a similar effort.`,
  })) : null;

  const up = tile.dir === 'up';
  const why = detail.lifts.length
    ? `${up ? 'Your' : 'Recent sessions on your'} ${list(detail.lifts.slice(0, 3).map(l => l.name))}`
      + (up ? ` ${detail.lifts.length === 1 ? 'has' : 'have'} been climbing.` : tile.dir === 'down' ? ' have slipped back.' : ' are holding where they were.')
    : up ? 'Two or more recent sessions agree it is moving up.'
    : tile.dir === 'down' ? 'Two or more recent sessions agree it has slipped. One lighter week is common.'
    : 'Recent sessions agree it is holding where it was.';

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <Header label={label} said={said} onSaid={profile}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <DirectionMark tile={tile} size={18} />
          <Text style={[t.rowTitle, { fontSize: 15, color: tile.dir === 'down' ? color.redDark : color.ink }]}>{tile.word}</Text>
          <ConfidenceDots dots={tile.dots} />
          <Text style={[t.meta, { color: color.muted2 }]}>{state?.confidence} confidence</Text>
        </View>
      </Header>
      <Text style={[t.bodySm, { fontSize: 13, color: color.ink, marginHorizontal: space.gutter, marginTop: 8 }]}>{why}</Text>
      {said && up ? (
        <View style={{ marginHorizontal: space.gutter, marginTop: 10, padding: 12, gap: 6, backgroundColor: color.mist, borderWidth: 1, borderColor: color.mistEdge }}>
          <Text style={[t.bodySm, { color: color.ink }]}>
            Your training says it’s improving. Keep it on your list, or swap it for something that isn’t moving?
          </Text>
          <Pressable onPress={profile} accessibilityRole="link" hitSlop={6}>
            <Text style={[t.rowTitle, { fontSize: 13, color: color.ink, textDecorationLine: 'underline' }]}>Change in Profile</Text>
          </Pressable>
        </View>
      ) : null}

      {detail.series.length >= 2 ? <BaselineChart detail={detail} />
        : paceSeries ? <BaselineChart detail={{ ...detail, series: paceSeries }} title="Faster than when you started"
            subject={`faster than your first ${p.highlights.pace!.distance_meters >= 1000 ? `${p.highlights.pace!.distance_meters / 1000} km` : `${p.highlights.pace!.distance_meters} m`} repeat session`} />
        : detail.readings.length ? (
        <View style={{ marginHorizontal: space.gutter, marginTop: 22 }}>
          <View style={{ paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: color.ink }}>
            <Label tone="ink">Recent readings</Label>
          </View>
          {detail.readings.slice(-6).reverse().map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.rule, gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>{r.session_name ? displayName(r.session_name) : 'A session'}</Text>
                <Text style={[t.meta, { color: color.muted2 }]}>{shortDate(r.date)} · {r.confidence} confidence</Text>
              </View>
              <Text style={[t.rowTitle, { fontSize: 13, color: r.direction === 'negative' ? color.redDark : color.ink }]}>
                {r.direction === 'positive' ? 'Better' : r.direction === 'negative' ? 'Worse' : 'The same'}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {detail.lifts.length ? (
        <>
          <View style={{ marginHorizontal: space.gutter, marginTop: 26, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: color.ink }}>
            <Label tone="ink">What moved it</Label>
          </View>
          {detail.lifts.slice(0, 5).map(l => (
            <View key={l.exercise_id} style={{
              marginHorizontal: space.gutter, paddingVertical: 11, flexDirection: 'row',
              justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: color.rule, gap: 10,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={[t.rowTitle, { color: color.ink }]}>{l.name}</Text>
                <Text style={[t.meta, { color: color.muted2 }]}>
                  Top set{l.reps_max ? `, ${l.reps_min && l.reps_min !== l.reps_max ? `${l.reps_min}-${l.reps_max}` : l.reps_max} reps` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[t.rowTitle, { color: color.ink }]}>{fmt(l.now, l.unit)}</Text>
                <Text style={[t.meta, { color: l.now < l.start ? color.redDark : color.muted2 }]}>
                  {l.now === l.start ? `same as ${fmt(l.start, l.unit)}` : `${l.now > l.start ? '↑' : '↓'} from ${fmt(l.start, l.unit)}`}
                </Text>
              </View>
            </View>
          ))}
        </>
      ) : null}

      {next ? (
        <Pressable
          onPress={() => router.push('/plan' as never)}
          accessibilityRole="link"
          style={({ pressed }) => ({
            marginHorizontal: space.gutter, marginTop: 20, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10,
            borderWidth: 1, borderColor: color.rule, backgroundColor: pressed ? color.hover : color.paper,
          })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Label size="sm">{tile.dir === 'down' ? 'Next in your week' : 'Keep it going · next in your week'}</Label>
            <Text style={[t.rowTitle, { fontSize: 15, color: color.ink }]}>{displayName(next.name)}</Text>
          </View>
          <Chevron dir="right" />
        </Pressable>
      ) : null}

      <Disclosure title="How this is read" open={howOpen} onToggle={() => setHowOpen(!howOpen)}
        style={{ marginHorizontal: space.gutter, marginTop: 22 }}>
        <Rules />
      </Disclosure>
    </ScrollView>
  );
}

function Header({ label, said, onSaid, children }: {
  label: string; said: boolean; onSaid: () => void; children: React.ReactNode;
}) {
  return (
    <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, gap: 8 }}>
      <Text style={[t.h2, { color: color.ink }]}>{label}</Text>
      {children}
      {said ? (
        <Pressable onPress={onSaid} accessibilityRole="link" hitSlop={6}
          accessibilityLabel={`You said ${label} needs work. Change on Profile.`}>
          <Text style={[t.meta, { fontSize: 12, color: color.muted2, textDecorationLine: 'underline' }]}>You said this needs work</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Rules() {
  return (
    <View style={{ gap: 8 }}>
      {RULES.map(r => (
        <View key={r} style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ width: 5, height: 5, backgroundColor: color.ink, marginTop: 7 }} />
          <Text style={[t.bodySm, { flex: 1, fontSize: 13, color: color.muted2 }]}>{r}</Text>
        </View>
      ))}
    </View>
  );
}

/** "Stronger than when you started": percent on baseline, week by week. */
function BaselineChart({ detail, title, subject }: { detail: CapabilityDetail; title?: string; subject?: string }) {
  const series = detail.series;
  const [picked, setPicked] = useState(series.length - 1);
  const last = series[series.length - 1];
  const lo = Math.min(0, ...series.map(s => s.pct)) - 2;
  const hi = Math.max(4, ...series.map(s => s.pct)) + 2;
  const point = series[picked];
  const lifts = detail.lifts.slice(0, 3).map(l => l.name);

  return (
    <View style={{ marginHorizontal: space.gutter, marginTop: 22, borderTopWidth: 2, borderTopColor: color.ink, paddingTop: 12 }}>
      <Label tone="ink">{title ?? (last.pct >= 0 ? 'Stronger than when you started' : 'Against when you started')}</Label>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 6 }}>
        <Text style={[t.h2, { fontSize: 34, color: last.pct < 0 ? color.redDark : color.ink }]}>
          {last.pct === 0 ? '' : last.pct > 0 ? '↑ ' : '↓ '}{Math.abs(last.pct)}%
        </Text>
        <Text style={[t.bodySm, { flex: 1, color: color.muted2, paddingBottom: 4 }]}>
          {subject ?? `on your baseline${lifts.length ? `, across your ${list(lifts)}` : ''}`}
        </Text>
      </View>
      <Measured height={150} style={{ marginTop: 10 }}
        accessibilityLabel={`Percent on baseline by week, from 0 to ${last.pct} percent`}>
        {width => {
          const px = (i: number) => 10 + i * ((width - 20) / Math.max(1, series.length - 1));
          const py = (v: number) => 140 - ((v - lo) / (hi - lo)) * 130;
          return (
            <>
              <Polyline points={[{ x: 0, y: py(0) }, { x: width, y: py(0) }]} stroke={color.muted3} width={1} dashed />
              <Text style={[t.meta, { position: 'absolute', left: 0, top: py(0) + 3, fontSize: 10, color: color.muted }]}>Baseline</Text>
              <Polyline points={series.map((s, i) => ({ x: px(i), y: py(s.pct) }))} />
              {series.map((s, i) => {
                const selected = i === picked;
                const dip = i > 0 && s.pct < series[i - 1].pct;
                return (
                  <React.Fragment key={s.week}>
                    <Dot at={{ x: px(i), y: py(s.pct) }} size={selected ? 14 : 10}
                      fill={selected ? color.red : color.paper} edge={selected || dip ? color.red : color.ink} />
                    <Pressable
                      onPress={() => setPicked(i)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${shortDate(s.week)}, ${s.pct} percent on baseline`}
                      style={{ position: 'absolute', left: px(i) - 18, top: py(s.pct) - 18, width: 36, height: 36 }}
                    />
                  </React.Fragment>
                );
              })}
            </>
          );
        }}
      </Measured>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={[t.meta, { color: color.muted }]}>{shortDate(series[0].week)}</Text>
        <Text style={[t.meta, { color: color.muted }]}>{subject ? 'Tap a session' : 'Tap a week'}</Text>
        <Text style={[t.meta, { color: color.muted }]}>{shortDate(last.week)}</Text>
      </View>
      {point ? (
        <View style={{ marginTop: 12, padding: 12, gap: 3, backgroundColor: color.card }}>
          <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>
            {subject ? shortDate(point.week) : `Week of ${shortDate(point.week)}`} · {picked === 0 ? 'Baseline' : `${point.pct}% on baseline`}
          </Text>
          {point.session_name ? <Text style={[t.bodySm, { color: color.ink }]}>{displayName(point.session_name)}</Text> : null}
          <Text style={[t.bodySm, { color: color.muted2 }]}>
            {picked === 0 ? 'Your first comparable session. Everything after is measured against it.' : point.detail}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The next session in this week that trains the capability. */
function useNextSession(key: CapabilityKey, detail: CapabilityDetail) {
  const { plan } = useApp();
  const { claimedToday } = useWeek();
  const lifts = new Set(detail.lifts.map(l => l.exercise_id));
  const stations = new Set<string>(HYROX_STATION_EXERCISES);
  return plan.week.queue.find(q => {
    if (q.id === claimedToday?.id || !(q.state === 'queued' || q.state === 'recommended')) return false;
    const tpl = templateById.get(q.template_id);
    const ids = (tpl?.blocks ?? []).flatMap(b => (b.exercises ?? []).map(e => e.exercise_id));
    switch (key) {
      case 'running_threshold': return !!tpl?.requires_running && tpl?.primary_goal === 'threshold';
      case 'aerobic_durability': return tpl?.primary_goal === 'aerobic_durability';
      case 'station_proficiency': return ids.some(id => stations.has(id));
      default: return ids.some(id => lifts.has(id) || capabilityOfExercise(id) === key);
    }
  }) ?? null;
}
