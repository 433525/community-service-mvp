/**
 * check-community.mjs — baseline browser check for the community MVP (static dist preview).
 *
 * Scenarios (baseline / current built dist):
 *   1. load community.html, confirm Vue mount + synthetic-data notice
 *   2. reset local storage, confirm initial fictional fixtures
 *   3. switch synthetic identity to 演练成员
 *   4. open publish form, fill a synthetic help request (confirm checkbox)
 *   5. submit -> pending review, inspect localStorage
 *   6. switch to 审核员, open moderation queue
 *   7. fill fictional review reason, approve the post
 *   8. switch back to member, verify the post is visible in 社区 feed
 *   9. accept an approved help order (演练接单), confirm orderStatus change in localStorage
 *  10. open 我的 -> 服务记录 and inspect the local service record view
 *  11. reload and confirm state persisted in localStorage
 *
 * Zero dependencies (Node >= 22). Writes PNG screenshots + page text files +
 * run-record.json/md into the evidence directory. The preview server must be
 * started separately (see docs report). This script never touches app source.
 *
 * Usage:
 *   node tools/check-community.mjs [--base=http://127.0.0.1:5180] [--out=<dir>]
 */
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserSession } from './cdp.mjs'

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
const RECORD = args.get('record') || 'run-record'

const FIXTURE_HELP_TITLE = '求助：帮忙把两箱演练物资搬到活动室（虚构）'
const NEW_TITLE = '求助：请教我使用社区共享打印机（演练合成）'
const NEW_CONTENT = '想在演练社区活动室学习共享打印机的使用步骤，大约十分钟即可。本内容为虚构演练，不含真实姓名、电话或地址。'
const NEW_TIME_WINDOW = '本周五 16:00–17:00'
const NEW_DURATION = '约 30 分钟'
const REVIEW_REASON = '虚构审核理由：内容为合成演练数据，不含真实个人信息，服务时段与时长填写完整，允许公开演示。'

const run = {
  script: 'tools/check-community.mjs',
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
    check: 'node tools/check-community.mjs --base=http://127.0.0.1:5180',
  },
  browser: null,
  site: null,
  steps: [],
  pageErrors: [],
  consoleErrors: [],
  featureProbe: null,
  storageSnapshots: [],
  notes: [],
}

function stamp() {
  const now = new Date()
  const offset = -now.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const pad = (value) => String(Math.floor(Math.abs(value))).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(offset / 60)}:${pad(offset % 60)}`
}

function rel(filePath) {
  return relative(REPO_ROOT, filePath).split('\\').join('/')
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`)
}

/** Local HH:mm:ss for human-readable run logs (record keeps ISO too). */
function localTime(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  return date.toLocaleString('zh-CN', { hour12: false })
}

/** Record what static build is actually being served (provenance for the report). */
async function collectDistInfo() {
  const distDir = join(APP_ROOT, 'dist')
  const files = []
  const add = async (relativePath) => {
    try {
      const info = await stat(join(distDir, relativePath))
      files.push({
        file: relativePath.split('\\').join('/'),
        size: info.size,
        modifiedAt: new Date(info.mtimeMs).toISOString(),
      })
    } catch {
      /* missing file: ignore */
    }
  }
  await add('community.html')
  await add('index.html')
  try {
    for (const entry of await readdir(join(distDir, 'assets'))) await add(`assets/${entry}`)
  } catch {
    /* no assets dir */
  }
  const sorted = files.slice().sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
  return {
    dir: rel(distDir),
    newestModifiedAt: sorted[0]?.modifiedAt ?? null,
    files: sorted,
  }
}

async function writeRecord() {
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, `${RECORD}.json`), `${JSON.stringify(run, null, 2)}\n`, 'utf8')
  await writeFile(join(OUT_DIR, `${RECORD}.md`), renderRecordMarkdown(run), 'utf8')
}

function renderRecordMarkdown(record) {
  const lines = []
  lines.push('# 社区 MVP 基线浏览器实测 · 运行记录（自动生成）')
  lines.push('')
  lines.push(`- 运行脚本：\`${record.script}\``)
  lines.push(`- 运行时间：${localTime(record.startedAt)} → ${localTime(record.finishedAt)}（本地时间，UTC 记录：${record.startedAt} → ${record.finishedAt ?? '—'}）`)
  lines.push(`- 站点地址：${record.base}`)
  lines.push(`- 静态 dist 预览命令：\`${record.commands.preview}\``)
  lines.push(`- 实测命令：\`${record.commands.check}\``)
  lines.push(`- Node：${record.node}；平台：${record.platform}`)
  if (record.dist) {
    lines.push(`- dist 目录：${record.dist.dir}；最新构建时间：${localTime(record.dist.newestModifiedAt)}（${record.dist.newestModifiedAt ?? '—'}）`)
    const served = record.site?.assets ?? []
    for (const asset of record.dist.files) {
      const name = asset.file.split('/').pop()
      const servedFlag = served.some((item) => item.endsWith(name)) ? '（本次页面实际引用）' : ''
      lines.push(`  - ${asset.file} · ${asset.size} B · ${localTime(asset.modifiedAt)}${servedFlag}`)
    }
  }
  if (record.browser) {
    lines.push(`- 浏览器：${record.browser.name} ${record.browser.version ?? ''}（headless，CDP 端口 ${record.browser.port}）`)
  }
  if (record.site) {
    lines.push(`- 页面入口：${record.site.entryUrl}（HTTP ${record.site.status}）`)
    lines.push(`- dist 资源：${record.site.assets.join('、') || '（未解析到）'}`)
  }
  lines.push('')
  lines.push('## 步骤结果')
  lines.push('')
  lines.push('| # | 步骤 | 操作 | 期望 | 实际 | 结果 | 证据 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const step of record.steps) {
    const evidence = step.evidence.length
      ? step.evidence.map((item) => `${item.screenshot}`).join('<br/>')
      : '—'
    const escape = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lines.push(`| ${step.id} | ${escape(step.title)} | ${escape(step.action)} | ${escape(step.expected)} | ${escape(step.actual || step.error)} | ${step.ok ? '✅ 通过' : '❌ 失败'} | ${evidence} |`)
  }
  lines.push('')
  lines.push(`**结果：${record.steps.filter((step) => step.ok).length}/${record.steps.length} 步通过${record.ok ? '，整体通过' : '，整体失败'}。**`)
  lines.push('')
  if (record.storageSnapshots.length) {
    lines.push('## localStorage 快照（摘录）')
    lines.push('')
    for (const snapshot of record.storageSnapshots) {
      lines.push(`### ${snapshot.label}`)
      lines.push('')
      lines.push(`- 文件：${snapshot.file}`)
      lines.push(`- savedAt：${snapshot.savedAt ?? 'null'}`)
      lines.push(`- 帖子：${snapshot.posts.length} 条；审核日志：${snapshot.auditLog.length} 条；举报：${snapshot.reports.length} 条`)
      const interesting = snapshot.posts.filter((post) =>
        post.title === NEW_TITLE || post.id === 'SYNTH-POST-001' || post.moderation !== 'approved')
      for (const post of interesting) {
        lines.push(`  - \`${post.id}\` 「${post.title}」 moderation=${post.moderation} orderStatus=${post.orderStatus ?? '—'} acceptedByMe=${post.acceptedByMe ?? '—'}`)
      }
      lines.push('')
    }
  }
  if (record.featureProbe) {
    lines.push('## 基线功能探针（B 段验收所需操作在基线页面中的出现次数）')
    lines.push('')
    lines.push('| 操作/文案 | 出现次数 |')
    lines.push('| --- | --- |')
    for (const [label, count] of Object.entries(record.featureProbe)) {
      lines.push(`| ${label} | ${count} |`)
    }
    lines.push('')
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

function summarizeStorage(label, envelope, filePath) {
  const state = envelope?.state ?? {}
  const snapshot = {
    label,
    file: rel(filePath),
    savedAt: envelope?.savedAt ?? null,
    schemaVersion: envelope?.schemaVersion ?? null,
    posts: (state.posts ?? []).map((post) => ({
      id: post.id,
      mode: post.mode,
      title: post.title,
      moderation: post.moderation ?? 'pending',
      orderStatus: post.orderStatus ?? null,
      acceptedByMe: post.acceptedByMe ?? null,
      authorId: post.author?.id ?? null,
      reviewNote: post.reviewNote ?? null,
    })),
    auditLog: (state.auditLog ?? []).map((entry) => ({
      action: entry.action,
      targetId: entry.targetId,
      decision: entry.decision ?? null,
      reason: entry.reason,
    })),
    reports: (state.reports ?? []).map((report) => ({
      targetType: report.targetType,
      targetId: report.targetId,
      status: report.status,
      reason: report.reason,
    })),
  }
  run.storageSnapshots.push(snapshot)
  return snapshot
}

async function readStorageSnapshot(page, label, fileName) {
  const envelope = await page.readLocalStorageJson(STORAGE_KEY)
  const filePath = join(OUT_DIR, `${PREFIX}${fileName}`)
  await writeFile(filePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
  return summarizeStorage(label, envelope, filePath)
}

async function collectSiteInfo() {
  const entryUrl = `${BASE}/community.html`
  const response = await fetch(entryUrl, { signal: AbortSignal.timeout(8000) })
  const html = await response.text()
  const assets = []
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assets.push(match[1])
  for (const match of html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)) assets.push(match[1])
  let homeStatus = null
  try {
    const home = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(8000) })
    homeStatus = home.status
  } catch {
    homeStatus = 'unreachable'
  }
  return {
    entryUrl,
    status: response.status,
    homeStatus,
    assets,
    htmlTitle: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '',
  }
}

async function main() {
  console.log(`[check-community] site: ${BASE}`)
  console.log(`[check-community] evidence: ${OUT_DIR}`)
  await mkdir(OUT_DIR, { recursive: true })

  // 0. Static-preview availability (fail fast with a clear message).
  run.site = await collectSiteInfo()
  run.dist = await collectDistInfo()
  assert(run.site.status === 200, `community.html should answer HTTP 200 (got ${run.site.status}) — is the preview server running on ${BASE}?`)
  console.log(`[check-community] dist assets: ${run.site.assets.join(', ')}`)
  console.log(`[check-community] dist newest build time: ${run.dist.newestModifiedAt}`)

  const page = await BrowserSession.launch({ browserPath: BROWSER_PATH, headless: true })
  run.browser = {
    name: page.browser.name,
    path: page.browser.path,
    version: page.browserVersion?.Browser ?? page.browserVersion?.['User-Agent'] ?? 'unknown',
    port: page.port,
    protocolVersion: page.browserVersion?.['Protocol-Version'] ?? '',
    userAgent: page.browserVersion?.['User-Agent'] ?? '',
  }
  console.log(`[check-community] browser: ${run.browser.name} ${run.browser.version} on CDP port ${page.port}`)

  const capture = async (step, name) => {
    const png = join(OUT_DIR, `${PREFIX}${name}.png`)
    const txt = join(OUT_DIR, `${PREFIX}${name}.txt`)
    await page.screenshot(png)
    const text = await page.savePageText(txt)
    step.evidence.push({ screenshot: rel(png), pageText: rel(txt) })
    return text
  }

  const step = async (id, title, action, expected, fn) => {
    const entry = {
      id,
      title,
      action,
      expected,
      actual: '',
      ok: false,
      error: null,
      startedAt: stamp(),
      durationMs: 0,
      evidence: [],
    }
    run.steps.push(entry)
    const startedAt = Date.now()
    console.log(`\n[check-community] step ${id}: ${title}`)
    try {
      const actual = await fn({ capture: (name) => capture(entry, name), entry })
      entry.actual = typeof actual === 'string' ? actual : actual?.actual ?? '完成'
      entry.ok = true
      console.log(`  -> ok: ${entry.actual}`)
      return actual
    } catch (error) {
      entry.error = error?.message ?? String(error)
      entry.actual = `失败：${entry.error}`
      try {
        await capture(entry, `${id}-failure`)
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

  try {
    // 1. Load + Vue mount.
    await step(
      '01',
      '加载社区页并确认 Vue 挂载',
      'Page.navigate 到 /community.html，等待 .community-app 与“演练身份”出现',
      '页面加载完成，Vue 挂载，出现身份选择器与合成数据声明',
      async ({ capture: cap }) => {
        await page.navigate(`${BASE}/community.html`)
        await page.waitForSelector('.community-app', { timeoutMs: 20000 })
        await page.waitForText(['演练身份', 'B · 受控社区演练', '合成数据演练版'], { timeoutMs: 15000 })
        const identity = await page.getMembership()
        assert(identity === 'visitor', `initial synthetic identity should be visitor (got ${identity})`)
        const appCount = await page.count('.community-app')
        assert(appCount === 1, 'exactly one Vue app root should exist')
        const heading = await page.eval(() => document.querySelector('.page-heading h1')?.innerText ?? '')
        await cap('01-load-community')
        return `Vue 挂载成功（.community-app=1）；初始身份=${identity}；页面标题=${JSON.stringify(heading)}；导航标签包含 首页/社区/发布/消息/我的/审核`
      },
    )

    // 2. Deterministic baseline: clear local storage and reload.
    await step(
      '02',
      '重置本机存档到初始虚构示例',
      'localStorage.clear() 后 Page.reload，等待应用重新挂载',
      '存档为空、回到初始虚构示例（4 条动态）且身份为访客',
      async ({ capture: cap }) => {
        await page.clearLocalStorage()
        const beforeReload = await page.readLocalStorage(STORAGE_KEY)
        await page.reload()
        await page.waitForSelector('.community-app', { timeoutMs: 20000 })
        await page.waitForText(['演练身份'], { timeoutMs: 15000 })
        const identity = await page.getMembership()
        assert(identity === 'visitor', `after reload identity should be visitor (got ${identity})`)
        assert(beforeReload === null, 'storage should be empty after clear')
        const emptyGate = await page.bodyText()
        assert(emptyGate.includes('这是受控社区'), 'visitor gate copy should be visible')
        await cap('02-baseline-fixtures')
        return 'localStorage 已清空并重载；身份=访客；显示“这是受控社区”访客提示；初始 4 条虚构动态待切换成员后可见'
      },
    )

    // 3. Switch to synthetic member.
    await step(
      '03',
      '切换“演练成员”身份',
      '在“演练身份”下拉框选择 member（本社区已核验成员（合成））',
      '身份切换为 member，出现成员首页内容',
      async ({ capture: cap }) => {
        await page.setMembership('member')
        await page.waitForText(['你好，演练居民', '发布求助', '邻里新鲜事'], { timeoutMs: 15000 })
        await page.waitForSelector('.hero-card', { timeoutMs: 10000 })
        await cap('03-member-identity')
        return '身份=member；首页出现“你好，演练居民 / 发布求助 / 邻里新鲜事”'
      },
    )

    // 4. Publish form.
    await step(
      '04',
      '打开发布表单并填写虚构求助',
      '点击导航“发布”→ 选择求助（默认）→ 填标题/需求说明/希望时段/预计时长 → 勾选合成数据确认',
      '表单填写完成，“提交审核”按钮由禁用变为可用',
      async ({ capture: cap }) => {
        await page.clickNav('发布')
        await page.waitForText(['发布一件小事。', '提交审核'], { timeoutMs: 15000 })
        const modeHelp = await page.eval(() => {
          const button = Array.from(document.querySelectorAll('.mode-options button'))
            .find((item) => item.innerText.includes('求助登记'))
          return { text: button?.innerText ?? '', selected: button?.className.includes('selected') ?? false }
        })
        assert(modeHelp.selected, 'help publish mode should be selected by default')
        await page.fillByLabel('标题', NEW_TITLE)
        await page.fillByLabel('需求说明', NEW_CONTENT)
        await page.fillByLabel('希望时段', NEW_TIME_WINDOW)
        await page.fillByLabel('预计时长', NEW_DURATION)
        const category = await page.eval(() => {
          const label = Array.from(document.querySelectorAll('label')).find((item) => item.innerText.includes('服务分类'))
          return label?.querySelector('input')?.value ?? ''
        })
        assert(category === '待分类', `default category should be 待分类 (got ${category})`)
        await page.checkSelector('.confirm-synthetic input')
        await page.waitForExpression("!document.querySelector('.submit-button').disabled", { timeoutMs: 5000 })
        const values = await page.eval(() => {
          const read = (text) => {
            const label = Array.from(document.querySelectorAll('.publish-form label')).find((item) => item.innerText.includes(text))
            return label?.querySelector('input, textarea')?.value ?? null
          }
          return { title: read('标题'), content: read('需求说明'), timeWindow: read('希望时段'), duration: read('预计时长'), confirmed: document.querySelector('.confirm-synthetic input')?.checked }
        })
        await cap('04-publish-form-filled')
        return `模式=求助登记（已选中）；标题/需求说明/希望时段/预计时长已填；分类=待分类；确认勾选=${values.confirmed}；提交按钮可用`
      },
    )

    // 5. Submit -> pending.
    await step(
      '05',
      '提交审核并检查待审状态',
      '点击“提交审核”，确认跳转“我的”并显示待审核',
      '出现“已提交本机待审队列”提示，动态为“待审核，尚未公开”，localStorage 中 moderation=pending、orderStatus=open',
      async ({ capture: cap }) => {
        await page.clickSelector('.submit-button')
        await page.waitForText(['我的发布', NEW_TITLE], { timeoutMs: 15000 })
        const body = await page.bodyText()
        assert(body.includes('待审核，尚未公开'), 'profile row should say 待审核，尚未公开')
        const snapshot = await readStorageSnapshot(page, '提交审核后', 'local-storage-after-publish.json')
        const created = snapshot.posts.find((post) => post.title === NEW_TITLE)
        assert(created, 'new post should exist in localStorage')
        assert(created.moderation === 'pending', `new post moderation should be pending (got ${created.moderation})`)
        assert(created.orderStatus === 'open', `new help orderStatus should be open (got ${created.orderStatus})`)
        assert(created.authorId === 'SYNTH-DEMO-USER', 'new post author should be the synthetic demo user')
        await cap('05-published-pending')
        return `跳转“我的发布”；新帖 ${created.id} moderation=pending、orderStatus=open、author=SYNTH-DEMO-USER；页面显示“待审核，尚未公开”`
      },
    )

    // 6. Reviewer queue.
    await step(
      '06',
      '切换“审核员”并打开审核队列',
      '身份切换为 reviewer → 点击导航“审核”',
      '出现“内容与举报审核”，待审发布队列中包含刚发布的求助',
      async ({ capture: cap }) => {
        await page.setMembership('reviewer')
        await page.waitForText(['审核员工作入口'], { timeoutMs: 10000 })
        await page.clickNav('审核')
        await page.waitForText(['内容与举报审核', '待审发布', NEW_TITLE], { timeoutMs: 15000 })
        const queueTitles = await page.eval(() =>
          Array.from(document.querySelectorAll('.moderation-page .feedback-card strong')).map((node) => node.innerText.trim()),
        )
        assert(queueTitles.includes(NEW_TITLE), `pending queue should contain the new post (queue: ${JSON.stringify(queueTitles)})`)
        const reasonField = await page.count('.moderation-reason textarea')
        assert(reasonField === 1, 'moderation reason textarea should be present')
        await cap('06-moderation-queue')
        return `身份=reviewer；审核页可见；待审队列包含「${NEW_TITLE}」；审核理由输入框存在`
      },
    )

    // 7. Approve with fictional reason.
    await step(
      '07',
      '填写虚构审核理由并通过',
      `在审核理由框填入虚构理由 → 点击该帖卡片的“通过”`,
      '待审队列清空，localStorage 中 moderation=approved 且 reviewNote=理由，审核日志新增一条',
      async ({ capture: cap }) => {
        await page.setValue('.moderation-reason textarea', REVIEW_REASON)
        const reasonValue = await page.eval(() => document.querySelector('.moderation-reason textarea')?.value ?? '')
        assert(reasonValue === REVIEW_REASON, 'reason textarea should hold the fictional reason')
        await page.clickByText(['通过'], {
          selector: 'button',
          withinSelector: 'article.feedback-card',
          withinText: NEW_TITLE,
        })
        await page.waitForText(['暂无待审发布。'], { timeoutMs: 15000 })
        const snapshot = await readStorageSnapshot(page, '审核通过后', 'local-storage-after-approve.json')
        const approved = snapshot.posts.find((post) => post.title === NEW_TITLE)
        assert(approved, 'approved post should exist in localStorage')
        assert(approved.moderation === 'approved', `post moderation should be approved (got ${approved.moderation})`)
        assert(approved.reviewNote === REVIEW_REASON, `reviewNote should equal the fictional reason (got ${approved.reviewNote})`)
        const audit = snapshot.auditLog.filter((item) => item.action === 'moderate-post')
        assert(audit.length === 1, `audit log should contain one moderate-post entry (got ${audit.length})`)
        assert(audit[0].decision === 'approved', 'audit decision should be approved')
        await page.scrollToText(NEW_TITLE)
        await cap('07-moderation-approved')
        return `审核通过；moderation=approved；reviewNote 与填写理由一致；审核日志 moderate-post/approved 1 条；待审队列显示“暂无待审发布。”`
      },
    )

    // 8. Back to member, community feed.
    await step(
      '08',
      '切回成员查看社区动态',
      '身份切回 member → 点击导航“社区”',
      '社区信息流出现刚审核通过的求助，标注“审核通过 · 虚构理由”',
      async ({ capture: cap }) => {
        await page.setMembership('member')
        await page.clickNav('社区')
        await page.waitForText(['把日常分享出来', NEW_TITLE], { timeoutMs: 15000 })
        const badge = await page.eval((title) => {
          const card = Array.from(document.querySelectorAll('article.post-card'))
            .find((item) => (item.innerText || '').includes(title))
          if (!card) return null
          return {
            badge: card.querySelector('.moderation-badge')?.innerText ?? '',
            text: card.innerText,
          }
        }, NEW_TITLE)
        assert(badge, 'community feed should contain the approved post card')
        assert(badge.badge.includes('审核通过'), `card badge should say 审核通过 (got ${badge.badge})`)
        assert(badge.badge.includes(REVIEW_REASON), 'card badge should display the review reason')
        const visibleCount = await page.count('article.post-card')
        await cap('08-community-approved-visible')
        return `社区信息流可见核验：卡片数=${visibleCount}；卡面标识=${JSON.stringify(badge.badge)}`
      },
    )

    // 9. Accept an approved help order.
    await step(
      '09',
      '对审核通过的求助点“演练接单”',
      `在社区找到初始示例求助「${FIXTURE_HELP_TITLE}」→ 点击卡片内“演练接单”`,
      '按钮变为“我已接单”，localStorage 中该帖 orderStatus=accepted-local-demo 且 acceptedByMe=true',
      async ({ capture: cap }) => {
        const before = await page.readLocalStorageJson(STORAGE_KEY)
        const beforePost = (before?.state?.posts ?? []).find((post) => post.id === 'SYNTH-POST-001')
        assert(beforePost, 'fixture SYNTH-POST-001 should exist before accepting')
        assert(beforePost.orderStatus === 'open', `fixture should start as open (got ${beforePost.orderStatus})`)
        await page.clickByText(['演练接单'], {
          selector: 'button',
          withinSelector: 'article.post-card',
          withinText: FIXTURE_HELP_TITLE,
        })
        await page.waitForExpression(
          `(() => {
            const raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
            if (!raw) return false;
            const state = JSON.parse(raw).state;
            return state.posts.some((post) => post.id === 'SYNTH-POST-001' && post.orderStatus === 'accepted-local-demo' && post.acceptedByMe === true);
          })()`,
          { timeoutMs: 10000, label: 'SYNTH-POST-001 accepted' },
        )
        const snapshot = await readStorageSnapshot(page, '接单后', 'local-storage-after-accept.json')
        const accepted = snapshot.posts.find((post) => post.id === 'SYNTH-POST-001')
        assert(accepted.orderStatus === 'accepted-local-demo', `orderStatus should be accepted-local-demo (got ${accepted.orderStatus})`)
        assert(accepted.acceptedByMe === true, 'acceptedByMe should be true')
        const buttonState = await page.eval((title) => {
          const card = Array.from(document.querySelectorAll('article.post-card'))
            .find((item) => (item.innerText || '').includes(title))
          const buttons = Array.from(card?.querySelectorAll('button') ?? []).map((button) => ({
            text: (button.innerText || '').replace(/\s+/g, ' ').trim(),
            disabled: button.disabled,
          }))
          return {
            buttons,
            accept: buttons.find((button) => /接单|申请完成|我的求助/.test(button.text)) ?? null,
          }
        }, FIXTURE_HELP_TITLE)
        await cap('09-order-accepted')
        return `orderStatus：open → accepted-local-demo；acceptedByMe=true；卡片按钮=${JSON.stringify(buttonState.buttons)}`
      },
    )

    // 10. Profile service record.
    await step(
      '10',
      '查看“我的→服务记录”',
      '点击导航“我的”→ 切换到“服务记录”页签',
      '服务记录中出现已接单求助，状态为“我接单 · 我已演练接单”',
      async ({ capture: cap }) => {
        await page.clickNav('我的')
        await page.waitForText(['演练居民·禾禾'], { timeoutMs: 15000 })
        await page.clickByText(['服务记录'], { selector: '.profile-tabs button', exact: false })
        await page.waitForText([FIXTURE_HELP_TITLE, '我接单'], { timeoutMs: 10000 })
        const recordText = await page.eval(() => {
          const rows = Array.from(document.querySelectorAll('.service-record-row'))
          return rows.map((row) => row.innerText.replace(/\s+/g, ' ').trim())
        })
        const matched = recordText.some((text) => text.includes(FIXTURE_HELP_TITLE) && text.includes('我接单'))
        assert(matched, `service record should include the accepted order (rows: ${JSON.stringify(recordText)})`)
        await cap('10-profile-service-record')
        return `服务记录 ${recordText.length} 行；已接单求助显示“我接单 · 我已演练接单”`
      },
    )

    // 11. Persistence across reload.
    await step(
      '11',
      '刷新后状态保留',
      'Page.reload 后重新切成员并进入社区',
      '重载后身份回到访客（身份不持久化），切换成员后社区仍显示审核通过帖，接单状态仍为 accepted-local-demo',
      async ({ capture: cap }) => {
        await page.reload()
        await page.waitForSelector('.community-app', { timeoutMs: 20000 })
        const identity = await page.getMembership()
        assert(identity === 'visitor', `identity is intentionally not persisted; expected visitor after reload (got ${identity})`)
        await page.setMembership('member')
        await page.clickNav('社区')
        await page.waitForText([NEW_TITLE], { timeoutMs: 15000 })
        const envelope = await page.readLocalStorageJson(STORAGE_KEY)
        const accepted = (envelope?.state?.posts ?? []).find((post) => post.id === 'SYNTH-POST-001')
        assert(accepted?.orderStatus === 'accepted-local-demo', 'accepted orderStatus should persist after reload')
        assert(envelope?.state?.posts?.some((post) => post.title === NEW_TITLE && post.moderation === 'approved'), 'approved post should persist after reload')
        const storageCard = await page.bodyText()
        await cap('11-reload-persisted')
        return `重载后身份=visitor（身份本身不持久化，符合设计）；重新切成员后社区仍含审核通过帖；SYNTH-POST-001 orderStatus 仍为 accepted-local-demo`
      },
    )

    // 12. Feature probe for the phase-2 acceptance list (baseline expected gaps).
    await step(
      '12',
      '记录基线功能探针（供 B 段对照）',
      '在成员身份的社区页扫描 B 段验收所需操作文案的出现次数',
      '基线仅支持“演练接单/演练报名”，完成/取消/争议等文案不应出现',
      async ({ capture: cap }) => {
        const probe = await page.eval(() => {
          const labels = ['申请完成', '确认完成', '代对方确认', '取消订单', '取消接单', '发起争议', '恢复订单', '关闭订单', '取消报名', '已完成', '普通志愿记录']
          const nodes = Array.from(document.querySelectorAll('button, a'))
          const result = {}
          for (const label of labels) {
            result[label] = nodes.filter((node) => (node.innerText || '').includes(label)).length
          }
          return result
        })
        run.featureProbe = probe
        await cap('12-baseline-feature-probe')
        const zero = Object.entries(probe).filter(([, count]) => count === 0).map(([label]) => label)
        return `基线页面未出现的 B 段验收文案：${zero.join('、')}；已有文案：演练接单/演练报名（初始示例）`
      },
    )

    run.ok = true
    run.notes.push('基线为静态 dist 预览：构建产物是静态文件，不受并行修改 src 的热更新影响；但 dist 仍可能被并行构建覆盖，本次实际服务版本以上方 dist 构建时间为准。')
    run.notes.push('演练身份为前端内存状态，刷新后回到“访客”，这是当前设计；审核/接单等业务状态保存在 localStorage 并在刷新后保留。')
    run.notes.push('本脚本只读 dist 页面并在临时浏览器 profile 中写入本机 localStorage，未修改应用源码；运行结束后自动关闭浏览器并清理临时 profile。')
  } finally {
    run.pageErrors = page.pageErrors.slice()
    run.consoleErrors = page.consoleErrors.slice()
    await page.close()
    run.finishedAt = new Date().toISOString()
    run.steps.forEach((entry) => {
      if (!entry.ok && !entry.error) entry.error = '未执行（前序步骤失败）'
    })
    await writeRecord()
    console.log(`\n[check-community] record: ${relative(REPO_ROOT, join(OUT_DIR, `${RECORD}.md`))}`)
  }

  return run
}

try {
  const finished = await main()
  const passed = finished.steps.filter((step) => step.ok).length
  console.log(`\n[check-community] ${finished.ok ? 'PASS' : 'FAIL'} — ${passed}/${finished.steps.length} steps`)
  if (!finished.ok) process.exitCode = 1
} catch (error) {
  console.error(`\n[check-community] FAILED: ${error?.stack ?? error}`)
  process.exitCode = 1
}
