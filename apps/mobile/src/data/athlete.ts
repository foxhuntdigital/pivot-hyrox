/**
 * Athlete state for the current build.
 *
 * These are the values the Supabase queries will return once auth is wired:
 * the active race, the current phase, this week's stimulus requirements and
 * recent sessions. Kept in one module so swapping to live data is a change of
 * source, not a change of shape.
 */
import type { CompletedSession, StimulusRequirement } from '@pivot/engine';
import type { AthleteProfile } from './profile';

export interface Race {
  name: string;
  date: string;
  division: string;
  days_remaining: number;
}

export interface Phase {
  type: 'foundation' | 'build' | 'specific' | 'peak' | 'taper' | 'race';
  week: number;
  total_weeks: number;
  name: string;
}

/**
 * The seeded athlete, used until a Supabase session supplies a real profile.
 * Name, experience level and postpartum date are editable at runtime (D22), and
 * the descriptor is derived from them rather than stored — so it stays true as
 * months pass instead of freezing at whatever was authored.
 */
export const DEFAULT_PROFILE: AthleteProfile = {
  display_name: 'Ashley Kerr',
  experience_level: 'intermediate',
  postpartum_birth_date: '2025-11-01',
};

export const RACE: Race = {
  name: 'Boston HYROX',
  date: 'October 10',
  division: 'Elite 15–39',
  days_remaining: 58,
};

export const PHASE: Phase = {
  type: 'build',
  week: 7,
  total_weeks: 16,
  name: 'Boston Build',
};

export const PHASE_SEQUENCE = [
  { key: 'foundation', label: 'Found.' },
  { key: 'build', label: 'Build' },
  { key: 'specific', label: 'Spec.' },
  { key: 'peak', label: 'Peak' },
  { key: 'taper', label: 'Taper' },
  { key: 'race', label: 'Race' },
] as const;

/** The week is measured in stimuli, not weekdays (PRD §2). */
export const WEEK_STIMULI: StimulusRequirement[] = [
  { stimulus_type: 'aerobic_durability', target_exposures: 2, completed_exposures: 1, priority: 1 },
  { stimulus_type: 'threshold', target_exposures: 2, completed_exposures: 1, priority: 1 },
  { stimulus_type: 'strength', target_exposures: 2, completed_exposures: 1, priority: 2 },
  { stimulus_type: 'race_specific', target_exposures: 1, completed_exposures: 0, priority: 2 },
  { stimulus_type: 'recovery', target_exposures: 1, completed_exposures: 1, priority: 3 },
];

export const RECENT_SESSIONS: CompletedSession[] = [
  { template_id: 'wo_ski_zone_2_30', workout_family: 'ski_base', primary_goal: 'aerobic_base', days_ago: 1, impact_level: 'low', session_rpe: 4 },
  { template_id: 'wo_hyrox_legs_a', workout_family: 'strength_legs', primary_goal: 'strength', days_ago: 2, impact_level: 'medium', session_rpe: 7 },
  { template_id: 'wo_zone_2_run_45', workout_family: 'run_base', primary_goal: 'aerobic_base', days_ago: 4, impact_level: 'medium', session_rpe: 5 },
  { template_id: 'wo_ski_5x500', workout_family: 'ski_quality', primary_goal: 'threshold', days_ago: 5, impact_level: 'low', session_rpe: 7 },
];

export const DEFAULT_EQUIPMENT = ['treadmill', 'outdoor', 'ski', 'bike', 'db', 'kb', 'box', 'wall_ball', 'sled', 'rope', 'sandbag'];

export const CONSIDERATION_CHOICES = [
  'Returning from injury',
  'Postpartum',
  'Breastfeeding',
  'Pelvic-floor considerations',
];

export const DEFAULT_CONSIDERATIONS = ['Postpartum', 'Pelvic-floor considerations'];

/** Readiness inputs for the Progress screen. */
export const READINESS_INPUTS = {
  aerobic_minutes_14d: 232,
  threshold_sessions_14d: 3,
  run_sessions_7d: 2,
  longest_run_km: 16.2,
  strength_completion_rate: 0.91,
  stations_covered_21d: 6,
  stimulus_adherence_4w: 0.83,
  recovery_signal: 0.58,
  observed_days: 26,
};

/** Per-metric supporting detail shown when a Progress row is expanded. */
export const METRIC_DETAIL: Record<string, { label: string; detail: string; stats: { k: string; v: string }[] }> = {
  aerobic: {
    label: 'Aerobic engine',
    detail: 'Threshold pace at a comparable heart rate has improved steadily through this block.',
    stats: [{ k: 'Z2 pace', v: '8:52' }, { k: '30d load', v: '1,640' }, { k: 'HR drift', v: '4.1%' }],
  },
  running: {
    label: 'Running',
    detail: 'The limiter for your goal time. Compromised running under fatigue is the next four weeks’ priority.',
    stats: [{ k: '1 km', v: '4:18' }, { k: 'Longest', v: '16.2 km' }, { k: 'Weekly', v: '38 km' }],
  },
  strength: {
    label: 'Strength',
    detail: 'Already ahead of what your goal requires. Maintaining rather than building.',
    stats: [{ k: 'Squat', v: '215' }, { k: 'Deadlift', v: '285' }, { k: 'Press', v: '105' }],
  },
  stations: {
    label: 'Stations',
    detail: 'Sled push and wall balls carry the gain; burpee broad jumps still lag.',
    stats: [{ k: 'Ski 1k', v: '4:02' }, { k: 'Sled', v: '1:48' }, { k: 'Wall balls', v: '2:31' }],
  },
  consistency: {
    label: 'Consistency',
    detail: 'Stimuli completed per week, not sessions on the calendar.',
    stats: [{ k: 'Stimuli/wk', v: '4.8' }, { k: 'Adapted', v: '41%' }, { k: 'Skipped', v: '3%' }],
  },
  recovery: {
    label: 'Recovery',
    detail: 'Sleep debt across the last ten days. Adaptations are already accounting for it.',
    stats: [{ k: 'Sleep avg', v: '5:41' }, { k: 'HRV', v: '48' }, { k: 'RHR', v: '54' }],
  },
};
