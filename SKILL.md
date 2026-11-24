---
name: web-clone-skill
description: >-
  Capture a live web page's DOM, design tokens and assets with Playwright, rebuild it, then measure
  geometry/style differences between the original and the rebuild until they converge. Use when asked to
  clone or recreate a landing page, reproduce a site's visual design, or quantify how far a clone drifts
  from its source. Triggers: "clone this landing page", "recreate this site's design", "pixel-match",
  "compare clone vs original", "复刻落地页", "还原网站设计", "仿站", "对比原站和复刻站差异", "像素级还原".
---

# web-clone-skill

A four-stage loop for rebuilding a page faithfully: **capture → rebuild → measure → converge**.

## Requirements

- Node.js 18+ and the `playwright` package (`npm install`).
- First run only: `npx playwright install chromium` to download the browser.

## Workflow

1. **Capture** the source page:
   `node tools/capture.mjs <url> out/src --full`
   Read `tokens.json` first (custom properties, font families, color and font-size frequency) to set up
   the rebuild's base styles. Use `elements.json` for layout boxes and per-element computed styles, and
   `full.png` as the visual reference.
2. **Fetch assets** you are allowed to reuse:
   `node tools/assets.mjs out/src/assets.json out/assets`
3. **Rebuild** the page by hand (plain HTML/CSS or the user's framework). Keep structure close to the
   source for the regions you intend to measure. Prefer tokens over hard-coded values.
4. **Measure**: write a selector map (`examples/probe.example.json` shows the shape) naming the key
   regions — header, hero title, CTA, cards, footer. Selectors may differ between original and clone, so
   keep one map per side with identical *names*. Probe both:
   `node tools/probe.mjs <original-url> sel.original.json out/a.json --screenshot out/a.png`
   `node tools/probe.mjs <clone-url> sel.clone.json out/b.json --screenshot out/b.png`
5. **Converge**: `node tools/diff.mjs out/a.json out/b.json --threshold 2`. Fix the largest geometry
   deltas first (they cascade), then colors / font sizes / weights. Repeat 4–5 until exit code is 0.
   Always probe both sides at the same `--viewport`.

## Boundaries

- Only use on sites you own or are authorized to reproduce. Respect copyright and trademarks of
  logos, text, images and fonts; replace them when you lack rights.
- Do not use to bypass logins, paywalls, bot protection or rate limits, and do not collect anyone's
  personal data.
- The tools see only the rendered public page at one viewport; they do not capture hover/animation
  states, cross-origin stylesheet rules, or content behind interaction.
