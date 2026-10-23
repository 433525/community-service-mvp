// 首屏载荷预算闸门（只看构建产物，不启动服务）。
// 运行：node tools/check-budget.mjs [--report]
// 依赖：仅 Node 标准库（zlib 的 gzip/brotli 同步压缩）。
//
// 口径（与 ai/size-limit、bundlewatch 一致，按“传输体积”而不是源文件体积）：
//   - 入口载荷 = 入口 <script type="module"> + 该页 <link rel="modulepreload"> + 样式表；
//   - JS / CSS 分开计，raw 与 gzip 双指标；brotli 只报告，不设闸（不同 Node 版本略有差异）；
//   - 每个入口另设单资源上限，防止某一次改动把某个 chunk 撑爆；
//   - 全站总量单独设限，覆盖按需加载的分块。
//
// 预算怎么来的：初始值 = 首次实测 + 约 10% 余量（size-limit README 推荐的
// “当前体积 + 25%”对成熟项目偏松，这里收紧）。调预算前先说明体积来源。

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dist = join(root, 'dist')
const budgetFile = join(__dirname, 'budget.json')
const evidenceDir = join(root, '..', 'docs', '运营准备', 'evidence-budget')
const reportOnly = process.argv.includes('--report')

const KB = 1024
const fmt = (bytes) => `${(bytes / KB).toFixed(1)} kB`
const pct = (value, budget) => `${Math.round((value / budget) * 100)}%`

function fail(message) {
  console.error(`[ERROR] ${message}`)
  process.exitCode = 1
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error('[ERROR] 未找到 dist/index.html，请先运行 npm run build')
  process.exit(1)
}

const budget = JSON.parse(await readFile(budgetFile, 'utf8'))
const entries = Object.keys(budget.entries ?? {})

const sizes = new Map() // path -> { raw, gzip, brotli }
async function measure(relPath) {
  if (sizes.has(relPath)) return sizes.get(relPath)
  const file = join(dist, relPath.replace(/^\//, ''))
  if (!existsSync(file)) {
    throw new Error(`产物缺失：${relPath}（先重新构建）`)
  }
  const buffer = await readFile(file)
  const result = {
    path: relPath,
    raw: buffer.byteLength,
    gzip: gzipSync(buffer, { level: 9 }).byteLength,
    brotli: brotliCompressSync(buffer, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 },
    }).byteLength,
  }
  sizes.set(relPath, result)
  return result
}

/** 从入口 HTML 取出首屏必需的 JS 与 CSS 引用。 */
function collectRefs(html) {
  const js = new Set()
  const css = new Set()
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/g)) {
    js.add(match[1])
  }
  for (const match of html.matchAll(/<link\b[^>]*\brel\s*=\s*"modulepreload"[^>]*\bhref\s*=\s*"([^"]+)"/g)) {
    js.add(match[1])
  }
  for (const match of html.matchAll(/<link\b[^>]*\brel\s*=\s*"stylesheet"[^>]*\bhref\s*=\s*"([^"]+)"/g)) {
    css.add(match[1])
  }
  return { js: [...js], css: [...css] }
}

const rows = []
let failures = 0

function check(id, label, value, budgetValue, unit = 'bytes') {
  const ok = value <= budgetValue
  if (!ok) failures += 1
  rows.push({ id, label, value, budget: budgetValue, unit, ok })
  const headroom = ((budgetValue - value) / budgetValue) * 100
  const headroomText = headroom >= 0 ? `余量 ${headroom.toFixed(0)}%` : `超出 ${Math.abs(headroom).toFixed(0)}%`
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${label} — ${fmt(value)} / ${fmt(budgetValue)}（${pct(value, budgetValue)}，${headroomText}）`)
  if (ok && headroom > 35) {
    console.log(`[NOTE] ${id} 预算余量偏大（${headroom.toFixed(0)}%），下次改动可考虑下调上限`)
  }
  return ok
}

// --- 入口首屏载荷 ----------------------------------------------------------
const entryReports = []
for (const entry of entries) {
  const config = budget.entries[entry]
  const html = await readFile(join(dist, entry), 'utf8').catch(() => null)
  if (!html) {
    fail(`预算配置里的入口 ${entry} 在 dist 中不存在`)
    continue
  }
  const refs = collectRefs(html)
  if (refs.js.length === 0) {
    fail(`${entry} 未解析到入口脚本，预算无法生效`)
    continue
  }
  const jsSizes = await Promise.all(refs.js.map(measure))
  const cssSizes = await Promise.all(refs.css.map(measure))
  const sum = (list, key) => list.reduce((total, item) => total + item[key], 0)

  const jsRaw = sum(jsSizes, 'raw')
  const jsGzip = sum(jsSizes, 'gzip')
  const cssRaw = sum(cssSizes, 'raw')
  const cssGzip = sum(cssSizes, 'gzip')

  check(`${entry}:js-raw`, `${config.label} 首屏 JS（未压缩）`, jsRaw, config.js.raw)
  check(`${entry}:js-gzip`, `${config.label} 首屏 JS（gzip）`, jsGzip, config.js.gzip)
  if (cssRaw > 0) {
    check(`${entry}:css-raw`, `${config.label} 首屏 CSS（未压缩）`, cssRaw, config.css.raw)
    check(`${entry}:css-gzip`, `${config.label} 首屏 CSS（gzip）`, cssGzip, config.css.gzip)
  }

  entryReports.push({
    entry,
    label: config.label,
    js: { files: jsSizes.length, raw: jsRaw, gzip: jsGzip, brotli: sum(jsSizes, 'brotli') },
    css: { files: cssSizes.length, raw: cssRaw, gzip: cssGzip, brotli: sum(cssSizes, 'brotli') },
    chunks: [...jsSizes, ...cssSizes].map((item) => ({
      path: item.path,
      raw: item.raw,
      gzip: item.gzip,
      brotli: item.brotli,
    })),
  })
}

// --- 单资源上限与全站总量 --------------------------------------------------
const assetDir = join(dist, 'assets')
const assetNames = existsSync(assetDir) ? await readdir(assetDir) : []
const allAssets = await Promise.all(
  assetNames.map((name) => measure(`/assets/${name}`).catch(() => null)),
)
const present = allAssets.filter(Boolean)
const jsAssets = present.filter((asset) => extname(asset.path) === '.js')
const cssAssets = present.filter((asset) => extname(asset.path) === '.css')

const biggest = (list) => list.reduce((max, item) => (item.raw > (max?.raw ?? 0) ? item : max), null)
const biggestJs = biggest(jsAssets)
const biggestCss = biggest(cssAssets)

if (biggestJs) {
  check('asset:max-js', `单块 JS 上限（${biggestJs.path.split('/').pop()}）`, biggestJs.raw, budget.assets.maxJsRaw)
}
if (biggestCss) {
  check('asset:max-css', `单块 CSS 上限（${biggestCss.path.split('/').pop()}）`, biggestCss.raw, budget.assets.maxCssRaw)
}

const totalJsRaw = jsAssets.reduce((total, item) => total + item.raw, 0)
const totalCssRaw = cssAssets.reduce((total, item) => total + item.raw, 0)
const totalJsGzip = jsAssets.reduce((total, item) => total + item.gzip, 0)
const totalCssGzip = cssAssets.reduce((total, item) => total + item.gzip, 0)

check('total:js-raw', '全站 JS 总量（未压缩）', totalJsRaw, budget.total.jsRaw)
check('total:js-gzip', '全站 JS 总量（gzip）', totalJsGzip, budget.total.jsGzip)
check('total:css-raw', '全站 CSS 总量（未压缩）', totalCssRaw, budget.total.cssRaw)
check('total:css-gzip', '全站 CSS 总量（gzip）', totalCssGzip, budget.total.cssGzip)

await mkdir(evidenceDir, { recursive: true })
await writeFile(
  join(evidenceDir, 'budget-report.json'),
  JSON.stringify({
    ranAt: new Date().toISOString(),
    dist,
    reportOnly,
    failures,
    entries: entryReports,
    totals: {
      js: { files: jsAssets.length, raw: totalJsRaw, gzip: totalJsGzip },
      css: { files: cssAssets.length, raw: totalCssRaw, gzip: totalCssGzip },
    },
    checks: rows,
  }, null, 2),
  'utf8',
)

console.log(`\n首屏载荷预算：${rows.length} 项，失败 ${failures}（报告见 docs/运营准备/evidence-budget/budget-report.json）`)
if (reportOnly) {
  console.log('[NOTE] --report 模式：仅采集，不因超限失败')
  process.exitCode = 0
} else {
  process.exitCode = failures ? 1 : 0
}
