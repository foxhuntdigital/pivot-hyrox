/**
 * The Coach tab before the redesign, kept beside it while the two are compared
 * on a phone (see `app/(tabs)/coach.tsx`). Its behaviour now lives in
 * `useCoachController`, shared with the new layout; this file is the old
 * rendering, unchanged apart from the footer that switches layouts. To be
 * deleted once the redesign is signed off.
 *
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
import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { color, type as t, space } from '@/theme/tokens';
import { Label, Rule } from '@/components/primitives';
import {
  ActionFooter, AthleteMessage, CoachNarrative, Committed, ContextStrip, InsightCard,
  Pending, PromptRow, RecentRow, Rise, StructuredCard, WhyDrawer,
} from '@/components/coach/cards';
import { PlanChangeReview } from '@/components/coach/PlanChangeReview';
import { useApp } from '@/state/store';
import { SUGGESTED_PROMPTS, relativeAge } from '@/data/coach';
import { phaseTitle } from '@/data/plan';
import { useCoachController } from './useCoachController';

export function CoachLegacy({ footer }: { footer?: React.ReactNode }) {
  const { plan, readiness } = useApp();
  const {
    coach, scroller, answers, insight, onAction, onCommittedPrimary, onUndo,
    applyProposal, reviewAnswer, lift,
  } = useCoachController();

  return (
    <View style={{ flex: 1, paddingBottom: lift }}>
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
            keyboardShouldPersistTaps="handled"
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
              /**
               * A local "I found nothing" is withheld while the model is still
               * looking.
               *
               * The local answer comes from a regex classifier and renders
               * instantly; the model's reading of the same sentence lands
               * seconds later and frequently finds what the regex missed. A
               * positive local answer is the engine's own and worth showing at
               * once, but a negative one shown with actions under it reads as a
               * settled refusal — and then gets replaced by the session it just
               * said did not exist. The pending indicator below stands in until
               * the model answers or fails, at which point this renders
               * whichever answer is actually true.
               */
              if (live.unresolved && !message.remote && coach.pending) return null;
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
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 20 }}
          // Dragging dismisses, and a tap on a suggestion fires first time
          // rather than being swallowed to close the keyboard.
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <ContextStrip
            // The race is named as the athlete named it. This used to strip a
            // literal " HYROX" out of it, which only ever fit one event.
            race={plan.race
              ? `${plan.race.name}${plan.race.days_remaining !== null
                  ? ` · ${plan.race.days_remaining}d` : ''}`
              : 'No race set'}
            phase={plan.phase
              ? `${phaseTitle(plan.phase.type)} · W${plan.phase.week}`
              : 'No plan yet'}
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

      {coach.view === 'home' ? footer : null}

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
    </View>
  );
}
