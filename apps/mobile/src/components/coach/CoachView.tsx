/**
 * Coach, redesigned: the same cards as the rest of the app, one live set of
 * actions at a time.
 *
 * Behaviour is unchanged and shared with the old layout (`useCoachController`):
 * what each action commits, undo, plan changes and the keyboard. What changes
 * is how a thread reads.
 *
 *   - A workout answer is drawn like Today's session: type tag, shape graphic,
 *     quantities, plain wording instead of "FULL".
 *   - Only the latest answer has buttons, compact and side by side. Older
 *     answers collapse to their outcome ("Applied", with Undo, or "Not
 *     taken"), so a thread stops being a stack of stale red buttons.
 *   - The evidence chips and the "Why this?" drawer become one quiet line,
 *     "Based on …", that opens to the engine's reasons.
 *   - The next questions worth asking sit as chips above the composer.
 *   - An answer the full Coach did not reach is tagged "Quick answer".
 *
 * Home leads with the one insight worth acting on, a compact line of where the
 * athlete is, starters that follow their day, and recent threads.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { color, kindColor, space, type as t } from '@/theme/tokens';
import { Label } from '@/components/primitives';
import { Chevron, SessionShape, TypeTag } from '@/components/system';
import { SessionRows } from '@/components/SessionRows';
import {
  AthleteMessage, InsightCard, Pending, RecentRow, Rise, StructuredCard,
} from '@/components/coach/cards';
import { PlanChangeReview } from '@/components/coach/PlanChangeReview';
import { lookOf } from '@/components/plan/weekData';
import { useApp } from '@/state/store';
import type { CoachMessage } from '@/state/coach';
import type { CoachAction, CoachAnswer, CoachCard } from '@/state/coachAnswer';
import { relativeAge } from '@/data/coach';
import { basedOnLine, followUpsFor, startersFor } from '@/data/coachHome';
import { phaseTitle } from '@/data/plan';
import { displayName, feelOf } from '@/data/planWeek';
import { readinessLine } from '@/data/todayView';
import { LOW_SLEEP_HOURS } from '@/lib/format';
import { useCoachController } from './useCoachController';

export function CoachView({ footer }: { footer?: React.ReactNode }) {
  const { plan, readiness, session, state, sleep } = useApp();
  const {
    coach, scroller, answers, insight, onAction, onCommittedPrimary, onUndo,
    applyProposal, reviewAnswer, lift,
  } = useCoachController();
  const [basedOpen, setBasedOpen] = useState<Record<string, boolean>>({});

  const finishedToday = plan.pendingCompletion || plan.week.completedToday.length > 0;
  const starters = startersFor({
    sessionName: session.kind === 'session' ? displayName(session.template.name) : null,
    sessionMinutes: session.kind === 'session' ? session.estimated_minutes : null,
    checkedIn: !!state.checkin,
    lowSleep: sleep.hours !== null && sleep.hours < LOW_SLEEP_HOURS,
    finishedToday,
    hasRace: plan.race !== null,
  });

  const messages = coach.thread?.messages ?? [];
  const latestCoachId = [...messages].reverse().find(m => m.role === 'coach')?.id ?? null;
  const latestMessage = messages.find(m => m.id === latestCoachId) ?? null;
  const latestAnswer = latestCoachId ? answers.get(latestCoachId) : undefined;
  const chips = coach.view === 'thread' && latestMessage && latestAnswer
    && !coach.commitments[latestMessage.id] && !coach.pending
    ? followUpsFor(latestMessage.intent ?? null, latestAnswer.actions.map(a => a.id))
    : [];

  const ready = readinessLine(readiness);
  const where = [
    plan.race ? `${plan.race.name}${plan.race.days_remaining != null ? ` · ${plan.race.days_remaining} days` : ''}` : null,
    plan.phase ? `${phaseTitle(plan.phase.type)} week ${plan.phase.week}` : null,
    `Readiness: ${ready.headline}`,
  ].filter(Boolean).join(' · ');

  return (
    <View style={{ flex: 1, paddingBottom: lift }}>
      {coach.view === 'thread' && coach.thread ? (
        <>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 8, paddingVertical: 4,
            borderBottomWidth: 1, borderBottomColor: color.rule,
          }}>
            <Pressable
              onPress={coach.goHome}
              accessibilityRole="button"
              accessibilityLabel="Back to Coach"
              style={({ pressed }) => ({
                width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
                backgroundColor: pressed ? color.hover : 'transparent',
              })}
            >
              <Chevron dir="left" size={10} tint={color.ink} weight={1.8} />
            </Pressable>
            <Text numberOfLines={1} style={[t.rowTitle, { flex: 1, fontSize: 15, fontFamily: t.eyebrow.fontFamily, color: color.ink }]}>
              {coach.thread.title}
            </Text>
          </View>

          <ScrollView
            ref={scroller}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: space.gutter, paddingTop: 14, paddingBottom: 16, gap: 16 }}
            onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          >
            {messages.map(message => {
              if (message.role === 'athlete') {
                return <Rise key={message.id}><AthleteMessage text={message.text ?? ''} /></Rise>;
              }
              const live = answers.get(message.id);
              if (!live) return null;
              // A local "found nothing" waits for the model, as before.
              if (live.unresolved && !message.remote && coach.pending) return null;
              const committed = coach.commitments[message.id];
              const answer = committed?.answer ?? live;
              const latest = message.id === latestCoachId;
              return (
                <Rise key={message.id}>
                  <Answer
                    message={message}
                    answer={answer}
                    narrative={message.remote?.text ?? answer.text}
                    basedOpen={!!basedOpen[message.id]}
                    onBased={() => setBasedOpen(o => ({ ...o, [message.id]: !o[message.id] }))}
                  />
                  {committed ? (
                    <Outcome
                      latest={latest}
                      text={committed.text}
                      cta={committed.cta}
                      onPrimary={() => onCommittedPrimary(committed.target)}
                      onUndo={() => onUndo(message.id)}
                    />
                  ) : latest ? (
                    <Actions actions={live.actions} onAction={a => onAction(message, live, a)} />
                  ) : live.actions.length ? (
                    <Text style={[t.meta, { fontFamily: t.rowTitle.fontFamily, color: color.muted2, marginTop: 10 }]}>
                      Not taken
                    </Text>
                  ) : null}
                </Rise>
              );
            })}
            {coach.pending ? <Pending /> : null}
          </ScrollView>
        </>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 20 }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {/* Only when there is something evidence-based to say (brief §3.3). */}
          {insight && !coach.insightDismissed ? (
            <InsightCard
              label={insight.label}
              text={insight.text}
              chips={insight.chips}
              cta={insight.cta}
              onPress={() => coach.ask(insight.intent)}
              onDismiss={coach.dismissInsight}
            />
          ) : null}

          {/* Where the athlete is, as one line. Readiness opens the question of
              what its confidence rests on, as the old context strip did. */}
          <Pressable
            onPress={() => coach.ask('progress', {}, 'What is my readiness confidence based on?')}
            accessibilityRole="button"
            accessibilityHint="Asks Coach what your readiness is based on"
            style={({ pressed }) => ({
              marginHorizontal: space.gutter, marginTop: 16, paddingVertical: 10,
              borderBottomWidth: 1, borderBottomColor: color.rule,
              backgroundColor: pressed ? color.hover : 'transparent',
            })}
          >
            <Text style={[t.bodySm, { fontSize: 13, color: color.muted2 }]}>{where}</Text>
          </Pressable>

          <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 22, paddingBottom: 8 }}>
            Ask about today
          </Label>
          <View style={{ paddingHorizontal: space.gutter }}>
            {starters.map(s => (
              <Pressable
                key={s.label}
                onPress={() => coach.send(s.label)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  minHeight: 52, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
                  borderBottomWidth: 1, borderBottomColor: color.rule,
                  backgroundColor: pressed ? color.hover : 'transparent',
                })}
              >
                <Text style={[t.body, { flex: 1, fontSize: 15, color: color.ink }]}>{s.label}</Text>
                <Chevron dir="right" />
              </Pressable>
            ))}
          </View>

          {coach.threads.length ? (
            <>
              <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingTop: 24, paddingBottom: 2 }}>
                Recent
              </Label>
              <View style={{ paddingHorizontal: space.gutter, paddingBottom: 8 }}>
                {coach.threads.slice(0, 5).map(thread => (
                  <RecentRow key={thread.id} title={thread.title} when={relativeAge(thread.created)}
                    onPress={() => coach.openThread(thread.id)} />
                ))}
              </View>
            </>
          ) : null}
          {footer}
        </ScrollView>
      )}

      {/* The next questions worth asking, above the composer. */}
      {chips.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          style={{ flexGrow: 0, borderTopWidth: 1, borderTopColor: color.rule }}
          contentContainerStyle={{ paddingHorizontal: space.gutter, paddingVertical: 10, gap: 8 }}>
          {chips.map(c => (
            <Pressable
              key={c.action}
              onPress={() => latestMessage && latestAnswer
                && onAction(latestMessage, latestAnswer, { id: c.action, label: c.label })}
              accessibilityRole="button"
              style={({ pressed }) => ({
                minHeight: 36, paddingHorizontal: 12, justifyContent: 'center',
                borderWidth: 1, borderColor: color.ink, backgroundColor: pressed ? color.hover : color.paper,
              })}
            >
              <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, color: color.ink }]}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* The composer stays put: a follow-up never costs the actions above it. */}
      <View style={{
        borderTopWidth: 1, borderTopColor: color.rule, backgroundColor: color.paper,
        flexDirection: 'row', alignItems: 'stretch', gap: 8,
        paddingHorizontal: space.gutter, paddingTop: 10, paddingBottom: 10,
      }}>
        <TextInput
          value={coach.draft}
          onChangeText={coach.setDraft}
          onSubmitEditing={() => coach.send(coach.draft)}
          placeholder="Ask Coach about your training…"
          placeholderTextColor={color.muted}
          accessibilityLabel="Ask Coach about your training"
          returnKeyType="send"
          style={{
            flex: 1, minHeight: 46, borderWidth: 1, borderColor: color.chipBorder, backgroundColor: color.onDark,
            paddingVertical: 13, paddingHorizontal: 12, fontFamily: t.body.fontFamily, fontSize: 13, color: color.ink,
          }}
        />
        <Pressable
          onPress={() => coach.send(coach.draft)}
          accessibilityRole="button"
          accessibilityLabel="Send question to Coach"
          style={({ pressed }) => ({
            minWidth: 64, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? color.inkPressed : color.ink,
          })}
        >
          <Text style={[t.button, { fontSize: 12, letterSpacing: 1.2, color: color.onDark }]}>Ask</Text>
        </Pressable>
      </View>

      <PlanChangeReview
        proposal={reviewAnswer?.proposal ?? null}
        visible={!!coach.reviewing && !!reviewAnswer?.proposal}
        onApply={() => coach.reviewing && applyProposal(coach.reviewing)}
        onCancel={coach.closeReview}
      />
    </View>
  );
}

/* ── One answer ───────────────────────────────────────────────────────────── */

function Answer({ message, answer, narrative, basedOpen, onBased }: {
  message: CoachMessage;
  answer: CoachAnswer;
  narrative: string;
  basedOpen: boolean;
  onBased: () => void;
}) {
  const card = answer.card;
  const line = basedOnLine(answer.chips);
  // The workout card's "Why it fits" joins the reasons behind the one line,
  // rather than being a second "why" beside the first.
  const reasons = [
    ...(card?.kind === 'workout' && card.fits ? [{ k: 'Why it fits', v: card.fits }] : []),
    ...(answer.why ?? []),
  ];
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Label size="sm" style={{ fontFamily: t.eyebrow.fontFamily, letterSpacing: 1.44 }}>Coach</Label>
        {message.fallback ? (
          // The full Coach was not reached; this is the on-phone answer.
          <View style={{ borderWidth: 1, borderColor: color.chipBorder, paddingHorizontal: 5, paddingVertical: 1 }}>
            <Text style={[t.labelXs, { fontFamily: t.eyebrow.fontFamily, color: color.muted2 }]}>Quick answer</Text>
          </View>
        ) : null}
      </View>
      <Text style={[t.body, { fontSize: 15, lineHeight: 22, color: color.ink }]}>{narrative}</Text>

      {card ? (
        <View style={{ marginTop: 12 }}>
          {card.kind === 'workout'
            ? <WorkoutAnswer card={card} templateId={answer.offered_template_id ?? answer.commit?.template_id ?? null} />
            : <StructuredCard card={card} />}
        </View>
      ) : null}

      {line || reasons.length ? (
        <View style={{ marginTop: 10 }}>
          <Pressable
            onPress={reasons.length ? onBased : undefined}
            disabled={!reasons.length}
            accessibilityRole={reasons.length ? 'button' : undefined}
            accessibilityState={reasons.length ? { expanded: basedOpen } : undefined}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}
          >
            <Text style={[t.bodySm, { flex: 1, color: color.muted2 }]}>{line ?? 'How this was worked out'}</Text>
            {reasons.length ? <Chevron dir={basedOpen ? 'up' : 'down'} size={6} /> : null}
          </Pressable>
          {basedOpen ? (
            <View style={{ borderLeftWidth: 2, borderLeftColor: color.rule, paddingLeft: 12, marginTop: 4 }}>
              {reasons.map(r => (
                <View key={r.k} style={{ paddingVertical: 5 }}>
                  <Label size="sm">{r.k}</Label>
                  <Text style={[t.bodySm, { fontSize: 13, lineHeight: 18, color: color.ink, marginTop: 2 }]}>{r.v}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A workout answer, drawn the way Today draws a session. */
function WorkoutAnswer({ card, templateId }: {
  card: Extract<CoachCard, { kind: 'workout' }>;
  templateId: string | null;
}) {
  const look = templateId ? lookOf(templateId, card.prescription) : null;
  const kind = look?.kind ?? 'strength';
  const length = card.variant.charAt(0) + card.variant.slice(1).toLowerCase();
  return (
    <View style={{ borderWidth: 2, borderColor: color.ink }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TypeTag kind={kind} />
          <Text style={[t.labelXs, { fontFamily: t.eyebrow.fontFamily, color: kindColor[kind] }]}>· {length}</Text>
          <Text style={[t.labelXs, { fontFamily: t.eyebrow.fontFamily, color: color.muted2, marginLeft: 'auto' }]}>
            {card.source}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <Text style={[t.h3, { flex: 1, fontSize: 20, lineHeight: 23, color: color.ink }]}>{displayName(card.name)}</Text>
          <Text style={[t.h3, { fontSize: 20, lineHeight: 23, color: color.ink }]}>
            {card.minutes}<Text style={[t.labelSm, { fontFamily: t.eyebrow.fontFamily, color: color.muted2 }]}> MIN</Text>
          </Text>
        </View>
        <Text style={[t.bodySm, { color: color.muted2 }]}>
          {[look ? feelOf(kind, look.effort, look.circuit) : null, card.intensity, card.equipment].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {look ? (
        <View style={{ paddingHorizontal: 14 }}>
          <SessionShape bars={look.bars} kind={kind} height={48} style={{ borderBottomWidth: 2 }} />
        </View>
      ) : null}
      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
        <SessionRows blocks={card.prescription} kind={kind} />
      </View>
    </View>
  );
}

/* ── Actions and outcomes ─────────────────────────────────────────────────── */

/** The latest answer's actions: compact, side by side, the primary first. */
function Actions({ actions, onAction }: { actions: CoachAction[]; onAction: (a: CoachAction) => void }) {
  if (!actions.length) return null;
  const ordered = [...actions].sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
      {ordered.map(a => (
        <Pressable
          key={a.id}
          onPress={() => onAction(a)}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexGrow: 1, flexBasis: ordered.length > 2 && a.primary ? '100%' : 0,
            minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
            backgroundColor: a.primary ? (pressed ? color.redPressed : color.red) : (pressed ? color.hover : 'transparent'),
            borderWidth: a.primary ? 0 : 1.5, borderColor: color.ink,
          })}
        >
          <Text style={[t.button, { fontSize: 11, letterSpacing: 1.1, textAlign: 'center', color: a.primary ? color.onDark : color.ink }]}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * What happened to an applied answer. The latest keeps its primary action and
 * Undo in full; an older one collapses to a line, Undo still one tap away.
 */
function Outcome({ latest, text, cta, onPrimary, onUndo }: {
  latest: boolean;
  text: string;
  cta: string;
  onPrimary: () => void;
  onUndo: () => void;
}) {
  if (!latest) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <View style={{ width: 8, height: 8, backgroundColor: color.red }} />
        <Text style={[t.bodySm, { flex: 1, color: color.ink }]} numberOfLines={2}>Applied · {text}</Text>
        <Pressable onPress={onUndo} accessibilityRole="button" accessibilityLabel="Undo this change" hitSlop={8}>
          <Text style={[t.bodySm, { fontFamily: t.rowTitle.fontFamily, color: color.ink, textDecorationLine: 'underline' }]}>
            Undo
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={{ marginTop: 12, borderLeftWidth: 3, borderLeftColor: color.red, paddingLeft: 12, gap: 10 }}>
      <View style={{ gap: 3 }}>
        <Label tone="redDark" size="sm">Applied</Label>
        <Text style={[t.body, { fontSize: 14, color: color.ink }]}>{text}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={onPrimary} accessibilityRole="button"
          style={({ pressed }) => ({
            flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? color.redPressed : color.red,
          })}>
          <Text style={[t.button, { fontSize: 11, color: color.onDark }]}>{cta}</Text>
        </Pressable>
        <Pressable onPress={onUndo} accessibilityRole="button" accessibilityLabel="Undo this change"
          style={({ pressed }) => ({
            minHeight: 44, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1.5, borderColor: color.ink, backgroundColor: pressed ? color.hover : 'transparent',
          })}>
          <Text style={[t.button, { fontSize: 11, color: color.ink }]}>Undo</Text>
        </Pressable>
      </View>
    </View>
  );
}
