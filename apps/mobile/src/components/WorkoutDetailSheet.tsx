/**
 * A queued workout, read in full before it is chosen.
 *
 * Plan's queue used to apply on the tap — one confirmation dialog naming the
 * workout, then it became today's session. That asks the athlete to decide
 * from a row that carries a name, a stimulus word and a duration, which is
 * enough to recognise a session but not enough to choose one. "Long Hybrid 75"
 * is a label; what it asks for is five blocks of work.
 *
 * So the tap opens this instead, and the decision moves to the bottom of a
 * screen that has already answered "what is it". The confirmation dialog is
 * gone rather than moved: the sentence it carried is above the button here, and
 * a second modal asking the same question after the athlete has read the whole
 * prescription would be a step that informs nobody.
 *
 * ── What is shown is what would be performed ──────────────────────────────
 *
 * This used to render `template.blocks` — the prescription as authored, out of
 * the bundled library, with no engine anywhere near it. Every other surface
 * that shows a workout shows the engine's answer: Today renders
 * `session.blocks`, the Adapt sheet renders `decision.blocks`, and both have
 * had equipment substitutions applied. This one did not, so it was the one
 * screen in the app still describing the library instead of the athlete.
 *
 * That is the whole of the "I don't own a SkiErg and it gave me SkiErg
 * intervals" report from beta. The session the athlete would actually have
 * performed was correct — the engine had already swapped the erg out — but the
 * screen they read before deciding showed the un-swapped version, so the app
 * appeared to have ignored the equipment answers it had in fact honoured.
 *
 * The template now goes through the same `recommend` call `switchToQueued`
 * makes, which means the preview is the session, not a description of it: the
 * blocks, the length and the variant are what tapping the button will hand
 * them, and any swap the engine made to get there is named rather than hidden.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, Modal, Pressable } from 'react-native';

import { recommend } from '@pivot/engine';
import { color, type as t, space } from '@/theme/tokens';
import { Rule, Label, ActionButton } from '@/components/primitives';
import { FullWorkout } from '@/components/FullWorkout';
import { EXERCISES, exerciseById, templateById } from '@/data/content';
import { useApp } from '@/state/store';
import type { QueuedSession } from '@/data/todayRepo';

/** One key/value in the header strip. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Label size="sm" style={{ marginBottom: 3 }}>{label}</Label>
      <Text style={[t.rowTitle, { fontSize: 13, color: color.ink }]}>{value}</Text>
    </View>
  );
}

export function WorkoutDetailSheet({
  queued, onClose, onDoToday, isToday,
}: {
  /** The row that was tapped. Null closes the sheet. */
  queued: QueuedSession | null;
  onClose: () => void;
  onDoToday: (templateId: string, name: string) => void;
  /** True when this is already today's session, which has nothing to switch to. */
  isToday: boolean;
}) {
  const { engineInput } = useApp();
  const template = queued ? templateById.get(queued.template_id) ?? null : null;

  /**
   * The template as this athlete would perform it today.
   *
   * The same forced run `switchToQueued` makes, so what is read here and what
   * the button hands over cannot disagree. A refusal is an answer too: it means
   * the session cannot be built from what they have, which is worth saying
   * plainly rather than showing a prescription they could not complete.
   */
  const resolved = useMemo(
    () => (template
      ? recommend({ ...engineInput, candidates: [template] }, EXERCISES)
      : null),
    [engineInput, template]);

  const built = resolved?.kind === 'session' ? resolved : null;
  const refused = resolved && resolved.kind !== 'session' ? resolved : null;

  // The engine's blocks when it built the session; the library's only as a
  // fallback for a template this client does not hold, where name, stimulus and
  // length are still enough to choose from.
  const blocks = built?.blocks ?? (template ? [] : []);
  const swaps = built?.substitutions_applied ?? [];
  const minutes = built?.estimated_minutes
    ?? queued?.estimated_minutes ?? template?.estimated_minutes ?? null;

  return (
    <Modal
      visible={queued !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Dismiss"
        style={{ flex: 1, backgroundColor: 'rgba(32,30,29,0.55)' }}
      />

      <View style={{
        maxHeight: '88%', backgroundColor: color.paper,
        borderTopWidth: 2, borderTopColor: color.ink,
      }}>
        <View style={{
          flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 12, padding: 16, paddingHorizontal: space.gutter, paddingBottom: 12,
        }}>
          <View style={{ flex: 1 }}>
            <Label style={{ marginBottom: 4 }}>In your week</Label>
            <Text style={[t.h4, { color: color.ink }]}>{queued?.name}</Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={{
              width: 32, height: 32, borderWidth: 1, borderColor: color.ink,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 14, fontFamily: t.rowTitle.fontFamily, color: color.ink }}>✕</Text>
          </Pressable>
        </View>
        <Rule />

        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          <View style={{
            flexDirection: 'row', gap: 12,
            paddingHorizontal: space.gutter, paddingVertical: 14,
          }}>
            <Fact
              label="Trains"
              value={(queued?.stimulus_type ?? '').replace(/_/g, ' ') || '—'}
            />
            <Fact label="Full length" value={minutes ? `${minutes} min` : '—'} />
            <Fact label="Intensity" value={template?.intensity_target ?? '—'} />
          </View>

          {template?.description ? (
            <Text style={[t.bodySm, {
              paddingHorizontal: space.gutter, paddingBottom: 14, color: color.muted2,
            }]}>
              {template.description}
            </Text>
          ) : null}

          {template?.coaching_notes ? (
            <View style={{
              marginHorizontal: space.gutter, marginBottom: 14,
              backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
              paddingHorizontal: 13, paddingVertical: 12,
            }}>
              <Label tone="redDark" size="sm" style={{ paddingBottom: 6 }}>Coaching notes</Label>
              <Text style={[t.bodySm, { color: color.redDeep }]}>
                {template.coaching_notes}
              </Text>
            </View>
          ) : null}

          {/* What the engine changed to fit the athlete's kit, said out loud.

              A silent substitution is indistinguishable from a mistake. An
              athlete who owns no SkiErg and reads "Row 500m" in a session
              called "Ski 5x500" has no way to tell whether the app adapted or
              simply mislabelled itself — so the swap is named, with the reason
              the substitution graph gives for it. This is the one place the
              adaptation is visible rather than merely correct. */}
          {swaps.length ? (
            <View style={{
              marginHorizontal: space.gutter, marginBottom: 14,
              backgroundColor: color.mist, borderWidth: 1, borderColor: color.mistEdge,
              paddingHorizontal: 13, paddingVertical: 12,
            }}>
              <Label size="sm" style={{ paddingBottom: 6, color: color.ink }}>
                {swaps.length === 1 ? 'Adapted to your kit' : `${swaps.length} swaps for your kit`}
              </Label>
              {swaps.map(sw => (
                <Text
                  key={`${sw.from}-${sw.to}`}
                  style={[t.bodySm, { color: color.muted2 }]}
                >
                  {exerciseById.get(sw.from)?.name ?? sw.from}
                  {' → '}
                  {exerciseById.get(sw.to)?.name ?? sw.to}
                </Text>
              ))}
            </View>
          ) : null}

          {blocks.length ? (
            <FullWorkout
              blocks={blocks}
              intensity={template?.intensity_target ?? null}
              totalMinutes={minutes ?? 0}
              defaultOpen
            />
          ) : refused ? (
            /**
             * The engine will not build this today.
             *
             * Equipment, impact or a recovery guardrail — `rationale` says
             * which. Better stated than papered over with the authored
             * prescription, which is what an athlete would otherwise read and
             * then fail to complete.
             */
            <View style={{
              marginHorizontal: space.gutter,
              backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
              paddingHorizontal: 13, paddingVertical: 12,
            }}>
              <Label tone="redDark" size="sm" style={{ paddingBottom: 6 }}>
                Not one you can do today
              </Label>
              <Text style={[t.bodySm, { color: color.redDeep }]}>
                {refused.guidance || refused.rationale}
              </Text>
            </View>
          ) : (
            <Text style={[t.bodySm, {
              paddingHorizontal: space.gutter, color: color.muted2,
            }]}>
              The full prescription for this one isn't available offline. It will be
              there once it becomes today's session.
            </Text>
          )}

        </ScrollView>

        {/* Pinned, not scrolled.

            The prescription is six blocks long for a race-pace session, which
            put "Do it today" below the fold of the one screen whose entire job
            is that decision — the athlete had to scroll past every set to reach
            the button that acts on them. The reading scrolls; the decision
            stays put. */}
        <View style={{
          borderTopWidth: 1, borderTopColor: color.rule,
          paddingBottom: 28, backgroundColor: color.paper,
        }}>
          {isToday ? (
            <Text style={[t.bodySm, {
              paddingHorizontal: space.gutter, paddingTop: 14, color: color.muted2,
            }]}>
              This is already today's session. Start it from the Today tab.
            </Text>
          ) : (
            <>
              {/* The reassurance the old confirmation dialog carried. It belongs
                  here, where it is read before the decision rather than after
                  it. */}
              <Text style={[t.bodySm, {
                paddingHorizontal: space.gutter, paddingTop: 12, paddingBottom: 12,
                color: color.muted2,
              }]}>
                Makes this today's session. Nothing is marked missed — the rest of
                the week keeps the same stimuli, in the same order.
              </Text>

              <ActionButton
                label="Do it today"
                onPress={() => queued && onDoToday(queued.template_id, queued.name)}
                style={{ marginHorizontal: space.gutter }}
              />

              {/* Said before the tap: the engine still gets the last word on how
                  long it is, and an athlete who read "75 min" here and started a
                  40-minute Express would think something had gone wrong. */}
              <Text style={[t.meta, {
                fontSize: 11.5, lineHeight: 17, color: color.muted,
                paddingHorizontal: space.gutter, paddingTop: 10,
              }]}>
                Shown at full length. Today's check-in may scale it to an Express or
                Micro version that keeps the same training purpose.
              </Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
