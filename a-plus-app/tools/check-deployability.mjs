// 静态可部署性闸门（不部署、只验证产物与预览可达性）
// 运行：node tools/check-deployability.mjs --base=http://127.0.0.1:5180
// 依赖：仅 Node 标准库（需 Node ≥ 18，用到全局 fetch）。不启动/不关闭任何服务。
//
// 检查项（任一 FAIL → exit 1）：
//   A 构建产物齐全（dist/index.html、community.html、robots.txt、404.html）
//   B 两个入口 HTML 里所有根路径本地引用（/assets/*、/favicon.svg 等）在 dist 中真实存在
//   C 两个入口 HTML + dist/assets/*.css（含 404.html 兜底页）无外链，仅允许 www.w3.org
//   D dist/robots.txt 含 Disallow: /
//   E dist/404.html 含 noindex、href="/"、href="/community.html"
//   F 预览服务对 /、/community.html、/robots.txt、/404.html 均返回 200

import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180')
  .slice('--base='.length)
  .replace(/\/+$/, '')
const ENTRIES = ['index.html', 'community.html']
const ALLOWED_EXTERNAL_HOSTS = new Set(['www.w3.org']) // SVG/XML 命名空间不属于网络请求

const rows = []
let failures = 0

function record(id, name, expected, actual, ok) {
  rows.push({ id, name, expected, actual, ok })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
function note(text) {
  console.log(`[NOTE] ${text}`)
}

async function exists(file) {
  try {
    const info = await stat(file)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

// --- A 构建产物齐全 ---------------------------------------------------------
const required = ['index.html', 'community.html', 'robots.txt', '404.html']
const missing = []
for (const name of required) {
  if (!(await exists(join(dist, name)))) missing.push(name)
}
record(
  'A',
  '构建产物齐全',
  required.map((n) => `dist/${n}`).join(' '),
  missing.length === 0 ? `${required.length}/${required.length} 存在` : `缺失：${missing.join(', ')}（先跑 npm run build）`,
  missing.length === 0,
)

// --- B 根路径引用在 dist 内可解析 -------------------------------------------
const htmlText = {}
for (const name of ENTRIES) {
  const file = join(dist, name)
  htmlText[name] = (await exists(file)) ? await readFile(file, 'utf8') : ''
}
const localRefs = new Map() // ref -> [files]
for (const name of ENTRIES) {
  for (const m of htmlText[name].matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const ref = m[1].split('#')[0].split('?')[0]
    if (!ref.startsWith('/') || ref.startsWith('//')) continue
    if (!localRefs.has(ref)) localRefs.set(ref, [])
    localRefs.get(ref).push(name)
  }
}
const brokenRefs = []
for (const ref of localRefs.keys()) {
  // 目录型路径（`/`、`/sub/`）在静态托管上解析到 index.html，不是断链；
  // 无脚本兜底页会链接回 `/`，这里按托管语义归一化后再判断。
  const fileRef = ref.endsWith('/') ? `${ref}index.html` : ref
  if (!(await exists(join(dist, fileRef)))) brokenRefs.push(ref)
}
record(
  'B',
  '入口 HTML 的根路径引用均能在 dist 解析',
  '所有 /assets/*、/favicon.svg 等根路径引用命中文件',
  localRefs.size === 0
    ? '未找到根路径引用（检查解析逻辑或产物结构）'
    : `${localRefs.size} 个唯一引用，${brokenRefs.length === 0 ? '全部命中' : `断链 ${brokenRefs.join(', ')}`}`,
  localRefs.size > 0 && brokenRefs.length === 0,
)

// --- C 无外链（HTML + CSS + 404 兜底页）------------------------------------
const cssDir = join(dist, 'assets')
let cssFiles = []
try {
  cssFiles = (await readdir(cssDir)).filter((f) => f.endsWith('.css'))
} catch {
  cssFiles = []
}
const scanTargets = [
  ...ENTRIES.map((name) => ({ label: `dist/${name}`, text: htmlText[name] })),
  { label: 'dist/404.html', text: (await exists(join(dist, '404.html'))) ? await readFile(join(dist, '404.html'), 'utf8') : '' },
]
for (const file of cssFiles) {
  scanTargets.push({ label: `dist/assets/${file}`, text: await readFile(join(cssDir, file), 'utf8') })
}
const externalHits = []
for (const target of scanTargets) {
  for (const m of target.text.matchAll(/https?:\/\/[^\s"'`()<>]+/g)) {
    const url = m[0]
    let host = ''
    try {
      host = new URL(url).host
    } catch {
      host = ''
    }
    if (ALLOWED_EXTERNAL_HOSTS.has(host)) continue
    externalHits.push(`${target.label} → ${url}`)
  }
}
record(
  'C',
  '入口 HTML / CSS / 404 页无外部网络引用',
  '仅允许 www.w3.org（命名空间），其余 http(s) 外链为 0',
  externalHits.length === 0
    ? `扫描 ${scanTargets.length} 个文件（含 ${cssFiles.length} 个 CSS），外链 0`
    : `${externalHits.length} 处外链：${externalHits.slice(0, 5).join(' | ')}${externalHits.length > 5 ? ' …' : ''}`,
  externalHits.length === 0,
)

// --- D robots.txt 禁止抓取 --------------------------------------------------
const robotsPath = join(dist, 'robots.txt')
const robotsText = (await exists(robotsPath)) ? await readFile(robotsPath, 'utf8') : ''
const robotsDisallow = /^\s*Disallow:\s*\/\s*$/m.test(robotsText)
const robotsWildcard = /^\s*User-agent:\s*\*\s*$/m.test(robotsText)
record(
  'D',
  'robots.txt 声明整站禁止抓取',
  '含 User-agent: * 与 Disallow: /',
  robotsText === ''
    ? 'dist/robots.txt 缺失或为空'
    : `User-agent:* ${robotsWildcard ? '有' : '无'} / Disallow:/ ${robotsDisallow ? '有' : '无'}（${robotsText.length} 字节）`,
  robotsDisallow && robotsWildcard,
)

// --- E 404 兜底页内容 -------------------------------------------------------
const p404Path = join(dist, '404.html')
const p404Text = (await exists(p404Path)) ? await readFile(p404Path, 'utf8') : ''
const p404Noindex = /name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(p404Text)
const p404Home = /href=["']\/["']/.test(p404Text)
const p404Community = /href=["']\/community\.html["']/.test(p404Text)
record(
  'E',
  '404 页具备 noindex 与两条返回路径',
  'noindex + href="/" + href="/community.html"',
  `noindex ${p404Noindex ? '有' : '无'} / href="/" ${p404Home ? '有' : '无'} / href="/community.html" ${p404Community ? '有' : '无'}`,
  p404Noindex && p404Home && p404Community,
)

// --- F 预览服务可达性 -------------------------------------------------------
const fetchTargets = ['/', '/community.html', '/robots.txt', '/404.html']
const fetchResults = []
for (const path of fetchTargets) {
  const url = `${base}${path}`
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) })
    const body = await res.text()
    const ctype = res.headers.get('content-type') ?? '(none)'
    fetchResults.push({ path, status: res.status, ctype, body })
  } catch (error) {
    fetchResults.push({ path, status: 0, ctype: '', body: '', error: error instanceof Error ? error.message : String(error) })
  }
}
const fetchFailed = fetchResults.filter((r) => r.status !== 200)
record(
  'F',
  '预览服务四个路径均返回 200',
  fetchTargets.map((p) => `${p} → 200`).join('，'),
  fetchFailed.length === 0
    ? fetchResults.map((r) => `${r.path} ${r.status} ${r.ctype}`).join('；')
    : `${fetchFailed.map((r) => `${r.path} ${r.status || r.error || ''}`).join('；')}（预览未启动？npm run dev 应监听 ${base}）`,
  fetchFailed.length === 0,
)

// 内容回退探测：200 也可能是 SPA/dev 回退成 index.html，会让上面的 200 变成假阳性。
const servedFallback = fetchResults.filter(
  (r) => r.status === 200 && (r.path === '/robots.txt' || r.path === '/404.html') && /<div id="app">/.test(r.body ?? ''),
)
if (servedFallback.length > 0) {
  note(`以下路径返回 200 但内容是应用外壳（回退），不代表文件真被提供：${servedFallback.map((r) => r.path).join(', ')}`)
}

// 附加提示：根路径绝对引用意味着只能部署在域名根，子路径部署会全盘 404。
const absoluteRefs = [...localRefs.keys()]
if (absoluteRefs.length > 0) {
  note(`产物使用 ${absoluteRefs.length} 个根路径绝对引用（如 ${absoluteRefs.slice(0, 3).join(', ')}），只适配根路径部署；子路径部署会断链。`)
}

// --- 汇总 -------------------------------------------------------------------
const total = rows.length
const passed = rows.filter((r) => r.ok).length
console.log('')
console.log('===== 可部署性检查摘要（可直接粘贴进交付文档） =====')
console.log(`目标：静态托管（根路径），base=${base}`)
for (const r of rows) {
  console.log(`${r.id} ${r.name} …… ${r.ok ? 'PASS' : 'FAIL'}`)
}
console.log(`合计：${passed}/${total} PASS，${failures} FAIL`)
console.log(`结论：${failures === 0 ? '静态可部署性检查全部通过（不含公开发布合规性，见 docs/部署说明-2026-10-22.md 的 G3 阻塞项）' : '存在 FAIL，当前产物不可交付上线'}`)
console.log('==================================================')

// Let fetch/Undici keep-alive handles drain naturally on Windows; avoid forced loop shutdown.
process.exitCode = failures === 0 ? 0 : 1
