/**
 * The Plan tab, direction A: show the week, don't describe it.
 *
 * A week card leads: one tile per session, outlined in its kind's colour and
 * filled once done, so the week can be read at a glance. Below it every
 * session is a row that opens in place, with its shape, what it is, and the
 * two things worth doing about it: read the workout, or do it today. Extras
 * scroll sideways. The paragraphs that used to explain how a week works are
 * one tap away instead of always on screen.
 *
 * Everything the old tab did is still here (redesign plan, preservation map):
 * the block and roadmap, the last-week banner, the no-plan state, the travel
 * notice, today's and finished sessions with ended early marked, Do today with
 * its warnings, the bonus sessions and their done state. The order still
 * follows the week's priority; the numbers in front of it are gone.
 */
import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { color, kindColor, kindLabel, space, type as t, type SessionKind } from '@/theme/tokens';
import { InkPanel, Label } from '@/components/primitives';
import { useDialog } from '@/components/Dialog';
import { WorkoutDetailSheet } from '@/components/WorkoutDetailSheet';
import { Chevron, SessionShape, TypeTag } from '@/components/system';
import { useApp } from '@/state/store';
import { phaseTitle } from '@/data/plan';
import type { ShapeBar } from '@/data/sessionShape';
import { lookOf, useWeek } from './weekData';
import {
  displayName, doTodayStep, feelOf, overrideFailed,
  type DoTodayStep, type WeekTile,
} from '@/data/planWeek';
import type { QueuedSession } from '@/data/todayRepo';

const WEEK_INFO = [
  'Sessions, not weekdays. Your week is the training it needs, in priority order, '
    + 'and any order works. A session landing a day late does not put you behind.',
  'Tap a session to read the workout, or to make it today’s. A session dropped '
    + 'this week stays in the week, faintly, so the week still shows what it was.',
  'The extras are sessions you can take if you want them, picked from what you said '
    + 'you like. Nothing there is owed: do one before your session, instead of it, or not at all.',
  'Want more than this? Ask Coach. It can build something for what you are after today '
    + 'rather than adding to a list.',
].join('\n\n');

export function PlanWeekView({ footer }: { footer?: React.ReactNode }) {
  const router = useRouter();
  const dialog = useDialog();
  const { width } = useWindowDimensions();
  const { state, session, plan, switchToQueued } = useApp();

  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<QueuedSession | null>(null);
  const scroller = useRef<ScrollView>(null);
  const listY = useRef(0);
  const rowY = useRef(new Map<string, number>());

  const hasPlan = plan.phase !== null;
  const isFinalBlockWeek = plan.race === null && plan.phase !== null
    && plan.phase.total_weeks > 0 && plan.phase.week >= plan.phase.total_weeks;
  const travelDays = state.travel?.days.length ?? 0;

  const { week, todayTemplateId, claimedToday } = useWeek();

  /** Today's shape is the session as adapted, not the template as written. */
  const barsFor = (tile: WeekTile): ShapeBar[] => {
    if (!tile.templateId) return [];
    if (tile.state === 'today' && session.kind === 'session') {
      return lookOf(tile.templateId, session.blocks)?.bars ?? [];
    }
    return lookOf(tile.templateId)?.bars ?? [];
  };

  const select = (key: string) => {
    setOpen(key);
    const y = rowY.current.get(key);
    if (y != null) scroller.current?.scrollTo({ y: Math.max(0, listY.current + y - 12), animated: true });
  };

  /** Today's own session, in the shape the detail sheet reads. */
  const readToday = () => {
    if (session.kind !== 'session') return;
    setDetail({
      id: claimedToday?.id ?? 'today',
      template_id: session.template.id,
      name: session.template.name,
      stimulus_type: claimedToday?.stimulus_type ?? session.template.primary_goal ?? '',
      rank: claimedToday?.rank ?? 0,
      state: claimedToday?.state ?? 'queued',
      estimated_minutes: session.estimated_minutes,
    });
  };

  const show = async (step: DoTodayStep): Promise<boolean> => {
    if (step.kind === 'confirm') {
      return dialog.confirm({
        eyebrow: step.eyebrow, title: step.title, body: step.body,
        confirmLabel: step.confirmLabel, cancelLabel: step.cancelLabel,
      });
    }
    if (step.kind === 'alert') {
      await dialog.alert({ eyebrow: step.eyebrow, title: step.title, body: step.body });
      return false;
    }
    return true;
  };

  /** Do today: the same switch and the same warnings as the old tab (doTodayStep). */
  const doToday = async (templateId: string, name: string) => {
    setDetail(null);
    const shown = displayName(name);
    const first = switchToQueued(templateId);
    if (!first.ok) {
      const step = doTodayStep(first, shown);
      const proceed = await show(step);
      if (!proceed || step.kind !== 'confirm') return;
      if (!switchToQueued(templateId, { override: true }).ok) {
        await show(overrideFailed(shown));
        return;
      }
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace('/today' as never);
  };

  // Six tiles to a row; more wrap. The card has a 2 px border and 14 px inside.
  const tileGap = 6;
  const inner = width - space.gutter * 2 - 4 - 28;
  const tileW = Math.floor((inner - tileGap * 5) / 6);
  const kindsShown = [...new Set(week.tiles.map(x => x.kind))] as SessionKind[];

  return (
    <>
    <ScrollView ref={scroller} contentContainerStyle={{ paddingBottom: 30 }}>
      {/* ── The block ─────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 20, paddingBottom: 18, gap: 6 }}>
        <Label>
          {plan.race
            ? `${plan.race.name}${plan.race.days_remaining != null ? ` · ${plan.race.days_remaining} days` : ''}`
            : plan.phase ? 'No race entered' : 'Your plan'}
        </Label>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text style={[t.h2, { fontSize: 32, lineHeight: 36, color: color.ink }]}>
            {plan.phase ? phaseTitle(plan.phase.type) : 'No plan yet'}
          </Text>
          {plan.phase ? (
            <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, fontSize: 13, color: color.muted2 }]}>
              Week {plan.phase.week} of {plan.phase.total_weeks}
            </Text>
          ) : null}
        </View>
        {plan.phase && plan.phase.total_weeks > 0 ? (
          <View
            style={{ flexDirection: 'row', gap: 3, marginTop: 10 }}
            accessibilityLabel={`Week ${plan.phase.week} of ${plan.phase.total_weeks}`}
          >
            {Array.from({ length: plan.phase.total_weeks }, (_, i) => (
              <View key={i} style={{
                flex: 1, height: 10,
                backgroundColor: i < plan.phase!.week - 1 ? color.ink
                  : i === plan.phase!.week - 1 ? color.red : color.rule,
              }} />
            ))}
          </View>
        ) : null}
      </View>

      {/* The last week of a block, unchanged from the old tab. */}
      {isFinalBlockWeek ? (
        <View style={{
          marginHorizontal: space.gutter, marginBottom: 16,
          backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
          paddingHorizontal: 13, paddingVertical: 12,
        }}>
          <Label tone="redDark" size="sm" style={{ paddingBottom: 6 }}>Last week of this block</Label>
          <Text style={[t.bodySm, { color: color.redDeep, paddingBottom: 10 }]}>
            Your block ends this week. Enter a race and the next weeks are built
            around the date, or start another block to keep training.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose what comes next, on Profile"
            onPress={() => router.push('/profile' as never)}
            style={({ pressed }) => ({ alignSelf: 'flex-start', paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, color: color.redDeep }]}>
              Choose what's next ›
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!hasPlan ? (
        <InkPanel label="Nothing to plan yet" style={{ margin: 20, marginHorizontal: space.gutter }}>
          <Text style={[t.body, { color: color.onDarkSoft }]}>
            A program is built from a runway — the weeks, the phases and what each
            week asks for all come from how long it is. Set a race date, or pick a
            block length if you have nothing entered, and this fills in.
          </Text>
        </InkPanel>
      ) : (
      <>
      {/* ── The week card ─────────────────────────────────────────── */}
      <View style={{
        marginHorizontal: space.gutter, borderWidth: 2, borderColor: color.ink,
        paddingHorizontal: 14, paddingTop: 16, paddingBottom: 14, gap: 14,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View style={{ gap: 2 }}>
            <Label>This week</Label>
            <Text style={[t.h2, { fontSize: 26, lineHeight: 30, color: color.ink }]}>
              {week.planned ? `${week.done} of ${week.planned} done` : 'Nothing planned yet'}
            </Text>
          </View>
          <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, fontSize: 13, color: color.muted2 }]}>
            {week.leftLine}
          </Text>
        </View>

        {week.tiles.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tileGap }}>
            {week.tiles.map(tile => (
              <Tile key={tile.key} tile={tile} width={tileW} selected={open === tile.key}
                onPress={() => select(tile.key)} />
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {kindsShown.map(k => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 8, height: 8, backgroundColor: kindColor[k] }} />
              <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted2 }]}>{kindLabel[k]}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 8, height: 8, borderWidth: 1.5, borderColor: color.ink }} />
            <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted2 }]}>to do</Text>
          </View>
        </View>

        {travelDays ? (
          <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.redDark }]}>
            Travel equipment from Coach · {travelDays} day{travelDays === 1 ? '' : 's'}
          </Text>
        ) : null}
      </View>

      {/* ── The sessions ──────────────────────────────────────────── */}
      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 26, paddingBottom: 6 }}>
        The sessions
      </Label>
      <View
        style={{ paddingHorizontal: space.gutter }}
        onLayout={e => { listY.current = e.nativeEvent.layout.y; }}
      >
        {week.tiles.length ? week.tiles.map(tile => (
          <View key={tile.key} onLayout={e => { rowY.current.set(tile.key, e.nativeEvent.layout.y); }}>
            <SessionRow
              tile={tile}
              bars={barsFor(tile)}
              open={open === tile.key}
              onToggle={() => setOpen(open === tile.key ? null : tile.key)}
              onRead={tile.state === 'today' ? readToday : tile.queued ? () => setDetail(tile.queued) : null}
              onDoToday={tile.state === 'todo' && tile.queued
                ? () => doToday(tile.queued!.template_id, tile.queued!.name) : null}
              onHistory={tile.state === 'done' ? () => router.push('/history' as never) : null}
            />
          </View>
        )) : (
          <Text style={[t.bodySm, { color: color.muted2, paddingVertical: 10 }]}>
            Nothing queued. The week's remaining training is chosen as you go.
          </Text>
        )}
      </View>

      {/* ── Extras ────────────────────────────────────────────────── */}
      {plan.week.opportunities.length ? (
        <View style={{ paddingTop: 30 }}>
          <View style={{
            paddingHorizontal: space.gutter, paddingBottom: 10,
            flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
          }}>
            <Label tone="ink">If you've got more in you</Label>
            <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted2 }]}>Optional</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.gutter, gap: 10 }}>
            {plan.week.opportunities.map(o => {
              const look = lookOf(o.template_id);
              return (
                <Pressable
                  key={o.template_id}
                  onPress={() => setDetail({
                    id: `opportunity:${o.template_id}`, template_id: o.template_id, name: o.name,
                    stimulus_type: o.stimulus ?? o.training_domain ?? '', rank: 0, state: 'queued',
                    estimated_minutes: o.estimated_minutes,
                  })}
                  accessibilityRole="button"
                  accessibilityLabel={`${displayName(o.name)}${o.done ? ', done this week' : ''}`}
                  style={({ pressed }) => ({
                    width: 156, minHeight: 124, padding: 12, gap: 10, justifyContent: 'space-between',
                    borderWidth: 1, borderColor: color.chipBorder,
                    backgroundColor: pressed ? color.hover : o.done ? color.mist : color.paper,
                  })}
                >
                  <View style={{ gap: 4 }}>
                    {look ? <TypeTag kind={look.kind} /> : null}
                    <Text style={[t.rowTitle, { color: color.ink }]} numberOfLines={2}>{displayName(o.name)}</Text>
                    <Text style={[t.meta, { fontSize: 12, color: color.muted2 }]}>
                      {o.done ? 'Done this week'
                        : [look ? feelOf(look.kind, look.effort, look.circuit) : null, o.estimated_minutes ? `${o.estimated_minutes} min` : null]
                          .filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {look ? <SessionShape bars={look.bars} kind={look.kind} height={16} muted={o.done} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* ── How the week works ────────────────────────────────────── */}
      <View style={{
        marginHorizontal: space.gutter, marginTop: 22, paddingTop: 14,
        borderTopWidth: 1, borderTopColor: color.rule,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <Text style={[t.bodySm, { fontSize: 13, color: color.muted2, flex: 1 }]}>
          Sessions, not weekdays. Any order works.
        </Text>
        <Pressable
          onPress={() => dialog.alert({ eyebrow: 'Your week', title: 'How your week works', body: WEEK_INFO })}
          accessibilityRole="button"
          accessibilityLabel="How your week works"
          style={({ pressed }) => ({
            width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? color.hover : 'transparent',
          })}
        >
          <View style={{
            width: 20, height: 20, borderRadius: 10, borderWidth: 1.6, borderColor: color.ink,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontFamily: t.eyebrow.fontFamily, fontSize: 12, lineHeight: 14, color: color.ink }}>i</Text>
          </View>
        </Pressable>
      </View>
      </>
      )}
      {footer}
    </ScrollView>

    <WorkoutDetailSheet
      queued={detail}
      isToday={detail?.template_id === todayTemplateId}
      todaySession={session}
      onClose={() => setDetail(null)}
      onDoToday={doToday}
    />
    </>
  );
}

/* ── A tile ───────────────────────────────────────────────────────────────── */

function Tile({ tile, width, selected, onPress }: {
  tile: WeekTile;
  width: number;
  selected: boolean;
  onPress: () => void;
}) {
  const c = kindColor[tile.kind];
  const done = tile.state === 'done';
  const skipped = tile.state === 'skipped';
  const fg = done ? color.paper : c;
  // State only. Six tiles share a phone's width, about 50 points each, and
  // "Strength" or "Station" does not fit at any readable size. The kind is
  // named in words in the legend right under the tiles, and in each tile's
  // spoken label.
  const label = done ? (tile.extra ? 'Extra' : 'Done')
    : tile.state === 'today' ? 'Today'
    : skipped ? 'Skip'
    : '';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${tile.name}, ${kindLabel[tile.kind]}, ${tile.subline}`}
      // A red ring marks the tile whose row is open: a border outside the tile's
      // own, so the tile itself does not move.
      style={{ borderWidth: 2, borderColor: selected ? color.red : 'transparent', margin: -2 }}
    >
      <View style={{
        width, height: 84, paddingHorizontal: 5, paddingTop: 7, paddingBottom: 6,
        borderWidth: 2, borderColor: c, borderStyle: skipped ? 'dashed' : 'solid',
        backgroundColor: done ? c : color.paper, opacity: skipped ? 0.45 : 1,
        justifyContent: 'space-between',
      }}>
        <Text numberOfLines={1}
          style={[t.labelXs, { fontFamily: t.eyebrow.fontFamily, letterSpacing: 0.6, color: fg }]}>
          {label}
        </Text>
        <View style={{ gap: 4 }}>
          <Text style={[t.statValue, { fontSize: 18, lineHeight: 20, letterSpacing: -0.4, color: fg }]}>
            {tile.minutes ?? '–'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {[1, 2, 3].map(i => (
              <View key={i} style={{
                width: 7, height: 3,
                backgroundColor: i <= tile.effort
                  ? (done ? color.paper : c)
                  : (done ? 'rgba(243,242,242,0.35)' : color.rule),
              }} />
            ))}
          </View>
        </View>
        {tile.endedEarly ? (
          // Ended early is its own mark, in the corner, as well as in words on the row.
          <View style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6, backgroundColor: color.red }} />
        ) : null}
      </View>
    </Pressable>
  );
}

/* ── A row ────────────────────────────────────────────────────────────────── */

function SessionRow({ tile, bars, open, onToggle, onRead, onDoToday, onHistory }: {
  tile: WeekTile;
  bars: ShapeBar[];
  open: boolean;
  onToggle: () => void;
  onRead: (() => void) | null;
  onDoToday: (() => void) | null;
  onHistory: (() => void) | null;
}) {
  const c = kindColor[tile.kind];
  const done = tile.state === 'done';
  const skipped = tile.state === 'skipped';
  return (
    <View style={{
      borderBottomWidth: 1, borderBottomColor: color.rule,
      backgroundColor: open ? color.hover : 'transparent', opacity: skipped ? 0.55 : 1,
    }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${tile.name}, ${tile.subline}`}
        style={{ minHeight: 64, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}
      >
        <View style={{
          width: 10, height: 10, borderWidth: 2, borderColor: c,
          backgroundColor: done ? c : 'transparent',
        }} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[t.rowTitle, { fontSize: 15, color: color.ink }]}>{tile.name}</Text>
          <Text style={[t.bodySm, {
            fontFamily: t.greeting.fontFamily, fontSize: 13,
            color: tile.endedEarly ? color.redDark : color.muted2,
          }]}>
            {tile.subline}
          </Text>
        </View>
        <SessionShape bars={bars} kind={tile.kind} height={22} muted={done || skipped}
          style={{ width: 74, borderBottomWidth: 0 }} />
        <Chevron dir={open ? 'up' : 'down'} size={7} />
      </Pressable>

      {open ? (
        <View style={{ paddingLeft: 22, paddingBottom: 16, gap: 12 }}>
          <SessionShape bars={bars} kind={tile.kind} height={52} muted={done || skipped} />
          {tile.description ? (
            <Text style={[t.body, { color: color.ink }]}>{tile.description}</Text>
          ) : null}
          {skipped ? (
            <Text style={[t.bodySm, { color: color.muted2 }]}>
              Dropped from this week. Ask Coach if you want it back.
            </Text>
          ) : null}
          {onRead || onDoToday ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {onRead ? (
                <Pressable onPress={onRead} accessibilityRole="button"
                  style={({ pressed }) => ({
                    flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 2, borderColor: color.ink, backgroundColor: pressed ? color.paper : 'transparent',
                  })}>
                  <Text style={[t.button, { fontSize: 11, color: color.ink }]}>Read workout</Text>
                </Pressable>
              ) : null}
              {onDoToday ? (
                <Pressable onPress={onDoToday} accessibilityRole="button"
                  style={({ pressed }) => ({
                    flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: pressed ? color.redPressed : color.red,
                  })}>
                  <Text style={[t.button, { fontSize: 11, color: color.onDark }]}>Do today</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {onHistory ? (
            <Pressable onPress={onHistory} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
              <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, color: color.ink, textDecorationLine: 'underline' }]}>
                See it in your history
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
