#!/usr/bin/env node
// Compare two probe outputs. Exit 0 when everything is within tolerance, 1 otherwise.
// Usage: node tools/diff.mjs <original.json> <clone.json> [--threshold 2]
// MIT (c) furs0x
import { readFile } from 'node:fs/promises';
import { parseArgs, die } from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [aFile, bFile] = positional;
if (!aFile || !bFile) die('Usage: node tools/diff.mjs <original.json> <clone.json> [--threshold 2]');
const threshold = flags.threshold !== undefined ? Number(flags.threshold) : 2;
if (!Number.isFinite(threshold) || threshold < 0) die('--threshold must be a non-negative number');

const load = async (f) => {
  try { return JSON.parse(await readFile(f, 'utf8')); } catch (e) { die(`Cannot read ${f}: ${e.message}`); }
};
const A = (await load(aFile)).results || {};
const B = (await load(bFile)).results || {};

const GEO = ['x', 'y', 'width', 'height'];
const STYLE = ['color', 'backgroundColor', 'fontSize', 'fontWeight'];
const norm = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase();

const rows = [];
const summary = { compared: 0, matched: 0, geometryDiffs: 0, styleDiffs: 0, missing: [] };
const names = Array.from(new Set([...Object.keys(A), ...Object.keys(B)]));

for (const name of names) {
  const a = A[name];
  const b = B[name];
  if (!a?.exists || !b?.exists) {
    const where = !a?.exists && !b?.exists ? 'both' : !a?.exists ? 'original' : 'clone';
    summary.missing.push(`${name} (${where})`);
    rows.push([name, 'missing', where, '', '']);
    continue;
  }
  summary.compared++;
  let ok = true;
  for (const k of GEO) {
    const d = Math.abs((a.box?.[k] ?? 0) - (b.box?.[k] ?? 0));
    if (d > threshold) {
      ok = false;
      summary.geometryDiffs++;
      rows.push([name, 'geometry', k, String(a.box?.[k]), `${b.box?.[k]} (Δ${d.toFixed(2)})`]);
    }
  }
  for (const k of STYLE) {
    if (norm(a.style?.[k]) !== norm(b.style?.[k])) {
      ok = false;
      summary.styleDiffs++;
      rows.push([name, 'style', k, String(a.style?.[k]), String(b.style?.[k])]);
    }
  }
  if (ok) {
    summary.matched++;
    rows.push([name, 'ok', '', '', '']);
  }
}

const header = ['selector', 'status', 'field', 'original', 'clone'];
const widths = header.map((h, i) => Math.min(48, Math.max(h.length, ...rows.map((r) => r[i].length))));
const cut = (s, w) => (s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w));
const line = (r) => r.map((c, i) => cut(c, widths[i])).join(' | ');
console.log(line(header));
console.log(widths.map((w) => '-'.repeat(w)).join('-+-'));
for (const r of rows) console.log(line(r));
console.log('');
console.log(`threshold: ${threshold}px`);
console.log(`selectors: ${names.length}, compared: ${summary.compared}, matched: ${summary.matched}`);
console.log(`geometry diffs: ${summary.geometryDiffs}, style diffs: ${summary.styleDiffs}, missing: ${summary.missing.length}`);
if (summary.missing.length) console.log(`missing: ${summary.missing.join(', ')}`);

const pass = summary.geometryDiffs === 0 && summary.styleDiffs === 0 && summary.missing.length === 0;
console.log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(pass ? 0 : 1);
