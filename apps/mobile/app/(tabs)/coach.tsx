/**
 * C01 Coach Home + C02 Conversation.
 *
 * Coach is the conversational interface to the training engine: conversation is
 * the interface, and the structured payloads underneath it are the authority
 * (Coach brief §1). Nothing on this screen decides anything — questions are
 * classified in `data/coach.ts`, answers are built from engine output in
 * `state/coachAnswer.ts`, and this file renders them and applies what the
 * athlete confirms.
 *
 * The rule that shapes the action handling below: an action either explains, or
 * it mutates and says so. A mutating action writes through to the app store —
 * so a session accepted here is the session Today shows — and leaves an inline
 * confirmation with an undo (brief §5.6, §10).
 */
import React, { useCallback, useMemo, useRef } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { color, type as t, space } from '@/theme/tokens';
import { Label, Rule } from '@/components/primitives';
import {
  ActionFooter, AthleteMessage, CoachNarrative, Committed, ContextStrip, InsightCard,
  Pending, PromptRow, RecentRow, Rise, StructuredCard, WhyDrawer,
} from '@/components/coach/cards';
import { PlanChangeReview } from '@/components/coach/PlanChangeReview';
import { useApp, snapshot } from '@/state/store';
import { useCoach, type CoachMessage } from '@/state/coach';
import {
  buildAnswer, insightFor, type CoachAction, type CoachAnswer, type CoachContext,
} from '@/state/coachAnswer';
import { LIMITER_KEYWORDS, SUGGESTED_PROMPTS, relativeAge } from '@/data/coach';
import { PHASE, RACE, WEEK_QUEUE, WEEK_STIMULI } from '@/data/athlete';

export default function CoachScreen() {
  const router = useRouter();
  const {
    state, dispatch, session, readiness, engineInput, beginSession, commitAdaptation,
  } = useApp();
  const coach = useCoach();
  const scroller = useRef<ScrollView | null>(null);

  const ctx = useMemo<CoachContext>(() => ({
    engineInput,
    today: session,
    readiness,
    weekStimuli: WEEK_STIMULI,
    queue: WEEK_QUEUE,
    race: RACE,
    phase: PHASE,
  }), [engineInput, session, readiness]);

  /**
   * Answers are derived, not stored. Rebuilding them from the current engine
   * context is what keeps a reopened thread honest when the athlete's check-in
   * or equipment has moved on since they asked (brief §4.3).
   */
  const answers = useMemo(() => {
    const map = new Map<string, CoachAnswer>();
    for (const message of coach.thread?.messages ?? []) {
      if (message.role === 'coach') {
        map.set(message.id, buildAnswer(message.intent ?? null, message.signals ?? {}, ctx));
      }
    }
    return map;
  }, [coach.thread, ctx]);

  const insight = useMemo(() => insightFor(ctx), [ctx]);

  const limiterKeywords = useCallback(() => {
    const entries = Object.entries(readiness.components) as [string, number][];
    const lowest = entries.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
    return LIMITER_KEYWORDS[lowest] ?? ['engine'];
  }, [readiness]);

  const goTo = useCallback((target: 'today' | 'plan' | 'progress') => {
    router.replace(`/${target}` as never);
  }, [router]);

  /** Applies the check-in the answer was computed against, then the session. */
  const applyCommit = useCallback((answer: CoachAnswer) => {
    const commit = answer.commit;
    if (!commit) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (commit.time_limit !== undefined) {
      dispatch({ type: 'set_time', minutes: commit.time_limit });
    }
    if (commit.low_energy) dispatch({ type: 'set_energy', energy: 'low' });
    if (commit.low_impact && !state.flags.includes('Need low impact')) {
      dispatch({ type: 'toggle_flag', flag: 'Need low impact' });
    }
    if (commit.equipment) {
      dispatch({ type: 'set_today_equipment', equipment: commit.equipment });
    }
    // Recorded like any other adaptation: a session accepted in conversation is
    // the same decision as one accepted in the sheet.
    commitAdaptation(commit.template_id, commit.variant);
  }, [commitAdaptation, dispatch, state.flags]);

  const onAction = useCallback((
    message: CoachMessage,
    answer: CoachAnswer,
    action: CoachAction,
  ) => {
    // Captured before anything is dispatched, so Undo restores the state the
    // athlete had before they agreed to this.
    const restore = snapshot(state);
    const signals = message.signals ?? {};

    switch (action.id) {
      case 'use_adaptation':
        applyCommit(answer);
        coach.commit(message.id, {
          text: `Today is now ${answer.commit?.name}, ${answer.commit?.minutes} min. Nothing else `
            + 'in your week moved.',
          cta: 'Start workout',
          target: 'start',
          restore,
          answer,
        });
        return;

      case 'use_workout':
      case 'use_equipment_today':
        applyCommit(answer);
        coach.commit(message.id, {
          text: `${answer.commit?.name} is today's session, ${answer.commit?.minutes} min. `
            + 'The rest of your week is unchanged.',
          cta: 'Start workout',
          target: 'start',
          restore,
          answer,
        });
        return;

      case 'keep_original':
        coach.commit(message.id, {
          text: session.kind === 'session'
            ? `Kept ${session.template.name} at ${session.estimated_minutes} min. Nothing changed.`
            : 'Nothing changed.',
          cta: 'See today',
          target: 'today',
          restore,
          answer,
        });
        return;

      case 'decline_plan':
        coach.commit(message.id, {
          text: 'No changes made. Your week stands as planned.',
          cta: 'See plan',
          target: 'plan',
          restore,
          answer,
        });
        return;

      case 'flag_symptom':
        if (!state.flags.includes('Something hurts')) {
          dispatch({ type: 'toggle_flag', flag: 'Something hurts' });
        }
        coach.commit(message.id, {
          text: "Today's check-in now carries a symptom flag, so the engine will not offer you "
            + 'anything above controlled intensity while it is set. Clear it from Adapt when it '
            + 'settles.',
          cta: 'See today',
          target: 'today',
          restore,
          answer,
        });
        return;

      case 'review_plan':
        coach.openReview(message.id);
        return;

      case 'see_today': goTo('today'); return;
      case 'see_plan': goTo('plan'); return;
      case 'see_progress': goTo('progress'); return;

      case 'ask_weakness': coach.ask('weakness'); return;
      case 'ask_explain': coach.ask('explain'); return;
      case 'ask_adapt':
        coach.ask('adapt', {}, 'I have less time than the plan assumes');
        return;
      case 'ask_low_impact':
        coach.ask('adapt', { low_impact: true }, 'Show me low-impact options');
        return;
      case 'ask_build':
        coach.ask(
          'build',
          { keywords: limiterKeywords() },
          'Build me a session for that',
        );
        return;
      case 'show_another':
        coach.ask(
          message.intent ?? 'build',
          {
            ...signals,
            exclude_template_ids: [
              ...(signals.exclude_template_ids ?? []),
              ...(answer.offered_template_id ? [answer.offered_template_id] : []),
            ],
          },
          'Show me another option',
        );
        return;
    }
  }, [applyCommit, coach, dispatch, goTo, limiterKeywords, session, state]);

  const onCommittedPrimary = useCallback((target: 'today' | 'plan' | 'start') => {
    if (target === 'start') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      beginSession();
      router.push('/active');
      return;
    }
    goTo(target);
  }, [beginSession, goTo, router]);

  const onUndo = useCallback((messageId: string) => {
    const undone = coach.undo(messageId);
    if (undone) dispatch({ type: 'restore', snapshot: undone.restore });
  }, [coach, dispatch]);

  /** Applying a proposal is the only place a Coach answer changes the week. */
  const applyProposal = useCallback((messageId: string) => {
    const answer = answers.get(messageId);
    const proposal = answer?.proposal;
    if (!proposal) return;
    const restore = snapshot(state);

    if (proposal.kind === 'week_days') {
      dispatch({ type: 'set_queue_order', reordered: true });
    } else if (proposal.commit_travel) {
      dispatch({ type: 'set_travel', travel: proposal.commit_travel });
    }

    coach.commit(messageId, {
      text: proposal.applied,
      cta: 'See plan',
      target: 'plan',
      restore,
      answer,
    });
    coach.closeReview();
  }, [answers, coach, dispatch, state]);

  const reviewAnswer = coach.reviewing ? answers.get(coach.reviewing) : undefined;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {coach.view === 'thread' && coach.thread ? (
        <>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingHorizontal: space.gutter, paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: color.rule,
          }}>
            <Pressable
              onPress={coach.goHome}
              accessibilityRole="button"
              accessibilityLabel="Back to Coach"
              hitSlop={14}
            >
              <Text style={{ fontFamily: t.eyebrow.fontFamily, fontSize: 16, color: color.ink }}>←</Text>
            </Pressable>
            <Text style={[t.eyebrow, { fontSize: 12, letterSpacing: 0.96, color: color.ink, flexShrink: 1 }]}>
              {coach.thread.title}
            </Text>
          </View>

          <ScrollView
            ref={scroller}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: space.gutter, paddingTop: 14, paddingBottom: 16, gap: 14,
            }}
            onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
            keyboardDismissMode="interactive"
          >
            {coach.thread.messages.map(message => {
              if (message.role === 'athlete') {
                return (
                  <Rise key={message.id}>
                    <AthleteMessage text={message.text ?? ''} />
                  </Rise>
                );
              }
              const live = answers.get(message.id);
              if (!live) return null;
              const committed = coach.commitments[message.id];
              // An open answer tracks the engine; an applied one shows what was
              // applied, which is the frozen copy on the commitment.
              const answer = committed?.answer ?? live;
              // The card is the engine's; the prose is the model's once it
              // lands. Until then — and whenever Coach is offline, unconfigured
              // or over its cap — the locally derived narrative stands in.
              const narrative = message.remote?.text ?? answer.text;
              return (
                <Rise key={message.id}>
                  <CoachNarrative text={narrative} chips={answer.chips} />
                  {answer.card ? <StructuredCard card={answer.card} /> : null}
                  {answer.why && !committed ? (
                    <WhyDrawer
                      open={!!coach.whyOpen[message.id]}
                      rows={answer.why}
                      onToggle={() => coach.toggleWhy(message.id)}
                    />
                  ) : null}
                  {committed ? (
                    <Committed
                      commitment={committed}
                      onPrimary={() => onCommittedPrimary(committed.target)}
                      onUndo={() => onUndo(message.id)}
                    />
                  ) : (
                    <ActionFooter
                      actions={live.actions}
                      onAction={action => onAction(message, live, action)}
                    />
                  )}
                </Rise>
              );
            })}
            {coach.pending ? <Pending /> : null}
          </ScrollView>
        </>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
          <ContextStrip
            race={`${RACE.name.replace(' HYROX', '')} · ${RACE.days_remaining}d`}
            phase={`${PHASE.type[0].toUpperCase()}${PHASE.type.slice(1)} · W${PHASE.week}`}
            readiness={readiness.overall}
            confidence={readiness.confidence}
            onReadiness={() => coach.ask(
              'progress', {}, 'What is my readiness confidence based on?')}
          />

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

          <Label style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6 }}>
            Ask about
          </Label>
          <View style={{ paddingHorizontal: space.gutter, gap: 6 }}>
            {SUGGESTED_PROMPTS.map(prompt => (
              <PromptRow
                key={prompt.label}
                label={prompt.label}
                onPress={() => coach.ask(prompt.intent, {}, prompt.label)}
              />
            ))}
          </View>

          {coach.threads.length ? (
            <>
              <View style={{ paddingHorizontal: space.gutter, paddingTop: 20 }}>
                <Rule />
              </View>
              <Label style={{ paddingHorizontal: space.gutter, paddingTop: 12, paddingBottom: 2 }}>
                Recent
              </Label>
              <View style={{ paddingHorizontal: space.gutter, paddingBottom: 8 }}>
                {coach.threads.slice(0, 5).map(thread => (
                  <RecentRow
                    key={thread.id}
                    title={thread.title}
                    when={relativeAge(thread.created)}
                    onPress={() => coach.openThread(thread.id)}
                  />
                ))}
              </View>
            </>
          ) : (
            <Text style={[t.bodySm, {
              paddingHorizontal: space.gutter, paddingTop: 20, color: color.muted2,
            }]}>
              Ask about today's workout, your progress, a schedule or equipment change, or a workout
              you want built. I answer from your plan and your logged training, so I will tell you
              when I do not have enough to be sure.
            </Text>
          )}
        </ScrollView>
      )}

      {/* The composer is persistent: a follow-up never costs the athlete the
          action state above it (brief §4.1). */}
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
            flex: 1, minHeight: 46,
            borderWidth: 1, borderColor: color.chipBorder, backgroundColor: color.onDark,
            paddingVertical: 13, paddingHorizontal: 12,
            fontFamily: t.body.fontFamily, fontSize: 13, color: color.ink,
          }}
        />
        <Pressable
          onPress={() => coach.send(coach.draft)}
          accessibilityRole="button"
          accessibilityLabel="Send question to Coach"
          style={({ pressed }) => ({
            minWidth: 64, paddingHorizontal: 18,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? color.inkPressed : color.ink,
          })}
        >
          <Text style={[t.button, { fontSize: 12, letterSpacing: 1.2, color: color.onDark }]}>
            Ask
          </Text>
        </Pressable>
      </View>

      <PlanChangeReview
        proposal={reviewAnswer?.proposal ?? null}
        visible={!!coach.reviewing && !!reviewAnswer?.proposal}
        onApply={() => coach.reviewing && applyProposal(coach.reviewing)}
        onCancel={coach.closeReview}
      />
    </KeyboardAvoidingView>
  );
}
