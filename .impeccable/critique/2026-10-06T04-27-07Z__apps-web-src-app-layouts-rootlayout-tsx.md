---
target: apps/web/src/app/layouts/RootLayout.tsx
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:D:\\SULUAN\\apps\\web\\src\\app\\layouts\\RootLayout.tsx"
target_fingerprint: "sha256:38ae6c8485fa5abb89983711d06e6a37b5e50e273490b00a88826b03fcf9469b"
target_path: "D:\\SULUAN\\apps\\web\\src\\app\\layouts\\RootLayout.tsx"
timestamp: 2026-10-06T04-27-07Z
slug: apps-web-src-app-layouts-rootlayout-tsx
---
Method: degraded single-context (Assessment A and B ran sequentially because subagent execution was unavailable at the current depth limit).

# Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Active route is clear; auth/loading state is mostly handled, but mobile menu state has limited focus/state support. |
| 2 | Match System / Real World | 4 | Institutional/repository language, search, graph, submission, and review map naturally to the product. |
| 3 | User Control and Freedom | 2 | Mobile disclosure has no Escape handling, focus return, or explicit close affordance beyond the icon; mobile signed-in users have no sign-out action. |
| 4 | Consistency and Standards | 3 | Strong shared shell patterns, with desktop/mobile navigation parity gaps. |
| 5 | Error Prevention | 3 | Navigation is low-risk and clear, but crowded desktop options increase misselection risk. |
| 6 | Recognition Rather Than Recall | 3 | Icons are paired with labels; active route is visible, but some manager destinations disappear on mobile. |
| 7 | Flexibility and Efficiency of Use | 2 | No keyboard shortcuts or quick account actions; experts must traverse a long top-level nav. |
| 8 | Aesthetic and Minimalist Design | 3 | Navy/warm-paper system is focused and product-specific; the shell carries many simultaneous links. |
| 9 | Help and Documentation | 2 | Skip-link and labels help, but there is no visible support/help route for first-time users. |
| 10 | Help Users Recognize, Diagnose, and Recover from Errors | 1 | The shell has no contextual recovery/help surface for navigation or account problems. |
| **Total** |  | **26/40** | **Acceptable — significant improvements needed before users are happy.** |

## Design Specificity Verdict

The shell is authored for SULUAN rather than category-interchangeable: the University of the Assumption strapline, SULUAN wordmark, research-specific destinations, navy masthead, gold active signal, and governed-repository language give it a distinct institutional identity. The core opportunity is not a new visual direction; it is operational completeness and hierarchy in the responsive shell.

The deterministic detector returned `[]` (0 findings) for `apps/web/src/app/layouts/RootLayout.tsx`; no automated anti-patterns were flagged. Browser visualization was attempted, but no desktop browser was connected to the session, so no reliable screenshot, overlay, or console evidence is available. The temporary Vite server was stopped.

## Overall Impression

A confident, calm institutional masthead with unusually good product grounding. The single biggest opportunity is to make the responsive navigation a complete, deliberate account/workspace system instead of a reduced link list: mobile currently hides manager analytics and gives signed-in users no sign-out path.

## What's Working

- **Clear institutional frame:** the strapline, SULUAN mark, UA navy, and “UA research repository” label establish provenance immediately.
- **Strong accessibility baseline:** semantic `header`/`nav`/`main`/`footer`, a skip link, text labels alongside icons, `aria-expanded`, and `aria-label` on the menu control are all good foundations.
- **Distinctive but restrained visual language:** the gold active underline and flat navy masthead align with the Governed Research Desk direction without generic SaaS decoration.

## Priority Issues

### [P1] Mobile navigation is functionally incomplete
**Why it matters:** authenticated managers cannot reach Analytics from the mobile menu, and signed-in users cannot sign out on mobile. This creates a real control and parity failure, not just a visual mismatch.
**Fix:** mirror all role-appropriate desktop destinations in the mobile menu, then add an explicit account section with the current email and Sign out action. Keep authorization server-driven.
**Suggested command:** `/impeccable harden`

### [P1] Desktop header carries too many peer-level choices
**Why it matters:** Search, Graph, Submit, My submissions, Review, Analytics, identity, and Sign out compete in one horizontal row. At common laptop widths this weakens the primary discovery path and risks cramped/truncated navigation.
**Fix:** make Search the unmistakable primary destination; group account/workflow links under an Account or Workspace menu, and reserve the masthead row for Search, Graph, Submit, and one account action.
**Suggested command:** `/impeccable distill`

### [P2] Mobile disclosure lacks robust focus management
**Why it matters:** keyboard and assistive-technology users can open the menu without focus moving into it, Escape handling, or focus returning to the trigger. The visual close icon is not enough for a reliable disclosure pattern.
**Fix:** implement a disclosure/dialog pattern with focus return, Escape close, and a clear `aria-controls` relationship; avoid trapping focus unless the menu behaves as a modal.
**Suggested command:** `/impeccable audit`

### [P2] Account state is visually secondary but operationally under-specified
**Why it matters:** desktop shows a truncated email and a sign-out button, while mobile drops both. Users can lose orientation about which account is active and how to end the session.
**Fix:** create a consistent account cluster across breakpoints; use a labeled account trigger or compact account panel rather than relying on an email string in the masthead.
**Suggested command:** `/impeccable layout`

## Persona Red Flags

### Jordan (first-timer)
- “Graph,” “Review,” and “Analytics” are understandable only with repository context; there is no visible help or orientation once inside a route.
- On mobile, the first-time user must open the menu to discover all destinations, and there is no indication that the menu is the complete navigation set.

### Sam (accessibility-dependent)
- Opening the mobile menu does not move focus into the menu or document focus return to the trigger on close.
- The mobile menu omits sign-out for authenticated users and manager Analytics, so the keyboard-accessible path is not functionally equivalent to desktop.

### Casey (distracted mobile user)
- Two persistent navy bars consume valuable viewport height before the destination content begins.
- Important account and manager actions are hidden or unavailable in the menu; interruption/resumption gives no account-state cue beyond the page shell.

## Cognitive Load

**Moderate load (3 checklist failures).** The shell has a clear primary frame and good grouping, but desktop presents roughly eight peer-level navigation/account choices, mobile has a reduced-but-incomplete choice set, and the user must infer route/account context without a dedicated account/workspace grouping. The main decision point exceeds the 4-item comfort target for a governed operational shell.

## Minor Observations

- The top institutional strip and sticky header form two stacked navy bands; consider reducing the strip on small screens or folding its content into the masthead.
- `MobileLink` does not provide an active-route state, so mobile users lose the desktop active underline cue.
- The footer copy is brand-consistent but does not provide a route to policies, contact, or help; add only when approved institutional destinations exist.
- The logo hover rotation is restrained, but it is decorative motion in a navigation element; respect reduced-motion preferences if this becomes more animated.

## Questions to Consider

- What if Search and Graph stayed as the only public top-level destinations while Submit became a clearly separated action and account/workspace controls moved into one cluster?
- Should the mobile menu be a true disclosure with focus management, or a full navigation sheet with an explicit account section?
- Is the two-band navy masthead intentional on phones, or should the institutional attribution collapse into the main header at small widths?
