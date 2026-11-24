// Shared helpers for web-clone-skill tools. MIT (c) furs0x

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

export function parseViewport(value, fallback = '1440x900') {
  const v = typeof value === 'string' ? value : fallback;
  const m = /^(\d+)x(\d+)$/i.exec(v);
  if (!m) throw new Error(`Invalid viewport "${v}", expected WIDTHxHEIGHT`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

export const STYLE_KEYS = [
  'color',
  'backgroundColor',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'borderRadius',
  'boxShadow',
];

export function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}
