/**
 * Profile's words and rules, kept out of the screens so they can be tested.
 *
 * Every row on the redesigned Profile shows its current value in plain words,
 * and every edit that changes sessions says what it will do before it is
 * saved. Both are worked out here: the summaries, the equipment groups, what a
 * draft changes, and whether a goal edit keeps the plan or starts a new one.
 */

/* ── row summaries ──────────────────────────────────────────────────────── */

export interface EquipmentChoice { id: string; name: string; category: string }

/** The equipment page's groups, in the order an athlete thinks of their kit. */
const GROUPS: { category: string; title: string }[] = [
  { category: 'cardio', title: 'Cardio' },
  { category: 'hyrox', title: 'Race kit' },
  { category: 'strength', title: 'Strength' },
  { category: 'conditioning', title: 'Conditioning' },
  { category: 'recovery', title: 'Recovery' },
];

export function equipmentGroups<T extends EquipmentChoice>(choices: T[]): { title: string; items: T[] }[] {
  const known = new Set(GROUPS.map(g => g.category));
  const groups = GROUPS.map(g => ({ title: g.title, items: choices.filter(c => c.category === g.category) }));
  const other = choices.filter(c => !known.has(c.category));
  if (other.length) groups.push({ title: 'Other', items: other });
  return groups.filter(g => g.items.length);
}

/** "14 items · Sled, SkiErg, Rower, Barbell, Dumbbells…", race kit named first. */
export function equipmentSummary(selected: string[], choices: EquipmentChoice[]): string {
  if (!selected.length) return 'Nothing ticked · bodyweight sessions only';
  const order = ['hyrox', 'cardio', 'strength', 'conditioning', 'recovery'];
  const rank = (c: EquipmentChoice) => (order.indexOf(c.category) + 1 || order.length + 1);
  const names = choices.filter(c => selected.includes(c.id)).sort((a, b) => rank(a) - rank(b)).map(c => c.name);
  const count = `${selected.length} ${selected.length === 1 ? 'item' : 'items'}`;
  return names.length > 5 ? `${count} · ${names.slice(0, 5).join(', ')}…` : `${count} · ${names.join(', ')}`;
}

export const lengthSummary = (minutes: number) => `Usually ${minutes >= 90 ? '90+' : minutes} min`;

export function weekSummary(label: string, variantsAhead: boolean): string {
  return `${label} · ${variantsAhead ? 'shorter versions ready in advance' : 'shorter versions when you ask'}`;
}

export function fitnessSummary(load: string | null, technical: string | null): string {
  return load && technical ? `${load} · ${technical}` : 'Not answered · your plan is sized for the middle';
}

/** "Love strength · Rather not easy aerobic", from what the athlete stated. */
export function enjoySummary(
  ratings: Record<string, string>, options: { value: string; label: string }[],
): string {
  const named = (rating: string) => options
    .filter(o => ratings[o.value] === rating).map(o => o.label.toLowerCase());
  const parts = [
    named('love').length ? `Love ${named('love').join(', ')}` : null,
    named('like').length && !named('love').length ? `Like ${named('like').join(', ')}` : null,
    named('rather_not').length ? `Rather not ${named('rather_not').join(', ')}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing set · sessions rank on your plan alone';
}

export function needsWorkSummary(picked: string[], options: { value: string; label: string }[], max = 3): string {
  const names = options.filter(o => picked.includes(o.value)).map(o => o.label);
  return names.length ? `${names.join(', ')} · ${picked.length} of ${max}` : `None picked · 0 of ${max}`;
}

export function healthSummary(considerations: string[], postpartum: string | null): string {
  const parts = [...considerations.filter(c => c !== 'Postpartum' || !postpartum), postpartum].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing set';
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso: string) => `${SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** "Training since Sep 7 · 54 sessions", from the session index (newest first). */
export function trainingSince(sessions: { date: string }[]): string | null {
  if (!sessions.length) return null;
  const first = sessions[sessions.length - 1].date;
  return `Training since ${shortDate(first)} · ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`;
}

/* ── drafts ─────────────────────────────────────────────────────────────── */

/** Ids whose state differs between what is saved and the draft. */
export function changedIds(saved: string[], draft: string[]): Set<string> {
  const a = new Set(saved);
  const b = new Set(draft);
  return new Set([...a, ...b].filter(id => a.has(id) !== b.has(id)));
}

export const changesTitle = (n: number) => (n === 1 ? '1 change' : `${n} changes`);

/** What saving an edit that changes sessions will do to this week. */
export function rebuildConsequence(left: number, what: string): string {
  if (left === 0) return `No sessions are left this week, so next week is built ${what}. Finished sessions stay as they were.`;
  return `Your ${left === 1 ? 'session' : `${left} sessions`} left this week ${left === 1 ? 'is' : 'are'} rebuilt ${what}. `
    + 'Finished sessions stay as they were.';
}

/* ── goal ───────────────────────────────────────────────────────────────── */

export interface GoalDraft {
  mode: 'race' | 'block';
  name: string;
  date: string | null;
  division: string | null;
  weeks: number;
}

export interface GoalNow {
  race: { name: string; event_date: string; division: string | null } | null;
  total_weeks: number | null;
}

/**
 * What a goal edit does.
 *
 * A race date, a program length, or a switch between race and no race moves
 * the runway every phase is a share of, so it starts a new plan at week 1.
 * A name or a division changes nothing the planner reads. This is GoalSettings'
 * `changesRunway`, unchanged, plus the case where nothing changed at all.
 */
export function goalChange(now: GoalNow, d: GoalDraft): 'none' | 'details' | 'rebuild' {
  const onRace = now.race != null;
  const rebuild = d.mode === 'race'
    ? !onRace || d.date !== now.race!.event_date
    : onRace || d.weeks !== now.total_weeks;
  if (rebuild) return 'rebuild';
  if (d.mode === 'race' && now.race
    && ((d.name.trim() || 'My race') !== now.race.name || (d.division ?? null) !== (now.race.division ?? null))) {
    return 'details';
  }
  return 'none';
}

/** Whole weeks from today to a date, rounded up, never below 0. */
export function weeksUntil(today: string, date: string): number {
  const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return Math.max(0, Math.ceil(days / 7));
}
