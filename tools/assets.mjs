#!/usr/bin/env node
// Download images and fonts listed in a capture assets.json, mirroring URL paths.
// Usage: node tools/assets.mjs <assets.json> <outDir>
// MIT (c) furs0x
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, die } from './lib.mjs';

const MAX_BYTES = 20 * 1024 * 1024;
const CONCURRENCY = 4;

const { positional } = parseArgs(process.argv.slice(2));
const [assetsFile, outDir] = positional;
if (!assetsFile || !outDir) die('Usage: node tools/assets.mjs <assets.json> <outDir>');

let manifest;
try {
  manifest = JSON.parse(await readFile(assetsFile, 'utf8'));
} catch (e) {
  die(`Cannot read ${assetsFile}: ${e.message}`);
}

const urls = Array.from(new Set([...(manifest.images || []), ...(manifest.fonts || [])]));
const skipped = [];
const failed = [];
const saved = [];

const localPath = (u) => {
  const parsed = new URL(u);
  let p = decodeURIComponent(parsed.pathname);
  if (p.endsWith('/') || p === '') p += 'index';
  const segments = p.split('/').filter((s) => s && s !== '.' && s !== '..')
    .map((s) => s.replace(/[<>:"\\|?*\x00-\x1f]/g, '_'));
  if (parsed.search) {
    const last = segments.pop() || 'index';
    const tag = Buffer.from(parsed.search).toString('base64url').slice(0, 16);
    const ext = path.extname(last);
    segments.push(`${path.basename(last, ext)}__${tag}${ext}`);
  }
  return path.join(outDir, parsed.hostname, ...segments);
};

async function fetchOne(u) {
  if (u.startsWith('data:')) return skipped.push({ url: u.slice(0, 60) + '…', reason: 'data URI' });
  let target;
  try {
    const proto = new URL(u).protocol;
    if (proto !== 'http:' && proto !== 'https:') return skipped.push({ url: u, reason: `protocol ${proto}` });
    target = localPath(u);
  } catch (e) {
    return failed.push({ url: u, error: `bad url: ${e.message}` });
  }
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) return failed.push({ url: u, error: `HTTP ${res.status}` });
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) {
      await res.body?.cancel();
      return skipped.push({ url: u, reason: `too large (${len} bytes)` });
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > MAX_BYTES) {
        return skipped.push({ url: u, reason: 'too large (streamed > 20MB)' });
      }
      chunks.push(chunk);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.concat(chunks));
    saved.push({ url: u, file: target, bytes: total });
  } catch (e) {
    failed.push({ url: u, error: e.message });
  }
}

let cursor = 0;
const worker = async () => {
  while (cursor < urls.length) {
    const u = urls[cursor++];
    await fetchOne(u);
  }
};
await mkdir(outDir, { recursive: true });
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length || 1) }, worker));

const report = { source: assetsFile, total: urls.length, saved, skipped, failed };
await writeFile(path.join(outDir, 'download-report.json'), JSON.stringify(report, null, 2));
console.log(`[assets] saved ${saved.length}, skipped ${skipped.length}, failed ${failed.length} of ${urls.length} -> ${outDir}`);
