/**
 * THROWAWAY SPIKE (branch spike/apple-health). Not for release.
 * JS face of `ios/PivotHealthSpikeModule.swift`. Null when the native module
 * isn't in the build (Android, Expo Go, an old dev client).
 */
import { requireOptionalNativeModule, type NativeModule } from 'expo';

export type SpikeEntry = { kind: string; at: string; [key: string]: unknown };

export type SpikeEnvironment = {
  iosVersion: string;
  healthDataAvailable: boolean;
  supportsIPhoneWorkoutSession: boolean;
  supportsZones: boolean;
};

export type SpikeActivity = 'functionalStrength' | 'crossTraining' | 'hiit' | 'running';

declare class PivotHealthSpikeModule extends NativeModule<{ onLog: (entry: SpikeEntry) => void }> {
  environment(): SpikeEnvironment;
  getLog(): SpikeEntry[];
  clearLog(): void;
  note(text: string): void;
  startSession(activity: SpikeActivity): Promise<void>;
  pauseSession(): Promise<void>;
  resumeSession(): Promise<void>;
  endSession(save: boolean): Promise<string | null>;
  startWatchHeartRate(): void;
  stopWatchHeartRate(): void;
  recentWorkouts(hours: number): Promise<Record<string, unknown>[]>;
  preferredZones(): Promise<Record<string, unknown> | null>;
}

export const HealthSpike = requireOptionalNativeModule<PivotHealthSpikeModule>('PivotHealthSpike');
