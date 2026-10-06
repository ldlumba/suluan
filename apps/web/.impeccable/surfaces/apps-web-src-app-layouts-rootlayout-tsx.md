---
version: 1
slug: "apps-web-src-app-layouts-rootlayout-tsx"
primary_target: "apps/web/src/app/layouts/RootLayout.tsx"
related_targets: ["apps/web/src/app/pages/HomePage.tsx","apps/web/src/index.css"]
---

# SULUAN application shell

## Scope

The shared application shell: public home, search, graph, submission, review, and account routes. Mode: Operate for authenticated workflows; public discovery should feel calm and legible rather than promotional.

## Direction contract

### THESIS
SULUAN should feel like a governed university research desk: readers arrive at the collection first, while submission and REO operations remain clear secondary paths. It refuses the default anonymous SaaS dashboard shell and the empty scaffold currently framing every route.

### OWN-WORLD
A deep UA navy frame, warm white reading surfaces, precise gold emphasis, restrained red status/impact accents, hairline borders, soft 25px feature radii, and Geist typography. Navigation is a quiet institutional masthead; pages use editorial spacing and clear state labels instead of nested cards and decorative gradients.

### STORY
A visitor understands within seconds that SULUAN is where University of the Assumption research can be discovered. The primary action is search. Signed-in users can submit and track work; managers can review without public workflows becoming noisy.

### FIRST VIEWPORT
A sticky navy masthead contains the SULUAN mark, primary Search and Graph links, and a focused account/action area. On Home, a navy opening field presents a direct research-search action and a short explanation, followed by a restrained latest-research strip. On internal routes, the shell leaves generous top space for the page title and makes the active destination unmistakable.

### FORM
Code-led institutional research desk: strong horizontal frame, editorial section breaks, sparse rounded feature surfaces, no hero video, no generic icon tile grid, and no decorative shadow stack. The supplied UA homepage teardown supplies the palette and flatness; the application translates it for real repository tasks.

### FINISH
unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved decisions

- Paper detail metadata route will be designed after the shared shell.
- Home-page content must use real API data or clearly avoid unsupported statistics.
- Semantic search remains unavailable and must not be presented as enabled.
