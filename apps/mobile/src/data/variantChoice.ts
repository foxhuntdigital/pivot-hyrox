/**
 * What happens when a session length (Full, Express, Micro) is chosen, given
 * what `chooseVariant` answered. Shared by the Adapt sheet and Today's length
 * picker, so the two can never word or rule it differently.
 *
 * A recovery refusal is advice and is put to the athlete as a question. A
 * symptom is a boundary no confirmation lifts. Equipment and constraints
 * describe what can be performed, so confirming would change nothing.
 */
export type VariantResult = { ok: true } | { ok: false; reason: 'recovery' | 'symptom' | 'unavailable' };

export type VariantStep =
  | { kind: 'go' }
  | { kind: 'confirm'; eyebrow: string; title: string; body: string; confirmLabel: string; cancelLabel: string }
  | { kind: 'alert'; eyebrow: string; title: string; body: string };

/**
 * `source` names the evidence the refusal rests on, from what the athlete
 * actually told us: a claim about a check-in that never happened is wrong.
 */
export function variantSource(args: { checkedIn: boolean; energy: string }): string {
  return args.checkedIn ? 'your check-in'
    : args.energy === 'low' ? 'the energy you reported' : 'what you have told me about today';
}

export function variantStep(result: VariantResult, label: string, source: string): VariantStep {
  if (result.ok) return { kind: 'go' };
  if (result.reason === 'recovery') {
    return {
      kind: 'confirm',
      eyebrow: 'Are you sure?',
      title: `${label} is more than today supports`,
      body: `Based on ${source}, this asks for more than the version `
        + 'recommended above. You can still do it — you know how you feel '
        + 'better than I do. Ease off if it stops feeling right.',
      confirmLabel: `Do the ${label}`,
      cancelLabel: 'Keep the suggestion',
    };
  }
  return {
    kind: 'alert',
    eyebrow: 'Not available',
    title: `${label} isn't available today`,
    body: result.reason === 'symptom'
      ? 'You reported a symptom that training hard through would not be '
        + 'reasonable. This one is not something to push past — rest today, '
        + 'and get it looked at if it persists.'
      : 'That version cannot be built from the equipment and constraints you '
        + 'have reported today. The one recommended above is the longest this '
        + 'can build from what you have.',
  };
}

/** After "Do the Full", if the override itself could not be applied. */
export function variantOverrideFailed(label: string): VariantStep {
  return {
    kind: 'alert',
    eyebrow: 'Not available',
    title: `${label} could not be applied`,
    body: 'Something about today changed while you were deciding. Try again.',
  };
}
