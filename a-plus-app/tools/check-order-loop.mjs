/**
 * check-order-loop.mjs — phase-2 acceptance run for the B 履约闭环 browser build.
 *
 * Covers (against the static dist served by `vite preview`):
 *   A. 他人求助：演练接单 → 发起完成申请 → 代合成求助方确认完成 → 已完成 + 账本 + 通知
 *   B. 本人求助：代合成邻居接单 → 代合成接单方申请完成 → 确认完成 → 已完成 + 账本
 *   C. 取消订单（必填原因）→ 已取消/关闭 + 时间线
 *   D. 争议：发起争议 → 争议处理中 → 撤销争议继续履约 → 再次争议 → 因争议关闭
 *   E. 活动报名 → 取消报名；普通志愿记录不可报名
 *   F. 我的页：查看存档 JSON（含 app/posts/orderEvents）与复制 JSON
 *   G. 数据层校验：通过 Pinia store 直接调用 signUpForEvent / cancelEventSignup 共享函数
 *   H. 刷新后状态保留（订单状态/账本/系统通知）
 *
 * Zero third-party dependencies (Node >= 22 built-in fetch + WebSocket).
 * Writes PNG + page-text evidence and run-record-acceptance.{json,md}.
 * The preview server must be started separately (see docs report).
 *
 * Usage:
 *   node tools/check-order-loop.mjs [--base=http://127.0.0.1:5180] [--out=<dir>]
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserSession, sleep } from './cdp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(HERE, '..')
const REPO_ROOT = resolve(APP_ROOT, '..')
const DEFAULT_OUT = join(REPO_ROOT, 'docs', '运营准备', 'evidence-B-order')
const STORAGE_KEY = 'community-mvp.synthetic-state.v1'

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=')
    return [key, rest.join('=')]
  }),
)
const BASE = (args.get('base') || 'http://127.0.0.1:5180').replace(/\/+$/, '')
const OUT_DIR = resolve(args.get('out') || DEFAULT_OUT)
const BROWSER_PATH = args.get('browser') || ''
// Optional evidence prefix/record name so a later build's run can coexist with earlier evidence.
const PREFIX = args.get('prefix') || ''
const RECORD_BASE = args.get('record') || 'run-record-acceptance'

// ---- Fictional fixtures / acceptance data (every string is synthetic) ----
const DEMO_USER_ID = 'SYNTH-DEMO-USER'
const T_FIXTURE = '求助：帮忙把两箱演练物资搬到活动室（虚构）'
const FIXTURE_ID = 'SYNTH-POST-001'
const T_ACTIVITY = '志愿招募：周六步道清洁 12 个名额（演练）'
const ACTIVITY_ID = 'SYNTH-POST-003'
const T_VOLUNTEER_UPDATE = '志愿日记：整理共享书架的两小时（演练）'
const VOLUNTEER_UPDATE_ID = 'SYNTH-POST-002'
const REASON_A_WORK = '本机演练：已完成搬运协助，请对方确认（合成说明）。'
const REASON_B_WORK = '本机演练：共享书架已整理完成，请确认（合成说明）。'
const REASON_C_WORK = '本机演练：借出剪刀已归还（合成说明）。'
const REASON_D_WORK = '本机演练：快递已代取（合成说明）。'
const REASON_CANCEL_C = '虚构演练理由：计划变更，取消本机演练订单。'
const REASON_DISPUTE_1 = '虚构演练理由：对完成标准有疑问，先标记争议。'
const REASON_DISPUTE_RESUME = '虚构演练理由：双方已在本机说明清楚，撤销争议继续履约。'
const REASON_DISPUTE_2 = '虚构演练理由：再次对交付说明有疑问。'
const REASON_DISPUTE_CLOSE = '虚构演练理由：决定因争议关闭这笔本机演练订单。'
const REVIEW_REASON_B = '虚构审核理由：本人求助发布演示，仅合成数据，字段完整。'
const REVIEW_REASON_C = '虚构审核理由：取消路径演示用合成求助，字段完整。'
const REVIEW_REASON_D = '虚构审核理由：争议路径演示用合成求助，字段完整。'

const T_B = '求助：协助整理演练社区共享书架（合成）'
const CONTENT_B = '想请人在演练社区共享书架协助分类和贴标，约一小时。本内容为虚构演练，不含真实姓名、电话或地址。'
const T_C = '求助：借一把演练用剪刀（合成）'
const CONTENT_C = '想在演练社区活动室借用一把剪刀制作演练手工，约二十分钟。本内容为虚构演练。'
const T_D = '求助：代取演练社区门口的演练快递（合成）'
const CONTENT_D = '想把一个演练快递从演练社区门口取到活动室，约十五分钟。本内容为虚构演练。'
const WINDOW_B = '本周六 10:00–11:00'
const WINDOW_C = '本周日 14:00–14:30'
const WINDOW_D = '下周一 09:00–09:30'
const DURATION_60 = '约 1 小时'
const DURATION_30 = '约 30 分钟'
const DURATION_20 = '约 20 分钟'

const run = {
  script: 'tools/check-order-loop.mjs',
  suite: 'phase-2 acceptance',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  ok: false,
  base: BASE,
  evidenceDir: OUT_DIR,
  storageKey: STORAGE_KEY,
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  commands: {
    preview: 'npm run preview -- --host 127.0.0.1 --port 5180 --strictPort',
    check: 'node tools/check-order-loop.mjs --base=http://127.0.0.1:5180',
  },
  browser: null,
  site: null,
  dist: null,
  assets: { community: [], aplus: [] },
  steps: [],
  storageSnapshots: [],
  storeCalls: null,
  checks: {},
  observations: {},
  pageErrors: [],
  consoleErrors: [],
  notes: [],
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`)
}

function localTime(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function rel(filePath) {
  return relative(REPO_ROOT, filePath).split('\\').join('/')
}

async function collectSiteInfo() {
  const entryUrl = `${BASE}/community.html`
  const response = await fetch(entryUrl, { signal: AbortSignal.timeout(8000) })
  const html = await response.text()
  const assets = []
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assets.push(match[1])
  for (const match of html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)) assets.push(match[1])
  return { entryUrl, status: response.status, assets }
}

async function collectDistInfo() {
  const distDir = join(APP_ROOT, 'dist')
  const files = []
  const add = async (relativePath) => {
    try {
      const info = await stat(join(distDir, relativePath))
      files.push({ file: relativePath.split('\\').join('/'), size: info.size, modifiedAt: new Date(info.mtimeMs).toISOString() })
    } catch {
      /* ignore */
    }
  }
  await add('community.html')
  await add('index.html')
  try {
    for (const entry of await readdir(join(distDir, 'assets'))) await add(`assets/${entry}`)
  } catch {
    /* ignore */
  }
  const sorted = files.slice().sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
  return { dir: rel(distDir), newestModifiedAt: sorted[0]?.modifiedAt ?? null, files: sorted }
}

/** Fetch each JS/CSS resource the page actually loaded and hash the served bytes. */
async function collectLoadedAssets(page) {
  const names = await page.eval(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => /\.(js|css)(\?|$)/.test(name)))
  const unique = [...new Set(names)].sort()
  const assets = []
  for (const name of unique) {
    try {
      const parsed = new URL(name)
      const target = `${BASE}${parsed.pathname}${parsed.search}`
      const response = await fetch(target, { signal: AbortSignal.timeout(8000) })
      const buffer = Buffer.from(await response.arrayBuffer())
      assets.push({
        url: parsed.pathname + parsed.search,
        status: response.status,
        bytes: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      })
    } catch (error) {
      assets.push({ url: name, error: error.message })
    }
  }
  return assets
}

function findPost(state, key) {
  return (state?.posts ?? []).find((post) => post.id === key || post.title === key)
}

function lastEvent(post) {
  const events = post?.orderEvents ?? []
  return events[events.length - 1]
}

function orderEventsOf(post) {
  return (post?.orderEvents ?? []).map((event) => ({ type: event.type, actor: event.actor, note: event.note }))
}

function summarizeStorage(label, envelope, filePath) {
  const state = envelope?.state ?? {}
  return {
    label,
    file: rel(filePath),
    savedAt: envelope?.savedAt ?? null,
    posts: (state.posts ?? []).map((post) => ({
      id: post.id,
      mode: post.mode,
      title: post.title,
      moderation: post.moderation ?? 'pending',
      orderStatus: post.orderStatus ?? null,
      acceptedByMe: post.acceptedByMe ?? null,
      authorId: post.author?.id ?? null,
      orderEvents: orderEventsOf(post),
      signedUpByMe: post.signedUpByMe ?? null,
      eventSignupCount: post.eventSignupCount ?? null,
      volunteerKind: post.volunteerKind ?? null,
    })),
    ledgerEntries: (state.ledgerEntries ?? []).map((entry) => ({ id: entry.id, title: entry.title, minutes: entry.minutes, status: entry.status, note: entry.note })),
    systemNoticeCount: (state.threads ?? [])
      .filter((thread) => thread.kind === 'system')
      .reduce((sum, thread) => sum + thread.messages.length, 0),
    auditLog: (state.auditLog ?? []).map((entry) => ({ action: entry.action, targetId: entry.targetId, decision: entry.decision ?? null, reason: entry.reason })),
  }
}

async function writeRecord() {
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, `${RECORD_BASE}.json`), `${JSON.stringify(run, null, 2)}\n`, 'utf8')
  await writeFile(join(OUT_DIR, `${RECORD_BASE}.md`), renderRecordMarkdown(run), 'utf8')
}

function renderRecordMarkdown(record) {
  const lines = []
  lines.push('# B 履约闭环 · 验收实测运行记录（自动生成）')
  lines.push('')
  lines.push(`- 运行脚本：\`${record.script}\`（suite：${record.suite}）`)
  lines.push(`- 运行时间：${localTime(record.startedAt)} → ${localTime(record.finishedAt)}`)
  lines.push(`- 站点地址：${record.base}；静态 dist 预览命令：\`${record.commands.preview}\``)
  lines.push(`- 实测命令：\`${record.commands.check}\`；Node：${record.node}；平台：${record.platform}`)
  if (record.dist) lines.push(`- dist 最新构建时间：${localTime(record.dist.newestModifiedAt)}（${record.dist.newestModifiedAt ?? '—'}）`)
  if (record.site) lines.push(`- 入口：${record.site.entryUrl}（HTTP ${record.site.status}）；dist 资源：${record.site.assets.join('、')}`)
  if (record.browser) lines.push(`- 浏览器：${record.browser.name} ${record.browser.version}（headless，CDP 端口 ${record.browser.port}）`)
  lines.push('')
  if (record.assets && (record.assets.community.length || record.assets.aplus.length)) {
    lines.push('## 实测资源哈希（页面实际加载的 JS/CSS，按服务端字节计算 SHA-256）')
    lines.push('')
    lines.push('| 页面 | 资源 | 字节 | SHA-256 |')
    lines.push('| --- | --- | --- | --- |')
    for (const [pageName, assets] of [['社区页 community.html', record.assets.community], ['A+ 页 /', record.assets.aplus]]) {
      for (const asset of assets) {
        lines.push(`| ${pageName} | ${asset.url} | ${asset.bytes ?? '—'} | \`${asset.sha256 ?? asset.error ?? '—'}\` |`)
      }
    }
    lines.push('')
  }
  lines.push('## 步骤结果')
  lines.push('')
  lines.push('| # | 步骤 | 操作 | 期望 | 实际 | 结果 | 证据 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  const escape = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  for (const step of record.steps) {
    lines.push(`| ${step.id} | ${escape(step.title)} | ${escape(step.action)} | ${escape(step.expected)} | ${escape(step.actual || step.error)} | ${step.ok ? '✅ 通过' : '❌ 失败'} | ${step.evidence.map((item) => item.screenshot).join('<br/>') || '—'} |`)
  }
  lines.push('')
  lines.push(`**结果：${record.steps.filter((step) => step.ok).length}/${record.steps.length} 步通过${record.ok ? '，整体通过' : '，整体失败'}。**`)
  lines.push('')
  if (record.storeCalls) {
    lines.push('## 数据层共享函数调用（Pinia store，Runtime.evaluate）')
    lines.push('')
    lines.push('```json')
    lines.push(JSON.stringify(record.storeCalls, null, 2))
    lines.push('```')
    lines.push('')
  }
  if (record.observations && Object.keys(record.observations).length) {
    lines.push('## 关键观察')
    lines.push('')
    for (const [key, value] of Object.entries(record.observations)) {
      lines.push(`- **${key}**：${value}`)
    }
    lines.push('')
  }
  if (record.storageSnapshots.length) {
    lines.push('## localStorage 快照（摘录）')
    lines.push('')
    for (const snapshot of record.storageSnapshots) {
      lines.push(`### ${snapshot.label}`)
      lines.push('')
      lines.push(`- 文件：${snapshot.file}；savedAt：${snapshot.savedAt ?? 'null'}；系统通知：${snapshot.systemNoticeCount} 条；账本：${snapshot.ledgerEntries.length} 条`)
      for (const post of snapshot.posts.filter((item) => item.mode === 'help')) {
        lines.push(`  - \`${post.id}\` 「${post.title}」 moderation=${post.moderation} orderStatus=${post.orderStatus ?? '—'} event=${JSON.stringify(post.orderEvents.map((event) => `${event.type}/${event.actor}`))}`)
      }
      lines.push('')
    }
  }
  if (record.pageErrors.length || record.consoleErrors.length) {
    lines.push('## 页面错误/告警')
    lines.push('')
    for (const error of record.pageErrors) lines.push(`- 页面异常：${error}`)
    for (const error of record.consoleErrors) lines.push(`- 控制台：${error}`)
    lines.push('')
  }
  if (record.notes.length) {
    lines.push('## 备注')
    lines.push('')
    for (const note of record.notes) lines.push(`- ${note}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  run.site = await collectSiteInfo()
  run.dist = await collectDistInfo()
  assert(run.site.status === 200, `community.html should answer HTTP 200 (got ${run.site.status}) — is the preview server running on ${BASE}?`)
  console.log(`[acceptance] site: ${BASE}`)
  console.log(`[acceptance] dist assets: ${run.site.assets.join(', ')} (built ${run.dist.newestModifiedAt})`)

  const page = await BrowserSession.launch({ browserPath: BROWSER_PATH, headless: true })
  run.browser = {
    name: page.browser.name,
    version: page.browserVersion?.Browser ?? 'unknown',
    port: page.port,
    protocolVersion: page.browserVersion?.['Protocol-Version'] ?? '',
    userAgent: page.browserVersion?.['User-Agent'] ?? '',
  }
  console.log(`[acceptance] browser: ${run.browser.name} ${run.browser.version} on CDP port ${page.port}`)

  const capture = async (step, name) => {
    const png = join(OUT_DIR, `${PREFIX}${name}.png`)
    const txt = join(OUT_DIR, `${PREFIX}${name}.txt`)
    await page.screenshot(png)
    await page.savePageText(txt)
    step.evidence.push({ screenshot: rel(png), pageText: rel(txt) })
  }

  const step = async (id, title, action, expected, fn) => {
    const entry = { id, title, action, expected, actual: '', ok: false, error: null, startedAt: localTime(new Date().toISOString()), durationMs: 0, evidence: [] }
    run.steps.push(entry)
    const startedAt = Date.now()
    console.log(`\n[acceptance] ${id}: ${title}`)
    try {
      const actual = await fn({ capture: (name) => capture(entry, name) })
      entry.actual = typeof actual === 'string' ? actual : actual?.actual ?? '完成'
      entry.ok = true
      console.log(`  -> ok: ${entry.actual}`)
      return actual
    } catch (error) {
      entry.error = error?.message ?? String(error)
      entry.actual = `失败：${entry.error}`
      try {
        await capture(entry, `acc-${id.toLowerCase()}-failure`)
      } catch {
        /* best effort */
      }
      console.error(`  -> FAILED: ${entry.error}`)
      throw error
    } finally {
      entry.durationMs = Date.now() - startedAt
      run.pageErrors = page.pageErrors.slice()
      run.consoleErrors = page.consoleErrors.slice()
      await writeRecord()
    }
  }

  // ---------- scenario helpers ----------
  const snapshotStorage = async (label, fileName) => {
    const envelope = await page.readLocalStorageJson(STORAGE_KEY)
    const filePath = join(OUT_DIR, `${PREFIX}${fileName}`)
    await writeFile(filePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
    const summary = summarizeStorage(label, envelope, filePath)
    run.storageSnapshots.push(summary)
    return { envelope, summary }
  }

  const waitStorage = async (predicate, label, timeoutMs = 12000) => {
    const startedAt = Date.now()
    let last = null
    while (Date.now() - startedAt < timeoutMs) {
      last = await page.readLocalStorageJson(STORAGE_KEY)
      try {
        if (last && predicate(last.state)) return last
      } catch {
        /* keep polling */
      }
      await sleep(120)
    }
    throw new Error(`waitStorage timeout (${label}); last help posts: ${JSON.stringify((last?.state?.posts ?? []).filter((post) => post.mode === 'help').map((post) => [post.title, post.orderStatus]))}`)
  }

  const cardSnapshot = (title) => page.eval((cardTitle) => {
    const norm = (value) => (value || '').replace(/\s+/g, ' ').trim()
    const card = Array.from(document.querySelectorAll('article.post-card'))
      .find((item) => norm(item.innerText).includes(cardTitle))
    if (!card) return { found: false }
    return {
      found: true,
      pill: norm(card.querySelector('.order-status-pill')?.innerText),
      roleHint: norm(card.querySelector('.order-role-hint')?.innerText),
      timeline: Array.from(card.querySelectorAll('.order-timeline li')).map((li) => norm(li.innerText)),
      buttons: Array.from(card.querySelectorAll('button')).map((button) => ({ text: norm(button.innerText), disabled: button.disabled })),
      formOpen: !!card.querySelector('.order-action-form'),
      inactiveNote: norm(card.querySelector('.order-inactive-note')?.innerText),
      eventDetail: norm(card.querySelector('.event-detail')?.innerText),
      signupState: norm(card.querySelector('.event-signup-state')?.innerText),
      text: norm(card.innerText),
    }
  }, title)

  const waitCardPill = async (title, expectedPill, timeoutMs = 12000) => {
    const startedAt = Date.now()
    let last = null
    while (Date.now() - startedAt < timeoutMs) {
      last = await cardSnapshot(title)
      if (last?.found && last.pill === expectedPill) return last
      await sleep(120)
    }
    throw new Error(`waitCardPill timeout for 「${title}」 expecting ${expectedPill}; last: ${JSON.stringify(last)}`)
  }

  const focusCard = async (title, selector = '') => {
    await page.eval((cardTitle, cardSelector) => {
      const norm = (value) => (value || '').replace(/\s+/g, ' ').trim()
      const card = Array.from(document.querySelectorAll('article.post-card')).find((item) => norm(item.innerText).includes(cardTitle))
      if (!card) return false
      const target = cardSelector ? card.querySelector(cardSelector) : null
      ;(target || card).scrollIntoView({ block: 'center', inline: 'nearest' })
      return true
    }, title, selector)
    await sleep(180)
  }

  const clickCardButton = async (title, label) => {
    await page.clickByText([label], { selector: 'button', withinSelector: 'article.post-card', withinText: title, exact: true })
  }

  const fillCardField = async (title, fieldSelector, value) => {
    const result = await page.eval((cardTitle, selector, nextValue) => {
      const norm = (input) => (input || '').replace(/\s+/g, ' ').trim()
      const card = Array.from(document.querySelectorAll('article.post-card')).find((item) => norm(item.innerText).includes(cardTitle))
      if (!card) return { ok: false, reason: 'card-missing' }
      const node = card.querySelector(selector)
      if (!node) return { ok: false, reason: 'field-missing' }
      const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(node, nextValue)
      else node.value = nextValue
      node.dispatchEvent(new Event('input', { bubbles: true }))
      node.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, value: node.value }
    }, title, fieldSelector, value)
    if (!result?.ok) throw new Error(`fillCardField(${title}, ${fieldSelector}) failed: ${JSON.stringify(result)}`)
  }

  const publishHelp = async (title, content, timeWindow, duration) => {
    await page.clickNav('发布')
    await page.waitForText(['发布一件小事。', '提交审核'], { timeoutMs: 15000 })
    await page.fillByLabel('标题', title)
    await page.fillByLabel('需求说明', content)
    await page.fillByLabel('希望时段', timeWindow)
    await page.fillByLabel('预计时长', duration)
    await page.checkSelector('.confirm-synthetic input')
    await page.waitForExpression("!document.querySelector('.submit-button').disabled", { timeoutMs: 5000 })
    await page.clickSelector('.submit-button')
    await page.waitForText(['我的发布', title], { timeoutMs: 15000 })
  }

  const approvePost = async (title, reason) => {
    await page.setMembership('reviewer')
    await page.waitForText(['审核员工作入口'], { timeoutMs: 10000 })
    await page.clickNav('审核')
    await page.waitForText(['内容与举报审核', title], { timeoutMs: 15000 })
    await page.setValue('.moderation-reason textarea', reason)
    await page.clickByText(['通过'], { selector: 'button', withinSelector: 'article.feedback-card', withinText: title })
    await page.waitForText(['暂无待审发布。'], { timeoutMs: 15000 })
  }

  const backToCommunity = async () => {
    await page.setMembership('member')
    await page.clickNav('社区')
    await page.waitForText(['把日常分享出来'], { timeoutMs: 15000 })
  }

  const openProfileTab = async (label) => {
    await page.clickNav('我的')
    await page.waitForText(['演练居民·禾禾'], { timeoutMs: 15000 })
    await page.clickByText([label], { selector: '.profile-tabs button', exact: false })
    await sleep(200)
  }

  const serviceRecordRows = () => page.eval(() =>
    Array.from(document.querySelectorAll('.service-record-row')).map((row) => (row.innerText || '').replace(/\s+/g, ' ').trim()),
  )

  const ledgerRows = () => page.eval(() =>
    Array.from(document.querySelectorAll('.ledger-entry')).map((row) => (row.innerText || '').replace(/\s+/g, ' ').trim()),
  )

  const notificationTexts = () => page.eval(() =>
    Array.from(document.querySelectorAll('.messages-page .system-notice')).map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()),
  )

  const threadItems = () => page.eval(() =>
    Array.from(document.querySelectorAll('.messages-page .thread-list .thread-item')).map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()),
  )

  try {
    // ---------- setup ----------
    await step('S1', '加载并重置到初始虚构示例', 'navigate /community.html → localStorage.clear() → reload → 切换演练成员', '页面正常挂载，身份=member，初始 4 条动态', async ({ capture: cap }) => {
      await page.navigate(`${BASE}/community.html`)
      await page.waitForSelector('.community-app', { timeoutMs: 20000 })
      await page.clearLocalStorage()
      await page.reload()
      await page.waitForSelector('.community-app', { timeoutMs: 20000 })
      await page.setMembership('member')
      await page.waitForText(['你好，演练居民'], { timeoutMs: 15000 })
      const storage = await page.readLocalStorageJson(STORAGE_KEY)
      assert(storage === null, 'localStorage should be empty before any action')
      run.assets.community = await collectLoadedAssets(page)
      assert(run.assets.community.some((asset) => /community-.*\.js$/.test(asset.url)), `community JS asset should be loaded (got ${JSON.stringify(run.assets.community.map((asset) => asset.url))})`)
      await cap('acc-s1-setup')
      return `应用挂载；localStorage 已清空；身份=member；初始 4 条虚构动态；实际加载资源：${run.assets.community.map((asset) => asset.url).join('、')}`
    })

    // ---------- Path A: someone else's help (fixture SYNTH-POST-001) ----------
    await step('A1', '他人求助：演练接单', `社区页定位「${T_FIXTURE}」→ 点“演练接单”`, '状态胶囊变为“已接单（本机演练）”，时间线出现“标记接单/本机参与者”', async ({ capture: cap }) => {
      await page.clickNav('社区')
      await page.waitForText(['把日常分享出来', T_FIXTURE], { timeoutMs: 15000 })
      const before = await cardSnapshot(T_FIXTURE)
      assert(before.found, 'fixture card should exist')
      assert(before.pill === '待接单（本机演练）', `fixture should start as 待接单 (got ${before.pill})`)
      assert(before.buttons.some((button) => button.text === '演练接单'), '演练接单 button should be present')
      await clickCardButton(T_FIXTURE, '演练接单')
      const after = await waitCardPill(T_FIXTURE, '已接单（本机演练）')
      const envelope = await waitStorage((state) => findPost(state, FIXTURE_ID)?.orderStatus === 'accepted-local-demo', 'accept fixture')
      const post = findPost(envelope.state, FIXTURE_ID)
      const events = orderEventsOf(post)
      assert(events.length === 1 && events[0].type === 'accept' && events[0].actor === 'demo-side', `expected one accept/demo-side event, got ${JSON.stringify(events)}`)
      await page.scrollToText(T_FIXTURE)
      await focusCard(T_FIXTURE, '.order-block')
      await cap('acc-a1-order-accepted')
      return `已接单：pill=「${after.pill}」；时间线=${JSON.stringify(after.timeline)}；orderEvents=${JSON.stringify(events)}`
    })

    await step('A2', '他人求助：发起完成申请', '点“发起完成申请”→ 在表单填写本机说明 → 点“发起本机申请”', '状态变为“待确认完成（本机演练）”，时间线新增“发起完成申请/本机参与者”', async ({ capture: cap }) => {
      await clickCardButton(T_FIXTURE, '发起完成申请')
      await focusCard(T_FIXTURE, '.order-action-form')
      await fillCardField(T_FIXTURE, '.order-action-form textarea', REASON_A_WORK)
      await clickCardButton(T_FIXTURE, '发起本机申请')
      const after = await waitCardPill(T_FIXTURE, '待确认完成（本机演练）')
      const envelope = await waitStorage((state) => findPost(state, FIXTURE_ID)?.orderStatus === 'completion-requested', 'request completion')
      const post = findPost(envelope.state, FIXTURE_ID)
      const events = orderEventsOf(post)
      assert(events.at(-1).type === 'request-completion' && events.at(-1).actor === 'demo-side', `last event should be request-completion/demo-side, got ${JSON.stringify(events)}`)
      assert(events.at(-1).note.includes(REASON_A_WORK), 'order event note should contain the local explanation')
      await focusCard(T_FIXTURE, '.order-block')
      await cap('acc-a2-completion-requested')
      return `待确认完成：pill=「${after.pill}」；时间线=${JSON.stringify(after.timeline)}`
    })

    await step('A3', '他人求助：代合成求助方确认完成', '在已接单卡片点“代合成求助方确认完成（演练）”', '状态“已完成（本机演练，未结算）”；时间线“确认完成/合成对方（代记录）”；账本新增未结算记录；系统通知新增确认通知', async ({ capture: cap }) => {
      const before = await cardSnapshot(T_FIXTURE)
      assert(before.buttons.some((button) => button.text === '代合成求助方确认完成（演练）'), 'counterpart confirm button should be present')
      await clickCardButton(T_FIXTURE, '代合成求助方确认完成（演练）')
      const after = await waitCardPill(T_FIXTURE, '已完成（本机演练，未结算）')
      const envelope = await waitStorage((state) => {
        const post = findPost(state, FIXTURE_ID)
        const ledger = (state.ledgerEntries ?? []).find((entry) => entry.title === `演练完成：${T_FIXTURE}`)
        return post?.orderStatus === 'completed-local-demo' && !!ledger
      }, 'counterpart confirm fixture')
      const post = findPost(envelope.state, FIXTURE_ID)
      const ledger = envelope.state.ledgerEntries.find((entry) => entry.title === `演练完成：${T_FIXTURE}`)
      const notice = envelope.state.threads
        .filter((thread) => thread.kind === 'system')
        .flatMap((thread) => thread.messages)
        .find((message) => message.content.includes(`你申请完成的订单《${T_FIXTURE}》已被合成求助方确认`))
      assert(ledger.status === 'unsettled', `ledger entry should be unsettled (got ${ledger.status})`)
      assert(ledger.minutes === 60, `ledger minutes should be estimated as 60 from “约 1 小时” (got ${ledger.minutes})`)
      assert(notice, 'system notification for counterpart completion should exist')
      run.observations['Path A 完成事件'] = JSON.stringify(orderEventsOf(post))
      run.observations['Path A 账本'] = JSON.stringify({ title: ledger.title, minutes: ledger.minutes, status: ledger.status, note: ledger.note })
      run.observations['Path A 系统通知'] = notice.content
      await snapshotStorage('Path A 完成后', 'acc-local-storage-after-a.json')
      await focusCard(T_FIXTURE, '.order-block')
      await cap('acc-a3-completed')
      return `已完成：pill=「${after.pill}」；账本「${ledger.title}」${ledger.minutes} 分钟/${ledger.status}；通知已生成`
    })

    await step('A4', 'Path A：我的→服务记录显示已完成', '点击导航“我的”→ 切换“服务记录”', '服务记录行显示“我接单 · 已完成（本机演练，未结算）”并列出履约事件', async ({ capture: cap }) => {
      await openProfileTab('服务记录')
      const rows = await serviceRecordRows()
      const row = rows.find((text) => text.includes(T_FIXTURE))
      assert(row, `service record should contain fixture order (rows: ${JSON.stringify(rows)})`)
      assert(row.includes('已完成（本机演练，未结算）'), `record status should be 已完成 (row: ${row})`)
      assert(row.includes('我接单'), 'record should be marked 我接单')
      assert(row.includes('发起完成申请') && row.includes('确认完成'), 'record should list fulfillment events')
      await page.scrollToText(T_FIXTURE)
      await cap('acc-a4-profile-service-record')
      return `服务记录行：${row}`
    })

    await step('A5', 'Path A：我的→时间账本新增未结算记录', '切换“时间账本”页签', '出现“演练完成：<标题>”未结算记录', async ({ capture: cap }) => {
      await page.clickByText(['时间账本'], { selector: '.profile-tabs button', exact: false })
      await sleep(200)
      const rows = await ledgerRows()
      const row = rows.find((text) => text.includes(`演练完成：${T_FIXTURE}`))
      assert(row, `ledger should contain completion entry (rows: ${JSON.stringify(rows)})`)
      assert(row.includes('未核验'), `ledger row should show the 未核验 badge (row: ${row})`)
      assert(row.includes('不可结算') || row.includes('未结算'), `ledger row should state it is unsettled (row: ${row})`)
      await page.scrollToText(`演练完成：${T_FIXTURE}`)
      await cap('acc-a5-ledger')
      return `账本行：${row}`
    })

    await step('A6', 'Path A：消息页系统通知与已完成订单只读', '导航“消息”→ 查看系统通知 → 点开已完成订单线程', '系统通知含完成确认文案；订单列表含已完成；留言区只读', async ({ capture: cap }) => {
      await page.clickNav('消息')
      await page.waitForText(['系统通知（合成示例）'], { timeoutMs: 15000 })
      const notices = await notificationTexts()
      const completionNotice = notices.find((text) => text.includes(`你申请完成的订单《${T_FIXTURE}》已被合成求助方确认`))
      assert(completionNotice, `system notification should list completion notice (notices: ${JSON.stringify(notices)})`)
      const threads = await threadItems()
      assert(threads.some((text) => text.includes(T_FIXTURE) && text.includes('已完成（本机演练，未结算）')), `order list should include completed order (items: ${JSON.stringify(threads)})`)
      await page.clickByText([T_FIXTURE], { selector: '.messages-page .thread-list .thread-item', exact: false })
      await page.waitForSelector('.messages-page .chat-readonly-note', { timeoutMs: 10000 })
      const readOnly = await page.eval(() => document.querySelector('.messages-page .chat-readonly-note')?.innerText ?? '')
      assert(readOnly.includes('该订单已完成（本机演练），订单留言只读'), `completed order should be read-only (got ${readOnly})`)
      run.observations['订单列表（A 完成后）'] = JSON.stringify(threads)
      await cap('acc-a6-messages-completed')
      return `系统通知 ${notices.length} 条，含完成确认；订单列表含“已完成”；留言区只读：${readOnly}`
    })

    // ---------- Path C: cancel an order ----------
    let postCId = ''
    await step('C1', 'Path C：发布本人求助（待审）', `发布求助「${T_C}」→ 确认合成数据勾选 → 提交`, '进入“我的发布”待审核状态；localStorage moderation=pending、orderStatus=open', async ({ capture: cap }) => {
      await publishHelp(T_C, CONTENT_C, WINDOW_C, DURATION_20)
      const envelope = await waitStorage((state) => !!findPost(state, T_C), 'publish C')
      const post = findPost(envelope.state, T_C)
      postCId = post.id
      assert(post.moderation === 'pending' && post.orderStatus === 'open', `new post should be pending/open (got ${post.moderation}/${post.orderStatus})`)
      await cap('acc-c1-published-pending')
      return `新帖 ${post.id}：moderation=pending、orderStatus=open`
    })

    await step('C2', 'Path C：审核通过（并检查审核结果系统通知）', '切审核员 → 审核理由 → 通过', 'localStorage moderation=approved、reviewNote=理由；系统通知出现“你的发布《T_C》审核通过”', async ({ capture: cap }) => {
      await approvePost(T_C, REVIEW_REASON_C)
      const envelope = await waitStorage((state) => {
        const post = findPost(state, T_C)
        const notice = (state.threads ?? []).filter((thread) => thread.kind === 'system').flatMap((thread) => thread.messages)
          .some((message) => message.content.includes(`你的发布《${T_C}》审核通过`))
        return post?.moderation === 'approved' && notice
      }, 'approve C + notice')
      const post = findPost(envelope.state, T_C)
      assert(post.reviewNote === REVIEW_REASON_C, `reviewNote should equal reason (got ${post.reviewNote})`)
      await page.scrollToText('暂无待审发布。')
      await cap('acc-c2-approved')
      return `审核通过；reviewNote 一致；系统通知已生成（发布审核结果通知）`
    })

    await step('C3', 'Path C：本人求助由合成邻居代接单', '回成员身份 → 社区 → 点卡片“代合成邻居接单（演练）”', '状态“已接单（本机演练）”；时间线“标记接单/合成对方（代记录）”；系统通知新增“已被合成邻居标记接单”', async ({ capture: cap }) => {
      await backToCommunity()
      const card = await waitCardPill(T_C, '待接单（本机演练）')
      assert(card.roleHint.includes('求助发布者'), `author role hint expected (got ${card.roleHint})`)
      await clickCardButton(T_C, '代合成邻居接单（演练）')
      const after = await waitCardPill(T_C, '已接单（本机演练）')
      const envelope = await waitStorage((state) => {
        const post = findPost(state, T_C)
        const notice = (state.threads ?? []).filter((thread) => thread.kind === 'system').flatMap((thread) => thread.messages)
          .some((message) => message.content.includes(`你的求助《${T_C}》在本地演练中已被合成邻居标记接单`))
        return post?.orderStatus === 'accepted-local-demo' && notice
      }, 'counterpart accept C')
      const post = findPost(envelope.state, T_C)
      assert(lastEvent(post).type === 'accept' && lastEvent(post).actor === 'synthetic-counterpart', `last event should be accept/synthetic-counterpart (got ${JSON.stringify(orderEventsOf(post))})`)
      run.observations['Path C 代接单事件'] = JSON.stringify(orderEventsOf(post))
      await focusCard(T_C, '.order-block')
      await cap('acc-c3-counterpart-accepted')
      return `已接单（合成对方代记录）：pill=「${after.pill}」；时间线=${JSON.stringify(after.timeline)}`
    })

    await step('C4', 'Path C：消息页订单列表同时出现“已完成/已接单”', '导航“消息”', '订单列表包含已完成订单（Path A）与已接单订单（Path C）', async ({ capture: cap }) => {
      await page.clickNav('消息')
      await page.waitForText([T_FIXTURE, T_C], { timeoutMs: 15000 })
      const threads = await threadItems()
      assert(threads.some((text) => text.includes(T_FIXTURE) && text.includes('已完成（本机演练，未结算）')), `completed order should be listed (${JSON.stringify(threads)})`)
      assert(threads.some((text) => text.includes(T_C) && text.includes('已接单（本机演练）')), `accepted order should be listed (${JSON.stringify(threads)})`)
      await cap('acc-c4-messages-statuses')
      return `订单列表：${JSON.stringify(threads)}`
    })

    await step('C5', 'Path C：取消/关闭订单（必填原因）', '社区该卡片点“取消/关闭订单（演练）”→ 填原因 → 提交本机记录', '状态“已取消/关闭（本机演练）”；时间线“取消/关闭订单”含原因；无进行中动作按钮', async ({ capture: cap }) => {
      await backToCommunity()
      await waitCardPill(T_C, '已接单（本机演练）')
      await clickCardButton(T_C, '取消/关闭订单（演练）')
      await focusCard(T_C, '.order-action-form')
      const emptyDisabled = await page.eval((cardTitle) => {
        const norm = (value) => (value || '').replace(/\s+/g, ' ').trim()
        const card = Array.from(document.querySelectorAll('article.post-card')).find((item) => norm(item.innerText).includes(cardTitle))
        const submit = Array.from(card?.querySelectorAll('.order-action-form button') ?? []).find((button) => norm(button.innerText) === '提交本机记录')
        return submit ? submit.disabled : null
      }, T_C)
      assert(emptyDisabled === true, 'cancel reason is required: submit should be disabled while empty')
      await fillCardField(T_C, '.order-action-form textarea', REASON_CANCEL_C)
      await clickCardButton(T_C, '提交本机记录')
      const after = await waitCardPill(T_C, '已取消/关闭（本机演练）')
      const envelope = await waitStorage((state) => findPost(state, T_C)?.orderStatus === 'cancelled-local-demo', 'cancel C')
      const post = findPost(envelope.state, T_C)
      const events = orderEventsOf(post)
      assert(events.at(-1).type === 'cancel' && events.at(-1).note.includes(REASON_CANCEL_C), `last event should be cancel with reason (got ${JSON.stringify(events)})`)
      run.observations['Path C 取消事件'] = JSON.stringify(events)
      await snapshotStorage('Path C 取消后', 'acc-local-storage-after-c.json')
      await focusCard(T_C, '.order-block')
      await cap('acc-c5-cancelled')
      return `已取消/关闭：pill=「${after.pill}」；时间线=${JSON.stringify(after.timeline)}；空原因时提交按钮 disabled=${emptyDisabled}`
    })

    // ---------- Path D: dispute lifecycle ----------
    await step('D1', 'Path D：发布并审核通过争议演示求助', `发布「${T_D}」→ 审核通过`, 'moderation=approved、orderStatus=open；审核结果通知生成', async ({ capture: cap }) => {
      await publishHelp(T_D, CONTENT_D, WINDOW_D, DURATION_30)
      await approvePost(T_D, REVIEW_REASON_D)
      const envelope = await waitStorage((state) => findPost(state, T_D)?.moderation === 'approved', 'approve D')
      const post = findPost(envelope.state, T_D)
      assert(post.orderStatus === 'open', `orderStatus should be open (got ${post.orderStatus})`)
      await backToCommunity()
      await page.waitForText([T_D], { timeoutMs: 15000 })
      await focusCard(T_D, '.order-block')
      await cap('acc-d1-approved')
      return `${post.id} 审核通过，orderStatus=open`
    })

    await step('D2', 'Path D：代合成邻居接单', '卡片点“代合成邻居接单（演练）”', '状态“已接单（本机演练）”，时间线“标记接单/合成对方（代记录）”', async ({ capture: cap }) => {
      await waitCardPill(T_D, '待接单（本机演练）')
      await clickCardButton(T_D, '代合成邻居接单（演练）')
      const after = await waitCardPill(T_D, '已接单（本机演练）')
      await focusCard(T_D, '.order-block')
      await cap('acc-d2-accepted')
      return `pill=「${after.pill}」；时间线=${JSON.stringify(after.timeline)}`
    })

    await step('D3', 'Path D：发起争议（必填原因）', '点“发起争议（演练）”→ 填原因 → 提交本机记录', '状态“争议处理中（本机演练）”；时间线“发起争议”含原因', async ({ capture: cap }) => {
      await clickCardButton(T_D, '发起争议（演练）')
      await focusCard(T_D, '.order-action-form')
      await fillCardField(T_D, '.order-action-form textarea', REASON_DISPUTE_1)
      await clickCardButton(T_D, '提交本机记录')
      const after = await waitCardPill(T_D, '争议处理中（本机演练）')
      const envelope = await waitStorage((state) => findPost(state, T_D)?.orderStatus === 'disputed-local-demo', 'dispute D')
      const events = orderEventsOf(findPost(envelope.state, T_D))
      assert(events.at(-1).type === 'dispute' && events.at(-1).note.includes(REASON_DISPUTE_1), `last event should be dispute with reason (got ${JSON.stringify(events)})`)
      run.observations['Path D 争议事件'] = JSON.stringify(events)
      await focusCard(T_D, '.order-block')
      await cap('acc-d3-disputed')
      return `pill=「${after.pill}」；时间线=${JSON.stringify(after.timeline)}`
    })

    await step('D4', 'Path D：消息页出现“争议处理中”订单', '导航“消息”', '订单列表包含争议处理中的订单', async ({ capture: cap }) => {
      await page.clickNav('消息')
      await page.waitForText([T_D], { timeoutMs: 15000 })
      const threads = await threadItems()
      assert(threads.some((text) => text.includes(T_D) && text.includes('争议处理中（本机演练）')), `disputed order should be listed (${JSON.stringify(threads)})`)
      await cap('acc-d4-messages-disputed')
      return `订单列表：${JSON.stringify(threads)}`
    })

    await step('D5', 'Path D：撤销争议继续履约', '点“撤销争议继续履约（演练）”→ 填说明 → 提交本机记录', '状态回到“已接单（本机演练）”；时间线“撤销争议并继续履约”', async ({ capture: cap }) => {
      await backToCommunity()
      await waitCardPill(T_D, '争议处理中（本机演练）')
      const before = await cardSnapshot(T_D)
      assert(before.buttons.some((button) => button.text === '撤销争议继续履约（演练）'), 'resume-dispute button should be present')
      await clickCardButton(T_D, '撤销争议继续履约（演练）')
      await focusCard(T_D, '.order-action-form')
      await fillCardField(T_D, '.order-action-form textarea', REASON_DISPUTE_RESUME)
      await clickCardButton(T_D, '提交本机记录')
      const after = await waitCardPill(T_D, '已接单（本机演练）')
      const envelope = await waitStorage((state) => findPost(state, T_D)?.orderStatus === 'accepted-local-demo', 'resume dispute')
      const events = orderEventsOf(findPost(envelope.state, T_D))
      assert(events.at(-1).type === 'resume-after-dispute' && events.at(-1).note.includes(REASON_DISPUTE_RESUME), `last event should be resume-after-dispute (got ${JSON.stringify(events)})`)
      await focusCard(T_D, '.order-block')
      await cap('acc-d5-resumed')
      return `pill=「${after.pill}」；时间线=${JSON.stringify(after.timeline)}`
    })

    await step('D6', 'Path D：再次争议 → 因争议关闭订单', '再次“发起争议（演练）”→ 填原因 → “因争议关闭订单（演练）”→ 填说明 → 提交', '状态“已取消/关闭（本机演练）”；时间线含“发起争议”“因争议关闭订单”', async ({ capture: cap }) => {
      await clickCardButton(T_D, '发起争议（演练）')
      await focusCard(T_D, '.order-action-form')
      await fillCardField(T_D, '.order-action-form textarea', REASON_DISPUTE_2)
      await clickCardButton(T_D, '提交本机记录')
      await waitCardPill(T_D, '争议处理中（本机演练）')
      await clickCardButton(T_D, '因争议关闭订单（演练）')
      await focusCard(T_D, '.order-action-form')
      await fillCardField(T_D, '.order-action-form textarea', REASON_DISPUTE_CLOSE)
      await clickCardButton(T_D, '提交本机记录')
      const after = await waitCardPill(T_D, '已取消/关闭（本机演练）')
      const envelope = await waitStorage((state) => findPost(state, T_D)?.orderStatus === 'cancelled-local-demo', 'close after dispute')
      const events = orderEventsOf(findPost(envelope.state, T_D))
      assert(events.at(-1).type === 'close-after-dispute' && events.at(-1).note.includes(REASON_DISPUTE_CLOSE), `last event should be close-after-dispute (got ${JSON.stringify(events)})`)
      run.observations['Path D 最终事件'] = JSON.stringify(events)
      await snapshotStorage('Path D 争议关闭后', 'acc-local-storage-after-d.json')
      await focusCard(T_D, '.order-block')
      await cap('acc-d6-closed-after-dispute')
      return `已取消/关闭：pill=「${after.pill}」；时间线=${JSON.stringify(after.timeline)}`
    })

    // ---------- Path B: own help post completion flow ----------
    let postBId = ''
    await step('B1', 'Path B：发布本人求助并审核通过', `发布「${T_B}」→ 切审核员通过`, 'moderation=approved、orderStatus=open；系统通知含“你的发布《T_B》审核通过”', async ({ capture: cap }) => {
      await publishHelp(T_B, CONTENT_B, WINDOW_B, DURATION_60)
      const pending = await waitStorage((state) => !!findPost(state, T_B), 'publish B')
      postBId = findPost(pending.state, T_B).id
      await approvePost(T_B, REVIEW_REASON_B)
      const envelope = await waitStorage((state) => {
        const post = findPost(state, T_B)
        const notice = (state.threads ?? []).filter((thread) => thread.kind === 'system').flatMap((thread) => thread.messages)
          .some((message) => message.content.includes(`你的发布《${T_B}》审核通过`))
        return post?.moderation === 'approved' && notice
      }, 'approve B + notice')
      const post = findPost(envelope.state, T_B)
      assert(post.orderStatus === 'open', `orderStatus should be open (got ${post.orderStatus})`)
      await backToCommunity()
      await page.waitForText([T_B], { timeoutMs: 15000 })
      await focusCard(T_B, '.order-block')
      await cap('acc-b1-approved')
      return `${postBId} 审核通过；系统通知已生成`
    })

    await step('B2', 'Path B：代合成邻居接单', '卡片点“代合成邻居接单（演练）”', '状态“已接单（本机演练）”；时间线“标记接单/合成对方（代记录）”', async ({ capture: cap }) => {
      await waitCardPill(T_B, '待接单（本机演练）')
      await clickCardButton(T_B, '代合成邻居接单（演练）')
      const after = await waitCardPill(T_B, '已接单（本机演练）')
      await focusCard(T_B, '.order-block')
      await cap('acc-b2-accepted')
      return `pill=「${after.pill}」；时间线=${JSON.stringify(after.timeline)}`
    })

    await step('B3', 'Path B：代合成接单方申请完成', '卡片点“代合成接单方申请完成（演练）”', '状态“待确认完成（本机演练）”；时间线“发起完成申请/合成对方（代记录）”；系统通知提示核对后确认', async ({ capture: cap }) => {
      const before = await cardSnapshot(T_B)
      assert(before.buttons.some((button) => button.text === '代合成接单方申请完成（演练）'), 'counterpart request button should be present')
      await clickCardButton(T_B, '代合成接单方申请完成（演练）')
      const after = await waitCardPill(T_B, '待确认完成（本机演练）')
      const envelope = await waitStorage((state) => {
        const post = findPost(state, T_B)
        const notice = (state.threads ?? []).filter((thread) => thread.kind === 'system').flatMap((thread) => thread.messages)
          .some((message) => message.content.includes(`你的求助《${T_B}》的合成接单方已发起完成申请`))
        return post?.orderStatus === 'completion-requested' && notice
      }, 'counterpart request B')
      const post = findPost(envelope.state, T_B)
      assert(lastEvent(post).type === 'request-completion' && lastEvent(post).actor === 'synthetic-counterpart', `last event should be request-completion/synthetic-counterpart (got ${JSON.stringify(orderEventsOf(post))})`)
      run.observations['Path B 完成申请事件'] = JSON.stringify(orderEventsOf(post))
      await focusCard(T_B, '.order-block')
      await cap('acc-b3-completion-requested')
      return `pill=「${after.pill}」；时间线=${JSON.stringify(after.timeline)}；系统通知已生成`
    })

    await step('B4', 'Path B：消息页出现“待确认完成”订单', '导航“消息”', '订单列表包含待确认完成的订单', async ({ capture: cap }) => {
      await page.clickNav('消息')
      await page.waitForText([T_B], { timeoutMs: 15000 })
      const threads = await threadItems()
      assert(threads.some((text) => text.includes(T_B) && text.includes('待确认完成（本机演练）')), `completion-requested order should be listed (${JSON.stringify(threads)})`)
      await cap('acc-b4-messages-requested')
      return `订单列表：${JSON.stringify(threads)}`
    })

    await step('B5', 'Path B：本机发布者确认完成', '卡片点“确认完成”', '状态“已完成（本机演练，未结算）”；时间线“确认完成/本机参与者”；账本新增“演练完成：T_B”', async ({ capture: cap }) => {
      await backToCommunity()
      await waitCardPill(T_B, '待确认完成（本机演练）')
      const before = await cardSnapshot(T_B)
      assert(before.buttons.some((button) => button.text === '确认完成'), 'confirm completion button should be present')
      await clickCardButton(T_B, '确认完成')
      const after = await waitCardPill(T_B, '已完成（本机演练，未结算）')
      const envelope = await waitStorage((state) => {
        const post = findPost(state, T_B)
        const ledger = (state.ledgerEntries ?? []).find((entry) => entry.title === `演练完成：${T_B}`)
        return post?.orderStatus === 'completed-local-demo' && !!ledger
      }, 'confirm completion B')
      const post = findPost(envelope.state, T_B)
      const ledger = envelope.state.ledgerEntries.find((entry) => entry.title === `演练完成：${T_B}`)
      assert(lastEvent(post).type === 'confirm-completion' && lastEvent(post).actor === 'demo-side', `last event should be confirm-completion/demo-side (got ${JSON.stringify(orderEventsOf(post))})`)
      assert(ledger.minutes === 60, `ledger minutes should be 60 (got ${ledger.minutes})`)
      run.observations['Path B 完成事件'] = JSON.stringify(orderEventsOf(post))
      run.observations['Path B 账本'] = JSON.stringify({ title: ledger.title, minutes: ledger.minutes, status: ledger.status })
      await snapshotStorage('Path B 完成后', 'acc-local-storage-after-b.json')
      await focusCard(T_B, '.order-block')
      await cap('acc-b5-completed')
      return `pill=「${after.pill}」；时间线=${JSON.stringify(after.timeline)}；账本已新增 60 分钟未结算记录`
    })

    await step('B6', 'Path B：我的→服务记录/时间账本核对', '“我的”页检查服务记录与账本', '双方订单（A 我接单、B 我发布）均显示已完成；账本共 2 条“演练完成”记录', async ({ capture: cap }) => {
      await openProfileTab('服务记录')
      const rows = await serviceRecordRows()
      assert(rows.some((text) => text.includes(T_FIXTURE) && text.includes('我接单') && text.includes('已完成（本机演练，未结算）')), `A record should be completed (rows: ${JSON.stringify(rows)})`)
      assert(rows.some((text) => text.includes(T_B) && text.includes('我发布') && text.includes('已完成（本机演练，未结算）')), `B record should be completed (rows: ${JSON.stringify(rows)})`)
      await page.clickByText(['时间账本'], { selector: '.profile-tabs button', exact: false })
      await sleep(200)
      const ledger = await ledgerRows()
      const completionRows = ledger.filter((text) => text.includes('演练完成：'))
      assert(completionRows.length === 2, `ledger should contain 2 completion entries (got ${completionRows.length}: ${JSON.stringify(ledger)})`)
      await page.scrollToText('时间账本')
      await cap('acc-b6-profile-records')
      return `服务记录 ${rows.length} 行（A/B 均已完成）；账本 ${ledger.length} 条，其中演练完成 ${completionRows.length} 条`
    })

    // ---------- Path E: activity signup + volunteer record ----------
    await step('E1', '活动报名（SYNTH-POST-003）', '社区页活动卡片点“演练报名”', '报名数 8→9，出现“我已演练报名”，按钮变“取消演练报名”', async ({ capture: cap }) => {
      await backToCommunity()
      await page.waitForText([T_ACTIVITY], { timeoutMs: 15000 })
      const before = await cardSnapshot(T_ACTIVITY)
      assert(before.eventDetail.includes('报名 8'), `event should start at 8 signups (got ${before.eventDetail})`)
      assert(before.buttons.some((button) => button.text === '演练报名'), '演练报名 button should be present')
      await clickCardButton(T_ACTIVITY, '演练报名')
      const envelope = await waitStorage((state) => {
        const post = findPost(state, ACTIVITY_ID)
        return post?.signedUpByMe === true && post?.eventSignupCount === 9
      }, 'activity signup')
      const post = findPost(envelope.state, ACTIVITY_ID)
      const after = await cardSnapshot(T_ACTIVITY)
      assert(after.eventDetail.includes('报名 9'), `event should show 9 signups (got ${after.eventDetail})`)
      assert(after.signupState.includes('我已演练报名'), `event should show signup state (got ${after.signupState})`)
      assert(after.buttons.some((button) => button.text === '取消演练报名'), 'cancel signup button should appear')
      run.observations['活动报名'] = JSON.stringify({ before: before.eventDetail, after: after.eventDetail, stored: { signedUpByMe: post.signedUpByMe, eventSignupCount: post.eventSignupCount } })
      await focusCard(T_ACTIVITY, '.event-detail')
      await cap('acc-e1-signup')
      return `报名数 8→${post.eventSignupCount}；signedUpByMe=${post.signedUpByMe}；按钮变“取消演练报名”`
    })

    await step('E2', '取消活动报名', '点“取消演练报名”', '报名数 9→8，恢复“演练报名”按钮，不再显示“我已演练报名”', async ({ capture: cap }) => {
      await clickCardButton(T_ACTIVITY, '取消演练报名')
      const envelope = await waitStorage((state) => {
        const post = findPost(state, ACTIVITY_ID)
        return post?.signedUpByMe === false && post?.eventSignupCount === 8
      }, 'activity signup cancel')
      const post = findPost(envelope.state, ACTIVITY_ID)
      const after = await cardSnapshot(T_ACTIVITY)
      assert(after.eventDetail.includes('报名 8'), `event should return to 8 signups (got ${after.eventDetail})`)
      assert(!after.signupState.includes('我已演练报名'), 'signup state should be cleared')
      assert(after.buttons.some((button) => button.text === '演练报名'), '演练报名 button should be back')
      await focusCard(T_ACTIVITY, '.event-detail')
      await cap('acc-e2-signup-cancelled')
      return `报名数 9→${post.eventSignupCount}；signedUpByMe=${post.signedUpByMe}；按钮恢复“演练报名”`
    })

    await step('E3', '普通志愿记录不可报名', '社区页检查志愿记录卡片（SYNTH-POST-002）', '卡片显示“志愿记录不提供报名”，且无“演练报名”按钮', async ({ capture: cap }) => {
      const card = await cardSnapshot(T_VOLUNTEER_UPDATE)
      assert(card.found, 'volunteer update card should exist')
      assert(card.text.includes('志愿记录不提供报名'), `volunteer update should explain no signup (text: ${card.text.slice(0, 200)})`)
      assert(!card.buttons.some((button) => button.text === '演练报名'), 'volunteer update must not offer 演练报名 button')
      assert(!card.text.includes('我已演练报名'), 'volunteer update must not show signup state')
      const envelope = await page.readLocalStorageJson(STORAGE_KEY)
      const post = findPost(envelope.state, VOLUNTEER_UPDATE_ID)
      assert(post?.volunteerKind === 'update', `fixture should be an update-kind volunteer post (got ${post?.volunteerKind})`)
      assert((post.eventSignupCount ?? 0) === 0 && post.signedUpByMe !== true, 'volunteer update should have no signup data')
      await focusCard(T_VOLUNTEER_UPDATE, '.post-actions')
      await cap('acc-e3-volunteer-update')
      return `卡片文案含“志愿记录不提供报名”；无报名按钮；存储 volunteerKind=update、eventSignupCount=${post.eventSignupCount ?? 0}`
    })

    // ---------- Path F: profile archive JSON ----------
    await step('F1', '我的页：查看存档 JSON', '“我的”→ 点“查看存档 JSON”', '出现只读 textarea，内容含 app=community-mvp、posts、orderEvents', async ({ capture: cap }) => {
      await page.clickNav('我的')
      await page.waitForText(['本机演练存档'], { timeoutMs: 15000 })
      await page.clickByText(['查看存档 JSON'], { selector: 'button', exact: true })
      await page.waitForSelector('.profile-backup-panel .backup-textarea', { timeoutMs: 10000 })
      const info = await page.eval(() => {
        const textarea = document.querySelector('.profile-backup-panel .backup-textarea')
        const text = textarea?.value ?? ''
        let parsed = null
        try {
          parsed = JSON.parse(text)
        } catch {
          /* keep null */
        }
        return {
          length: text.length,
          readonly: textarea?.readOnly ?? null,
          hasApp: text.includes('"app":"community-mvp"') || text.includes('"app": "community-mvp"'),
          hasPosts: text.includes('"posts"'),
          hasOrderEvents: text.includes('"orderEvents"'),
          hasLedger: text.includes('"ledgerEntries"'),
          schemaVersion: parsed?.schemaVersion ?? null,
          parsedPosts: Array.isArray(parsed?.state?.posts) ? parsed.state.posts.length : null,
          parsedEvents: Array.isArray(parsed?.state?.posts)
            ? parsed.state.posts.reduce((sum, post) => sum + (post.orderEvents?.length ?? 0), 0)
            : null,
        }
      })
      assert(info.length > 500, `backup JSON should be non-trivial (length=${info.length})`)
      assert(info.readonly === true, 'backup textarea should be read-only')
      assert(info.hasApp && info.hasPosts && info.hasOrderEvents && info.hasLedger, `backup JSON should include app/posts/orderEvents/ledgerEntries (got ${JSON.stringify(info)})`)
      run.observations['存档 JSON'] = JSON.stringify({ length: info.length, schemaVersion: info.schemaVersion, parsedPosts: info.parsedPosts, parsedEvents: info.parsedEvents, readonly: info.readonly })
      await snapshotStorage('存档 JSON 打开时', 'acc-local-storage-at-backup.json')
      await page.scrollToText('本机存档 JSON（只读快照）')
      await cap('acc-f1-backup-json')
      return `只读 textarea ${info.length} 字符；schemaVersion=${info.schemaVersion}；posts=${info.parsedPosts}；orderEvents=${info.parsedEvents} 条；含 app/posts/orderEvents/ledgerEntries`
    })

    await step('F2', '我的页：复制 JSON', '点“复制 JSON”，检查 toast 与剪贴板', '提示“已复制本机存档 JSON…”，剪贴板内容以 {"app":"community-mvp" 开头（无头浏览器受限时如实记录）', async ({ capture: cap }) => {
      let permissionGranted = false
      try {
        await page.client.send('Browser.grantPermissions', {
          origin: BASE,
          permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
        })
        permissionGranted = true
      } catch (error) {
        permissionGranted = `grant-failed: ${error.message}`
      }
      await page.clickByText(['复制 JSON'], { selector: 'button', exact: true })
      await sleep(300)
      const toast = await page.eval(() => document.querySelector('.toast-message')?.innerText ?? '')
      const clipboard = await page.eval(async () => {
        try {
          const text = await navigator.clipboard.readText()
          return { ok: true, length: text.length, head: text.slice(0, 40) }
        } catch (error) {
          return { ok: false, error: String(error) }
        }
      })
      const copyConfirmed = (typeof clipboard === 'object' && clipboard.ok && clipboard.head.includes('community-mvp'))
        || toast.includes('已复制本机存档 JSON')
      assert(toast !== '' || clipboard.ok, 'copy action should produce a toast or clipboard content')
      run.observations['复制 JSON'] = JSON.stringify({ permissionGranted, toast, clipboard })
      if (!copyConfirmed) run.notes.push(`复制 JSON：按钮已点击，但无头浏览器剪贴板写入/读取受限（toast=${JSON.stringify(toast)}, clipboard=${JSON.stringify(clipboard)}）。`)
      await page.scrollToText('本机存档 JSON（只读快照）')
      await cap('acc-f2-copy-json')
      return `toast=${JSON.stringify(toast)}；剪贴板读取=${JSON.stringify(clipboard)}；权限授予=${permissionGranted}`
    })

    // ---------- Path G: data-layer shared function checks via Pinia ----------
    await step('G1', '数据层校验：store 共享函数直接调用', 'Runtime.evaluate 取 Pinia store，调用 signUpForEvent/cancelEventSignup 普通志愿记录', 'signUpForEvent(SYNTH-POST-002) 返回 ok:false 且理由为“只有活动招募可以报名”；cancelEventSignup 同样失败', async () => {
      const result = await page.eval(() => {
        const app = document.querySelector('#app')?.__vue_app__
        const pinia = app?.config?.globalProperties?.$pinia
        const store = pinia?._s?.get('community')
        if (!store) return { available: false }
        const updateSignup = store.signUpForEvent('SYNTH-POST-002')
        const updateCancel = store.cancelEventSignup('SYNTH-POST-002')
        const activityCancelWithoutSignup = store.cancelEventSignup('SYNTH-POST-003')
        return {
          available: true,
          membership: store.membership,
          storeFunctionNames: Object.keys(store).filter((key) => typeof store[key] === 'function'),
          updateSignup,
          updateCancel,
          activityCancelWithoutSignup,
        }
      })
      assert(result?.available === true, 'Pinia store should be reachable through #app.__vue_app__')
      assert(result.updateSignup.ok === false, `signUpForEvent(update) should fail (got ${JSON.stringify(result.updateSignup)})`)
      assert(result.updateSignup.errors.some((text) => text.includes('只有“活动招募”可以报名')), `signUpForEvent(update) error text unexpected: ${JSON.stringify(result.updateSignup.errors)}`)
      assert(result.updateCancel.ok === false, `cancelEventSignup(update) should fail (got ${JSON.stringify(result.updateCancel)})`)
      assert(result.activityCancelWithoutSignup.ok === false, `cancelEventSignup(activity not signed up) should fail (got ${JSON.stringify(result.activityCancelWithoutSignup)})`)
      run.storeCalls = {
        membership: result.membership,
        updateSignup: result.updateSignup,
        updateCancel: result.updateCancel,
        activityCancelWithoutSignup: result.activityCancelWithoutSignup,
      }
      await writeFile(join(OUT_DIR, `${PREFIX}acc-store-calls.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
      return `store 可用（membership=${result.membership}）；signUpForEvent(update)=ok:false/${JSON.stringify(result.updateSignup.errors)}；cancelEventSignup(update)=ok:false/${JSON.stringify(result.updateCancel.errors)}；未报名时取消活动报名=ok:false/${JSON.stringify(result.activityCancelWithoutSignup.errors)}`
    })

    // ---------- Path H: persistence after reload ----------
    await step('H1', '刷新后订单状态保留（社区页）', 'Page.reload → 重切成员 → 社区', '已完成 A/B 与已取消 C/D 状态仍在（身份本身不持久化，回到访客）', async ({ capture: cap }) => {
      await page.reload()
      await page.waitForSelector('.community-app', { timeoutMs: 20000 })
      const identity = await page.getMembership()
      assert(identity === 'visitor', `identity should reset to visitor after reload (got ${identity})`)
      await page.setMembership('member')
      await page.clickNav('社区')
      await page.waitForText(['把日常分享出来'], { timeoutMs: 15000 })
      const envelope = await waitStorage((state) => {
        const a = findPost(state, FIXTURE_ID)
        const b = findPost(state, T_B)
        const c = findPost(state, T_C)
        const d = findPost(state, T_D)
        return a?.orderStatus === 'completed-local-demo'
          && b?.orderStatus === 'completed-local-demo'
          && c?.orderStatus === 'cancelled-local-demo'
          && d?.orderStatus === 'cancelled-local-demo'
      }, 'persistence after reload')
      const body = await page.bodyText()
      const completedMentions = body.split('已完成（本机演练，未结算）').length - 1
      assert(completedMentions >= 2, `community page should show 2 completed orders after reload (mentions=${completedMentions})`)
      assert(body.includes('已取消/关闭（本机演练）'), 'community page should show cancelled orders after reload')
      const ledger = envelope.state.ledgerEntries.filter((entry) => entry.title.startsWith('演练完成：'))
      assert(ledger.length === 2, `ledger completion entries should persist (got ${ledger.length})`)
      const notices = envelope.state.threads.filter((thread) => thread.kind === 'system').flatMap((thread) => thread.messages)
      assert(notices.length >= 6, `system notices should persist (got ${notices.length})`)
      await cap('acc-h1-reload-community')
      return `重载后身份=visitor；重新切成员后社区含 ${completedMentions} 处“已完成”与“已取消/关闭”；账本完成记录 ${ledger.length} 条；系统通知 ${notices.length} 条`
    })

    await step('H2', '刷新后“我的→服务记录/账本”保留', '重载后打开“我的”检查服务记录与账本', 'A/B 均显示已完成并列出事件；账本仍为 2 条演练完成记录', async ({ capture: cap }) => {
      await openProfileTab('服务记录')
      const rows = await serviceRecordRows()
      assert(rows.some((text) => text.includes(T_FIXTURE) && text.includes('已完成（本机演练，未结算）')), `A record should persist (rows: ${JSON.stringify(rows)})`)
      assert(rows.some((text) => text.includes(T_B) && text.includes('已完成（本机演练，未结算）')), `B record should persist (rows: ${JSON.stringify(rows)})`)
      await page.clickByText(['时间账本'], { selector: '.profile-tabs button', exact: false })
      await sleep(200)
      const ledger = await ledgerRows()
      assert(ledger.filter((text) => text.includes('演练完成：')).length === 2, `ledger should persist 2 completion entries (got ${JSON.stringify(ledger)})`)
      await cap('acc-h2-reload-profile')
      return `服务记录 ${rows.length} 行，A/B 均保留已完成；账本完成记录 2 条`
    })

    await step('H3', '刷新后系统通知与消息列表保留', '重载后导航“消息”', '系统通知数量与关键文案保留；订单列表含已完成订单', async ({ capture: cap }) => {
      await page.clickNav('消息')
      await page.waitForText(['系统通知（合成示例）'], { timeoutMs: 15000 })
      const notices = await notificationTexts()
      assert(notices.some((text) => text.includes(`你申请完成的订单《${T_FIXTURE}》已被合成求助方确认`)), `completion notice should persist (notices: ${JSON.stringify(notices)})`)
      assert(notices.some((text) => text.includes(`你的发布《${T_B}》审核通过`)), 'moderation notice should persist')
      const threads = await threadItems()
      assert(threads.some((text) => text.includes(T_FIXTURE) && text.includes('已完成（本机演练，未结算）')), `completed order should persist in messages (${JSON.stringify(threads)})`)
      run.observations['系统通知（最终）'] = JSON.stringify(notices)
      run.observations['订单列表（最终）'] = JSON.stringify(threads)
      await cap('acc-h3-reload-messages')
      return `系统通知 ${notices.length} 条（含完成确认/审核通过）；订单列表 ${threads.length} 条（含已完成）`
    })

    // ---------- Path J: A+ bridge regression (same browser, same origin) ----------
    await step('J1', 'A+ 入口读取社区求助（含已完成/已取消状态）', '打开 A+ 入口 / → 点“社区求助（本机演练）”→ 读取面板', '列出全部审核通过的求助（含已完成/已取消），社区状态显示“已完成（本机演练，未结算）”，无“登记状态无效”错误', async ({ capture: cap }) => {
      const before = await page.readLocalStorageJson(STORAGE_KEY)
      assert(before, 'community storage should exist before opening the A+ entry')
      await page.navigate(`${BASE}/`)
      await page.waitForText(['受控登记队列'], { timeoutMs: 20000 })
      await page.waitForSelector('.app-shell', { timeoutMs: 10000 })
      await page.waitForText(['社区求助（本机演练）'], { timeoutMs: 10000 })
      await page.clickByText(['社区求助（本机演练）'], { selector: 'button', exact: true })
      await page.waitForSelector('.bridge-modal', { timeoutMs: 10000 })
      await page.waitForText(['社区状态：'], { timeoutMs: 10000 })
      const bridge = await page.eval((storageKey) => {
        const norm = (value) => (value || '').replace(/\s+/g, ' ').trim()
        const modal = document.querySelector('.bridge-modal')
        const status = norm(modal?.querySelector('.bridge-status')?.innerText)
        const emptyStates = Array.from(modal?.querySelectorAll('.empty-state') ?? []).map((node) => norm(node.innerText))
        const posts = Array.from(modal?.querySelectorAll('.bridge-post') ?? []).map((card) => {
          const tags = Array.from(card.querySelectorAll('.bridge-post-head .tag')).map((tag) => norm(tag.innerText))
          return {
            title: norm(card.querySelector('.bridge-post-head strong')?.innerText),
            tags,
            statusTag: tags.find((tag) => tag.startsWith('社区状态：')) ?? '',
            registerTag: tags.find((tag) => ['已登记', '可登记', '登记已暂停'].includes(tag)) ?? '',
          }
        })
        const body = norm(modal?.innerText)
        let storageSavedAt = null
        let storagePosts = 0
        try {
          const raw = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
          storageSavedAt = raw?.savedAt ?? null
          storagePosts = raw?.state?.posts?.length ?? 0
        } catch {
          /* ignore */
        }
        return { status, emptyStates, posts, body, hasInvalidStatusError: body.includes('登记状态无效'), hasStopRead: body.includes('已停止读取'), storageSavedAt, storagePosts }
      }, STORAGE_KEY)
      assert(!bridge.hasInvalidStatusError, `A+ bridge must not report 登记状态无效; modal: ${bridge.body.slice(0, 400)}`)
      assert(!bridge.hasStopRead, `A+ bridge must not stop reading; modal: ${bridge.body.slice(0, 400)}`)
      assert(bridge.status.includes('已读取'), `bridge status should report a successful read (got ${bridge.status})`)
      assert(bridge.emptyStates.filter((text) => text.includes('读取失败')).length === 0, `bridge should not show a read-failure message (got ${JSON.stringify(bridge.emptyStates)})`)
      const titles = bridge.posts.map((post) => post.title)
      assert(bridge.posts.length === 4, `bridge should list 4 approved help posts (got ${bridge.posts.length}: ${JSON.stringify(titles)})`)
      const expectStatus = (title, expected) => {
        const post = bridge.posts.find((item) => item.title === title)
        assert(post, `bridge should list 「${title}」 (got ${JSON.stringify(titles)})`)
        assert(post.statusTag.includes(expected), `「${title}」 community status should be ${expected} (got ${post.statusTag})`)
      }
      expectStatus(T_FIXTURE, '已完成（本机演练，未结算）')
      expectStatus(T_B, '已完成（本机演练，未结算）')
      expectStatus(T_C, '已取消/关闭（本机演练）')
      expectStatus(T_D, '已取消/关闭（本机演练）')
      run.assets.aplus = await collectLoadedAssets(page)
      run.checks.aplusBridge = { readStatus: bridge.status, postCount: bridge.posts.length, posts: bridge.posts, savedAt: bridge.storageSavedAt }
      run.observations['A+ 社区桥读取'] = JSON.stringify({ status: bridge.status, posts: bridge.posts, savedAt: bridge.storageSavedAt })
      await cap('acc-j1-aplus-bridge')
      return `A+ 读取状态「${bridge.status}」；列出 ${bridge.posts.length} 条审核通过求助；已完成/已取消状态标签正确；无“登记状态无效”/停止读取错误`
    })

    await step('J2', 'A+ 读取只读性校验', '比较 A+ 读取前后社区存档 savedAt / 帖子数 / 订单状态', '社区存档未被 A+ 读取修改（只读，不写回）', async () => {
      const after = await page.eval((storageKey) => {
        const norm = (value) => (value || '').replace(/\s+/g, ' ').trim()
        let savedAt = null
        let postCount = 0
        const statuses = {}
        try {
          const raw = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
          savedAt = raw?.savedAt ?? null
          const posts = raw?.state?.posts ?? []
          postCount = posts.length
          for (const post of posts.filter((item) => item.mode === 'help')) statuses[post.title] = post.orderStatus
        } catch {
          /* ignore */
        }
        return { savedAt, postCount, statuses, modalOpen: !!document.querySelector('.bridge-modal') }
      }, STORAGE_KEY)
      const beforeSavedAt = run.checks.aplusBridge?.savedAt ?? null
      assert(after.modalOpen === true, 'A+ bridge modal should remain open for the read-only check')
      assert(after.savedAt === beforeSavedAt, `community savedAt should not change after A+ read (before=${beforeSavedAt}, after=${after.savedAt})`)
      assert(after.postCount === 7, `community post count should stay 7 (got ${after.postCount})`)
      assert(after.statuses[T_FIXTURE] === 'completed-local-demo', 'fixture order status should stay completed')
      assert(after.statuses[T_C] === 'cancelled-local-demo', 'cancelled order status should stay cancelled')
      run.observations['A+ 只读校验'] = JSON.stringify({ beforeSavedAt, afterSavedAt: after.savedAt, postCount: after.postCount })
      return `无写回：社区存档 savedAt 未变（${after.savedAt}）；帖子仍 ${after.postCount} 条；已完成/已取消订单状态未变`
    })

    // ---------- final summary ----------
    await step('I1', '最终状态汇总探针', '回到社区页读取 localStorage 汇总订单/账本/通知/活动状态', '四类订单状态与账本/通知数据与界面一致', async ({ capture: cap }) => {
      await page.navigate(`${BASE}/community.html`)
      await page.waitForSelector('.community-app', { timeoutMs: 20000 })
      await page.setMembership('member')
      await page.clickNav('社区')
      await page.waitForText(['把日常分享出来'], { timeoutMs: 15000 })
      const envelope = await page.readLocalStorageJson(STORAGE_KEY)
      const state = envelope.state
      const helpPosts = state.posts.filter((post) => post.mode === 'help')
      const summary = {
        orderStatuses: Object.fromEntries(helpPosts.map((post) => [post.title, post.orderStatus])),
        helpPosts: helpPosts.map((post) => ({ id: post.id, title: post.title, moderation: post.moderation, orderStatus: post.orderStatus, events: (post.orderEvents ?? []).length })),
        ledger: state.ledgerEntries.map((entry) => ({ title: entry.title, minutes: entry.minutes, status: entry.status })),
        systemNoticeCount: state.threads.filter((thread) => thread.kind === 'system').reduce((sum, thread) => sum + thread.messages.length, 0),
        activity: (() => {
          const post = state.posts.find((item) => item.id === ACTIVITY_ID)
          return { signedUpByMe: post?.signedUpByMe ?? null, eventSignupCount: post?.eventSignupCount ?? null }
        })(),
        totalOrderEvents: helpPosts.reduce((sum, post) => sum + (post.orderEvents?.length ?? 0), 0),
      }
      run.checks = summary
      const validatedCases = [
        summary.orderStatuses[T_FIXTURE] === 'completed-local-demo',
        summary.orderStatuses[T_B] === 'completed-local-demo',
        summary.orderStatuses[T_C] === 'cancelled-local-demo',
        summary.orderStatuses[T_D] === 'cancelled-local-demo',
        summary.ledger.filter((entry) => entry.title.startsWith('演练完成：')).length === 2,
        summary.activity.eventSignupCount === 8,
        summary.systemNoticeCount >= 6,
      ]
      assert(validatedCases.every(Boolean), `final summary mismatch: ${JSON.stringify(summary)}`)
      await snapshotStorage('最终状态', 'acc-local-storage-final.json')
      await cap('acc-i1-final-summary')
      return `订单状态：${JSON.stringify(summary.orderStatuses)}；账本 ${summary.ledger.length} 条；系统通知 ${summary.systemNoticeCount} 条；orderEvents 共 ${summary.totalOrderEvents} 条；活动报名=${summary.activity.eventSignupCount}/signedUpByMe=${summary.activity.signedUpByMe}`
    })

    run.ok = true
    run.notes.push('本验收基于静态 dist 预览（vite preview 从磁盘读取构建产物），未触发 npm run build，避免与 Lead 的构建冲突。')
    run.notes.push('所有数据为合成/虚构内容，只写入本次临时 Chrome profile 的 localStorage；浏览器关闭后临时 profile 已清理。')
    run.notes.push('演练身份为前端内存状态，刷新后回到“访客”属于当前设计；订单/账本/通知等业务状态已由 localStorage 持久化并在 H1~H3 验证。')
    run.notes.push(`数据层校验（G1）通过 Runtime.evaluate 直接调用 Pinia store 的共享函数，未通过界面按钮；返回值已原样记录在 ${PREFIX}acc-store-calls.json。`)
    run.notes.push('A+ 读取器回归（J1/J2）在同一浏览器、同一 origin（5180）下进行：A+ 只读社区存档，J2 对比 savedAt 证明未写回。')
    run.notes.push(`实测加载资源（SHA-256 见上表）：社区页 ${run.assets.community.map((asset) => asset.url).join('、') || '—'}；A+ 页 ${run.assets.aplus.map((asset) => asset.url).join('、') || '—'}。`)
  } finally {
    run.pageErrors = page.pageErrors.slice()
    run.consoleErrors = page.consoleErrors.slice()
    await page.close()
    run.finishedAt = new Date().toISOString()
    await writeRecord()
    console.log(`\n[acceptance] record: ${relative(REPO_ROOT, join(OUT_DIR, `${RECORD_BASE}.md`))}`)
  }
  return run
}

try {
  const finished = await main()
  const passed = finished.steps.filter((step) => step.ok).length
  console.log(`\n[acceptance] ${finished.ok ? 'PASS' : 'FAIL'} — ${passed}/${finished.steps.length} steps`)
  if (!finished.ok) process.exitCode = 1
} catch (error) {
  console.error(`\n[acceptance] FAILED: ${error?.stack ?? error}`)
  process.exitCode = 1
}
