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
import { DEFAULT_EQUIPMENT } from '@/data/athlete';

/** Readable headings for the category keys the library uses. */
const CATEGORY_LABEL: Record<string, string> = {
  cardio: 'Cardio',
  hyrox: 'HYROX stations',
  strength: 'Strength',
  bodyweight: 'Bodyweight',
  other: 'Other',
};

export default function EquipmentScreen() {
  const router = useRouter();
  const { draft, update } = useOnboarding();
  const [options, setOptions] = useState<EquipmentOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEquipment()
      .then(list => {
        if (cancelled) return;
        setOptions(list);
        // Pre-select a sensible default the first time rather than starting
        // empty, which reads as "you own nothing".
        if (draft.equipment.length === 0 && list.length > 0) {
          const ids = new Set(list.map(o => o.id));
          update({ equipment: DEFAULT_EQUIPMENT.filter(id => ids.has(id)) });
        }
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load equipment.'); });
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
      error={error}
    >
      {options === null && !error ? (
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
