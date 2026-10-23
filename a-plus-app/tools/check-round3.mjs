// Solo acceptance run for the 2026-10-21 evening additions:
//   - large-reading mode (local preference persisted in localStorage)
//   - unread system-notice badge + explicit mark-as-read
//   - report reporter field, pending-report de-duplication, create-report audit entry
//   - publish draft autosave / restore / clear
// Run: node tools/check-round3.mjs --base=http://127.0.0.1:5180
// Requires a static `dist` preview (npm run preview) on the given base URL.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const evidenceDir = join(repoRoot, '..', 'docs', '运营准备', 'evidence-B-order-round3')

const COMMUNITY_KEY = 'community-mvp.synthetic-state.v1'
const DRAFT_KEY = 'community-mvp.publish-draft.v1'
const READING_KEY = 'community-mvp.reading-mode.v1'

const args = new Map()
for (const raw of process.argv.slice(2)) {
  const [key, ...rest] = raw.replace(/^--/, '').split('=')
  args.set(key, rest.join('='))
}
const base = (args.get('base') || 'http://127.0.0.1:5180').replace(/\/$/, '')
const prefix = args.get('prefix') || 'r3'

const steps = []
const observations = {}
let failures = 0

function step(id, name, expected, actual, ok, shot) {
  steps.push({ id, name, expected, actual, ok, shot: shot ?? '' })
  if (!ok) failures += 1
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${id} ${name} — ${actual}`)
}

async function shot(page, name) {
  const file = join(evidenceDir, `${prefix}-${name}.png`)
  await page.screenshot(file)
  return file
}

async function text(page, name) {
  const file = join(evidenceDir, `${prefix}-${name}.txt`)
  await page.savePageText(file)
  return file
}

async function storeEval(page, fn, ...args) {
  return page.eval((...a) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    return (new Function('store', 'args', `return (${fn})(store, ...args)`))(store, a)
  }, ...args)
}

async function publishHelp(page, title) {
  await page.clickByText('发布', { selector: '.side-nav button', exact: false })
  await page.waitForText('发布一件小事')
  await page.fillByLabel('标题', title)
  await page.fillByLabel('需求说明', '这是一条用于本机流程验证的虚构求助，不包含真实个人信息。')
  await page.fillByLabel('希望时段', '本周五 15:00')
  await page.fillByLabel('预计时长', '约 1 小时')
  await page.checkSelector('.confirm-synthetic input')
  const confirmed = await page.eval(() => document.querySelector('.confirm-synthetic input')?.checked === true)
  if (!confirmed) throw new Error('synthetic confirmation checkbox did not become checked')
  await page.clickSelector('.publish-form .submit-button')
  await page.waitForText('我的发布')
}

async function approveFirstPending(page, reason) {
  await page.setMembership('reviewer')
  await page.clickByText('审核', { selector: '.side-nav button', exact: false })
  await page.waitForText('内容与举报审核')
  await page.fillByLabel('本次审核或处理理由', reason)
  await page.clickByText('通过', { selector: '.moderation-page button', exact: true })
  await sleep(400)
  await page.setMembership('member')
  await page.clickNav('我的')
  await page.waitForText('我的发布')
}

async function main() {
  await mkdir(evidenceDir, { recursive: true })

  await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
    // ---------------------------------------------------------------- setup
    await page.navigate(`${base}/community.html`)
    await page.clearLocalStorage()
    await page.reload()
    await page.waitForSelector('.community-app')
    await page.setMembership('member')
    await page.waitForSelector('.post-card')
    await shot(page, '0-setup')

    // ------------------------------------------------------ 1 reading mode
    const initial = await page.eval(() => {
      const toggle = document.querySelector('.reading-toggle')
      const title = document.querySelector('.post-title')
      return {
        pressed: toggle?.getAttribute('aria-pressed'),
        large: document.querySelector('.community-app')?.classList.contains('reading-large'),
        font: title ? getComputedStyle(title).fontSize : '',
      }
    })
    await page.clickSelector('.reading-toggle')
    await page.waitForExpression("document.querySelector('.community-app').classList.contains('reading-large')")
    await sleep(200)
    const large = await page.eval(() => {
      const toggle = document.querySelector('.reading-toggle')
      const title = document.querySelector('.post-title')
      return {
        pressed: toggle?.getAttribute('aria-pressed'),
        font: title ? getComputedStyle(title).fontSize : '',
        stored: localStorage.getItem('community-mvp.reading-mode.v1'),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }
    })
    const fontSize = (value) => Number.parseFloat(String(value)) || 0
    step('R1', '开启大字阅读模式', 'class reading-large 生效、aria-pressed=true、字体变大、选择被持久化',
      `class=${large.large !== false} pressed=${large.pressed} font ${initial.font}→${large.font} stored=${large.stored} overflow=${large.overflow}`,
      large.pressed === 'true' && fontSize(large.font) > fontSize(initial.font) && large.stored === 'large' && large.overflow <= 1,
      await shot(page, '1-reading-large'))
    await text(page, '1-reading-large')

    await page.reload()
    await page.waitForSelector('.community-app')
    await page.setMembership('member')
    const persisted = await page.eval(() => ({
      large: document.querySelector('.community-app')?.classList.contains('reading-large'),
      pressed: document.querySelector('.reading-toggle')?.getAttribute('aria-pressed'),
      stored: localStorage.getItem('community-mvp.reading-mode.v1'),
    }))
    step('R2', '刷新后保持大字模式', '刷新后仍为 reading-large 且 aria-pressed=true',
      `large=${persisted.large} pressed=${persisted.pressed}`, persisted.large === true && persisted.pressed === 'true',
      await shot(page, '2-reading-persisted'))

    await page.clickSelector('.reading-toggle')
    await page.waitForExpression("!document.querySelector('.community-app').classList.contains('reading-large')")
    const normal = await page.eval(() => ({
      stored: localStorage.getItem('community-mvp.reading-mode.v1'),
      font: getComputedStyle(document.querySelector('.post-title')).fontSize,
    }))
    step('R3', '关闭大字模式恢复常规', 'class 移除、偏好键删除、字号回到常规',
      `stored=${normal.stored} font=${normal.font}`, normal.stored === null && fontSize(normal.font) < fontSize(large.font),
      await shot(page, '3-reading-normal'))

    // --------------------------------------------------- 2 unread notices
    const fresh = await page.eval(() => ({
      badges: document.querySelectorAll('.nav-badge').length,
      title: document.title,
    }))
    step('U1', '初始未读通知为 0', '初始虚构通知视为历史已读，无角标、标题无计数',
      `badges=${fresh.badges} title=${fresh.title}`, fresh.badges === 0 && !fresh.title.startsWith('('),
      await shot(page, '4-unread-zero'))

    await publishHelp(page, '求助：验证本机未读通知（合成）')
    await approveFirstPending(page, '虚构审核理由：通知流程验证')
    await page.waitForText('我的发布')
    const afterNotice = await page.eval(() => {
      const badge = document.querySelector('.nav-badge')
      return { badge: badge?.textContent?.trim() ?? '', title: document.title }
    })
    step('U2', '审核通过生成未读通知', '消息角标出现计数，标题带未读前缀',
      `badge=${afterNotice.badge} title=${afterNotice.title}`,
      /^\d+$/.test(afterNotice.badge) && Number(afterNotice.badge) >= 1 && afterNotice.title.startsWith('('),
      await shot(page, '5-unread-badge'))

    await page.clickSelector('.topbar-message')
    await page.waitForText('全部标为已读')
    await shot(page, '6-unread-messages')
    await text(page, '6-unread-messages')
    await page.clickByText('全部标为已读')
    await page.waitForExpression("document.querySelectorAll('.nav-badge').length === 0", { timeoutMs: 8000 })
    const read = await page.eval(() => ({
      title: document.title,
      state: JSON.parse(localStorage.getItem('community-mvp.synthetic-state.v1') || 'null')?.state,
      unreadChip: document.body.innerText.includes('条未读'),
    }))
    step('U3', '全部标为已读', '角标消失、标题恢复、notificationsReadAt 已写入存档',
      `title=${read.title} readAt=${read.state?.notificationsReadAt ?? 'missing'} busyChip=${read.unreadChip}`,
      read.title.startsWith('(') === false && typeof read.state?.notificationsReadAt === 'string',
      await shot(page, '7-read'))

    await publishHelp(page, '求助：验证第二次未读计数（合成）')
    await approveFirstPending(page, '虚构审核理由：第二次通知验证')
    await page.waitForText('我的发布')
    const again = await page.eval(() => document.querySelector('.nav-badge')?.textContent?.trim() ?? '')
    step('U4', '新通知再次计为未读', '标为已读后新通知重新出现角标',
      `badge=${again}`, /^\d+$/.test(again) && Number(again) >= 1, await shot(page, '8-unread-again'))

    // -------------------------------------------------- 3 report integrity
    await page.clickByText('社区', { selector: '.side-nav button', exact: false })
    await page.waitForSelector('.post-card')
    await page.clickByText('举报', { selector: '.post-actions button', exact: true })
    await page.waitForText('举报理由（帖子）')
    await page.fillByLabel('举报理由', '虚构举报理由：用于验证举报人字段与去重')
    await page.clickByText('提交本机举报')
    await page.waitForText('举报已进入本机审核队列。')
    const reportState = await page.eval(() => {
      const app = document.querySelector('#app').__vue_app__
      const store = app.config.globalProperties.$pinia._s.get('community')
      const post = store.visiblePosts[0]
      const before = store.reports.length
      const duplicate = store.reportContent('post', post.id, '重复举报应被去重')
      const firstReport = store.reports[0]
      return {
        reporter: firstReport?.reporter ? JSON.parse(JSON.stringify(firstReport.reporter)) : null,
        reportCount: store.reports.length,
        before,
        after: store.reports.length,
        duplicate: JSON.parse(JSON.stringify(duplicate)),
        auditActions: store.auditLog.map((entry) => entry.action),
        auditReasons: store.auditLog.map((entry) => entry.reason),
      }
    })
    const reporterName = reportState.reporter?.name ?? ''
    step('P1', '举报携带举报人且写入审核日志', 'reports[0].reporter 存在，auditLog 含 create-report',
      `reporter=${reporterName} audit=${reportState.auditActions.join(',')}`,
      reporterName.length > 0 && reportState.auditActions.includes('create-report'),
      await shot(page, '9-report'))
    step('P2', '同一目标待处理举报去重', '第二次举报返回 already、报告数量不增加',
      `result=${JSON.stringify(reportState.duplicate)} before=${reportState.before} after=${reportState.after}`,
      reportState.duplicate?.already === true && reportState.after === reportState.before,
      await shot(page, '10-report-duplicate'))
    await text(page, '10-report-duplicate')

    // ------------------------------------------------------- 4 draft save
    await page.clickByText('发布', { selector: '.side-nav button', exact: false })
    await page.waitForText('发布一件小事')
    await page.fillByLabel('标题', '草稿：本机自动保存验证（虚构）')
    await page.fillByLabel('需求说明', '这是虚构草稿内容，用于验证自动保存与恢复。')
    await page.fillByLabel('希望时段', '本周六 10:00')
    await page.fillByLabel('预计时长', '约 30 分钟')
    await sleep(700)
    const savedDraft = await page.eval(() => {
      const raw = localStorage.getItem('community-mvp.publish-draft.v1')
      return { exists: typeof raw === 'string', hint: document.body.innerText.includes('草稿已自动保存在本机') }
    })
    step('D1', '填写后自动保存草稿', '本机草稿键存在且页面显示自动保存提示',
      `exists=${savedDraft.exists} hint=${savedDraft.hint}`, savedDraft.exists && savedDraft.hint,
      await shot(page, '11-draft-saved'))

    await page.clickByText('首页', { selector: '.side-nav button', exact: false })
    await page.waitForText('今天想为邻里做点什么')
    await page.clickByText('发布', { selector: '.side-nav button', exact: false })
    await page.waitForText('发布一件小事')
    const restored = await page.eval(() => {
      const hint = document.body.innerText.includes('已恢复上次未提交的本机草稿')
      const label = Array.from(document.querySelectorAll('label')).find((item) => item.innerText.includes('标题'))
      const input = label?.querySelector('input')
      return { hint, title: input?.value ?? '', confirm: document.querySelector('.confirm-synthetic input')?.checked }
    })
    step('D2', '返回发布页恢复草稿', '标题值恢复、提示已恢复、虚构确认未被恢复',
      `hint=${restored.hint} title=${restored.title} confirm=${restored.confirm}`,
      restored.hint && restored.title.startsWith('草稿：') && restored.confirm === false,
      await shot(page, '12-draft-restored'))

    await page.reload()
    await page.waitForSelector('.community-app')
    await page.setMembership('member')
    await page.clickByText('发布', { selector: '.side-nav button', exact: false })
    await page.waitForText('发布一件小事')
    const restoredAfterReload = await page.eval(() => {
      const label = Array.from(document.querySelectorAll('label')).find((item) => item.innerText.includes('标题'))
      return {
        hint: document.body.innerText.includes('已恢复上次未提交的本机草稿'),
        title: label?.querySelector('input')?.value ?? '',
      }
    })
    step('D3', '刷新后草稿仍可恢复', '刷新进入发布页仍显示恢复草稿',
      `hint=${restoredAfterReload.hint} title=${restoredAfterReload.title}`,
      restoredAfterReload.hint && restoredAfterReload.title.startsWith('草稿：'),
      await shot(page, '13-draft-reload'))

    await page.clickByText('清除草稿')
    await sleep(300)
    const cleared = await page.eval(() => {
      const label = Array.from(document.querySelectorAll('label')).find((item) => item.innerText.includes('标题'))
      return {
        title: label?.querySelector('input')?.value ?? '',
        stored: localStorage.getItem('community-mvp.publish-draft.v1'),
      }
    })
    step('D4', '清除草稿', '草稿键删除且标题清空',
      `stored=${cleared.stored} title=${JSON.stringify(cleared.title)}`,
      cleared.stored === null && cleared.title === '', await shot(page, '14-draft-cleared'))

    await page.fillByLabel('标题', '求助：提交后清除草稿（合成）')
    await page.fillByLabel('需求说明', '虚构内容：验证提交成功后草稿被清除。')
    await page.fillByLabel('希望时段', '本周日 14:00')
    await page.fillByLabel('预计时长', '约 1 小时')
    await page.checkSelector('.confirm-synthetic input')
    await page.clickSelector('.publish-form .submit-button')
    await page.waitForText('我的发布')
    const afterPublish = await page.eval(() => localStorage.getItem('community-mvp.publish-draft.v1'))
    step('D5', '提交后清除草稿', '发布成功后草稿键删除',
      `stored=${afterPublish}`, afterPublish === null, await shot(page, '15-draft-after-publish'))

    // ------------------------------------------------------ 5 mobile check
    await page.client.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    })
    await sleep(400)
    await shot(page, '16-mobile')
    const mobile = await page.eval(() => {
      const toggle = document.querySelector('.reading-toggle')
      const nav = document.querySelector('.mobile-nav')
      const box = toggle?.getBoundingClientRect()
      return {
        navVisible: nav ? getComputedStyle(nav).display !== 'none' : false,
        toggleHeight: box ? Math.round(box.height) : 0,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }
    })
    step('M1', '移动端 390px 布局', '底部导航显示、阅读开关可点、无横向溢出',
      `nav=${mobile.navVisible} toggle=${mobile.toggleHeight}px overflow=${mobile.overflow}`,
      mobile.navVisible && mobile.toggleHeight >= 36 && mobile.overflow <= 1,
      await shot(page, '17-mobile-layout'))
    await page.client.send('Emulation.clearDeviceMetricsOverride')

    // ------------------------------------------------------ final summary
    observations.pageErrors = page.pageErrors
    observations.consoleErrors = page.consoleErrors
    observations.localState = await page.readLocalStorageJson(COMMUNITY_KEY)
    observations.finalText = await page.bodyText()

    step('S1', '页面运行无未捕获异常', 'Runtime.exceptionThrown 为 0',
      `pageErrors=${page.pageErrors.length} consoleErrors=${page.consoleErrors.length}`,
      page.pageErrors.length === 0)
  })

  const stamp = new Date().toISOString()
  const summary = {
    runAt: stamp,
    base,
    prefix,
    steps,
    failures,
    observations,
  }
  await writeFile(join(evidenceDir, `${prefix}-run-record.json`), JSON.stringify(summary, null, 2), 'utf8')
  await writeFile(join(evidenceDir, `${prefix}-run-record.md`), renderMarkdown(summary), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} steps passed; failures=${failures}`)
  if (failures > 0) process.exitCode = 1
}

function renderMarkdown(summary) {
  const lines = []
  lines.push(`# 第三轮功能实测运行记录（${summary.prefix ?? 'reading/notices/drafts'}）`)
  lines.push('')
  lines.push(`- 运行时间：${summary.runAt}`)
  lines.push(`- 站点：${summary.base}`)
  lines.push(`- 结果：**${summary.steps.length - summary.failures}/${summary.steps.length} 通过**，失败 ${summary.failures}`)
  lines.push('')
  lines.push('| # | 步骤 | 期望 | 实际 | 结果 | 截图 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const item of summary.steps) {
    lines.push(`| ${item.id} | ${item.name} | ${item.expected} | ${item.actual} | ${item.ok ? '✅ 通过' : '❌ 失败'} | ${item.shot ? `[${item.shot.split(/[\\/]/).pop()}](${item.shot.split(/[\\/]/).pop()})` : '—'} |`)
  }
  lines.push('')
  const errors = summary.observations?.pageErrors ?? []
  lines.push('## 页面异常')
  lines.push('')
  lines.push(errors.length ? errors.map((text) => `- ${text}`).join('\n') : '- 未捕获到页面异常。')
  lines.push('')
  lines.push('## 未覆盖项')
  lines.push('')
  lines.push('- 移动端为 CDP Emulation，不是真机；未做读屏器与全键盘遍历。')
  lines.push('- 未验证多标签页冲突、存档容量上限、截图像素级对比度。')
  lines.push('- 大字模式只做字号放大的可用性验证，未做用户偏好调研。')
  return lines.join('\n')
}

main().catch(async (error) => {
  failures += 1
  try {
    await mkdir(evidenceDir, { recursive: true })
    await writeFile(join(evidenceDir, `${prefix}-run-error.txt`), String(error?.stack || error), 'utf8')
  } catch {
    /* ignore */
  }
  console.error(error)
  process.exitCode = 1
})
