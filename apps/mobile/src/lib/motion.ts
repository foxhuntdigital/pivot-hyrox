/**
 * Whether the athlete has asked the system for less movement.
 *
 * Null until the platform answers: starting an animation before then and
 * correcting it afterwards is the one thing Reduce Motion is meant to prevent,
 * so callers hold rather than guess. On failure it resolves false — an
 * unanswered query is not a request for reduced motion.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (alive) setReduced(v); })
      .catch(() => { if (alive) setReduced(false); });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged', v => { if (alive) setReduced(v); });
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduced;
}
