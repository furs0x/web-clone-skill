#!/usr/bin/env node
// Measure a fixed set of selectors on a page and emit comparable JSON.
// Usage: node tools/probe.mjs <url> <selectors.json> <out.json> [--viewport 1440x900] [--screenshot out.png] [--timeout 45000]
// MIT (c) furs0x
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, parseViewport, STYLE_KEYS, die } from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [url, selectorsFile, outFile] = positional;
if (!url || !selectorsFile || !outFile) {
  die('Usage: node tools/probe.mjs <url> <selectors.json> <out.json> [--viewport 1440x900] [--screenshot out.png]');
}
const viewport = parseViewport(flags.viewport);
const timeout = Number(flags.timeout) || 45000;

let raw;
try {
  raw = JSON.parse(await readFile(selectorsFile, 'utf8'));
} catch (e) {
  die(`Cannot read selectors file: ${e.message}`);
}
let targets;
if (Array.isArray(raw)) targets = raw.map((s) => [s, s]);
else if (raw && typeof raw === 'object') targets = Object.entries(raw);
else die('selectors.json must be an array of selectors or an object {name: selector}');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport });
const errors = [];
try {
  await page.goto(url, { waitUntil: 'networkidle', timeout });
} catch (e) {
  errors.push({ step: 'navigate', message: e.message });
}

const results = {};
for (const [name, selector] of targets) {
  try {
    results[name] = await page.evaluate(
      ({ selector, keys }) => {
        const all = document.querySelectorAll(selector);
        const el = all[0];
        if (!el) return { selector, exists: false, matches: 0 };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const style = {};
        for (const k of keys) style[k] = cs[k];
        return {
          selector,
          exists: true,
          matches: all.length,
          box: {
            x: Math.round((r.left + window.scrollX) * 100) / 100,
            y: Math.round((r.top + window.scrollY) * 100) / 100,
            width: Math.round(r.width * 100) / 100,
            height: Math.round(r.height * 100) / 100,
          },
          style,
          text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
          childCount: el.children.length,
        };
      },
      { selector, keys: STYLE_KEYS },
    );
  } catch (e) {
    results[name] = { selector, exists: false, error: e.message };
  }
}

if (typeof flags.screenshot === 'string') {
  try {
    await page.screenshot({ path: flags.screenshot, fullPage: true });
  } catch (e) {
    errors.push({ step: 'screenshot', message: e.message });
  }
}
await browser.close();

const out = { url, viewport, capturedAt: new Date().toISOString(), results, errors };
await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
await writeFile(outFile, JSON.stringify(out, null, 2));
const found = Object.values(results).filter((r) => r.exists).length;
console.log(`[probe] ${found}/${targets.length} selectors found -> ${outFile}`);
