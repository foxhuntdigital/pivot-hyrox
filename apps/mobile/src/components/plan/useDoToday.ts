/**
 * "Do today": swap a queued session in for today, with the same warnings
 * wherever it is offered (Plan's week, Readiness's suggested session).
 *
 * The outcome and its copy are `doTodayStep` and `overrideFailed`; this hook
 * only shows them and moves to Today when the swap is made.
 */
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { useDialog } from '@/components/Dialog';
import { displayName, doTodayStep, overrideFailed, type DoTodayStep } from '@/data/planWeek';
import { useApp } from '@/state/store';

export function useDoToday() {
  const router = useRouter();
  const dialog = useDialog();
  const { switchToQueued } = useApp();

  const show = async (step: DoTodayStep): Promise<boolean> => {
    if (step.kind === 'confirm') {
      return dialog.confirm({
        eyebrow: step.eyebrow, title: step.title, body: step.body,
        confirmLabel: step.confirmLabel, cancelLabel: step.cancelLabel,
      });
    }
    if (step.kind === 'alert') {
      await dialog.alert({ eyebrow: step.eyebrow, title: step.title, body: step.body });
      return false;
    }
    return true;
  };

  return async (templateId: string, name: string): Promise<boolean> => {
    const shown = displayName(name);
    const first = switchToQueued(templateId);
    if (!first.ok) {
      const step = doTodayStep(first, shown);
      const proceed = await show(step);
      if (!proceed || step.kind !== 'confirm') return false;
      if (!switchToQueued(templateId, { override: true }).ok) {
        await show(overrideFailed(shown));
        return false;
      }
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace('/today' as never);
    return true;
  };
}
