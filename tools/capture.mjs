#!/usr/bin/env node
// Capture a rendered page: HTML, design tokens, element geometry, asset list.
// Usage: node tools/capture.mjs <url> <outDir> [--viewport 1440x900] [--full] [--timeout 45000]
// MIT (c) furs0x
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, parseViewport, die } from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [url, outDir] = positional;
if (!url || !outDir) {
  die('Usage: node tools/capture.mjs <url> <outDir> [--viewport 1440x900] [--full] [--timeout 45000]');
}
const viewport = parseViewport(flags.viewport);
const timeout = Number(flags.timeout) || 45000;
const MAX_ELEMENTS = 3000;

const errors = [];
const record = (step, err) => {
  errors.push({ step, message: String(err && err.message ? err.message : err) });
  console.error(`[capture] ${step} failed: ${err && err.message ? err.message : err}`);
};
const save = async (name, data) => {
  try {
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await writeFile(path.join(outDir, name), body);
    console.log(`[capture] wrote ${name}`);
  } catch (e) {
    record(`write ${name}`, e);
  }
};

// Runs inside the page. Must be self-contained.
function collectInPage(maxElements) {
  const cssPath = (el) => {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const dataAttr = Array.from(node.attributes).find(
        (a) => a.name.startsWith('data-') && a.value && a.value.length < 80,
      );
      if (dataAttr) {
        const sel = `${node.localName}[${dataAttr.name}="${CSS.escape(dataAttr.value)}"]`;
        const scope = node.parentElement || document;
        if (scope.querySelectorAll(`:scope > ${sel}`).length === 1) {
          parts.unshift(sel);
          node = node.parentElement;
          continue;
        }
      }
      let idx = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.localName === node.localName) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${node.localName}:nth-of-type(${idx})`);
      node = node.parentElement;
    }
    if (!parts.length || !parts[0].startsWith('#')) parts.unshift('html');
    return parts.join(' > ');
  };

  // Tokens: custom properties declared on :root / html.
  const customProps = {};
  const sheetErrors = [];
  const walkRules = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.selectorText) {
        try { walkRules(rule.cssRules); } catch (_) { /* ignore */ }
        continue;
      }
      if (!rule.selectorText || !rule.style) continue;
      const sels = rule.selectorText.split(',').map((s) => s.trim());
      if (!sels.some((s) => s === ':root' || s === 'html')) continue;
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i];
        if (prop.startsWith('--')) customProps[prop] = rule.style.getPropertyValue(prop).trim();
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walkRules(sheet.cssRules);
    } catch (e) {
      sheetErrors.push({ href: sheet.href, message: 'cssRules not readable (likely cross-origin)' });
    }
  }

  const bump = (map, key) => { if (key) map[key] = (map[key] || 0) + 1; };
  const fonts = {}, colors = {}, backgrounds = {}, fontSizes = {};
  const elements = [];
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of all) {
    if (elements.length >= maxElements) break;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const style = {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
    };
    bump(fonts, cs.fontFamily);
    bump(colors, cs.color);
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
      bump(backgrounds, cs.backgroundColor);
    }
    bump(fontSizes, cs.fontSize);
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    elements.push({
      tag: el.localName,
      selector: cssPath(el),
      text: ownText.slice(0, 200),
      box: {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      style,
    });
  }

  const sortDesc = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));

  const abs = (u) => { try { return new URL(u, location.href).href; } catch (_) { return null; } };
  const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
  const images = [];
  for (const img of document.images) {
    images.push(abs(img.currentSrc || img.src));
    if (img.srcset) img.srcset.split(',').forEach((s) => images.push(abs(s.trim().split(/\s+/)[0])));
  }
  document.querySelectorAll('source[srcset]').forEach((s) =>
    s.srcset.split(',').forEach((p) => images.push(abs(p.trim().split(/\s+/)[0]))));
  document.querySelectorAll('*').forEach((el) => {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      for (const m of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) images.push(abs(m[1]));
    }
  });
  const scripts = Array.from(document.scripts).map((s) => s.src && abs(s.src));
  const stylesheets = Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).map((l) => abs(l.href));
  const icons = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')).map((l) => abs(l.href));
  const fontUrls = [];
  for (const entry of performance.getEntriesByType('resource')) {
    if (/\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(entry.name)) fontUrls.push(entry.name);
  }

  return {
    tokens: {
      customProperties: customProps,
      fontFamilies: sortDesc(fonts),
      colors: sortDesc(colors).slice(0, 40),
      backgrounds: sortDesc(backgrounds).slice(0, 40),
      fontSizes: sortDesc(fontSizes),
      unreadableStylesheets: sheetErrors,
    },
    elements,
    assets: {
      images: uniq(images),
      fonts: uniq(fontUrls),
      scripts: uniq(scripts),
      stylesheets: uniq(stylesheets),
      icons: uniq(icons),
    },
    page: {
      title: document.title,
      url: location.href,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    },
  };
}

await mkdir(outDir, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (e) {
  record('launch browser', e);
  await save('errors.json', errors);
  process.exit(1);
}

const context = await browser.newContext({ viewport });
const page = await context.newPage();
const networkFonts = new Set();
page.on('response', (res) => {
  try {
    const type = res.request().resourceType();
    if (type === 'font') networkFonts.add(res.url());
  } catch (_) { /* ignore */ }
});

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout });
} catch (e) {
  record('navigate (networkidle)', e);
}

try {
  await save('page.html', await page.content());
} catch (e) {
  record('page.html', e);
}

let data = null;
try {
  data = await page.evaluate(collectInPage, MAX_ELEMENTS);
} catch (e) {
  record('collect in page', e);
}

if (data) {
  await save('tokens.json', data.tokens);
  await save('elements.json', { url, viewport, page: data.page, count: data.elements.length, elements: data.elements });
  const fonts = Array.from(new Set([...data.assets.fonts, ...networkFonts]));
  await save('assets.json', { url, ...data.assets, fonts });
}

if (flags.full) {
  try {
    await page.screenshot({ path: path.join(outDir, 'full.png'), fullPage: true });
    console.log('[capture] wrote full.png');
  } catch (e) {
    record('full screenshot', e);
  }
}

await browser.close().catch((e) => record('close browser', e));
await save('errors.json', errors);
console.log(`[capture] done: ${data ? data.elements.length : 0} elements, ${errors.length} errors -> ${outDir}`);
