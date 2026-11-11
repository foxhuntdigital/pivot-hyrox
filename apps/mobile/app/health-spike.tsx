/**
 * THROWAWAY SPIKE (branch spike/apple-health). Not for release.
 *
 * Hidden test screen for the Apple Health device spike. Open it with the deep
 * link `pivot://health-spike` (signed in and past onboarding). The test script
 * is docs/apple-health-spike-checklist.md; findings go back into
 * docs/apple-health-discovery.md.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Share, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AuthorizationRequestStatus, AuthorizationStatus,
  authorizationStatusFor, getRequestStatusForAuthorization, isHealthDataAvailable, requestAuthorization,
} from '@kingstinct/react-native-healthkit';

import { HealthSpike, type SpikeActivity, type SpikeEntry } from '../modules/pivot-health-spike';
import { color, space, type as t } from '@/theme/tokens';

const ACCESS = {
  toRead: [
    'HKQuantityTypeIdentifierHeartRate',
    'HKQuantityTypeIdentifierRestingHeartRate',
    'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
    'HKQuantityTypeIdentifierActiveEnergyBurned',
    'HKCategoryTypeIdentifierSleepAnalysis',
    'HKWorkoutTypeIdentifier',
  ],
  toShare: [
    'HKWorkoutTypeIdentifier',
    'HKQuantityTypeIdentifierHeartRate',
    'HKQuantityTypeIdentifierActiveEnergyBurned',
  ],
} as const;

const ACTIVITIES: SpikeActivity[] = ['functionalStrength', 'crossTraining', 'hiit', 'running'];
const NOTES = ['Strap on', 'Strap off', 'Earbuds in', 'Watch workout started', 'Watch workout ended', 'Locking phone', 'Hard effort'];

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={{
        borderWidth: 1, borderColor: color.ink, paddingHorizontal: 12, paddingVertical: 10,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Text style={[t.bodySm, { color: color.ink }]}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, gap: 8 }}>
      <Text style={[t.rowTitle, { color: color.ink }]}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

const fmt = (n: unknown, digits = 0) => (typeof n === 'number' ? n.toFixed(digits) : '—');

export default function HealthSpikeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<SpikeEntry[]>(() => HealthSpike?.getLog() ?? []);
  const [activity, setActivity] = useState<SpikeActivity>('functionalStrength');
  const [running, setRunning] = useState(false);
  const [watching, setWatching] = useState(false);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');

  const env = HealthSpike?.environment();

  useEffect(() => {
    if (!HealthSpike) return;
    const sub = HealthSpike.addListener('onLog', entry => setEntries(prev => [...prev, entry]));
    return () => sub.remove();
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const request = await getRequestStatusForAuthorization(ACCESS);
      const workout = authorizationStatusFor('HKWorkoutTypeIdentifier');
      const hr = authorizationStatusFor('HKQuantityTypeIdentifierHeartRate');
      setStatus([
        `prompt: ${AuthorizationRequestStatus[request]}`,
        `write workouts: ${AuthorizationStatus[workout]}`,
        `write HR: ${AuthorizationStatus[hr]}`,
      ].join(' · '));
    } catch (e) {
      setStatus(`status error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const run = (label: string, fn: () => Promise<unknown> | unknown) => async () => {
    try {
      await fn();
    } catch (e) {
      HealthSpike?.note(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Rebuilt from the native log so readings taken while locked show up too.
  const lastLive = [...entries].reverse().find(e => e.kind === 'live_hr');
  const lastWatch = [...entries].reverse().find(e => e.kind === 'hr_sample');

  if (!HealthSpike) {
    return (
      <View style={{ flex: 1, padding: space.gutter, paddingTop: insets.top + 20, backgroundColor: color.paper }}>
        <Text style={[t.bodySm, { color: color.ink }]}>
          The spike's native module isn't in this build. Install a development build from the spike/apple-health branch.
        </Text>
      </View>
    );
  }
  const spike = HealthSpike;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.paper }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 60 }}>
      <View style={{ paddingHorizontal: space.gutter, gap: 4 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={[t.bodySm, { color: color.muted2 }]}>‹ Back</Text></Pressable>
        <Text style={[t.h2, { color: color.ink }]}>Apple Health spike</Text>
        <Text style={[t.meta, { color: color.muted2 }]}>
          iOS {env?.iosVersion} · Health {env?.healthDataAvailable ? 'available' : 'unavailable'} · iPhone session {env?.supportsIPhoneWorkoutSession ? 'yes' : 'no'} · zones {env?.supportsZones ? 'yes' : 'no'}
        </Text>
        <Text style={[t.meta, { color: color.muted2 }]}>{status}</Text>
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: space.gutter, paddingTop: 16, gap: 24 }}>
        <View>
          <Text style={[t.meta, { color: color.muted2 }]}>Live (session)</Text>
          <Text style={[t.statValue, { color: color.ink }]}>{fmt(lastLive?.bpm)}</Text>
          <Text style={[t.meta, { color: color.muted2 }]}>delay {fmt(lastLive?.delaySec, 1)} s</Text>
        </View>
        <View>
          <Text style={[t.meta, { color: color.muted2 }]}>Latest sample</Text>
          <Text style={[t.statValue, { color: color.ink }]}>{fmt(lastWatch?.bpm)}</Text>
          <Text style={[t.meta, { color: color.muted2 }]}>
            {String(lastWatch?.source ?? '—')} · {fmt(lastWatch?.delaySec, 1)} s late
          </Text>
        </View>
      </View>

      <Section title="1. Access">
        <Button label="Request access" onPress={run('request access', async () => {
          if (!isHealthDataAvailable()) { spike.note('Health data not available'); return; }
          const shown = await requestAuthorization(ACCESS);
          spike.note(`requestAuthorization returned ${shown}`);
          await refreshStatus();
        })} />
        <Button label="Refresh status" onPress={() => void refreshStatus()} />
      </Section>

      <Section title="2. iPhone workout session">
        {ACTIVITIES.map(a => (
          <Button key={a} label={a === activity ? `● ${a}` : a} onPress={() => setActivity(a)} disabled={running} />
        ))}
      </Section>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: space.gutter, paddingTop: 8 }}>
        <Button label="Start" disabled={running} onPress={run('start', async () => { await spike.startSession(activity); setRunning(true); })} />
        <Button label="Pause" disabled={!running} onPress={run('pause', () => spike.pauseSession())} />
        <Button label="Resume" disabled={!running} onPress={run('resume', () => spike.resumeSession())} />
        <Button label="End + save" disabled={!running} onPress={run('end', async () => { setRunning(false); await spike.endSession(true); })} />
        <Button label="End + discard" disabled={!running} onPress={run('discard', async () => { setRunning(false); await spike.endSession(false); })} />
      </View>

      <Section title="3. Heart-rate samples reaching the phone (Watch)">
        <Button label={watching ? 'Listening…' : 'Start listening'} disabled={watching} onPress={() => { spike.startWatchHeartRate(); setWatching(true); }} />
        <Button label="Stop" disabled={!watching} onPress={() => { spike.stopWatchHeartRate(); setWatching(false); }} />
      </Section>

      <Section title="4. Workouts and zones in Health">
        <Button label="Workouts, last 6 h" onPress={run('workouts', () => spike.recentWorkouts(6))} />
        <Button label="My preferred zones" onPress={run('zones', () => spike.preferredZones())} />
      </Section>

      <Section title="5. Notes (timestamped into the log)">
        {NOTES.map(n => <Button key={n} label={n} onPress={() => spike.note(n)} />)}
      </Section>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: space.gutter, paddingTop: 8 }}>
        <TextInput
          value={note} onChangeText={setNote} placeholder="Free note" placeholderTextColor={color.muted3}
          style={{ flex: 1, borderWidth: 1, borderColor: color.chipBorder, paddingHorizontal: 10, color: color.ink }}
        />
        <Button label="Add" onPress={() => { if (note.trim()) spike.note(note.trim()); setNote(''); }} />
      </View>

      <Section title={`6. Log (${entries.length})`}>
        <Button label="Share log" onPress={run('share', () => Share.share({ message: JSON.stringify(spike.getLog(), null, 1) }))} />
        <Button label="Reload" onPress={() => setEntries(spike.getLog())} />
        <Button label="Clear" onPress={() => { spike.clearLog(); setEntries([]); }} />
      </Section>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: 10, gap: 4 }}>
        {[...entries].reverse().slice(0, 80).map((e, i) => {
          const { kind, at, ...rest } = e;
          return (
            <Text key={`${at}-${i}`} style={[t.meta, { color: color.ink, fontSize: 11 }]}>
              {at.slice(11, 23)} {kind} {Object.keys(rest).length ? JSON.stringify(rest) : ''}
            </Text>
          );
        })}
      </View>
    </ScrollView>
  );
}
