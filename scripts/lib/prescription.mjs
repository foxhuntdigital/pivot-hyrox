/**
 * Parses a pack's free-text `full_prescription` into schema-shaped blocks.
 *
 * The station matrix and running expansion describe a session as prose —
 * "4r: 600m run + 400m Ski + 12 wall balls" — while content.block_exercises
 * needs (exercise_id, prescription_type, quantity, quantity_unit) per movement.
 *
 * Two things make this more than string-splitting:
 *
 *  1. `m` is ambiguous. "800m run" is metres, "8m tempo" is eight minutes, and
 *     "4 x 20m" of burpee broad jumps is twenty metres. Reading one as the other
 *     prescribes twenty minutes of burpees. Where the movement settles it
 *     (a sled is never measured in minutes) that is used; where only magnitude
 *     could settle it the reading is recorded as a heuristic and the caller is
 *     told, and durations are reconciled against the pack's own
 *     `estimated_minutes` so a wrong reading fails loudly.
 *
 *  2. A movement the lexicon does not know must never fall through to the
 *     station's default. "10 TRX rows" at the Sled Pull station is not ten sled
 *     pulls. Unrecognised movement words are refused.
 *
 * Anything that cannot be read confidently returns { unparsed: reason }.
 */

const MOVEMENTS = [
  [/\bski(?:erg)?\b/i, 'ex_skierg'],
  [/\brow(?:erg)?\b(?!\s*s?\b.*trx)/i, 'ex_rowerg'],
  [/\b(?:spin\s+)?bike\b/i, 'ex_spin_bike'],
  [/\bsled\s+push\b|\bpush\b(?!\s*-?\s*ups?)/i, 'ex_sled_push'],
  [/\bsled\s+pull\b|\bpull\b(?!\s*-?\s*ups?)/i, 'ex_sled_pull'],
  [/\bbbj\b|\bburpees?\b|\bbroad\s+jumps?\b/i, 'ex_burpee_broad_jump'],
  [/\b(?:farmer\s+)?carry\b/i, 'ex_farmer_carry'],
  [/\b(?:sandbag\s+)?lunges?\b/i, 'ex_sandbag_walking_lunge'],
  [/\bwb\b|\bwall\s+balls?\b/i, 'ex_wall_ball'],
  [/\bair\s+squats?\b/i, 'ex_air_squat'],
  [/\bgoblet\s+squats?\b/i, 'ex_goblet_squat'],
  [/\bstep-?overs?\b/i, 'ex_box_step_over'],
  [/\bpush-?ups?\b/i, 'ex_push_up'],
  [/\bwalk\b/i, 'ex_incline_walk'],
  [/\bruns?\b|\brunning\b|\bstrides?\b|\bjog\b|\buphill\b/i, 'ex_run'],
];

export const STATION_EXERCISE = {
  'SkiErg': 'ex_skierg', 'Sled Push': 'ex_sled_push', 'Sled Pull': 'ex_sled_pull',
  'Burpee Broad Jump': 'ex_burpee_broad_jump', 'RowErg': 'ex_rowerg',
  'Farmer Carry': 'ex_farmer_carry', 'Sandbag Lunge': 'ex_sandbag_walking_lunge',
  'Wall Ball': 'ex_wall_ball',
};

/** `m` on these is always metres — none of them is ever prescribed in minutes. */
const ALWAYS_DISTANCE = new Set([
  'ex_sled_push', 'ex_sled_pull', 'ex_farmer_carry',
  'ex_sandbag_walking_lunge', 'ex_burpee_broad_jump',
]);

/** `m` on these is always minutes. */
const ALWAYS_TIME = new Set(['ex_spin_bike', 'ex_incline_walk']);

/**
 * `m` on these could be either — an erg or a run is prescribed both ways — so
 * magnitude decides and the call is reported. In the supplied packs distances
 * are 400m and up while durations top out at 75, so the boundary is wide.
 */
const MAGNITUDE_BOUNDARY = { minutesAtOrBelow: 90, metresAtOrAbove: 100 };

/** Effort, load and cue words that are description rather than movement. */
const CUE_WORDS = new RegExp('^(?:' + [
  'easy', 'moderate', 'hard', 'steady', 'strong', 'smooth', 'controlled', 'relaxed',
  'fast', 'brisk', 'light', 'heavy', 'crisp', 'very', 'conversational', 'repeatable',
  'sustainable', 'progressive', 'best', 'same', 'equal', 'quality', 'target', 'goal',
  'tempo', 'threshold', 'race', 'load', 'pace', 'paced', 'pacing', 'rhythm', 'feel',
  'effort', 'technique', 'form', 'cadence', 'focus', 'reps', 'rep', 'steps', 'step',
  'strokes', 'stroke', 'rounds', 'round', 'min', 'mins', 'minute', 'minutes', 'sec', 's',
  'rpe', 'hr', 'spm', 'incline', 'flat', 'ball', 'recovery', 'rest', 'between',
  'and', 'or', 'at', 'the', 'a', 'per', 'each', 'to', 'of', 'with', 'in', 'on', 'for',
  'x', 'r', 'm', 'ft', 'k', 'km', 'mile', 'miles', 'emom', 'time', 'trial', 'benchmark',
  'full', 'partial', 'return', 'finish', 'finished', 'total', 'inside', 'drift',
] .join('|') + ')$', 'i');

class Unparseable extends Error {}
const refuse = reason => { throw new Unparseable(reason); };

function findMovement(text) {
  for (const [re, id] of MOVEMENTS) if (re.test(text)) return id;
  return null;
}

/**
 * True when the segment contains a word that is neither a cue nor a known
 * movement — i.e. it names something the lexicon does not cover.
 */
function hasUnknownMovementWord(text) {
  const stripped = text.replace(/\d+(?:[:.]\d+)?/g, ' ').replace(/[%@/+;,()<>-]/g, ' ');
  return stripped.split(/\s+/).filter(Boolean).some(w => {
    if (CUE_WORDS.test(w)) return false;
    return !findMovement(w);
  });
}

function readItem(segment, fallbackMovement, notes) {
  const text = segment.trim();
  if (!text) refuse('empty segment');

  let movement = findMovement(text);
  if (!movement) {
    if (hasUnknownMovementWord(text)) refuse(`unrecognised movement in ${JSON.stringify(text)}`);
    movement = fallbackMovement;
  }
  if (!movement) refuse(`no movement in ${JSON.stringify(text)}`);

  const num = text.match(/(\d+(?:\.\d+)?)/);
  if (!num) refuse(`no quantity in ${JSON.stringify(text)}`);
  const qty = Number(num[1]);

  // Look for a unit anywhere in the segment, not just beside the number:
  // "8 x 5 easy technique reps" puts it at the end.
  const unitTok = text.match(/\b(\d+(?:\.\d+)?)\s*(K|km|miles?|ft)\b/i)
    ?? text.match(/\b(ft|reps?|steps?|strokes?|min(?:ute)?s?|sec(?:ond)?s?)\b/i)
    ?? text.match(/(\d+)\s*(m|s)\b/i);
  const unit = (unitTok?.[2] ?? unitTok?.[1] ?? '').toLowerCase();

  if (/^(k|km)$/.test(unit)) return item(movement, qty * 1000, 'm', 'distance', text);
  if (/^mile/.test(unit)) return item(movement, Math.round(qty * 1609), 'm', 'distance', text);
  if (unit === 'ft') return item(movement, qty, 'ft', 'distance', text);
  if (/^rep/.test(unit)) return item(movement, qty, 'reps', 'reps', text);
  if (/^step/.test(unit)) return item(movement, qty, 'steps', 'reps', text);
  if (/^stroke/.test(unit)) return item(movement, qty, 'reps', 'reps', text);
  if (/^min/.test(unit)) return item(movement, qty, 'min', 'duration', text);
  if (/^sec|^s$/.test(unit)) return item(movement, qty, 's', 'duration', text);

  if (unit === 'm') {
    if (ALWAYS_DISTANCE.has(movement)) return item(movement, qty, 'm', 'distance', text);
    if (ALWAYS_TIME.has(movement)) return item(movement, qty, 'min', 'duration', text);
    if (qty >= MAGNITUDE_BOUNDARY.metresAtOrAbove) {
      notes.push(`read "${qty}m" as metres for ${movement} on magnitude`);
      return item(movement, qty, 'm', 'distance', text);
    }
    if (qty <= MAGNITUDE_BOUNDARY.minutesAtOrBelow) {
      notes.push(`read "${qty}m" as minutes for ${movement} on magnitude`);
      return item(movement, qty, 'min', 'duration', text);
    }
    refuse(`"${qty}m" for ${movement} sits between the minute and metre ranges`);
  }

  // No unit anywhere: a bare count is a repetition count.
  return item(movement, qty, 'reps', 'reps', text);
}

function item(exercise_id, quantity, unit, prescription_type, source) {
  const note = source
    .replace(/\d+(?:\.\d+)?\s*(?:K|km|miles?|ft|m|min(?:ute)?s?|sec(?:ond)?s?|reps?|steps?|strokes?)?/gi, ' ')
    .replace(/\b(?:x|r|rounds?)\b/gi, ' ')
    .replace(/^[\s:+/;,-]+|[\s:+/;,-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { exercise_id, quantity, quantity_unit: unit, prescription_type, intensity_note: note || null };
}

/**
 * Reads a trailing rest marker: "... / 90s easy", "... / 2m".
 *
 * `/` is overloaded — in a circuit it separates movements ("200m Ski / 10 WB /
 * 40m carry"), and in a cadence ladder it separates rates ("20/22/24 spm").
 * So rest is only read from the LAST group, and only when that group is
 * nothing but a duration followed by cue words: no `+`, no second number. That
 * keeps "/ 90s easy" and rejects "/ 40m carry", which would otherwise be read
 * as a forty-minute rest.
 */
function readRest(text) {
  const groups = text.split('/');
  if (groups.length < 2) return null;
  const last = groups[groups.length - 1].trim();
  const m = last.match(/^(\d+)\s*(s|sec|m|min)\b(?:\s+[a-z-]+)*$/i);
  if (!m) return null;
  const seconds = /^m/i.test(m[2]) ? Number(m[1]) * 60 : Number(m[1]);
  // A rest longer than ten minutes between intervals is not a rest.
  return seconds <= 600 ? seconds : null;
}

const phaseRole = text =>
  /\bwarm-?\s?up\b/i.test(text) ? 'warmup'
  : /\bcool-?\s?down\b|\bcooldown\b/i.test(text) ? 'cooldown'
  : null;

/** Parses one phase of a session into a single block. */
function parsePhase(src, fallback, notes) {
  const rest = readRest(src);
  const role = phaseRole(src);

  let m = src.match(/^(\d+)\s*m(?:in)?\s*(EMOM)?\s*:\s*(.+)$/i);
  if (m) {
    const body = m[3].split(/\s*[+/]\s*/).filter(s => s.trim() && !CUE_WORDS.test(s.trim()));
    return { block: { block_type: 'continuous', rounds: null, duration_minutes: Number(m[1]), rest_seconds: rest,
      title: 'Main', instructions: m[2] ? 'EMOM — one movement per minute' : 'Repeat the circuit for the time available' },
      items: body.map(s => readItem(s, fallback, notes)) };
  }

  m = src.match(/^(\d+)\s*(?:r|rounds?)\s*:\s*(.+)$/i);
  if (m) {
    return { block: { block_type: 'rounds', rounds: Number(m[1]), duration_minutes: null, rest_seconds: rest,
      title: 'Main', instructions: 'Complete every movement, then repeat' },
      items: m[2].split(/\s*\+\s*/).map(s => readItem(s, fallback, notes)) };
  }

  m = src.match(/^(\d+)\s*x\s*(.+)$/i);
  if (m) {
    const body = m[2].replace(/\/.*$/, '');
    if (/\+/.test(body)) refuse('interval with compound content — author as rounds');
    return { block: { block_type: 'rounds', rounds: Number(m[1]), duration_minutes: null, rest_seconds: rest,
      title: role === 'warmup' ? 'Warm-up' : 'Main', instructions: 'Equal-quality repeats' },
      items: [readItem(body, fallback, notes)] };
  }

  if (/\btime trial\b|\bbenchmark\b/i.test(src)) {
    return { block: { block_type: 'continuous', rounds: null, duration_minutes: null, rest_seconds: null,
      title: 'Main', instructions: 'Repeatable test — record the result under the same conditions' },
      items: [readItem(src, fallback, notes)] };
  }

  // Plain continuous effort: "30 min steady RPE 3-4", "10m easy", "cooldown".
  const it = readItem(src, fallback, notes);
  const minutes = it.quantity_unit === 'min' ? it.quantity : null;
  return { block: { block_type: 'continuous', rounds: null, duration_minutes: minutes, rest_seconds: null,
    title: role === 'warmup' ? 'Warm-up' : role === 'cooldown' ? 'Cool-down' : 'Main',
    instructions: role === 'warmup' ? 'Raise temperature and rehearse the pattern'
      : role === 'cooldown' ? 'Flush and finish easy' : 'Hold a repeatable effort' },
    items: [it] };
}

/**
 * Parses a prescription into one or more blocks.
 *
 * Returns { blocks, notes } on success — `notes` lists any magnitude-based
 * reading so the caller can surface them — or { unparsed: reason }.
 */
export function parsePrescription(text, { station = null, fallbackMovement = null, estimatedMinutes = null } = {}) {
  const fallback = station ? STATION_EXERCISE[station] : fallbackMovement;
  const notes = [];
  try {
    const src = text.trim();
    if (/\balternating\b|\bone moderate station dose\b|\bshort station technique\b|\beach\b.*\/.*\//i.test(src)) {
      refuse('prescription offers a choice of movement rather than naming one');
    }

    // "4r: A + B" and "12m: A + B" are containers — their `+` separates
    // movements inside one block. Anything else is a sequence of phases, and
    // must be split, or a session like "10m easy + 6x20s strides + easy finish"
    // gets read as its first ten minutes and the strides are silently lost.
    const isContainer = /^\d+\s*(?:r|rounds?|m(?:in)?)\s*(?:EMOM)?\s*:/i.test(src)
      || /^\d+\s*x\s/i.test(src);
    const phases = isContainer
      ? [src]
      : src.split(/\s*[;+]\s*/).map(s => s.trim()).filter(Boolean);

    const blocks = [];
    for (const phase of phases) {
      if (!/\d/.test(phase)) {
        // An unquantified phase is droppable only if it is pure cue words.
        // "easy finish" carries no prescription; "drills" and "progressive
        // warm-up" name work we cannot represent, so a human decides.
        const residue = phase.split(/[\s/,()-]+/).filter(Boolean).filter(w => !CUE_WORDS.test(w));
        if (residue.length) refuse(`unquantified phase ${JSON.stringify(phase)} names work with no prescription`);
        continue;
      }
      // "recovery 2:00/1:45/1:30/1:15" is a per-round rest schedule, not work.
      // Read as a phase it becomes "2 reps of running", which is nonsense, and
      // the schema has one rest_seconds per block so it cannot be stored.
      if (/^(?:recovery|rest)\b/i.test(phase)) {
        refuse(`${JSON.stringify(phase)} is a rest schedule, which a single rest_seconds cannot express`);
      }
      blocks.push(parsePhase(phase, fallback, notes));
    }
    if (!blocks.length) refuse('nothing quantified in the prescription');

    // Reconcile: if every block is timed, the total should resemble the pack's
    // own estimate. A metre/minute misread shows up here as a wild total.
    if (estimatedMinutes && blocks.every(b => b.block.duration_minutes != null)) {
      const total = blocks.reduce((s, b) => s + b.block.duration_minutes, 0);
      if (total > estimatedMinutes * 2 || total < estimatedMinutes / 3) {
        refuse(`timed total ${total}min does not reconcile with estimated_minutes ${estimatedMinutes}`);
      }
    }
    return { blocks, notes };
  } catch (e) {
    if (e instanceof Unparseable) return { unparsed: e.message };
    throw e;
  }
}
