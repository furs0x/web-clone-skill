# web-clone-skill

Playwright toolkit for rebuilding web pages and measuring how close the rebuild is.
用 Playwright 采集网页、辅助复刻，并量化复刻站与原站的差异。

## Install / 安装

```bash
npm install
npx playwright install chromium   # first run only / 首次运行
```

## Commands / 命令

| Command | Purpose / 作用 |
|---|---|
| `node tools/capture.mjs <url> <outDir> [--viewport 1440x900] [--full] [--timeout 45000]` | Snapshot HTML, tokens, element boxes, asset list / 采集页面 |
| `node tools/probe.mjs <url> <selectors.json> <out.json> [--viewport 1440x900] [--screenshot out.png]` | Measure named selectors / 测量指定选择器 |
| `node tools/diff.mjs <original.json> <clone.json> [--threshold 2]` | Compare two probes, exit 0 = pass / 比对，0 为通过 |
| `node tools/assets.mjs <assets.json> <outDir>` | Download images + fonts / 下载图片与字体 |

`selectors.json` is either an array of selectors or a `{ "name": "selector" }` object. See `examples/probe.example.json`.
选择器文件可为数组或 `{名称: 选择器}` 对象。

## Full run / 完整流程

```bash
node tools/capture.mjs https://source.example out/src --full
node tools/assets.mjs out/src/assets.json out/assets
# ...rebuild the page, serve it at http://localhost:8080 ...
node tools/probe.mjs https://source.example sel.json out/a.json --screenshot out/a.png
node tools/probe.mjs http://localhost:8080   sel.json out/b.json --screenshot out/b.png
node tools/diff.mjs out/a.json out/b.json --threshold 2
```

## Outputs / 输出

- `capture`: `page.html` (rendered DOM), `tokens.json` (`:root` custom properties, font families, color/background/font-size frequency), `elements.json` (≤3000 visible elements: tag, stable selector, own text, box, computed styles), `assets.json` (images, fonts, scripts, stylesheets, icons), `full.png` (with `--full`), `errors.json` (per-step failures; the script keeps going).
- `probe`: per name → `exists`, `matches`, `box`, `style`, `text`, `childCount`.
- `diff`: table + summary (compared / matched / geometry diffs / style diffs / missing). Compares x/y/width/height within threshold and color, background-color, font-size, font-weight.
- `assets`: mirrored files under `<outDir>/<host>/<path>` plus `download-report.json` (saved / skipped / failed). Skips `data:` URIs and files > 20 MB; 4 concurrent downloads.

## Limits / 限制

- Use only on pages you are authorized to reproduce. Not for bypassing logins, paywalls or bot protection, or scraping personal data. 仅限有权处理的站点，不得绕过登录/付费墙或抓取隐私数据。
- Single viewport, static state: no hover/animation states. Rules in cross-origin stylesheets can't be read (listed in `tokens.unreadableStylesheets`).
- `networkidle` may never settle on pages with long-polling; the navigation error is recorded and capture continues with whatever rendered.

## Verified / 已验证

Date 2026-11-24 · Node v24.22.2 · playwright 1.65.0 (Chromium 158.0.8127.18, headless) · Linux.

| Command | Result |
|---|---|
| `node --check tools/*.mjs` | all pass |
| `node tools/capture.mjs https://example.com /tmp/wcs-capture --full` | 12 elements, 0 errors; wrote page.html, tokens.json, elements.json, assets.json, full.png, errors.json |
| `node tools/probe.mjs https://example.com /tmp/wcs-selectors.json /tmp/wcs-probe-a.json` (and `-b`) | 3/3 selectors found (svg, first `p`, `a`) |
| `node tools/diff.mjs /tmp/wcs-probe-a.json /tmp/wcs-probe-b.json` | compared 3, matched 3, 0 diffs, `RESULT: PASS`, exit 0 |
| diff against a doctored copy (+10px x, font-size 18px, one selector removed) | 1 geometry, 1 style, 1 missing, `RESULT: FAIL`, exit 1 |
| `node tools/assets.mjs` on a 3-URL test list | saved 1, skipped 1 (data URI), failed 1 (HTTP 404), exit 0 |

Note: playwright is pinned to 1.65.0 because it matches the locally cached Chromium build (revision 1254).

## License

MIT © furs0x
