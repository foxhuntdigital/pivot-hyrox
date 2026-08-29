/**
 * PIVOT design tokens — extracted verbatim from `Adaptive Athlete.dc.html`.
 * Modernist system: zero radius, hairline rules, uppercase micro-labels,
 * Archivo 400–900, one red accent carrying every adaptive/attention state.
 */

export const color = {
  // Surfaces
  paper: '#f3f2f2',       // app background
  paperEdge: '#e4e2e0',   // outside the device frame
  hover: '#eae9e9',       // pressed state on light
  onDark: '#f8f4f4',      // text on ink
  onDarkSoft: '#eae7e7',
  card: '#eae9e9',        // alt-variant rows

  // Ink
  ink: '#201e1d',         // primary text + 2px structural rules
  inkPressed: '#2f2c2b',  // pressed state on dark
  muted: '#7d7979',       // micro-labels, secondary meta
  muted2: '#605d5d',      // body copy, descriptions
  muted3: '#9b9797',      // disabled / on-dark secondary

  // Rules
  rule: '#d7d3d3',        // 1px divider
  ruleFaint: '#eae7e7',   // 1px list separator
  ruleDark: '#444141',    // divider on ink
  ruleDark2: '#605d5d',   // heavier divider on ink
  chipBorder: '#bab6b6',  // inactive chip outline

  /**
   * Mist — the secondary accent, and the only cool value in the system.
   *
   * It means "measured": data the athlete has actually produced, as against
   * red's "attention, act on this". Giving it a job is what stops a second
   * colour diluting the first — red stays the thing that means something
   * changed, and this stays the thing that means something is known.
   *
   * Two values because one cannot do both jobs. `mist` is a fill: at 1.04:1
   * against paper it carries an area and is invisible as a line — the same
   * reason `tint` (1.02:1) is only ever a block wash with `tintBorder` around
   * it. `mistEdge` is the structural weight, at 1.28:1 — a hair under `rule`
   * (1.33:1) — for the offset slabs and any edge that has to be seen.
   */
  mist: '#e0f2f2',
  mistEdge: '#b8dfdf',

  // Red — the primary accent
  red: '#ec3013',
  redPressed: '#dd2b0f',
  redBright: '#ff563c',   // pressed on dark
  redDark: '#ae1800',     // text/number on tint
  redDeep: '#4d170e',     // body copy on tint
  salmon: '#ff9783',      // section label on ink
  tint: '#fff2ef',        // "adapted" callout background
  tintBorder: '#ffc4b8',
} as const;

/** Archivo weights, mapped to the loaded font families. */
export const font = {
  regular: 'Archivo_400Regular',
  medium: 'Archivo_500Medium',
  semibold: 'Archivo_600SemiBold',
  bold: 'Archivo_700Bold',
  extrabold: 'Archivo_800ExtraBold',
  black: 'Archivo_900Black',
} as const;

/**
 * Named type roles from the mockup. Letter-spacing in the source is in `em`;
 * React Native wants points, so each is pre-multiplied by its own fontSize.
 */
export const type = {
  /** 10/700, .14em, uppercase — "NEXT GOAL", "TODAY'S TRAINING" */
  label: { fontFamily: font.bold, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase' },
  /** 9/700, .12em, uppercase — stat cell captions */
  labelSm: { fontFamily: font.bold, fontSize: 9, letterSpacing: 1.08, textTransform: 'uppercase' },
  /** 8/700, .12em, uppercase — phase bars, expanded stat keys */
  labelXs: { fontFamily: font.bold, fontSize: 8, letterSpacing: 0.96, textTransform: 'uppercase' },
  /** 11/800, .16em, uppercase — wordmark, variant badges */
  eyebrow: { fontFamily: font.extrabold, fontSize: 11, letterSpacing: 1.76, textTransform: 'uppercase' },
  /** 13/800, .12em, uppercase — button text */
  button: { fontFamily: font.extrabold, fontSize: 13, letterSpacing: 1.56, textTransform: 'uppercase' },
  /** 16/900, .12em, uppercase — the big "Next" / "Finish" player control */
  buttonLg: { fontFamily: font.black, fontSize: 16, letterSpacing: 1.92, textTransform: 'uppercase' },

  /**
   * Display numerals — readiness score, step quantity, countdown, duration.
   *
   * The mockup sets line-height below font-size for tight stacking. CSS lets
   * the glyph overflow the line box; RN does not, and clips the top of every
   * digit. Archivo Black measures ascent 878 + descent 210 per 1000 upem, so
   * its natural line box is 1.088em — the floor these have to clear, and each
   * is set to 1.15em. Pair every one with `numeralTrim` at the call site.
   */
  hero: { fontFamily: font.black, fontSize: 76, lineHeight: 88, letterSpacing: -3.8 },
  stepQty: { fontFamily: font.black, fontSize: 58, lineHeight: 67, letterSpacing: -2.61 },
  countdown: { fontFamily: font.black, fontSize: 52, lineHeight: 60, letterSpacing: -2.08 },
  sessionMins: { fontFamily: font.black, fontSize: 34, lineHeight: 39, letterSpacing: -1.36 },

  /** Headings */
  h1: { fontFamily: font.black, fontSize: 32, lineHeight: 33, letterSpacing: -1.12 },
  h2: { fontFamily: font.black, fontSize: 28, letterSpacing: -0.84 },
  h3: { fontFamily: font.extrabold, fontSize: 22, letterSpacing: -0.44, lineHeight: 23 },
  h4: { fontFamily: font.extrabold, fontSize: 19, letterSpacing: -0.19 },
  greeting: { fontFamily: font.medium, fontSize: 20, letterSpacing: -0.2 },

  /** Body */
  body: { fontFamily: font.regular, fontSize: 13, lineHeight: 19.5 },
  bodySm: { fontFamily: font.regular, fontSize: 12, lineHeight: 18 },
  meta: { fontFamily: font.regular, fontSize: 11 },
  rowTitle: { fontFamily: font.bold, fontSize: 14 },
  statValue: { fontFamily: font.black, fontSize: 24, letterSpacing: -0.72 },
} as const;

/**
 * Vertical trim for the display numerals above.
 *
 * Once `lineHeight` clears the font's own line height, RN re-centres the glyph
 * with `baseLineOffset = (lineHeight - fontLineHeight) / 2` — see
 * `RCTAttributedTextUtils.mm`, which returns early and leaves the glyph
 * bottom-anchored below that threshold. CSS half-leading is the same term, so
 * pulling half the difference between our line height and the mockup's off
 * each edge puts the digits back exactly where the mockup drew them, in a box
 * of the mockup's height. Spread onto the numeral itself:
 *
 *   <Text style={[t.hero, numeralTrim.hero]}>{score}</Text>
 */
export const numeralTrim = {
  hero: { marginTop: -13, marginBottom: -13 },          // 88 vs 62
  stepQty: { marginTop: -7, marginBottom: -7 },         // 67 vs 53
  countdown: { marginTop: -7.5, marginBottom: -7.5 },   // 60 vs 45
  sessionMins: { marginTop: -4, marginBottom: -4 },     // 39 vs 31
} as const;

/** 2px = structural break, 1px = list separator. Never a border-radius. */
export const rule = { heavy: 2, hair: 1 } as const;

export const space = {
  /** Every screen's horizontal gutter in the mockup. */
  gutter: 20,
  card: 16,
} as const;

/** Phone-frame reference the design was drawn at (iPhone 16 Pro logical px). */
export const frame = { width: 402, height: 874 } as const;
