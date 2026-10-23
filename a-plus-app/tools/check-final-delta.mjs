/**
 * check-final-delta.mjs — delta checks for the FINAL dist build (task-6).
 *
 * New increments vs the previous acceptance run:
 *   1. a11y/focus: global :focus-visible deep green (#2a6049), search input focus ring,
 *      mobile (390px) 44px touch targets + 16px field font, desktop 1440 no layout break.
 *   2. messages page: 反馈与投诉（仅本机）form → localStorage complaints +1, list shown.
 *   3. messages page order list includes cancelled orders and the read-only branch.
 *   4. moderation page: 恢复为通过 / 恢复评论为通过 for rejected/hidden posts & comments.
 *   5. 我的页 storageError detail; long error toast extended to 6.5s.
 *   6. A+ bridge copy text: "含…各种本机订单状态，仅展示".
 *
 * Zero dependencies. The preview server must already serve the final dist.
 *
 * Usage:
 *   node tools/check-final-delta.mjs --base=http://127.0.0.1:5180 --prefix=final- --record=run-record-final-delta
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
const PREFIX = args.get('prefix') || 'final-'
const RECORD_BASE = args.get('record') || 'run-record-final-delta'

const T_FIXTURE = '求助：帮忙把两箱演练物资搬到活动室（虚构）'
const T_CANCEL = '求助：取消订单消息可见性验证（合成）'
const CONTENT_CANCEL = '这是用于验证“已取消订单在消息页可见且留言只读”的虚构求助，约十分钟。'
const T_RESTORE = '求助：审核驳回后恢复为通过验证（合成）'
const CONTENT_RESTORE = '这是用于验证审核页“恢复为通过”入口的虚构求助，约十分钟。'
const REVIEW_REASON = '虚构审核理由：仅合成演练数据，字段完整。'
const REJECT_REASON = '虚构审核理由：用于验证驳回后可恢复路径，内容仍为合成数据。'
const CANCEL_REASON = '虚构演练理由：计划变更，取消本机演练订单（用于消息页已取消订单可见性验证）。'
const FEEDBACK_SUBJECT = '演练反馈：消息页反馈表单验证（合成）'
const FEEDBACK_CONTENT = '这是一条只保存在当前浏览器 localStorage 的虚构反馈，不含真实姓名、电话或地址。'
const COMMENT_TEXT = '这是一条用于验证“恢复评论为通过”的虚构演练评论。'

const run = {
  script: 'tools/check-final-delta.mjs',
  suite: 'final-build delta (task-6)',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  ok: false,
  base: BASE,
  evidenceDir: OUT_DIR,
  recordBase: RECORD_BASE,
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  commands: {
    preview: 'npm run preview -- --host 127.0.0.1 --port 5180 --strictPort',
    check: 'node tools/check-final-delta.mjs --base=http://127.0.0.1:5180 --prefix=final- --record=run-record-final-delta',
  },
  browser: null,
  site: null,
  dist: null,
  assets: { community: [], aplus: [] },
  steps: [],
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
  return { entryUrl, status: response.status, htmlAssets: assets }
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

async function collectLoadedAssets(page) {
  const names = await page.eval(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => /\.(js|css)(\?|$)/.test(name)))
  const assets = []
  for (const name of [...new Set(names)].sort()) {
    try {
      const parsed = new URL(name)
      const response = await fetch(`${BASE}${parsed.pathname}${parsed.search}`, { signal: AbortSignal.timeout(8000) })
      const buffer = Buffer.from(await response.arrayBuffer())
      assets.push({ url: parsed.pathname + parsed.search, status: response.status, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') })
    } catch (error) {
      assets.push({ url: name, error: error.message })
    }
  }
  return assets
}

function findPost(state, key) {
  return (state?.posts ?? []).find((post) => post.id === key || post.title === key)
}

function renderRecordMarkdown(record) {
  const lines = []
  lines.push('# 最终构建增量复验（task-6）· 运行记录（自动生成）')
  lines.push('')
  lines.push(`- 运行脚本：\`${record.script}\``)
  lines.push(`- 运行时间：${localTime(record.startedAt)} → ${localTime(record.finishedAt)}`)
  lines.push(`- 站点：${record.base}；预览命令：\`${record.commands.preview}\``)
  lines.push(`- 实测命令：\`${record.commands.check}\`；Node：${record.node}；平台：${record.platform}`)
  if (record.dist) lines.push(`- dist 最新构建时间：${localTime(record.dist.newestModifiedAt)}（${record.dist.newestModifiedAt ?? '—'}）`)
  if (record.site) lines.push(`- 入口：${record.site.entryUrl}（HTTP ${record.site.status}）`)
  if (record.browser) lines.push(`- 浏览器：${record.browser.name} ${record.browser.version}（headless，CDP 端口 ${record.browser.port}）`)
  lines.push('')
  lines.push('## 实测资源哈希（页面实际加载，SHA-256 按服务端字节）')
  lines.push('')
  lines.push('| 页面 | 资源 | 字节 | SHA-256 |')
  lines.push('| --- | --- | --- | --- |')
  for (const [pageName, assets] of [['社区页', record.assets.community], ['A+ 页', record.assets.aplus]]) {
    for (const asset of assets) lines.push(`| ${pageName} | ${asset.url} | ${asset.bytes ?? '—'} | \`${asset.sha256 ?? asset.error ?? '—'}\` |`)
  }
  lines.push('')
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
  if (Object.keys(record.observations).length) {
    lines.push('## 关键观察')
    lines.push('')
    for (const [key, value] of Object.entries(record.observations)) lines.push(`- **${key}**：${value}`)
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

async function writeRecord() {
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, `${RECORD_BASE}.json`), `${JSON.stringify(run, null, 2)}\n`, 'utf8')
  await writeFile(join(OUT_DIR, `${RECORD_BASE}.md`), renderRecordMarkdown(run), 'utf8')
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  run.site = await collectSiteInfo()
  run.dist = await collectDistInfo()
  assert(run.site.status === 200, `community.html should answer HTTP 200 (got ${run.site.status})`)
  console.log(`[delta] site ${BASE}; dist built ${run.dist.newestModifiedAt}`)

  const page = await BrowserSession.launch({ browserPath: BROWSER_PATH, headless: true })
  run.browser = {
    name: page.browser.name,
    version: page.browserVersion?.Browser ?? 'unknown',
    port: page.port,
  }
  console.log(`[delta] browser ${run.browser.name} ${run.browser.version}`)

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
    console.log(`\n[delta] ${id}: ${title}`)
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
        await capture(entry, `${id.toLowerCase()}-failure`)
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
    throw new Error(`waitStorage timeout (${label}); help posts: ${JSON.stringify((last?.state?.posts ?? []).filter((post) => post.mode === 'help').map((post) => [post.title, post.orderStatus, post.moderation]))}`)
  }

  /** Click a button inside every card containing `title` (searches all cards). */
  const clickTextInCards = async (title, labels, { cardSelector = 'article.feedback-card', exact = true } = {}) => {
    const result = await page.eval((cardTitle, wantedLabels, selector, exactMatch) => {
      const norm = (value) => (value || '').replace(/\s+/g, ' ').trim()
      const wanted = wantedLabels.map(norm)
      const containers = Array.from(document.querySelectorAll(selector)).filter((node) => norm(node.innerText).includes(cardTitle))
      for (const container of containers) {
        for (const button of container.querySelectorAll('button')) {
          if (button.disabled) continue
          const text = norm(button.innerText)
          const matched = exactMatch ? wanted.includes(text) : wanted.some((label) => text.includes(label))
          if (matched) {
            button.scrollIntoView({ block: 'center', inline: 'nearest' })
            button.click()
            return { ok: true, text, containers: containers.length }
          }
        }
      }
      return { ok: false, containers: containers.length }
    }, title, labels, cardSelector, exact)
    if (!result.ok) throw new Error(`clickTextInCards(${title}, ${JSON.stringify(labels)}) not found; containers=${result.containers}`)
    return result
  }

  /** Click the first visible enabled button whose text matches exactly. */
  const clickButton = async (label) => page.clickByText([label], { selector: 'button', exact: true })

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

  const openModeration = async () => {
    await page.setMembership('reviewer')
    await page.waitForText(['审核员工作入口'], { timeoutMs: 10000 })
    await page.clickNav('审核')
    await page.waitForText(['内容与举报审核'], { timeoutMs: 15000 })
  }

  const backToCommunity = async () => {
    await page.setMembership('member')
    await page.clickNav('社区')
    await page.waitForText(['把日常分享出来'], { timeoutMs: 15000 })
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
    if (!result?.ok) throw new Error(`fillCardField failed: ${JSON.stringify(result)}`)
    return result
  }

  const clickLikeOnFirstCard = async () => page.eval(() => {
    const norm = (value) => (value || '').replace(/\s+/g, ' ').trim()
    for (const card of document.querySelectorAll('article.post-card')) {
      for (const button of card.querySelectorAll('.post-actions button')) {
        if (norm(button.innerText).startsWith('♡')) {
          button.scrollIntoView({ block: 'center' })
          button.click()
          return { clicked: true, text: norm(button.innerText) }
        }
      }
    }
    return { clicked: false }
  })

  /** Keyboard-focus probe: find an element whose :focus-visible outline is deep green. */
  const keyboardFocusProbe = async (maxTabs = 20) => {
    await page.eval(() => {
      document.activeElement?.blur?.()
      const body = document.body
      body.setAttribute('tabindex', '-1')
      body.focus()
      body.removeAttribute('tabindex')
    })
    for (let attempt = 0; attempt < maxTabs; attempt += 1) {
      await page.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
      await page.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
      await sleep(90)
      const info = await page.eval(() => {
        const element = document.activeElement
        if (!element) return null
        const style = getComputedStyle(element)
        return {
          tag: element.tagName,
          label: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          outlineColor: style.outlineColor,
          outlineWidth: style.outlineWidth,
          outlineStyle: style.outlineStyle,
          isSearch: element.matches('.search-box input'),
        }
      })
      if (info && info.outlineColor === 'rgb(42, 96, 73)' && info.outlineStyle !== 'none') return { method: 'tab', ...info, tabPresses: attempt + 1 }
    }
    // Fallback: after keyboard interaction, focus a known control programmatically.
    await page.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    const info = await page.eval(() => {
      const element = document.querySelector('.post-actions button') ?? document.querySelector('.side-nav button')
      element?.focus()
      if (!element) return null
      const style = getComputedStyle(element)
      return { tag: element.tagName, label: (element.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), outlineColor: style.outlineColor, outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle }
    })
    return info && info.outlineColor === 'rgb(42, 96, 73)' ? { method: 'programmatic-after-keyboard', ...info, tabPresses: -1 } : null
  }

  const styleRules = () => page.eval(() => {
    const texts = []
    const walk = (rules) => {
      for (const rule of rules) {
        texts.push(rule.cssText)
        if (rule.cssRules) walk(rule.cssRules)
      }
    }
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules)
      } catch {
        /* cross-origin sheet: skip */
      }
    }
    return texts
  })

  const DEEP_GREEN = 'rgb(42, 96, 73)'

  try {
    // ---------- S1: fresh setup on final build ----------
    await step('S1', '最终构建加载与重置', 'navigate /community.html → 清空 localStorage → 刷新 → 切 member', '页面挂载、身份 member、初始虚构示例', async ({ capture: cap }) => {
      await page.navigate(`${BASE}/community.html`)
      await page.waitForSelector('.community-app', { timeoutMs: 20000 })
      await page.clearLocalStorage()
      await page.reload()
      await page.waitForSelector('.community-app', { timeoutMs: 20000 })
      await page.setMembership('member')
      await page.waitForText(['你好，演练居民'], { timeoutMs: 15000 })
      run.assets.community = await collectLoadedAssets(page)
      assert(run.assets.community.some((asset) => /community-.*\.js$/.test(asset.url)), 'community JS asset should be loaded')
      await cap('delta-s1-setup')
      return `挂载成功；身份=member；加载资源：${run.assets.community.map((asset) => asset.url).join('、')}`
    })

    // ---------- M1: desktop focus-visible + layout sanity ----------
    await step('M1', '适老化/焦点样式（桌面 1440）', '检查已加载 CSS 的 :focus-visible 规则、键盘 Tab 焦点环颜色、桌面布局无横向溢出', '全局焦点环为 #2a6049（深绿），搜索框焦点环存在；桌面 1440 无布局破坏', async ({ capture: cap }) => {
      const rules = await styleRules()
      const ruleIndex = (needle) => rules.findIndex((text) => text.includes(needle))
      const globalGreen = rules.findIndex((text) => text.includes('button:focus-visible') && text.includes(DEEP_GREEN) && text.includes('select:focus-visible'))
      const oldLightRule = rules.findIndex((text) => text.includes(':focus-visible') && text.includes('rgb(135, 184, 154)'))
      const searchRule = rules.findIndex((text) => text.includes('.search-box input:focus-visible') && text.includes(DEEP_GREEN) && text.includes('2px'))
      assert(globalGreen >= 0, `global :focus-visible deep-green rule should exist (rules: ${rules.length})`)
      assert(ruleIndex(':focus-visible') >= 0, ':focus-visible rules should be loaded')
      assert(searchRule >= 0, 'search input :focus-visible ring rule should exist')
      if (oldLightRule >= 0) assert(globalGreen > oldLightRule, `deep-green rule should come after the legacy light rule (old=${oldLightRule}, new=${globalGreen})`)
      const focus = await keyboardFocusProbe()
      assert(focus, 'keyboard Tab focus should produce a deep green focus-visible outline')
      const layout = await page.eval(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector)
          if (!element) return null
          const box = element.getBoundingClientRect()
          return { x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height), visible: box.width > 0 && box.height > 0 }
        }
        return {
          viewportWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          app: rect('.community-app'),
          sideNav: rect('.side-nav'),
          main: rect('.main-column'),
          postCard: rect('article.post-card'),
        }
      })
      assert(layout.scrollWidth <= layout.viewportWidth + 1, `desktop should have no horizontal overflow (scrollWidth=${layout.scrollWidth}, viewport=${layout.viewportWidth})`)
      assert(layout.sideNav?.visible, 'desktop sidebar should be visible')
      assert(layout.main && layout.main.width > 700, `desktop main column should keep its width (${JSON.stringify(layout.main)})`)
      assert(layout.postCard?.visible, 'post card should be visible on desktop')
      run.observations['焦点环'] = JSON.stringify({ globalRuleFound: globalGreen >= 0, searchRuleFound: searchRule >= 0, keyboardFocus: focus })
      run.observations['桌面布局'] = JSON.stringify(layout)
      await cap('delta-m1-focus-desktop')
      return `深绿焦点环规则存在（全局=${globalGreen >= 0}、搜索框=${searchRule >= 0}，旧浅色规则之后）；键盘 Tab 焦点=${JSON.stringify(focus)}；桌面无横向溢出（scrollWidth=${layout.scrollWidth}/viewport=${layout.viewportWidth}）`
    })

    // ---------- M2: mobile 390px touch targets / font sizes ----------
    await step('M2', '适老化/触控目标（移动端 390×844）', 'Emulation 切换 390×844 移动视口 → 社区页检查 44px 触控目标、16px 输入字号、无横向溢出', '输入/标题 16px，按钮/图标 ≥44px，无横向溢出', async ({ capture: cap }) => {
      await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      await page.reload()
      await page.waitForSelector('.community-app', { timeoutMs: 20000 })
      await page.setMembership('member')
      await page.clickByText(['社区'], { selector: '.side-nav button, .mobile-nav button', exact: false })
      await page.waitForText(['把日常分享出来'], { timeoutMs: 15000 })
      const probe = await page.eval(() => {
        const styleOf = (selector) => {
          const element = document.querySelector(selector)
          if (!element) return null
          const style = getComputedStyle(element)
          const box = element.getBoundingClientRect()
          return { fontSize: style.fontSize, height: Math.round(box.height), width: Math.round(box.width), visible: box.width > 0 && box.height > 0 }
        }
        const heights = (selector) => Array.from(document.querySelectorAll(selector)).map((element) => Math.round(element.getBoundingClientRect().height))
        return {
          viewportWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          searchInput: styleOf('.search-box input'),
          membershipSelect: styleOf('.membership-panel select'),
          postTitle: styleOf('.post-title'),
          postActionButtons: heights('.post-actions button'),
          filterButtons: heights('.filter-row button'),
          orderActionButtons: heights('.order-actions button'),
          iconButtons: heights('.icon-button'),
          mobileNavButtons: heights('.mobile-nav button'),
          sideNavDisplay: document.querySelector('.side-nav') ? getComputedStyle(document.querySelector('.side-nav')).display : null,
        }
      })
      assert(probe.scrollWidth <= probe.viewportWidth + 1, `mobile should have no horizontal overflow (scrollWidth=${probe.scrollWidth}, viewport=${probe.viewportWidth})`)
      assert(probe.searchInput?.fontSize === '16px', `search input font-size should be 16px on mobile (got ${probe.searchInput?.fontSize})`)
      assert(probe.membershipSelect?.fontSize === '16px', `membership select font-size should be 16px (got ${probe.membershipSelect?.fontSize})`)
      assert(probe.postTitle?.fontSize === '16px', `post title font-size should be 16px (got ${probe.postTitle?.fontSize})`)
      const checkHeights = (name, values, minimum = 44) => {
        if (!values.length) return
        const small = values.filter((value) => value < minimum)
        assert(small.length === 0, `${name} should be >= ${minimum}px on mobile (got ${JSON.stringify(values)})`)
      }
      checkHeights('post action buttons', probe.postActionButtons)
      checkHeights('filter buttons', probe.filterButtons)
      checkHeights('order action buttons', probe.orderActionButtons)
      checkHeights('icon buttons', probe.iconButtons)
      checkHeights('mobile nav buttons', probe.mobileNavButtons)
      run.observations['移动端 390px'] = JSON.stringify(probe)
      await cap('delta-m2-mobile-390')
      // back to desktop
      await page.client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
      await page.reload()
      await page.waitForSelector('.community-app', { timeoutMs: 20000 })
      return `无横向溢出（${probe.scrollWidth}/${probe.viewportWidth}）；输入=${probe.searchInput?.fontSize}、标题=${probe.postTitle?.fontSize}；触控目标全部 ≥44px（post-actions=${JSON.stringify(probe.postActionButtons)}、order-actions=${JSON.stringify(probe.orderActionButtons)}）`
    })

    // ---------- FB1: feedback & complaint form ----------
    await step('FB1', '消息页反馈与投诉（仅本机）提交', '消息页填写“反馈主题/反馈内容”→ 保存本机反馈', 'localStorage complaints +1，页面列表出现该条并标注仅本机/仅本机保存说明', async ({ capture: cap }) => {
      await page.setMembership('member')
      const beforeCount = await page.eval(() => {
        const app = document.querySelector('#app')?.__vue_app__
        const pinia = app?.config?.globalProperties?.$pinia
        const store = pinia?._s?.get('community')
        return store ? store.complaints.length : null
      })
      assert(typeof beforeCount === 'number', 'community store should be reachable to count complaints')
      await page.clickNav('消息')
      await page.waitForText(['反馈与投诉（仅本机）'], { timeoutMs: 15000 })
      await page.fillByLabel('反馈主题', FEEDBACK_SUBJECT)
      await page.fillByLabel('反馈内容', FEEDBACK_CONTENT)
      await clickButton('保存本机反馈')
      const envelope = await waitStorage((state) => {
        const complaints = state.complaints ?? []
        return complaints.some((item) => item.subject === FEEDBACK_SUBJECT) && complaints.length === beforeCount + 1
      }, 'submit feedback')
      const complaint = envelope.state.complaints.find((item) => item.subject === FEEDBACK_SUBJECT)
      assert(complaint, 'new complaint should be stored')
      assert(complaint.statusNote.includes('仅保存在本机演示数据中'), `complaint statusNote should say local-only (got ${complaint.statusNote})`)
      assert(complaint.content === FEEDBACK_CONTENT, 'complaint content should match input')
      const lists = await page.eval(() => Array.from(document.querySelectorAll('.messages-page .feedback-card')).map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()))
      const listed = lists.find((text) => text.includes(FEEDBACK_SUBJECT))
      assert(listed, `complaint should appear in the local list (got ${JSON.stringify(lists)})`)
      assert(listed.includes('仅本机'), 'complaint list row should be marked 仅本机')
      run.observations['反馈与投诉'] = JSON.stringify({ beforeCount, afterCount: envelope.state.complaints.length, complaintId: complaint.id, statusNote: complaint.statusNote, listed: listed.slice(0, 160) })
      await page.scrollToText(FEEDBACK_SUBJECT)
      await cap('delta-fb1-feedback')
      return `complaints ${beforeCount}→${envelope.state.complaints.length}（${complaint.id}）；列表显示“${FEEDBACK_SUBJECT} · 仅本机”；状态说明：${complaint.statusNote}`
    })

    // ---------- CO1: create a cancelled order ----------
    await step('CO1', '创建一笔已取消订单（发布→审核→代接单→取消）', `发布「${T_CANCEL}」→ 审核通过 → 代合成邻居接单 → 取消并填原因`, '订单最终 orderStatus=cancelled-local-demo', async ({ capture: cap }) => {
      await publishHelp(T_CANCEL, CONTENT_CANCEL, '下周三 10:00–10:30', '约 15 分钟')
      await openModeration()
      await page.waitForText(['内容与举报审核', T_CANCEL], { timeoutMs: 15000 })
      await page.setValue('.moderation-reason textarea', REVIEW_REASON)
      await page.clickByText(['通过'], { selector: 'button', withinSelector: 'article.feedback-card', withinText: T_CANCEL })
      await page.waitForText(['暂无待审发布。'], { timeoutMs: 15000 })
      await backToCommunity()
      await page.waitForText([T_CANCEL], { timeoutMs: 15000 })
      await clickTextInCards(T_CANCEL, ['代合成邻居接单（演练）'], { cardSelector: 'article.post-card' })
      await waitStorage((state) => findPost(state, T_CANCEL)?.orderStatus === 'accepted-local-demo', 'counterpart accept cancel-order')
      await clickTextInCards(T_CANCEL, ['取消/关闭订单（演练）'], { cardSelector: 'article.post-card' })
      await fillCardField(T_CANCEL, '.order-action-form textarea', CANCEL_REASON)
      await clickTextInCards(T_CANCEL, ['提交本机记录'], { cardSelector: 'article.post-card' })
      const envelope = await waitStorage((state) => findPost(state, T_CANCEL)?.orderStatus === 'cancelled-local-demo', 'cancel order')
      const post = findPost(envelope.state, T_CANCEL)
      run.observations['已取消订单'] = JSON.stringify({ id: post.id, orderStatus: post.orderStatus, events: (post.orderEvents ?? []).map((event) => `${event.type}/${event.actor}`) })
      await page.scrollToText(T_CANCEL)
      await cap('delta-co1-cancelled-created')
      return `${post.id} orderStatus=cancelled-local-demo；事件=${JSON.stringify(run.observations['已取消订单'])}`
    })

    // ---------- CO2: cancelled order visible in messages + read-only ----------
    await step('CO2', '消息页已取消订单可见且留言只读', '消息页订单列表检查已取消订单 → 点开该订单', '列表显示“已取消/关闭（本机演练）”；点开后显示只读提示且无留言输入框', async ({ capture: cap }) => {
      await page.clickNav('消息')
      await page.waitForText([T_CANCEL], { timeoutMs: 15000 })
      const threads = await page.eval(() => Array.from(document.querySelectorAll('.messages-page .thread-list .thread-item')).map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()))
      const cancelledItem = threads.find((text) => text.includes(T_CANCEL))
      assert(cancelledItem, `cancelled order should be listed in messages (got ${JSON.stringify(threads)})`)
      assert(cancelledItem.includes('已取消/关闭（本机演练）'), `cancelled order row should show cancelled status (got ${cancelledItem})`)
      await page.clickByText([T_CANCEL], { selector: '.messages-page .thread-list .thread-item', exact: false })
      await page.waitForSelector('.messages-page .chat-readonly-note', { timeoutMs: 10000 })
      const readOnly = await page.eval(() => document.querySelector('.messages-page .chat-readonly-note')?.innerText ?? '')
      const composerCount = await page.count('.messages-page .chat-composer')
      assert(readOnly.includes('该订单已关闭（本机演练），不能再新增留言'), `cancelled order read-only text unexpected: ${readOnly}`)
      assert(composerCount === 0, 'cancelled order should not show a message composer')
      run.observations['已取消订单消息页'] = JSON.stringify({ listed: cancelledItem, readOnly, composerCount })
      await cap('delta-co2-cancelled-readonly')
      return `列表项：${cancelledItem}；只读提示：${readOnly}；留言输入框数量=${composerCount}`
    })

    // ---------- MR1: rejected post → 恢复为通过 ----------
    await step('MR1', '审核页：驳回的帖子可“恢复为通过”', `发布「${T_RESTORE}」→ 审核员驳回 → 内容管理点“恢复为通过”`, '驳回后出现“恢复为通过”按钮；点击后 moderation=approved', async ({ capture: cap }) => {
      await backToCommunity()
      await publishHelp(T_RESTORE, CONTENT_RESTORE, '下周四 15:00–15:30', '约 20 分钟')
      await openModeration()
      await page.waitForText(['内容与举报审核', T_RESTORE], { timeoutMs: 15000 })
      await page.setValue('.moderation-reason textarea', REJECT_REASON)
      await page.clickByText(['驳回'], { selector: 'button', withinSelector: 'article.feedback-card', withinText: T_RESTORE })
      const rejected = await waitStorage((state) => findPost(state, T_RESTORE)?.moderation === 'rejected', 'reject post')
      assert(rejected, 'post should be rejected')
      await page.waitForText(['恢复为通过'], { timeoutMs: 10000 })
      await page.scrollToText(T_RESTORE)
      await cap('delta-mr1-rejected')
      await page.setValue('.moderation-reason textarea', REVIEW_REASON)
      await clickTextInCards(T_RESTORE, ['恢复为通过'])
      const restored = await waitStorage((state) => findPost(state, T_RESTORE)?.moderation === 'approved', 'restore rejected post')
      assert(restored, 'post should be restored to approved')
      const buttons = await page.eval((title) => {
        const norm = (value) => (value || '').replace(/\s+/g, ' ').trim()
        const card = Array.from(document.querySelectorAll('article.feedback-card')).find((node) => norm(node.innerText).includes(title))
        return Array.from(card?.querySelectorAll('button') ?? []).map((button) => norm(button.innerText))
      }, T_RESTORE)
      assert(buttons.includes('下架帖子'), `restored post should now offer 下架帖子 (buttons: ${JSON.stringify(buttons)})`)
      run.observations['驳回后恢复'] = JSON.stringify({ rejected: true, restoredModeration: 'approved', buttons })
      await page.scrollToText(T_RESTORE)
      await cap('delta-mr1-restored')
      return `驳回→“恢复为通过”按钮出现并点击成功；moderation 恢复 approved；按钮变为 ${JSON.stringify(buttons)}`
    })

    // ---------- MR2: hidden post → 恢复为通过 ----------
    await step('MR2', '审核页：下架的帖子可“恢复为通过”', '内容管理点“下架帖子”→ 确认 hidden → 点“恢复为通过”', 'hidden 后出现“恢复为通过”；点击后 moderation=approved', async ({ capture: cap }) => {
      await page.setValue('.moderation-reason textarea', REVIEW_REASON)
      await clickTextInCards(T_RESTORE, ['下架帖子'])
      const hidden = await waitStorage((state) => findPost(state, T_RESTORE)?.moderation === 'hidden', 'hide post')
      assert(hidden, 'post should be hidden')
      await page.waitForText(['恢复为通过'], { timeoutMs: 10000 })
      await page.scrollToText(T_RESTORE)
      await cap('delta-mr2-hidden')
      await page.setValue('.moderation-reason textarea', REVIEW_REASON)
      await clickTextInCards(T_RESTORE, ['恢复为通过'])
      const restored = await waitStorage((state) => findPost(state, T_RESTORE)?.moderation === 'approved', 'restore hidden post')
      assert(restored, 'hidden post should be restored to approved')
      run.observations['下架后恢复'] = JSON.stringify({ hidden: true, restoredModeration: 'approved' })
      await page.scrollToText(T_RESTORE)
      await cap('delta-mr2-restored')
      return '下架→“恢复为通过”点击成功；moderation 恢复 approved'
    })

    // ---------- MR3: rejected/hidden comment → 恢复评论为通过 ----------
    await step('MR3', '审核页：驳回/下架的评论可“恢复评论为通过”', '成员在帖子下发评论 → 审核员驳回 → “恢复评论为通过” → 下架评论 → 恢复评论为通过', '评论 rejected/hidden 时都出现恢复按钮，点击后 moderation=approved', async ({ capture: cap }) => {
      await backToCommunity()
      await page.waitForText([T_RESTORE], { timeoutMs: 15000 })
      // open comment composer on the restored post card
      await clickTextInCards(T_RESTORE, ['条评论'], { cardSelector: 'article.post-card', exact: false })
      await fillCardField(T_RESTORE, '.comment-form input', COMMENT_TEXT)
      await clickTextInCards(T_RESTORE, ['发送'], { cardSelector: 'article.post-card' })
      let envelope = await waitStorage((state) => {
        const post = findPost(state, T_RESTORE)
        return (post?.comments ?? []).some((comment) => comment.content === COMMENT_TEXT && comment.moderation === 'pending')
      }, 'comment pending')
      const pendingComment = findPost(envelope.state, T_RESTORE).comments.find((comment) => comment.content === COMMENT_TEXT)
      await openModeration()
      await page.waitForText(['待审评论', T_RESTORE], { timeoutMs: 15000 })
      await page.setValue('.moderation-reason textarea', REJECT_REASON)
      await clickButton('驳回评论')
      envelope = await waitStorage((state) => findPost(state, T_RESTORE)?.comments.find((comment) => comment.content === COMMENT_TEXT)?.moderation === 'rejected', 'reject comment')
      await page.waitForText(['恢复评论为通过'], { timeoutMs: 10000 })
      await page.scrollToText(COMMENT_TEXT)
      await cap('delta-mr3-comment-rejected')
      await page.setValue('.moderation-reason textarea', REVIEW_REASON)
      await clickTextInCards(T_RESTORE, ['恢复评论为通过'])
      envelope = await waitStorage((state) => findPost(state, T_RESTORE)?.comments.find((comment) => comment.content === COMMENT_TEXT)?.moderation === 'approved', 'restore rejected comment')
      // hide the approved comment, then restore it again
      await page.setValue('.moderation-reason textarea', REVIEW_REASON)
      await clickTextInCards(T_RESTORE, ['下架评论'])
      envelope = await waitStorage((state) => findPost(state, T_RESTORE)?.comments.find((comment) => comment.content === COMMENT_TEXT)?.moderation === 'hidden', 'hide comment')
      await page.waitForText(['恢复评论为通过'], { timeoutMs: 10000 })
      await page.scrollToText(COMMENT_TEXT)
      await cap('delta-mr3-comment-hidden')
      await page.setValue('.moderation-reason textarea', REVIEW_REASON)
      await clickTextInCards(T_RESTORE, ['恢复评论为通过'])
      envelope = await waitStorage((state) => findPost(state, T_RESTORE)?.comments.find((comment) => comment.content === COMMENT_TEXT)?.moderation === 'approved', 'restore hidden comment')
      const commentStatus = findPost(envelope.state, T_RESTORE).comments.find((comment) => comment.content === COMMENT_TEXT).moderation
      run.observations['评论恢复'] = JSON.stringify({ commentId: pendingComment.id, finalModeration: commentStatus, rejectedRestore: true, hiddenRestore: true })
      await cap('delta-mr3-comment-restored')
      return `评论 ${pendingComment.id}：驳回→恢复评论为通过；下架评论→恢复评论为通过；最终 moderation=${commentStatus}`
    })

    // ---------- AB1: A+ bridge copy text ----------
    await step('AB1', 'A+ 读取器说明文案（含各种本机订单状态）', '打开 A+ 入口 / → “社区求助（本机演练）”', '说明文案含“含待接单、进行中、已完成或已关闭等状态，仅展示”且无“登记状态无效”', async ({ capture: cap }) => {
      await page.navigate(`${BASE}/`)
      await page.waitForText(['受控登记队列'], { timeoutMs: 20000 })
      await page.clickByText(['社区求助（本机演练）'], { selector: 'button', exact: true })
      await page.waitForSelector('.bridge-modal', { timeoutMs: 10000 })
      await page.waitForText(['社区状态：'], { timeoutMs: 10000 })
      const info = await page.eval(() => {
        const text = (document.querySelector('.bridge-modal')?.innerText ?? '').replace(/\s+/g, ' ').trim()
        return {
          hasNewCopy: text.includes('含待接单、进行中、已完成或已关闭等状态，仅展示'),
          hasInvalidStatusError: text.includes('登记状态无效'),
          status: (document.querySelector('.bridge-modal .bridge-status')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
          postCount: document.querySelectorAll('.bridge-modal .bridge-post').length,
        }
      })
      assert(info.hasNewCopy, `A+ bridge copy should mention all local order states, got: ${info.status}`)
      assert(!info.hasInvalidStatusError, 'A+ bridge should not report 登记状态无效')
      assert(info.status.includes('已读取'), `A+ bridge should report a successful read (got ${info.status})`)
      assert(info.postCount >= 3, `A+ bridge should list approved help posts (got ${info.postCount})`)
      run.assets.aplus = await collectLoadedAssets(page)
      run.observations['A+ 说明文案'] = JSON.stringify(info)
      await cap('delta-ab1-aplus-copy')
      return `A+ 读取「${info.status}」，列出 ${info.postCount} 条；文案含“含待接单、进行中、已完成或已关闭等状态，仅展示”；无“登记状态无效”`
    })

    // ---------- SE1: save-error detail shown on profile ----------
    await step('SE1', '我的页显示存档错误详情（save-error）', '模拟 localStorage.setItem 抛错 → 触发一次写入动作 → 打开“我的”', '存档卡片显示“最近一次写入失败”及 storageError 详情文本', async ({ capture: cap }) => {
      await page.navigate(`${BASE}/community.html`)
      await page.waitForSelector('.community-app', { timeoutMs: 20000 })
      await page.setMembership('member')
      await page.clickNav('社区')
      await page.waitForText(['把日常分享出来'], { timeoutMs: 15000 })
      await page.eval((key) => {
        const original = Storage.prototype.setItem
        window.__dshOriginalSetItem = original
        Storage.prototype.setItem = function patchedSetItem(storageKey, storageValue) {
          if (storageKey === key) {
            const error = new Error('simulated quota exceeded for verification')
            error.name = 'QuotaExceededError'
            throw error
          }
          return original.call(this, storageKey, storageValue)
        }
      }, STORAGE_KEY)
      const liked = await clickLikeOnFirstCard()
      assert(liked?.clicked, 'should click a like button to trigger a write attempt')
      await sleep(300)
      // restore the real setItem before reading further
      await page.eval(() => {
        if (window.__dshOriginalSetItem) {
          Storage.prototype.setItem = window.__dshOriginalSetItem
          window.__dshOriginalSetItem = null
        }
      })
      await page.clickNav('我的')
      await page.waitForText(['本机演练存档'], { timeoutMs: 15000 })
      const profile = await page.eval(() => ({
        cardText: (document.querySelector('.profile-storage-card')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
        errorDetail: (document.querySelector('.storage-error-detail')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
        downloadButton: Array.from(document.querySelectorAll('.profile-storage-card button')).map((button) => (button.innerText || '').trim()),
      }))
      assert(profile.cardText.includes('最近一次写入失败'), `storage card should show save-error copy (got ${profile.cardText})`)
      assert(profile.errorDetail.includes('本机存档写入失败'), `storage error detail should show storageError text (got ${profile.errorDetail})`)
      run.observations['存档错误详情（save-error）'] = JSON.stringify(profile)
      await page.scrollToText('本机演练存档')
      await cap('delta-se1-save-error')
      return `存档卡片文案含“最近一次写入失败”；storageError 详情：${profile.errorDetail}`
    })

    // ---------- SE2: long error toast duration (6.5s) + recovery-required detail ----------
    await step('SE2', '长错误 toast 延长到 6.5s + recovery-required 详情', '写入损坏存档 → 刷新 → 触发一次被阻止的写入动作 → 观察 toast 存活时间与“我的”错误详情', 'toast 文本为长错误信息，3.5s 仍可见、约 7.6s 已消失；我的页显示错误详情', async ({ capture: cap }) => {
      await page.eval((key) => window.localStorage.setItem(key, '{这个存档故意损坏用于验证恢复提示'), STORAGE_KEY)
      await page.reload()
      await page.waitForSelector('.community-app', { timeoutMs: 20000 })
      await page.setMembership('member')
      await page.clickNav('社区')
      await page.waitForText(['把日常分享出来'], { timeoutMs: 15000 })
      const clicked = await clickLikeOnFirstCard()
      assert(clicked?.clicked, 'should click a like button while storage is in recovery-required state')
      await sleep(400)
      const toastEarly = await page.eval(() => (document.querySelector('.toast-message')?.innerText ?? '').replace(/\s+/g, ' ').trim())
      assert(toastEarly.includes('本机有一份无法读取或版本不受支持的社区演练存档'), `toast should show the long recovery-required error (got ${toastEarly})`)
      assert(toastEarly.length > 60, `toast text should be long enough to use the 6.5s timer (length=${toastEarly.length})`)
      await cap('delta-se2-long-toast')
      await sleep(3100)
      const toastAt3500 = await page.eval(() => document.querySelector('.toast-message')?.innerText ?? '')
      await sleep(4200)
      const toastAt7600 = await page.eval(() => document.querySelector('.toast-message')?.innerText ?? '')
      assert(toastAt3500.trim().length > 0, 'long error toast should still be visible at ~3.5s (6.5s timer)')
      assert(toastAt7600.trim().length === 0, 'long error toast should be gone by ~7.6s')
      await page.clickNav('我的')
      await page.waitForText(['本机演练存档'], { timeoutMs: 15000 })
      const profile = await page.eval(() => ({
        cardText: (document.querySelector('.profile-storage-card')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
        errorDetail: (document.querySelector('.storage-error-detail')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
        buttons: Array.from(document.querySelectorAll('.profile-storage-card button')).map((button) => (button.innerText || '').trim()),
      }))
      assert(profile.errorDetail.length > 0 && profile.errorDetail.includes('存档'), `recovery-required error detail should be shown (got ${profile.errorDetail})`)
      assert(profile.cardText.includes('存档需要处理'), `storage card should explain recovery-required (got ${profile.cardText})`)
      assert(profile.buttons.includes('下载原始存档'), `recovery-required should offer 下载原始存档 (buttons: ${JSON.stringify(profile.buttons)})`)
      run.observations['长错误 toast'] = JSON.stringify({ toastLength: toastEarly.length, visibleAt3500: toastAt3500.trim().length > 0, visibleAt7600: toastAt7600.trim().length > 0, toastText: toastEarly })
      run.observations['recovery-required 详情'] = JSON.stringify(profile)
      await page.scrollToText('本机演练存档')
      await cap('delta-se2-recovery-detail')
      return `toast（${toastEarly.length} 字符）3.5s 仍可见、7.6s 已消失；我的页错误详情=${profile.errorDetail}；按钮含“下载原始存档”`
    })

    run.ok = true
    run.notes.push('本次为最终构建（dist mtime 见上）的增量复验；基线 12/12 与验收 36/36 已用同机构建另行重跑并通过（见 run-record-final-baseline.md / run-record-final-acceptance.md）。')
    run.notes.push('移动端检查通过 CDP Emulation.setDeviceMetricsOverride 390×844 完成，桌面检查使用 1440×1000；不属于真实设备测试。')
    run.notes.push('save-error 通过临时 patch Storage.prototype.setItem 抛错模拟；recovery-required 通过写入损坏 JSON 模拟；均为本机合成数据与临时浏览器 profile，脚本结束即清理。')
    run.notes.push('未修改任何应用源码；A+ 页只读验证；所有证据前缀 final-。')
  } finally {
    run.pageErrors = page.pageErrors.slice()
    run.consoleErrors = page.consoleErrors.slice()
    await page.close()
    run.finishedAt = new Date().toISOString()
    await writeRecord()
    console.log(`\n[delta] record: ${relative(REPO_ROOT, join(OUT_DIR, `${RECORD_BASE}.md`))}`)
  }
  return run
}

try {
  const finished = await main()
  const passed = finished.steps.filter((step) => step.ok).length
  console.log(`\n[delta] ${finished.ok ? 'PASS' : 'FAIL'} — ${passed}/${finished.steps.length} steps`)
  if (!finished.ok) process.exitCode = 1
} catch (error) {
  console.error(`\n[delta] FAILED: ${error?.stack ?? error}`)
  process.exitCode = 1
}
