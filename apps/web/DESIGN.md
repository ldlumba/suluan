---
name: SULUAN Web
description: A governed University of the Assumption research desk for discovering, submitting, and reviewing institutional research.
colors:
  ua-navy: "#002366"
  signal-blue: "#0288d1"
  archive-gold: "#ffbd00"
  impact-red: "#ce2029"
  warm-paper: "#fbfaf7"
  white: "#ffffff"
  ink: "#070707"
  slate-muted: "#52606a"
  ink-muted: "#66737d"
  hairline: "#dfe3e6"
  soft-gray: "#f5f5f5"
typography:
  display:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "clamp(3rem, 7vw, 5.5rem)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.027em"
  headline:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3rem)"
    fontWeight: 600
    lineHeight: 1.1
  title:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.14em"
rounded:
  sm: "3.6px"
  md: "4.8px"
  lg: "6px"
  xl: "8.4px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.ua-navy}"
    textColor: "{colors.white}"
    rounded: "{rounded.lg}"
    padding: "0.625rem 1rem"
    height: "2.25rem"
  button-action:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.white}"
    rounded: "{rounded.lg}"
    padding: "0.75rem 1.5rem"
    height: "3rem"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ua-navy}"
    rounded: "{rounded.lg}"
    padding: "0.625rem 1rem"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0.25rem 0.625rem"
    height: "2rem"
---

# Design System: SULUAN Web

## Overview

**Creative North Star: "The Governed Research Desk"**

SULUAN is an institutional research desk: confident, editorial, and deliberately calm. The visual system puts the collection before the machinery around it. Deep UA navy establishes trust and orientation; warm paper surfaces make accepted research feel readable; small, precise accents mark action, status, and discovery.

The interface is tactile and confident rather than ornamental. Strong horizontal rules, generous editorial spacing, compact controls, and clear state labels make the product feel governed without turning it into an anonymous SaaS dashboard.

**Key Characteristics:**
- Deep navy masthead and decisive institutional framing
- Warm-white reading surfaces with hairline boundaries
- Geist Variable throughout, with tight display headlines
- Gold for emphasis, signal blue for action, red for impact and destructive states
- Flat-by-default surfaces with tonal layering instead of decorative depth

## Colors

The palette pairs UA's deep navy with a warm paper ground and a deliberately scarce signal palette.

### Primary
- **UA Navy** (#002366): Masthead, primary navigation, major headings, and high-confidence primary actions.
- **Signal Blue** (#0288d1): Interactive action, focus rings, and prominent discovery calls to action.

### Secondary
- **Archive Gold** (#ffbd00): Eyebrows, active navigation, selection, and the small moments that direct attention.
- **Impact Red** (#ce2029): Destructive actions, rejection or impact states, and high-salience exceptions.

### Neutral
- **Warm Paper** (#fbfaf7): The default page ground; warmer than pure white for long reading sessions.
- **White** (#ffffff): Cards, footer surfaces, and high-contrast content areas.
- **Ink** (#070707): Primary text and high-contrast labels.
- **Slate Muted** (#52606a): Supporting copy on working surfaces.
- **Ink Muted** (#66737d): Secondary metadata and footer copy with AA contrast on warm paper and white.
- **Hairline** (#dfe3e6): Inputs, dividers, and quiet structure.
- **Soft Gray** (#f5f5f5): Secondary bands and muted controls.

**The Accent Scarcity Rule.** Gold, blue, and red should clarify hierarchy or state, not decorate every surface.

## Typography

**Display Font:** Geist Variable (with sans-serif)

**Body Font:** Geist Variable (with sans-serif)

**Character:** Geist keeps institutional information modern and legible while its variable weights support both editorial scale and dense operational controls.

### Hierarchy
- **Display** (700, clamp(3rem, 7vw, 5.5rem), 0.98): Landing-page statements and high-impact route openings.
- **Headline** (600, clamp(2.25rem, 5vw, 3rem), 1.1): Major section titles and route headings.
- **Title** (700, 1.25rem, 1.25): Paper titles, feature headings, and compact content anchors.
- **Body** (400, 1rem, 1.75): Explanatory copy and research context; allow generous measure rather than dense wrapping.
- **Label** (700, 0.72rem, 0.14em, uppercase): Eyebrows and provenance cues.

**The Display Restraint Rule.** Use tight, bold display type for orientation; do not turn every operational heading into a hero.

## Layout

The shell uses a centered max-width of 80rem with responsive horizontal padding of 1rem, 1.5rem, and 2rem at larger breakpoints. The masthead is sticky and keeps primary destinations visible; the main column breathes with 2rem top/bottom padding, expanding to 3rem on large screens.

Public home sections can break full-bleed from the shell, then return to the same 80rem reading frame. Internal routes use a calm single-column start and expand to practical grids only when content benefits from comparison. Mobile navigation collapses into a full-width navy menu; actions remain stacked and thumb-friendly.

## Elevation & Depth

The system is flat with tonal layering. Navy bands, warm paper, white cards, hairline borders, and restrained rings establish depth. The only persistent shell shadow is a near-invisible 1px separation under the sticky header; avoid floating shadow stacks.

**The Flat-by-Default Rule.** Surfaces are flat at rest. Use border, background shift, or focus ring before adding a shadow.

## Shapes

Forms are gently rounded but never pill-shaped by default. The base radius is 6px, with 3.6px and 4.8px utility steps and an 8.4px card step. Cards use 8.4px corners; compact controls use 6px. Borders are hairline and functional, with clipping reserved for card media and grouped surfaces.

## Components

### Buttons
- **Shape:** Compact, gently rounded corners (6px).
- **Primary:** UA navy background with white text; compact 2.25rem controls and 0.625rem 1rem padding.
- **Action:** Signal blue is reserved for high-intent discovery and sign-in actions; larger calls to action use 3rem height and 1.5rem horizontal padding.
- **Hover / Focus:** Shift toward gold for major action links; all controls retain a visible signal-blue focus ring and a small active translation.
- **Secondary / Ghost:** Transparent or soft-gray surfaces with readable borders; use them to reduce competition with the primary action.

### Chips
- **Style:** Small, border-led metadata or keyword treatments; use muted backgrounds and ink text.
- **State:** Selected or applied filters may use signal blue or gold, but never rely on color alone.

### Cards / Containers
- **Corner Style:** Gently rounded (8.4px).
- **Background:** White on warm paper; muted bands may use soft gray.
- **Shadow Strategy:** No persistent shadow; use a hairline ring (`ring-1 ring-foreground/10`) and tonal contrast.
- **Border:** Hairline where grouping or scanability requires it.
- **Internal Padding:** Usually 1rem; compact variants use 0.75rem.

### Inputs / Fields
- **Style:** 2rem minimum height, 6px radius, transparent or white background, hairline border, 0.625rem horizontal padding.
- **Focus:** Signal-blue border and visible 3px ring with restrained opacity.
- **Error / Disabled:** Impact red ring/border for errors; disabled fields lower contrast and interaction without hiding their value.

### Navigation
- **Style:** Sticky UA navy masthead with white type, compact icon-plus-label links, and a gold 2px active underline. Mobile navigation becomes a bordered navy drawer beneath the masthead.
- **Account area:** Kept visually separate with a hairline divider; signed-in identity is secondary to destination navigation.

### Eyebrows
- **Signature:** Uppercase, gold or impact-red, 0.72rem, 700 weight, and 0.14em tracking. Use as provenance and section orientation, not as decoration.

## Do's and Don'ts

### Do:
- **Do** lead public discovery with search, repository context, and readable metadata.
- **Do** use UA navy as the stable frame and warm paper as the reading ground.
- **Do** make focus, visibility, and workflow states explicit in text as well as color.
- **Do** preserve generous section spacing and strong horizontal structure.
- **Do** use gold sparingly for orientation and signal blue for action.

### Don't:
- **Don't** add decorative SaaS polish: no gradients, glassmorphism, stacked shadows, or generic icon-tile dashboards.
- **Don't** present unsupported repository counts, testimonials, or institutional claims.
- **Don't** use semantic search as an enabled visual mode while its gate remains closed.
- **Don't** make hidden UI or client state stand in for authorization.
- **Don't** use red as a general brand accent; reserve it for impact, rejection, and destructive states.
