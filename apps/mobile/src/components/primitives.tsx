/**
 * The mockup repeats five shapes everywhere. Rather than restating raw hex and
 * px per screen, each is captured once here so the modernist system stays
 * consistent as screens are added.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle, type TextStyle } from 'react-native';
import { color, rule, space, type } from '../theme/tokens';

/** 2px ink bar = section break. 1px = list separator. */
export function Rule({ heavy, faint, style }: { heavy?: boolean; faint?: boolean; style?: ViewStyle }) {
  return (
    <View
      style={[
        {
          height: heavy ? rule.heavy : rule.hair,
          backgroundColor: heavy ? color.ink : faint ? color.ruleFaint : color.rule,
        },
        style,
      ]}
    />
  );
}

/** Uppercase micro-label — the system's primary organising device. */
export function Label({
  children,
  size = 'md',
  tone = 'muted',
  style,
}: {
  children: React.ReactNode;
  size?: 'xs' | 'sm' | 'md';
  tone?: 'muted' | 'ink' | 'salmon' | 'redDark' | 'onDarkMuted';
  style?: TextStyle;
}) {
  const sizes = { xs: type.labelXs, sm: type.labelSm, md: type.label } as const;
  const tones = {
    muted: color.muted,
    ink: color.ink,
    salmon: color.salmon,
    redDark: color.redDark,
    onDarkMuted: color.muted3,
  } as const;
  return <Text style={[sizes[size] as TextStyle, { color: tones[tone] }, style]}>{children}</Text>;
}

/**
 * Full-bleed action row: label left, arrow right. `variant` covers the three
 * the design uses — solid red, ink outline, and outline-on-dark.
 */
export function ActionButton({
  label,
  arrow = '→',
  variant = 'primary',
  size = 'md',
  onPress,
  style,
}: {
  label: string;
  arrow?: string | null;
  variant?: 'primary' | 'outline' | 'outlineDark';
  size?: 'md' | 'lg';
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const isPrimary = variant === 'primary';
  const isDark = variant === 'outlineDark';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        size === 'lg' ? { paddingVertical: 26 } : null,
        isPrimary && { backgroundColor: pressed ? color.redPressed : color.red },
        variant === 'outline' && {
          borderWidth: 1,
          borderColor: color.ink,
          backgroundColor: pressed ? color.hover : 'transparent',
        },
        isDark && {
          borderWidth: 1,
          borderColor: color.ruleDark2,
          backgroundColor: pressed ? color.inkPressed : 'transparent',
        },
        !arrow && { justifyContent: 'center' },
        style,
      ]}
    >
      <Text
        style={[
          (size === 'lg' ? type.buttonLg : type.button) as TextStyle,
          { color: isPrimary ? color.onDark : isDark ? color.onDarkSoft : color.ink },
        ]}
      >
        {label}
      </Text>
      {arrow ? (
        <Text style={{ fontSize: size === 'lg' ? 20 : 15, color: isPrimary ? color.onDark : isDark ? color.onDarkSoft : color.ink }}>
          {arrow}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Selectable chip — inverts to solid ink when active. Used for time, energy, flags, RPE. */
export function Chip({
  label,
  active,
  onPress,
  flex,
  size = 'md',
  style,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  flex?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: ViewStyle;
}) {
  const pad = { sm: 13, md: 16, lg: 16 }[size];
  const textStyle: TextStyle = {
    sm: { fontFamily: type.rowTitle.fontFamily, fontSize: 12 },
    md: { fontFamily: type.statValue.fontFamily, fontSize: 15 },
    lg: { fontFamily: type.statValue.fontFamily, fontSize: 16 },
  }[size] as TextStyle;
  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          flex: flex ? 1 : undefined,
          borderWidth: 1,
          borderColor: active ? color.ink : color.chipBorder,
          backgroundColor: active ? color.ink : 'transparent',
          paddingVertical: pad,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text style={[textStyle, { color: active ? color.onDark : color.ink }]}>{label}</Text>
    </Pressable>
  );
}

/** 16px square checkbox — hollow with grey outline, filled red when on. */
export function SquareCheck({ on, size = 16 }: { on: boolean; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderWidth: 2,
        borderColor: on ? color.red : color.chipBorder,
        backgroundColor: on ? color.red : 'transparent',
      }}
    />
  );
}

/** Inverted callout block — ink panel, salmon label. Used for nudges and coach notes. */
export function InkPanel({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[{ backgroundColor: color.ink, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18 }, style]}>
      <Label tone="salmon" size="sm" style={{ letterSpacing: 1.26, marginBottom: 6 }}>
        {label}
      </Label>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 17,
    paddingHorizontal: space.card,
  },
});
