/**
 * D07 Health permissions — progressive permission education (PRD §6.1 step 8).
 *
 * The PRD is explicit that permission is deferred until the value is clear and
 * that the app explains exactly what is read and written. HealthKit is P1 and
 * not built (README, "Known gaps"), so this screen does the explaining and
 * nothing else: an inert Connect button that grants nothing would be a lie
 * about what the app does, and the same posture the app takes elsewhere is to
 * show an honest disconnected state rather than invent one (§8.3).
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingStep } from '@/components/onboarding';
import { Label, Rule } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';

const READS = [
  'Workouts you record elsewhere, so the plan counts training it did not prescribe',
  'Resting heart rate and heart-rate variability, as recovery signals',
  'Sleep duration, which can downgrade a hard session on a bad night',
];

const WRITES = [
  'Completed sessions, so your rings and history stay accurate',
];

function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ paddingHorizontal: space.gutter, paddingBottom: 18 }}>
      {items.map(item => (
        <View key={item} style={{ flexDirection: 'row', paddingBottom: 8 }}>
          <Text style={[t.bodySm, { color: color.muted, width: 16 }]}>—</Text>
          <Text style={[t.bodySm, { color: color.muted2, flex: 1 }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export default function HealthScreen() {
  const router = useRouter();

  return (
    <OnboardingStep
      step={6}
      title="Health data, when you want it"
      description="Nothing is connected now. This is what it would read and write when it is, so the ask is not a surprise later."
      onBack={() => router.back()}
      onContinue={() => router.push('/preferences' as never)}
      continueLabel="Continue"
    >
      <Label tone="ink" style={{ paddingHorizontal: space.gutter, paddingBottom: 10 }}>
        What it would read
      </Label>
      <Bullets items={READS} />

      <Rule faint />

      <Label tone="ink" style={{
        paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 10,
      }}>
        What it would write
      </Label>
      <Bullets items={WRITES} />

      <View style={{
        marginHorizontal: space.gutter,
        borderWidth: 1, borderColor: color.rule,
        paddingHorizontal: 13, paddingVertical: 12,
      }}>
        <Label tone="ink" size="sm" style={{ paddingBottom: 6 }}>Not yet available</Label>
        <Text style={[t.bodySm, { color: color.muted2 }]}>
          Health integration is not built into this version. Until it is, the app shows a plain
          "not connected" state where heart rate and training load would appear rather than
          filling the gap with estimates. Your plan works without it.
        </Text>
      </View>
    </OnboardingStep>
  );
}
