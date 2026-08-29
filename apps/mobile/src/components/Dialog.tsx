/**
 * The app's own confirmation dialog.
 *
 * `Alert.alert` was doing this work, and it looked like what it was: an iOS
 * system prompt dropped into a screen that shares none of its language. The
 * design is a modernist system — zero radius, ink surfaces, uppercase micro
 * labels, one red accent — and a rounded grey sheet with blue text reads as the
 * operating system interrupting the app rather than the app asking a question.
 *
 * So this is the same dialog rebuilt out of the app's own primitives. It is
 * deliberately not a general-purpose modal: it asks one question, offers at most
 * two answers, and the affirmative one is the red action the rest of the app
 * uses for anything that changes what happens next.
 *
 * Presented through `useDialog()` rather than rendered by each screen, because
 * the calls it replaces were imperative and inside event handlers. A screen
 * awaits an answer:
 *
 *     if (await dialog.confirm({ title: 'Do this today?', ... })) apply();
 *
 * **Asking from inside another modal needs a provider inside that modal.** A
 * React Native modal presents from the view controller of the React view it is
 * rendered into, so the app-wide provider in `_layout` presents from the root
 * controller — which is already presenting any open sheet. iOS refuses the
 * second presentation, nothing appears, and the promise never settles, so the
 * tap that asked the question looks broken. `AdaptSheet` shows the shape of the
 * fix: wrap the modal's contents in their own `DialogProvider`, and `useDialog`
 * resolves to that one.
 */
import React, {
  createContext, useCallback, useContext, useMemo, useRef, useState,
} from 'react';
import { View, Text, Modal, Pressable } from 'react-native';

import { Label, ActionButton, Rule } from '@/components/primitives';
import { color, space, type as t } from '@/theme/tokens';

export interface ConfirmOptions {
  /** Uppercase micro-label above the title. */
  eyebrow?: string;
  title: string;
  body?: string;
  /** The affirmative action. Defaults to "Confirm". */
  confirmLabel?: string;
  /** The way out. Defaults to "Cancel". */
  cancelLabel?: string;
}

export interface AlertOptions {
  eyebrow?: string;
  title: string;
  body?: string;
  dismissLabel?: string;
}

interface DialogStore {
  /** Resolves true if the athlete confirmed, false if they backed out. */
  confirm(options: ConfirmOptions): Promise<boolean>;
  /** A statement with one way out. Resolves when it is dismissed. */
  alert(options: AlertOptions): Promise<void>;
}

type Pending =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'alert'; options: AlertOptions; resolve: (ok: boolean) => void };

const Ctx = createContext<DialogStore | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  /**
   * Guards against resolving one question twice — a backdrop tap racing the
   * cancel button would otherwise settle the promise and then settle it again,
   * and the second call would silently do nothing while looking like it worked.
   */
  const settled = useRef(false);

  const close = useCallback((answer: boolean) => {
    setPending(current => {
      if (current && !settled.current) {
        settled.current = true;
        current.resolve(answer);
      }
      return null;
    });
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => (
    new Promise<boolean>(resolve => {
      settled.current = false;
      setPending({ kind: 'confirm', options, resolve });
    })
  ), []);

  const alert = useCallback((options: AlertOptions) => (
    new Promise<void>(resolve => {
      settled.current = false;
      setPending({ kind: 'alert', options, resolve: () => resolve() });
    })
  ), []);

  const value = useMemo<DialogStore>(() => ({ confirm, alert }), [confirm, alert]);

  const isConfirm = pending?.kind === 'confirm';
  const options = pending?.options;

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        visible={pending !== null}
        transparent
        animationType="fade"
        // Android's back button, and the gesture that maps to it.
        onRequestClose={() => close(false)}
      >
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {/* Same scrim the adapt sheet uses, so the two read as one system. */}
          <Pressable
            accessibilityLabel="Dismiss"
            onPress={() => close(false)}
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(32,30,29,0.55)',
            }}
          />

          <View
            accessibilityViewIsModal
            accessibilityRole="alert"
            style={{
              marginHorizontal: space.gutter,
              backgroundColor: color.ink,
              // The red edge is the app's accent doing what it does everywhere
              // else: marking the thing that is asking for a decision.
              borderTopWidth: 3,
              borderTopColor: color.red,
            }}
          >
            <View style={{ paddingHorizontal: space.gutter, paddingTop: 18, paddingBottom: 16 }}>
              <Label tone="salmon" size="sm" style={{ letterSpacing: 1.26, marginBottom: 8 }}>
                {options?.eyebrow ?? (isConfirm ? 'Confirm' : 'Heads up')}
              </Label>
              <Text style={[t.h3, { color: color.onDark }]}>
                {options?.title}
              </Text>
              {options?.body ? (
                <Text style={[t.bodySm, { color: color.onDarkSoft, marginTop: 8, lineHeight: 20 }]}>
                  {options.body}
                </Text>
              ) : null}
            </View>

            <Rule style={{ backgroundColor: color.ruleDark }} />

            {/* Side by side, primary first — the same two-action row Today uses
                for Start/Adapt. Stacking them full-bleed left one button
                left-aligned with an arrow and the other centred, because
                ActionButton centres itself when it has no arrow. */}
            <View style={{
              flexDirection: 'row', gap: 8,
              paddingHorizontal: space.gutter, paddingVertical: 16,
            }}>
              {isConfirm ? (
                <>
                  <ActionButton
                    label={(options as ConfirmOptions).confirmLabel ?? 'Confirm'}
                    variant="primary"
                    arrow={null}
                    onPress={() => close(true)}
                    style={{ flex: 1, paddingHorizontal: 12 }}
                  />
                  <ActionButton
                    label={(options as ConfirmOptions).cancelLabel ?? 'Cancel'}
                    variant="outlineDark"
                    arrow={null}
                    onPress={() => close(false)}
                    style={{ flex: 1, paddingHorizontal: 12 }}
                  />
                </>
              ) : (
                <ActionButton
                  label={(options as AlertOptions | undefined)?.dismissLabel ?? 'Got it'}
                  variant="primary"
                  arrow={null}
                  onPress={() => close(false)}
                  style={{ flex: 1, paddingHorizontal: 12 }}
                />
              )}
            </View>
          </View>
        </View>
      </Modal>
    </Ctx.Provider>
  );
}

export function useDialog(): DialogStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDialog must be used inside DialogProvider');
  return v;
}
