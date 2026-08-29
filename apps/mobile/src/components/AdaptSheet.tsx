/**
 * D10 Adapt sheet.
 *
 * Inputs are tap-based and recalculate live (PRD §6.3), so the athlete sees the
 * recommendation change as they answer rather than after a submit. The engine
 * runs on every keystroke-equivalent because it is a pure function over state.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, ScrollView, Modal, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';

import { VARIANT_LABEL, variantMinutes, type VariantCode } from '@pivot/engine';
import { color, numeralTrim, type as t, space } from '@/theme/tokens';
import { Rule, Label, ActionButton, Chip } from '@/components/primitives';
import { useApp } from '@/state/store';
import { DialogProvider, useDialog } from '@/components/Dialog';
import { FullWorkout } from '@/components/FullWorkout';
import { exerciseById } from '@/data/content';
import { track, bucketMinutes } from '@/lib/analytics';

const TIME_CHOICES = [15, 30, 45, 60, 90];
const ENERGY_CHOICES = ['low', 'normal', 'high'] as const;
const FLAG_CHOICES = ['Low sleep', 'Something hurts', 'No equipment', 'Need low impact'];

function AdaptSheetBody({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { state, dispatch, decision, chooseVariant } = useApp();
  const dialog = useDialog();

  // What the athlete arrived with, captured on open so `adaptation_applied`
  // and `adapt_opened` agree on what "original" meant (PRD §16).
  const openedVariant = decision.kind === 'session' ? decision.variant.variant_code : null;
  const openedVariantRef = useRef(openedVariant);
  openedVariantRef.current = openedVariant;

  useEffect(() => {
    if (!visible) return;
    track({ name: 'adapt_opened', original_variant: openedVariantRef.current });
  }, [visible]);

  /**
   * One event per settled change rather than one per chip.
   *
   * The sheet recalculates live, so an athlete answering three questions taps
   * five or six times in a couple of seconds. §16 wants the resulting input
   * set, not the keystrokes, so this debounces the way `commitEquipment` does
   * and reports the state the taps landed on.
   */
  const timeBucket = bucketMinutes(state.available_minutes);
  const lowImpact = state.flags.includes('Need low impact');
  const equipmentChange = state.flags.includes('No equipment') || state.today_equipment !== null;

  const latest = useRef({ timeBucket, energy: state.energy, lowImpact, equipmentChange });
  latest.current = { timeBucket, energy: state.energy, lowImpact, equipmentChange };
  const unreported = useRef(false);
  const firstRender = useRef(true);

  const emitInputChange = useCallback(() => {
    if (!unreported.current) return;
    unreported.current = false;
    const v = latest.current;
    track({
      name: 'adapt_input_changed',
      time_bucket: v.timeBucket,
      energy_bucket: v.energy,
      low_impact: v.lowImpact,
      equipment_change: v.equipmentChange,
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    // Opening the sheet is not an input change; `adapt_opened` covers that.
    if (firstRender.current) { firstRender.current = false; return; }
    unreported.current = true;
    const id = setTimeout(emitInputChange, 600);
    return () => clearTimeout(id);
  }, [visible, timeBucket, state.energy, lowImpact, equipmentChange, emitInputChange]);

  /**
   * Flush on close rather than let the debounce be cancelled by it.
   *
   * The common path is answering the questions and immediately accepting a
   * variant, which closes the sheet inside the debounce window. Dropping the
   * pending event there would lose the inputs for exactly the flow that matters
   * most — the one that ends in an adaptation.
   */
  useEffect(() => {
    if (visible) return;
    emitInputChange();
    firstRender.current = true;
  }, [visible, emitInputChange]);

  /**
   * Applies the version the athlete tapped.
   *
   * This used to call `commitAdaptation` directly, which recorded the variant
   * and then had it ignored downstream — the sheet closed and Today kept the
   * session it already had, so choosing Full or Micro did nothing visible.
   * `chooseVariant` is the path that actually applies it.
   *
   * It also used to end the conversation on a refusal: an athlete who had been
   * given an Express and wanted the Full one was told the version "isn't
   * available today" and left with no way forward. But a recovery refusal is
   * the engine's advice about how hard today should be, not a fact about the
   * world, and advice about your own body is yours to overrule. So a refusal
   * the athlete can answer is now put to them as a question, and answering yes
   * applies the session they asked for.
   *
   * The two refusals that are not advice keep their dead end, deliberately. A
   * severe symptom is a boundary the app has said it will not cross, and
   * offering to press on would make that promise false. Equipment, impact and
   * postpartum constraints describe what can actually be performed, so
   * confirming would change nothing and pretending otherwise would be a button
   * that does not work.
   */
  const accept = async (templateId: string, variant: VariantCode) => {
    const result = chooseVariant(templateId, variant);

    if (!result.ok && result.reason === 'recovery') {
      // Named from what the athlete actually told us. The copy used to cite
      // "your check-in" unconditionally, which is a claim about evidence — and
      // for someone who has not checked in, evidence that does not exist.
      const source = state.checkin
        ? 'your check-in'
        : state.energy === 'low' ? 'the energy you reported' : 'what you have told me about today';
      const proceed = await dialog.confirm({
        eyebrow: 'Are you sure?',
        title: `${VARIANT_LABEL[variant]} is more than today supports`,
        body: `Based on ${source}, this asks for more than the version `
          + 'recommended above. You can still do it — you know how you feel '
          + 'better than I do. Ease off if it stops feeling right.',
        confirmLabel: `Do the ${VARIANT_LABEL[variant]}`,
        cancelLabel: 'Keep the suggestion',
      });
      if (!proceed) return;

      const overridden = chooseVariant(templateId, variant, { override: true });
      if (!overridden.ok) {
        // The classification said this would build. Reaching here means the
        // inputs moved between the two calls, so it is reported rather than
        // silently swallowed into a closed sheet.
        await dialog.alert({
          eyebrow: 'Not available',
          title: `${VARIANT_LABEL[variant]} could not be applied`,
          body: 'Something about today changed while you were deciding. Try again.',
        });
        return;
      }
    } else if (!result.ok) {
      await dialog.alert({
        eyebrow: 'Not available',
        title: `${VARIANT_LABEL[variant]} isn't available today`,
        body: result.reason === 'symptom'
          ? 'You reported a symptom that training hard through would not be '
            + 'reasonable. This one is not something to push past — rest today, '
            + 'and get it looked at if it persists.'
          : 'That version cannot be built from the equipment and constraints you '
            + 'have reported today. The one recommended above is the longest this '
            + 'can build from what you have.',
      });
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  /** The other two variants of the recommended session, offered as choices. */
  const alternates = decision.kind === 'session'
    ? decision.template.variants
        .filter(v => v.variant_code !== decision.variant.variant_code)
        .sort((a, b) => b.volume_multiplier - a.volume_multiplier)
    : [];

  return (
    <>
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
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          padding: 16, paddingHorizontal: space.gutter, paddingBottom: 12,
        }}>
          <View style={{ flex: 1 }}>
            <Text style={[t.h4, { color: color.ink }]}>Adapt today</Text>
            <Text style={[t.meta, { color: color.muted, fontSize: 11.5 }]}>
              {decision.kind === 'session'
                ? `${decision.template.name} · ${decision.template.estimated_minutes} min planned`
                : 'No session currently recommended'}
            </Text>
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

        <ScrollView contentContainerStyle={{ paddingBottom: 34 }}>
          <Label style={{ paddingHorizontal: space.gutter, paddingTop: 16, paddingBottom: 6 }}>
            Time available
          </Label>
          <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter }}>
            {TIME_CHOICES.map(v => (
              <Chip
                key={v} flex label={v === 90 ? '90+' : String(v)}
                active={state.available_minutes === v}
                onPress={() => dispatch({ type: 'set_time', minutes: v })}
              />
            ))}
          </View>

          <Label style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6 }}>
            Energy
          </Label>
          <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.gutter }}>
            {ENERGY_CHOICES.map(v => (
              <Chip
                key={v} flex label={v.toUpperCase()} size="sm"
                active={state.energy === v}
                onPress={() => dispatch({ type: 'set_energy', energy: v })}
                style={{ paddingVertical: 16 }}
              />
            ))}
          </View>

          <Label style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 6 }}>
            Anything else
          </Label>
          <View style={{
            flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: space.gutter,
          }}>
            {FLAG_CHOICES.map(f => (
              <Chip
                key={f} label={f} size="sm"
                active={state.flags.includes(f)}
                onPress={() => dispatch({ type: 'toggle_flag', flag: f })}
                style={{ width: '48.5%', paddingVertical: 13 }}
              />
            ))}
          </View>

          <View style={{ paddingHorizontal: space.gutter, paddingTop: 22 }}>
            <Rule heavy />
          </View>

          {decision.kind === 'session' ? (
            <>
              <Label style={{ paddingHorizontal: space.gutter, paddingTop: 14 }}>
                Recommended
              </Label>
              <View style={{
                margin: 8, marginHorizontal: space.gutter, marginBottom: 0,
                borderWidth: 2, borderColor: color.red,
              }}>
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ flex: 1, padding: 14, paddingHorizontal: 16 }}>
                    <Text style={[t.labelSm, { fontSize: 9, letterSpacing: 1.44, color: color.red }]}>
                      {VARIANT_LABEL[decision.variant.variant_code]}
                    </Text>
                    <Text style={[t.h4, { fontSize: 21, marginTop: 5, color: color.ink }]}>
                      {decision.template.name}
                    </Text>
                    <Text style={[t.meta, { fontSize: 11.5, color: color.muted2, marginTop: 3 }]}>
                      {decision.primary_stimulus.replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <View style={{
                    width: 88, borderLeftWidth: 1, borderLeftColor: color.tintBorder,
                    backgroundColor: color.tint, justifyContent: 'center', paddingLeft: 14,
                  }}>
                    <Text style={[t.sessionMins, numeralTrim.sessionMins, { fontSize: 32, color: color.redDark }]}>
                      {decision.estimated_minutes}
                    </Text>
                    <Label tone="redDark" size="sm" style={{ letterSpacing: 1.26 }}>Min</Label>
                  </View>
                </View>

                <View style={{
                  borderTopWidth: 1, borderTopColor: color.tintBorder,
                  backgroundColor: color.tint, padding: 12, paddingHorizontal: 16,
                }}>
                  <Text style={[t.bodySm, { fontSize: 12.5, color: color.redDeep }]}>
                    {decision.rationale}
                  </Text>
                </View>

                <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
                  {decision.blocks.map((b, i) => (
                    <View key={b.id ?? i} style={{
                      flexDirection: 'row', gap: 12, paddingVertical: 8,
                      borderBottomWidth: 1, borderBottomColor: color.ruleFaint,
                    }}>
                      <Text style={[t.rowTitle, { fontSize: 12.5, width: 56, color: color.ink }]}>
                        {b.rounds && b.rounds > 1 ? `${b.rounds} ×` : `${b.duration_minutes ?? ''} min`}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[{ fontFamily: t.greeting.fontFamily, fontSize: 12.5, color: color.ink }]}>
                          {b.title ?? b.block_type}
                        </Text>
                        <Text style={[t.meta, { color: color.muted }]}>
                          {b.exercises.map(e =>
                            exerciseById.get(e.exercise_id)?.name ?? e.exercise_id).join(' · ')}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>

                {/* The same disclosure Today's card carries. Adapting is where
                    the prescription changes, so it is the place the athlete is
                    most likely to want to read what changed. */}
                <FullWorkout
                  blocks={decision.blocks}
                  intensity={decision.template.intensity_target ?? null}
                  totalMinutes={decision.estimated_minutes}
                />
              </View>

              {alternates.length > 0 && (
                <>
                  <Label style={{ paddingHorizontal: space.gutter, paddingTop: 16 }}>
                    Other versions of this stimulus
                  </Label>
                  <Text style={[t.meta, {
                    paddingHorizontal: space.gutter, paddingTop: 4, color: color.muted,
                  }]}>
                    Tap one to use it instead.
                  </Text>
                  <View style={{ paddingHorizontal: space.gutter, paddingTop: 8, gap: 6 }}>
                    {alternates.map(v => (
                      <Pressable
                        key={v.variant_code}
                        onPress={() => accept(decision.template.id, v.variant_code)}
                        accessibilityRole="button"
                        accessibilityLabel={`${VARIANT_LABEL[v.variant_code]}, ${variantMinutes(decision.template, v)} minutes`}
                        style={({ pressed }) => ({
                          borderWidth: 1, borderColor: color.rule,
                          backgroundColor: pressed ? color.hover : color.card,
                          padding: 13, paddingHorizontal: 14,
                          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                        })}
                      >
                        <View>
                          <Text style={[t.labelSm, {
                            fontSize: 11, letterSpacing: 1.54, color: color.muted2,
                          }]}>
                            {VARIANT_LABEL[v.variant_code]}
                          </Text>
                          <Text style={[t.rowTitle, { marginTop: 2, color: color.ink }]}>
                            {decision.template.name}
                          </Text>
                        </View>
                        <Text style={[t.h4, { fontSize: 18, color: color.muted2 }]}>
                          {variantMinutes(decision.template, v)}
                          <Text style={{ fontSize: 9, letterSpacing: 0.9 }}> MIN</Text>
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <ActionButton
                label="Use this workout"
                onPress={() => accept(decision.template.id, decision.variant.variant_code)}
                style={{ margin: 18, marginHorizontal: space.gutter, paddingVertical: 19 }}
              />
            </>
          ) : (
            <View style={{ padding: space.gutter }}>
              <Text style={[t.body, { color: color.muted2 }]}>{decision.guidance}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </>
  );
}

/**
 * The sheet, with its own dialog host inside it.
 *
 * That nesting is load-bearing, not tidiness. A React Native modal presents
 * from the view controller of the React view it is rendered into
 * (`RCTModalHostViewComponentView`: `[[self reactViewController]
 * presentViewController:…]`). The app-wide `DialogProvider` in `_layout` renders
 * its modal as a sibling of the screens, so its controller is the root one —
 * and the root controller is already presenting *this* sheet. iOS will not
 * present twice from the same controller, so the confirmation never appeared,
 * the promise it returns never settled, and choosing Full simply did nothing.
 *
 * A provider inside this modal gives the dialog this sheet's controller to
 * present from instead. The outer provider still serves every screen that asks
 * from outside a modal; `useDialog` resolves to the nearest one.
 */
export function AdaptSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <DialogProvider>
        <AdaptSheetBody visible={visible} onClose={onClose} />
      </DialogProvider>
    </Modal>
  );
}
