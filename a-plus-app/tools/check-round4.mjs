// Solo acceptance run for the 2026-10-21 late-evening additions:
//   - in-app help dialog (keyboard/focus behavior)
//   - home safety dialog keyboard/focus behavior
//   - "my service records" status filter and full order-event expansion
//   - previously untested B admin paths: order message + moderator hide + report handling + post hide/restore
// Run: node tools/check-round4.mjs --base=http://127.0.0.1:5180
// Requires a static `dist` preview (npm run preview) on the given base URL.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const evidenceDir = join(repoRoot, '..', 'docs', '运营准备', 'evidence-B-order-round4')

const COMMUNITY_KEY = 'community-mvp.synthetic-state.v1'
const HELP_TITLE = '使用说明（合成演练）'
const OWN_ORDER_TITLE = '求助：验证消息与筛选（合成）'

const args = new Map()
for (const raw of process.argv.slice(2)) {
  const [key, ...rest] = raw.replace(/^--/, '').split('=')
  args.set(key, rest.join('='))
}
const base = (args.get('base') || 'http://127.0.0.1:5180').replace(/\/$/, '')
const prefix = args.get('prefix') || 'r4'

const steps = []
const observations = {}
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}

async function shot(page, name) {
  const file = join(evidenceDir, `${prefix}-${name}.png`)
  await page.screenshot(file)
  return file
}

async function pageText(page, name) {
  const file = join(evidenceDir, `${prefix}-${name}.txt`)
  await page.savePageText(file)
  return file
}

async function storeEval(page, fn) {
  return page.eval((source) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    return (new Function('store', `return (${source})(store)`))(store)
  }, fn.toString())
}

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

async function clickCardButton(page, cardText, labels) {
  const result = await page.eval((text, wanted) => {
    const normText = (value) => (value || '').replace(/\s+/g, ' ').trim()
    const cards = Array.from(document.querySelectorAll('.post-card'))
    const card = cards.find((node) => normText(node.innerText).includes(normText(text)))
    if (!card) return { ok: false, reason: 'card-not-found', cards: cards.map((node) => normText(node.innerText).slice(0, 40)) }
    const buttons = Array.from(card.querySelectorAll('button'))
    for (const label of wanted) {
      const button = buttons.find((node) => normText(node.innerText) === label && !node.disabled)
      if (button) {
        button.scrollIntoView({ block: 'center', inline: 'nearest' })
        button.click()
        return { ok: true, label, text: normText(button.innerText) }
      }
    }
    return { ok: false, reason: 'button-not-found', wanted, available: buttons.map((node) => normText(node.innerText)) }
  }, cardText, labels)
  if (!result?.ok) throw new Error(`clickCardButton(${cardText}) failed: ${JSON.stringify(result)}`)
  return result
}

async function fillCardNote(page, cardText, value) {
  const result = await page.eval((text, nextValue) => {
    const normText = (input) => (input || '').replace(/\s+/g, ' ').trim()
    const cards = Array.from(document.querySelectorAll('.post-card'))
    const card = cards.find((node) => normText(node.innerText).includes(normText(text)))
    const area = card?.querySelector('.order-action-form textarea')
    if (!area) return { ok: false, reason: 'textarea-not-found' }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(area, nextValue)
    area.dispatchEvent(new Event('input', { bubbles: true }))
    area.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true }
  }, cardText, value)
  if (!result?.ok) throw new Error(`fillCardNote(${cardText}) failed: ${JSON.stringify(result)}`)
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
}

async function backToMember(page) {
  await page.setMembership('member')
}

async function openOrderCard(page, cardText, label) {
  await clickCardButton(page, cardText, [label])
  await sleep(300)
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

    // ----------------------------------------------------------- help dialog
    await page.clickSelector('.help-toggle')
    await page.waitForSelector('.help-dialog')
    const helpState = await page.eval((title) => {
      const dialog = document.querySelector('.help-dialog')
      return {
        role: dialog?.getAttribute('role'),
        modal: dialog?.getAttribute('aria-modal'),
        focusInside: Boolean(dialog?.contains(document.activeElement)),
        hasTitle: (dialog?.innerText || '').includes(title),
        mentionsBoundary: (dialog?.innerText || '').includes('不会连接真实居民'),
        triggers: document.querySelector('.help-toggle')?.getAttribute('aria-expanded'),
      }
    }, HELP_TITLE)
    step('H1', '打开使用说明弹层', 'role=dialog、aria-modal=true、标题与边界说明存在、焦点进入弹层、触发按钮 aria-expanded=true',
      `role=${helpState.role} modal=${helpState.modal} focusInside=${helpState.focusInside} title=${helpState.hasTitle} boundary=${helpState.mentionsBoundary} expanded=${helpState.triggers}`,
      helpState.role === 'dialog' && helpState.modal === 'true' && helpState.focusInside && helpState.hasTitle && helpState.mentionsBoundary && helpState.triggers === 'true',
      await shot(page, '1-help-dialog'))
    await pageText(page, '1-help-dialog')

    await page.eval(() => {
      document.querySelector('.help-dialog')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    await page.waitForExpression("!document.querySelector('.help-dialog')", { timeoutMs: 5000 })
    const helpClosed = await page.eval(() => ({
      focusReturned: document.activeElement?.classList?.contains('help-toggle') === true,
      expanded: document.querySelector('.help-toggle')?.getAttribute('aria-expanded'),
    }))
    step('H2', 'Esc 关闭使用说明并归还焦点', '弹层关闭、焦点回到“说明”按钮、aria-expanded=false',
      `focusReturned=${helpClosed.focusReturned} expanded=${helpClosed.expanded}`,
      helpClosed.focusReturned && helpClosed.expanded === 'false',
      await shot(page, '2-help-closed'))

    // --------------------------------------------------------- safety dialog
    await page.clickByText('查看说明', { selector: '.care-strip button', exact: false })
    await page.waitForSelector('#safety-title')
    const safetyOpen = await page.eval(() => ({
      focusInside: document.querySelector('#safety-title')?.closest('.dialog-card')?.contains(document.activeElement) ?? false,
      modal: document.querySelector('#safety-title')?.closest('.dialog-card')?.getAttribute('aria-modal'),
    }))
    await page.eval(() => {
      document.querySelector('#safety-title')?.closest('.dialog-card')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    await page.waitForExpression("!document.querySelector('#safety-title')", { timeoutMs: 5000 })
    const safetyClosed = await page.eval(() => ({
      focusReturned: (document.activeElement?.innerText || '').includes('查看说明'),
    }))
    step('H3', '安全说明弹层键盘行为', 'aria-modal=true、焦点进入、Esc 关闭并归还焦点',
      `focusInside=${safetyOpen.focusInside} modal=${safetyOpen.modal} focusReturned=${safetyClosed.focusReturned}`,
      safetyOpen.focusInside && safetyOpen.modal === 'true' && safetyClosed.focusReturned,
      await shot(page, '3-safety-dialog'))

    // --------------------------------------- order A: disputed + completed
    await page.clickByText('社区', { selector: '.side-nav button', exact: false })
    await page.waitForSelector('.post-card')
    const fixtureTitle = '帮忙把两箱演练物资搬到活动室'
    await openOrderCard(page, fixtureTitle, '演练接单')
    await page.waitForText('已接单（本机演练）')
    await openOrderCard(page, fixtureTitle, '发起完成申请')
    await fillCardNote(page, fixtureTitle, '本机演练：已完成搬运协助，请对方确认')
    await clickCardButton(page, fixtureTitle, ['发起本机申请'])
    await page.waitForText('待确认完成（本机演练）')
    await openOrderCard(page, fixtureTitle, '发起争议（演练）')
    await fillCardNote(page, fixtureTitle, '虚构争议原因：交接时间需要再确认')
    await clickCardButton(page, fixtureTitle, ['提交本机记录'])
    await page.waitForText('争议处理中（本机演练）')
    await openOrderCard(page, fixtureTitle, '撤销争议继续履约（演练）')
    await fillCardNote(page, fixtureTitle, '虚构说明：双方已重新约定时间')
    await clickCardButton(page, fixtureTitle, ['提交本机记录'])
    await page.waitForText('已接单（本机演练）')
    await openOrderCard(page, fixtureTitle, '发起完成申请')
    await fillCardNote(page, fixtureTitle, '本机演练：第二次完成申请')
    await clickCardButton(page, fixtureTitle, ['发起本机申请'])
    await page.waitForText('待确认完成（本机演练）')
    await openOrderCard(page, fixtureTitle, '代合成求助方确认完成（演练）')
    await page.waitForText('已完成（本机演练，未结算）')
    const orderA = await storeEval(page, (store) => {
      const post = store.posts.find((item) => item.title.includes('帮忙把两箱演练物资'))
      return { status: post?.orderStatus, eventCount: post?.orderEvents?.length ?? 0, events: (post?.orderEvents ?? []).map((event) => event.type) }
    })
    step('O1', '订单 A 完整争议到完成闭环', '状态 completed、事件包含接单/申请/争议/撤销/再次申请/确认',
      `status=${orderA.status} events=${orderA.events.join('>')} count=${orderA.eventCount}`,
      orderA.status === 'completed-local-demo' && orderA.eventCount >= 6 && orderA.events.includes('dispute') && orderA.events.includes('resume-after-dispute'),
      await shot(page, '4-order-a-completed'))

    // ------------------------------------ order B: own help, active order
    await publishHelp(page, OWN_ORDER_TITLE)
    await approveFirstPending(page, '虚构审核理由：消息与筛选验证')
    await backToMember(page)
    await page.clickByText('社区', { selector: '.side-nav button', exact: false })
    await page.waitForSelector('.post-card')
    await openOrderCard(page, OWN_ORDER_TITLE, '代合成邻居接单（演练）')
    await page.waitForText('已接单（本机演练）')
    const orderB = await storeEval(page, (store) => store.posts.find((item) => item.title.includes('验证消息与筛选'))?.orderStatus)
    step('O2', '订单 B 处于进行中', '本人求助被代合成邻居接单、状态 accepted',
      `status=${orderB}`, orderB === 'accepted-local-demo', await shot(page, '5-order-b-accepted'))

    // ------------------------------------- profile filter + event expansion
    await page.clickByText('我的', { selector: '.side-nav button', exact: false })
    await page.waitForText('我的发布')
    await page.clickByText('服务记录', { selector: '.profile-tabs button', exact: false })
    await page.waitForSelector('.profile-order-filter')
    const filterInitial = await page.eval(() => {
      const buttons = Array.from(document.querySelectorAll('.profile-order-filter button'))
      const counts = buttons.map((node) => ({ text: node.innerText.replace(/\s+/g, ' ').trim(), pressed: node.getAttribute('aria-pressed') }))
      const rows = document.querySelectorAll('.service-record-row').length
      return { counts, rows }
    })
    step('F1', '服务记录筛选初始计数', '全部=2、已完成=1、进行中=1，列表 2 行',
      `${JSON.stringify(filterInitial.counts)} rows=${filterInitial.rows}`,
      filterInitial.rows === 2
      && filterInitial.counts.some((item) => item.text.startsWith('全部') && item.text.endsWith('2'))
      && filterInitial.counts.some((item) => item.text.startsWith('已完成') && item.text.endsWith('1'))
      && filterInitial.counts.some((item) => item.text.startsWith('进行中') && item.text.endsWith('1')),
      await shot(page, '6-profile-filters'))

    await page.clickByText('已完成', { selector: '.profile-order-filter button', exact: false })
    await sleep(250)
    const completedRows = await page.eval(() => ({
      rows: document.querySelectorAll('.service-record-row').length,
      text: document.body.innerText,
      pressed: Array.from(document.querySelectorAll('.profile-order-filter button')).find((node) => node.innerText.includes('已完成'))?.getAttribute('aria-pressed'),
    }))
    step('F2', '按“已完成”筛选', '只显示 1 行已完成订单、按钮 aria-pressed=true',
      `rows=${completedRows.rows} pressed=${completedRows.pressed}`,
      completedRows.rows === 1 && completedRows.pressed === 'true', await shot(page, '7-filter-completed'))

    await page.clickByText('进行中', { selector: '.profile-order-filter button', exact: false })
    await sleep(250)
    const activeRows = await page.eval(() => document.querySelectorAll('.service-record-row').length)
    step('F3', '按“进行中”筛选', '只显示 1 行进行中订单', `rows=${activeRows}`, activeRows === 1, await shot(page, '8-filter-active'))

    await page.clickByText('全部', { selector: '.profile-order-filter button', exact: false })
    await sleep(250)
    const beforeExpand = await page.eval(() => {
      const rows = Array.from(document.querySelectorAll('.service-record-row'))
      const row = rows.find((node) => node.innerText.includes('帮忙把两箱'))
      return {
        rows: rows.length,
        visibleEvents: row ? row.querySelectorAll('.order-event-mini-list p').length : 0,
        moreLabel: row?.querySelector('.order-event-more')?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
      }
    })
    step('F4', '长订单时间线默认折叠', '默认只显示最近 3 条，并提供展开按钮',
      `visible=${beforeExpand.visibleEvents} more=${beforeExpand.moreLabel}`,
      beforeExpand.visibleEvents === 3 && beforeExpand.moreLabel.includes('展开全部'), await shot(page, '9-timeline-collapsed'))

    await page.clickByText('展开全部', { selector: '.order-event-more', exact: false })
    await sleep(250)
    const afterExpand = await page.eval(() => {
      const rows = Array.from(document.querySelectorAll('.service-record-row'))
      const row = rows.find((node) => node.innerText.includes('帮忙把两箱'))
      return {
        visibleEvents: row ? row.querySelectorAll('.order-event-mini-list p').length : 0,
        moreLabel: row?.querySelector('.order-event-more')?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
      }
    })
    step('F5', '展开全部订单事件', '显示 6 条事件、按钮变为收起',
      `visible=${afterExpand.visibleEvents} more=${afterExpand.moreLabel}`,
      afterExpand.visibleEvents >= 5 && afterExpand.moreLabel.includes('收起'), await shot(page, '10-timeline-expanded'))

    // --------------------------- order message, moderator hide, report flow
    await page.clickByText('消息', { selector: '.side-nav button', exact: false })
    await page.waitForText('订单内留言')
    await page.clickByText(OWN_ORDER_TITLE, { selector: '.thread-item', exact: false })
    await page.waitForSelector('#order-message')
    const messageContent = '虚构订单留言：明天下午在活动室门口交接。'
    await page.setValue('#order-message', messageContent)
    await page.clickByText('保存订单留言', { selector: '.chat-composer button', exact: false })
    await page.waitForText('已保存订单内留言')
    await page.waitForText(messageContent)
    step('M1', '进行中订单可发送本机留言', '留言保存并显示在订单线程中',
      `found=${(await page.bodyText()).includes(messageContent)}`, (await page.bodyText()).includes(messageContent),
      await shot(page, '11-order-message'))

    await page.setMembership('reviewer')
    await page.clickByText('审核', { selector: '.side-nav button', exact: false })
    await page.waitForText('订单留言管理')
    await page.fillByLabel('本次审核或处理理由', '虚构下架理由：留言包含不适宜演示内容')
    await page.clickByText('下架留言', {
      selector: '.moderation-page button',
      exact: true,
      withinSelector: '.feedback-card',
      withinText: messageContent,
    })
    await sleep(400)
    const hiddenState = await storeEval(page, (store) => ({
      hiddenMessages: store.threads.flatMap((thread) => thread.messages).filter((message) => message.hidden === true).map((message) => message.content),
      audit: store.auditLog.map((entry) => entry.action),
    }))
    step('M2', '审核员下架订单留言', '留言 hidden=true 且审核日志记录 hide-message',
      `hidden=${hiddenState.hiddenMessages.length} audit=${hiddenState.audit.slice(-3).join(',')}`,
      hiddenState.hiddenMessages.length === 1 && hiddenState.audit.includes('hide-message'),
      await shot(page, '12-message-hidden'))

    await page.setMembership('member')
    await page.clickByText('消息', { selector: '.side-nav button', exact: false })
    await page.waitForText('订单内留言')
    await page.clickByText(OWN_ORDER_TITLE, { selector: '.thread-item', exact: false })
    await sleep(300)
    const memberView = await page.bodyText()
    step('M3', '成员端看不到已下架留言', '订单线程不再显示被下架留言内容',
      `stillVisible=${memberView.includes(messageContent)}`, !memberView.includes(messageContent),
      await shot(page, '13-message-hidden-member'))

    await page.clickByText('社区', { selector: '.side-nav button', exact: false })
    await page.waitForSelector('.post-card')
    await page.clickByText('举报', { selector: '.post-actions button', exact: true })
    await page.waitForText('举报理由（帖子）')
    await page.fillByLabel('举报理由', '虚构举报理由：用于验证举报处理流程')
    await page.clickByText('提交本机举报')
    await page.waitForText('举报已进入本机审核队列。')
    await page.setMembership('reviewer')
    await page.clickByText('审核', { selector: '.side-nav button', exact: false })
    await page.waitForText('举报处理')
    await page.fillByLabel('本次审核或处理理由', '虚构处理说明：已核对内容与举报理由')
    await page.clickByText('记录已处理', { selector: '.moderation-page button', exact: true })
    await sleep(400)
    const reportState = await storeEval(page, (store) => ({
      report: store.reports[0] ? JSON.parse(JSON.stringify(store.reports[0])) : null,
      audit: store.auditLog.map((entry) => entry.action),
    }))
    step('R1', '审核员处理举报并留痕', '举报状态 resolved、说明写入、审核日志含 resolve-report',
      `status=${reportState.report?.status} resolution=${reportState.report?.resolution} audit=${reportState.audit.slice(-2).join(',')}`,
      reportState.report?.status === 'resolved' && Boolean(reportState.report?.resolution) && reportState.audit.includes('resolve-report'),
      await shot(page, '14-report-resolved'))

    await page.fillByLabel('本次审核或处理理由', '虚构下架说明：内容需要暂时下架核对')
    await page.clickByText('下架帖子', { selector: '.moderation-page button', exact: true })
    await sleep(400)
    const hiddenPostCount = await storeEval(page, (store) => store.posts.filter((post) => post.moderation === 'hidden').length)
    await page.fillByLabel('本次审核或处理理由', '虚构恢复说明：误操作恢复')
    await page.clickByText('恢复为通过', { selector: '.moderation-page button', exact: true })
    await sleep(400)
    const restore = await storeEval(page, (store) => ({
      hidden: store.posts.filter((post) => post.moderation === 'hidden').length,
      approved: store.posts.filter((post) => post.moderation === 'approved').length,
    }))
    step('R2', '下架与恢复为通过', '下架后 hidden 增加，恢复后回到 approved',
      `hiddenAfterHide=${hiddenPostCount} hiddenNow=${restore.hidden} approved=${restore.approved}`,
      hiddenPostCount >= 1 && restore.hidden === 0 && restore.approved >= 2,
      await shot(page, '15-moderation-content'))

    // --------------------------------------------------- mobile help dialog
    await page.client.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    })
    await sleep(300)
    await page.clickSelector('.help-toggle')
    await page.waitForSelector('.help-dialog')
    const mobileHelp = await page.eval(() => {
      const dialog = document.querySelector('.help-dialog')
      const grid = dialog?.querySelector('.help-grid')
      const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0
      return {
        columns,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        dialogFits: dialog ? dialog.getBoundingClientRect().width <= window.innerWidth : false,
      }
    })
    await shot(page, '16-help-mobile')
    await page.eval(() => {
      document.querySelector('.help-dialog')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    await page.waitForExpression("!document.querySelector('.help-dialog')", { timeoutMs: 5000 })
    step('M4', '移动端使用说明布局', '单列、无横向溢出、弹层宽度适配 390px',
      `columns=${mobileHelp.columns} overflow=${mobileHelp.overflow} fits=${mobileHelp.dialogFits}`,
      mobileHelp.columns === 1 && mobileHelp.overflow <= 1 && mobileHelp.dialogFits)
    await page.client.send('Emulation.clearDeviceMetricsOverride')

    observations.pageErrors = page.pageErrors
    observations.consoleErrors = page.consoleErrors
    observations.localState = await page.readLocalStorageJson(COMMUNITY_KEY)
    step('S1', '页面运行无未捕获异常', 'Runtime.exceptionThrown 为 0',
      `pageErrors=${page.pageErrors.length} consoleErrors=${page.consoleErrors.length}`,
      page.pageErrors.length === 0)
  })

  const summary = {
    runAt: new Date().toISOString(),
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
  lines.push(`# 第四轮功能实测运行记录（${summary.prefix}）`)
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
  lines.push('- 真机移动端、读屏器与全页键盘遍历、对比度仪器测量未做；移动端为 CDP Emulation。')
  lines.push('- 未测 A+“登记到 A+ 队列”动作、多标签冲突、存档容量上限、localStorage 故障注入。')
  lines.push('- 审核员“不予支持”分支、举报重开/申诉、内容下架后的举报联动未覆盖。')
  return lines.join('\n')
}

main().catch(async (error) => {
  try {
    await mkdir(evidenceDir, { recursive: true })
    await writeFile(join(evidenceDir, `${prefix}-run-error.txt`), String(error?.stack || error), 'utf8')
  } catch {
    /* ignore */
  }
  console.error(error)
  process.exitCode = 1
})
