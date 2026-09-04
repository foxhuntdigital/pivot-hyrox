/**
 * D05 Equipment (PRD §6.1 step 5, §8.2).
 *
 * Options come from `content.equipment` rather than a hardcoded list, so what
 * an athlete can claim to own is exactly what the engine can select against.
 * Location profiles are a later refinement; this captures the default profile.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingStep, MultiChipRow } from '@/components/onboarding';
import { Label } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';
import { useOnboarding } from '@/state/onboarding';
import { fetchEquipment, type EquipmentOption } from '@/data/planRepo';
import { COMMON_EQUIPMENT, EQUIPMENT, visibleEquipment } from '@/data/content';

/** Readable headings for the category keys the library uses. */
const CATEGORY_LABEL: Record<string, string> = {
  cardio: 'Cardio',
  hyrox: 'HYROX stations',
  strength: 'Strength',
  other: 'Other',
};

export default function EquipmentScreen() {
  const router = useRouter();
  const { draft, update } = useOnboarding();
  const [options, setOptions] = useState<EquipmentOption[] | null>(null);
  // Set when the library could not be reached and the bundled catalogue is
  // standing in. Not surfaced as a blocking error: the shipped list is the same
  // seed the server holds, so the athlete can answer and move on.
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function apply(source: EquipmentOption[]) {
      // Filtered here rather than at each call site so the fetched catalogue and
      // the bundled fallback offer the same thing, and so the default selection
      // below can never pre-select something the athlete cannot see.
      const list = visibleEquipment(source);
      setOptions(list);
      // Pre-select a sensible default the first time rather than starting
      // empty, which reads as "you own nothing".
      if (draft.equipment.length === 0 && list.length > 0) {
        const ids = new Set(list.map(o => o.id));
        update({ equipment: COMMON_EQUIPMENT.filter(id => ids.has(id)) });
      }
    }
    fetchEquipment()
      .then(list => {
        if (cancelled) return;
        // An unconfigured Supabase returns [] rather than throwing, and the
        // seeded build should still get a list to answer with.
        if (list.length === 0) { setOffline(true); apply(EQUIPMENT); return; }
        apply(list);
      })
      .catch(e => {
        if (cancelled) return;
        // The library ships with the binary (PRD §15.1), so a failed fetch is a
        // reason to fall back to it, not to strand the athlete mid-flow.
        console.warn('[onboarding] equipment fetch failed, using bundled catalogue:', e);
        setOffline(true);
        apply(EQUIPMENT);
      });
    return () => { cancelled = true; };
    // Runs once: re-running on draft changes would fight the athlete's edits.
  }, []);

  function toggle(id: string) {
    update({
      equipment: draft.equipment.includes(id)
        ? draft.equipment.filter(e => e !== id)
        : [...draft.equipment, id],
    });
  }

  const categories = options
    ? [...new Set(options.map(o => o.category))]
    : [];

  return (
    <OnboardingStep
      step={4}
      title="What can you train with?"
      description="Sessions are only built from equipment you have. You can change this whenever your setup does."
      onBack={() => router.back()}
      onContinue={() => router.push('/availability' as never)}
    >
      {options === null ? (
        <View style={{ paddingVertical: 40 }}>
          <ActivityIndicator color={color.red} />
        </View>
      ) : null}

      {options !== null ? (
        <>
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            paddingHorizontal: space.gutter, paddingBottom: 14,
          }}>
            <Label tone="muted">{`${draft.equipment.length} selected`}</Label>
            <Pressable
              onPress={() => update({
                equipment: draft.equipment.length === options.length
                  ? []
                  : options.map(o => o.id),
              })}
              hitSlop={10}
            >
              <Label tone="ink">
                {draft.equipment.length === options.length ? 'Clear all' : 'Select all'}
              </Label>
            </Pressable>
          </View>

          {categories.map(category => (
            <MultiChipRow
              key={category}
              label={CATEGORY_LABEL[category] ?? category}
              options={options
                .filter(o => o.category === category)
                .map(o => ({ value: o.id, label: o.name }))}
              values={draft.equipment}
              onToggle={toggle}
            />
          ))}
        </>
      ) : null}

      {offline ? (
        <View style={{
          marginHorizontal: space.gutter, marginBottom: 16,
          borderWidth: 1, borderColor: color.rule,
          paddingHorizontal: 13, paddingVertical: 12,
        }}>
          <Text style={[t.bodySm, { color: color.muted2 }]}>
            We couldn't refresh this just now, so this is the built-in list. Everything here
            still works — you can fine-tune it later on Profile.
          </Text>
        </View>
      ) : null}

      {options !== null && draft.equipment.length === 0 ? (
        <View style={{
          marginHorizontal: space.gutter,
          backgroundColor: color.tint, borderWidth: 1, borderColor: color.tintBorder,
          paddingHorizontal: 13, paddingVertical: 12,
        }}>
          <Text style={[t.bodySm, { color: color.redDeep }]}>
            With nothing selected the plan falls back to bodyweight and running only. That is a
            valid way to train, but it will not cover the HYROX stations.
          </Text>
        </View>
      ) : null}
    </OnboardingStep>
  );
}
