# DESIGN.md — University of the Assumption

**Source:** https://web.ua.edu.ph — homepage analysis
**Captured:** October 6, 2026
**Stack:** WordPress 7.1.2 · Elementor 3.32.5 · UIcore Pro theme · Swiper carousels
**Measured at:** 1296px desktop viewport

A formal, confident Catholic-university identity: deep navy grounds, high-contrast white typography, and a tri-color accent system (navy / red / gold) used boldly in stat blocks and section headings. Generous whitespace, flat surfaces (hairline borders instead of shadows), large 25px-radius feature cards, and playful hand-drawn SVG underlines on key headlines.

---

## 1. Color Palette

### Core tokens (Elementor global kit)

| Token | Hex | RGB | Role |
|---|---|---|---|
| `uicore_primary` | `#002366` | 0, 35, 102 | Navy — top bar, hero background, value cards, icon accents, `<meta theme-color>` |
| `uicore_secondary` | `#CE2029` | 206, 32, 41 | Red — BIASA heading, stat card, hero decoration block |
| `uicore_accent` | `#0288D1` | 2, 136, 209 | Blue — all primary buttons |
| Gold (highlight) | `#FFBD00` | 255, 189, 0 | Hand-drawn SVG underlines, button hover, MAYAP heading, stat card, decoration block |
| `uicore_dark` / `uicore_headline` | `#070707` | 7, 7, 7 | Headings, dark section background, dropdown menu background |
| `uicore_body` | `#6E7A84` | 110, 122, 132 | Body copy, muted text, icons/arrows |
| `uicore_light` | `#F5F5F5` | 245, 245, 245 | Alternating light section background, stat card |
| `uicore_white` | `#FFFFFF` | 255, 255, 255 | Text on dark, base surface |

### Secondary swatches (defined, rarely used on homepage)

| Hex | Notes |
|---|---|
| `#4BA4EF` | Light blue |
| `#FD8834` | Orange |
| `#A32CFF` | Purple |
| `#030981` | Deep blue |

### Usage rules observed

- **Navy** frames the page: top bar, hero, footer strip accents, and one stat card.
- **Red + gold** are impact colors — used as solid stat-card fills and the three value-pillar heading colors (BIASA = red, MAGANACA = gray `#6E7A84`, MAYAP = gold).
- **Blue** is strictly the interactive color (buttons); **gold** is the hover/reward color.
- **Body text is never pure black** — it is `#6E7A84`; headlines are near-black `#070707`.
- Section backgrounds alternate between white, `#F5F5F5`, and `#070707` for rhythm.

---

## 2. Typography

**Family:** `Inter` (Google Fonts, weights 100–900) for everything.
**Secondary:** a custom display face *"The Bohemian"* is preloaded (`@font-face`) but not applied anywhere on the homepage — treat as reserved/legacy.

### Type scale

| Element | Size | Line height | Weight | Letter spacing |
|---|---|---|---|---|
| H1 (hero) | 72px | 86.4px (1.2) | 700 | −1.944px (−0.027em) |
| H2 (section) | 48px | 56.4px (1.175) | 600 | −1.296px (−0.027em) |
| H3 (sub-section) | 24px | 28.8px (1.2) | 700 | −0.648px (−0.027em) |
| H4 (card/lead) | 21px | 29.82px (1.42) | 700 | −0.567px (−0.027em) |
| Body | 16px | 30px (1.875) | 400 | normal |
| Nav link | 14px | 1.2 | 700 | normal |
| Button | 15px | 15px | 500 | normal |
| Kicker / pre-title | 14px | — | 600 | normal, `uppercase` |
| Top bar | 12px | — | 400 | normal |

**Rules:**
- All headings share **−0.027em** tracking; tighten as size grows.
- Section headings (H2) are semibold (600), sub-headings bold (700).
- Body line-height is a generous **1.875**.
- Global typography tokens: primary = Inter 700, secondary = Inter 600, accent = Inter 500, text = Inter 400.

---

## 3. Layout & Grid

- **Content width:** `min(100%, 95%, 1170px)` → **1170px max**, centered.
- **Section padding:** `60px 0` (boxed sections use an `.e-con-inner` wrapper).
- **Carousel gap:** 20px; slides per view — 3 desktop / 2 tablet / 1 mobile.
- **Breakpoints (Elementor):** mobile ≤ 767px, tablet ≤ 1024px; desktop nav switches at **1025px**.
- **Header:** sticky, ~101px tall, transparent (sits over the navy hero).
- **Top bar:** relative (scrolls away), navy, 12px vertical padding.

---

## 4. Spacing & Radius

| Token | Value | Usage |
|---|---|---|
| Radius — buttons/inputs | **6px** | All buttons |
| Radius — feature cards | **25px** | Stat cards, value cards, decorative blocks |
| Radius — news cards | **0px** | Sharp, hairline-bordered |
| Card padding (stat) | 20px | |
| Button padding (standard) | 17px 40px | Hero, Read More |
| Button padding (small/CTA) | 13.5px 26px | Header CTA, size-sm |
| Dropdown item padding | 8px 25px | Sub-menu links |
| Section padding | 60px 0 | |

**Shadows:** essentially none on content cards. Depth comes from background contrast. Only the dropdown menu uses a soft elevation:
`rgba(0,0,0,0.02) 0 0 0 1px, rgba(0,0,0,0.04) 0 2px 35px 0px`.

**Borders:** news cards use `1px solid rgba(110,122,132,0.2)` (body color at 20%).

---

## 5. Components

### 5.1 Top bar
- Background `#002366`, text white 12px.
- Left: tagline *"The First Archdiocesan Catholic University in Asia"*.
- Right: phone `(045) 961-3617` and address with inline icons (phone / map-pin).

### 5.2 Header / navigation
- Transparent sticky bar over the hero; logo left, menu center-right, socials (Facebook, YouTube, TikTok) + CTA right, hamburger drawer far right.
- Links: Inter 14px/700, white, horizontal padding ≈ 18.75px.
- **Dropdowns:** background `#070707` (dark), min-width 280px, vertical padding 22px, soft shadow, 6px radius, fade/slide in (opacity + transform, `will-change`).
- Header CTA ("Enroll Now!"): accent-blue pill, 6px radius.
- Side drawer: "Quick Links" (School ERP, Library, Telephone Directory, Location Map).
- Mobile: off-canvas menu with logo + hamburger.

### 5.3 Buttons
```
background: #0288D1 · color: #FFF · font: Inter 15/500
radius: 6px · padding: 17px 40px (standard) / 13.5px 26px (small)
border: none · no shadow
hover: background #FFBD00, color #070707
```
- Full-width/justified variant for modal action buttons (`elementor-align-justify`).

### 5.4 Hero
- Background: navy `#002366` with an autoplaying, looping, muted YouTube video behind.
- Decoration blocks in **red `#CE2029`** and **gold `#FFBD00`**.
- Headline "UA Transforms You" — 72px/700 white, with *"Transforms"* underlined by a **hand-drawn gold SVG scribble** (path stroke `#FFBD00`, stroke-width 40, `preserveAspectRatio: none`), drawn on entrance (delay ~1s).
- Subtitle: 21px/700 white.
- Two small buttons: Learn More / Enroll Now!.

### 5.5 News carousel (Latest News)
- Section background `#F5F5F5`; heading 48px/600 left-aligned.
- Card: transparent, `1px solid rgba(110,122,132,0.2)`, sharp corners, no shadow.
  - Image: `background-size: cover`, ~281px tall, square crops (650×650 sources).
  - Title: H4 21px/700 `#070707`.
  - Excerpt: 16px/30 `#6E7A84`.
  - "Read More" button revealed/animated on card hover.
  - Card transition: `0.65s cubic-bezier(0.23, 1, 0.32, 1)`.
- Behavior: autoplay 5000ms, loop, grab cursor, centered slides; arrows (24px caret-square icons, `#6E7A84`, transparent bg) + pagination dots.

### 5.6 Stat / counter blocks
- Left column: odometer counter ("63 Years", 48px/600 `#070707`) beside a highlighted headline ("Providing *Quality* Catholic Education" — gold underline), body copy, button.
- Right: grid of **25px-radius, 20px-padded** stat cards, each a different palette fill:

| Stat | Fill | Number style |
|---|---|---|
| 3 — PAASCU level | `#CE2029` red | 72px/700 white |
| 25 — accredited programs | `#FFBD00` gold | 72px/700 (dark on gold) |
| 1000+ — scholarships | `#F5F5F5` light | 72px/700 dark |
| 95% — employability | `#002366` navy | 72px/700 white |

- Counter labels: 16px/30; count-up animation 2.5s, staggered `zoomIn` entrances (0–1400ms delays).
- Empty 25px-radius spacer blocks interleave the grid.

### 5.7 Dark feature section ("Get To Know UA")
- Background `#070707`, min-height 500px.
- Centered white H2; two-column Vision / Mission with H3 headings and body copy.

### 5.8 Value pillar cards (BIASA / MAGANACA / MAYAP)
- Three **navy `#002366`** cards, **25px radius**, 556px tall, image backgrounds with gradient overlay.
- Kicker (Scientia / Virtus / Communitas): 14px/600 uppercase white.
- Title: H3 24px/700 white (Academic Excellence / Christian Formation / Community Service).
- Hover: `scale(1.025)`; entrance `fadeInUp` staggered 0/200/400ms.

### 5.9 Value detail sections
- Alternate white / `#F5F5F5` backgrounds.
- Giant pillar headings colored: **BIASA `#CE2029`**, **MAGANACA `#6E7A84`**, **MAYAP `#FFBD00`**.
- Sub-headings (H3) + grouped icon lists:
  - Item: title text + trailing `fa-chevron-circle-right` icon in navy `#002366`, 20px.

### 5.10 President's message
- Parallax background (−200px offset).
- Cut-out president portrait PNG (tall aspect), centered H2, gold `fa-quote-left` icon, body copy.
- "Continue Reading" inline toggle with +/− icons (show-hide pattern).
- Name: H4; role: H6.

### 5.11 Enrollment CTA + modal
- Headline "Be Part of the Growing *UA Family*" with gold underline scribble; H4 subtitle; Enroll button.
- Triggers a **modal popup (920px wide)**: white, centered, H2 title, two square image cards each with a full-width justified button linking to Google Forms; overlay `rgba(0,0,0,0.4)`; close (×) top-right; `fadeIn` 0.4–0.6s; locks page scroll.

### 5.12 Footer
- Minimal: centered copyright bar — *"© University of the Assumption 2026. All Rights Reserved."* (body gray on white).
- Floating back-to-top arrow button (desktop only).

---

## 6. Iconography

- **Font Awesome 5 Solid** — chevrons, quote marks, caret-square carousel arrows, plus/minus, close.
- **UIcore custom icons** — phone, map-pin (top bar), social glyphs (FB / YouTube / TikTok), hamburger bars.
- Icons are mostly monochrome: white on navy, navy on light, body-gray for controls.

---

## 7. Motion & Interaction

| Pattern | Detail |
|---|---|
| Entrance animations | `fadeInUp` (section blocks) and `zoomIn` (stat cards), delays staggered 200–1400ms |
| Headline reveals | Highlighted-text component with delayed draw (600–1000ms) of the gold SVG underline |
| Counters | Odometer + simple count-up, 2.5s duration |
| Carousel | Autoplay 5s, loop, centered, grab cursor, arrow + dot nav |
| Parallax | President section background, −200px scroll offset |
| Card hover | Value cards `scale(1.025)`; news card → Read More reveal; transition `0.65s cubic-bezier(0.23,1,0.32,1)` |
| Button hover | Blue → gold background, text → `#070707` |
| Header | 0.4s transition, sticky |
| Scroll-linked | `animation-timeline: view()` (CSS scroll animations) with JS fallback |
| Modal | Fade-in 0.4–0.6s, scroll-lock while open |

Motion personality: **measured and staged** — elements arrive in deliberate cascades rather than all at once.

---

## 8. Imagery

- News thumbnails: square (650×650) and 4:3 (650×488) crops, `object-fit: cover`.
- Value cards: full-bleed photos under a navy gradient scrim for text legibility.
- Enroll modal: square 1000×1000 promotional graphics.
- Portraits: cut-out PNGs with transparency (president).
- Hero: external YouTube video, autoplay/loop, inline, controls on.

---

## 9. Quick-Reference Tokens

```css
:root {
  /* Color */
  --color-primary:    #002366;  /* navy   */
  --color-secondary:  #CE2029;  /* red    */
  --color-accent:     #0288D1;  /* blue — buttons */
  --color-highlight:  #FFBD00;  /* gold — hover & underlines */
  --color-headline:   #070707;
  --color-body:       #6E7A84;
  --color-light:      #F5F5F5;
  --color-white:      #FFFFFF;

  /* Type */
  --font: 'Inter', sans-serif;
  --tracking-heading: -0.027em;
  --lh-body: 1.875;

  /* Layout */
  --container: 1170px;
  --section-pad: 60px;
  --gap-carousel: 20px;

  /* Radius */
  --radius-btn: 6px;
  --radius-card: 25px;

  /* Breakpoints */
  --bp-mobile: 767px;
  --bp-tablet: 1024px;
  --bp-nav: 1025px;
}
```

---

## 10. Design Principles (distilled)

1. **Navy is the anchor; gold is the reward.** Structure comes from navy and near-black surfaces; gold appears only to highlight, underline, and reward interaction.
2. **Flat over shadowed.** Contrast between surfaces and hairline borders create depth; drop shadows are reserved for floating menus.
3. **One family, many voices.** Inter alone carries the system — hierarchy comes from weight (400/500/600/700), scale, and consistent negative tracking on headings.
4. **Tri-color storytelling.** Red / gray / gold encode the three pillars (BIASA / MAGANACA / MAYAP) consistently across headings, cards, and stats.
5. **Staged entrances.** Content arrives in cascades — counters count up, underlines draw themselves, cards zoom in — conveying energy without chaos.
6. **Sharp + round contrast.** Feature/stat cards are soft (25px radius); editorial news cards stay sharp and bordered — signaling "brand" vs. "content".
