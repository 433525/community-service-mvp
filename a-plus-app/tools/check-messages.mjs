// Messages: notification unread/all filter + my reports status filter.
// Run: node tools/check-messages.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-messages')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `messages-${name}.png`)
  await page.screenshot(file)
  return file
}
async function publishHelp(page, title) {
  await page.clickByText('发布', { selector: '.side-nav button', exact: false })
  await page.waitForText('发布一件小事')
  await page.fillByLabel('标题', title)
  await page.fillByLabel('需求说明', '消息筛选验证：虚构求助。')
  await page.fillByLabel('希望时段', '本周五 15:00')
  await page.fillByLabel('预计时长', '约 1 小时')
  await page.checkSelector('.confirm-synthetic input')
  await page.clickSelector('.publish-form .submit-button')
  await page.waitForText('我的发布')
}
async function approveLatest(page) {
  await page.setMembership('reviewer')
  await page.clickByText('审核', { selector: '.side-nav button', exact: false })
  await page.waitForText('内容与举报审核')
  await page.fillByLabel('本次审核或处理理由', '消息筛选验证：审核通过')
  await page.clickByText('通过', { selector: '.moderation-page button', exact: true })
  await sleep(400)
  await page.setMembership('member')
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.home-todo')

  const title = '求助：消息筛选验证（合成）'
  await publishHelp(page, title)
  await approveLatest(page)
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')
  await page.clickByText('举报', { selector: '.post-actions button', exact: true })
  await page.waitForText('举报理由（帖子）')
  await page.fillByLabel('举报理由', '消息筛选验证：虚构举报理由')
  await page.clickByText('提交本机举报')
  await page.waitForText('举报已进入本机审核队列。')

  await page.clickByText('消息', { selector: '.side-nav button', exact: false })
  await page.waitForText('系统通知（合成示例）')
  await page.waitForSelector('.notices-filter')
  const initial = await page.eval(() => ({
    noticeFilters: document.querySelectorAll('.notices-filter button').length,
    notices: document.querySelectorAll('.system-notice').length,
    unread: Number((document.querySelectorAll('.notices-filter button')[1]?.innerText || '0').replace(/\D+/g, '')),
    reports: document.querySelectorAll('.my-reports-list article').length,
    reportFilters: document.querySelectorAll('.my-reports-filter button').length,
  }))
  step('N1', '消息页初始筛选', '通知 2 个筛选、举报 4 个筛选；至少有 1 条未读通知和 1 条举报',
    `noticeFilters=${initial.noticeFilters} notices=${initial.notices} unread=${initial.unread} reportFilters=${initial.reportFilters} reports=${initial.reports}`,
    initial.noticeFilters === 2 && initial.reportFilters === 4 && initial.notices > 0 && initial.unread > 0 && initial.reports === 1,
    await shot(page, 'n1-initial'))

  await page.clickByText('未读', { selector: '.notices-filter button', exact: false })
  await sleep(250)
  const unreadView = await page.eval(() => ({
    notices: document.querySelectorAll('.system-notice').length,
    selected: document.querySelector('.notices-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
  step('N2', '只显示未读通知', '未读筛选显示数量与未读计数一致',
    `notices=${unreadView.notices} selected=${unreadView.selected}`,
    unreadView.notices === initial.unread && unreadView.selected.includes('未读'),
    await shot(page, 'n2-unread'))

  await page.clickByText('全部标为已读', { selector: '.notice-mark-read', exact: true })
  await page.waitForText('已把本机系统通知标为已读')
  await sleep(300)
  const afterRead = await page.eval(() => ({
    notices: document.querySelectorAll('.system-notice').length,
    empty: document.body.innerText.includes('当前筛选下没有通知'),
    markReadGone: !document.querySelector('.notice-mark-read'),
  }))
  step('N3', '标为已读后未读为空', '未读筛选下无通知并显示空态；标为已读按钮消失',
    `notices=${afterRead.notices} empty=${afterRead.empty} markReadGone=${afterRead.markReadGone}`,
    afterRead.notices === 0 && afterRead.empty && afterRead.markReadGone,
    await shot(page, 'n3-all-read'))

  await page.clickByText('全部', { selector: '.notices-filter button', exact: false })
  await sleep(250)
  const allNotices = await page.eval(() => document.querySelectorAll('.system-notice').length)
  step('N4', '全部通知仍保留', '标为已读后全部筛选仍显示历史通知',
    `notices=${allNotices}`, allNotices === initial.notices,
    await shot(page, 'n4-all-notices'))

  await page.clickByText('待处理', { selector: '.my-reports-filter button', exact: false })
  await sleep(250)
  const pending = await page.eval(() => ({
    reports: document.querySelectorAll('.my-reports-list article').length,
    selected: document.querySelector('.my-reports-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
  await page.clickByText('已处理', { selector: '.my-reports-filter button', exact: false })
  await sleep(250)
  const resolved = await page.eval(() => ({
    reports: document.querySelectorAll('.my-reports-list article').length,
    empty: document.querySelector('.my-reports-list p')?.innerText ?? '',
  }))
  await page.clickByText('全部', { selector: '.my-reports-filter button', exact: false })
  await sleep(250)
  const allReports = await page.eval(() => document.querySelectorAll('.my-reports-list article').length)
  step('N5', '我的举报状态筛选', '待处理 1 条；已处理空态；全部 1 条',
    `pending=${pending.reports} resolved=${resolved.reports} empty=${resolved.empty.includes('没有举报记录')} all=${allReports}`,
    pending.reports === 1 && pending.selected.includes('待处理') && resolved.reports === 0
    && resolved.empty.includes('没有举报记录') && allReports === 1,
    await shot(page, 'n5-reports'))

  await page.setMembership('reviewer')
  await page.clickByText('审核', { selector: '.side-nav button', exact: false })
  await page.waitForText('内容与举报审核')
  await page.fillByLabel('本次审核或处理理由', '举报通知验证：已核对虚构内容')
  await page.clickByText('记录已处理', { selector: '.moderation-report-list button', exact: true })
  await sleep(400)
  await page.setMembership('member')
  await page.clickByText('消息', { selector: '.side-nav button', exact: false })
  await page.waitForText('系统通知（合成示例）')
  await page.waitForSelector('.notices-filter')
  const afterResolve = await page.eval(() => ({
    notice: document.body.innerText.includes('你提交的举报'),
    reason: document.body.innerText.includes('已核对虚构内容'),
    reports: document.querySelectorAll('.my-reports-list article').length,
    status: document.querySelector('.my-reports-list article strong')?.innerText ?? '',
  }))
  step('N6', '举报处理结果通知举报人', '系统通知出现举报处理结果与理由；举报显示已处理',
    `notice=${afterResolve.notice} reason=${afterResolve.reason} reports=${afterResolve.reports} status=${afterResolve.status}`,
    afterResolve.notice && afterResolve.reason && afterResolve.reports === 1 && afterResolve.status.includes('已处理'),
    await shot(page, 'n6-report-notice'))

  const messageBaseline = await page.eval(() => ({
    notices: document.querySelectorAll('.system-notice').length,
    reports: document.querySelectorAll('.my-reports-list article').length,
  }))
  await page.eval(() => {
    const input = document.querySelector('.message-search-row input')
    input.value = '已核对虚构内容'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(300)
  const searched = await page.eval(() => ({
    notices: document.querySelectorAll('.system-notice').length,
    reports: document.querySelectorAll('.my-reports-list article').length,
    noticeText: document.querySelector('.system-notice')?.innerText ?? '',
    reportText: document.querySelector('.my-reports-list article')?.innerText ?? '',
  }))
  await page.eval(() => {
    const input = document.querySelector('.message-search-row input')
    input.value = '不存在的消息词'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(300)
  const emptySearch = await page.eval(() => ({
    notices: document.querySelectorAll('.system-notice').length,
    reports: document.querySelectorAll('.my-reports-list article').length,
    complaints: document.querySelectorAll('.my-complaints-list article').length,
  }))
  await page.clickSelector('.message-search-row button')
  await sleep(300)
  const cleared = await page.eval(() => ({
    notices: document.querySelectorAll('.system-notice').length,
    reports: document.querySelectorAll('.my-reports-list article').length,
  }))
  step('N7', '消息页搜索跨通知/举报', '搜索结果同时命中通知与举报；无结果为空；清除后恢复',
    `searched=${searched.notices}/${searched.reports} text=${searched.noticeText.includes('已核对虚构内容')}${searched.reportText.includes('已核对虚构内容')} empty=${emptySearch.notices}/${emptySearch.reports}/${emptySearch.complaints} cleared=${cleared.notices}/${cleared.reports} baseline=${messageBaseline.notices}/${messageBaseline.reports}`,
    searched.notices === 1 && searched.reports === 1
    && searched.noticeText.includes('已核对虚构内容') && searched.reportText.includes('已核对虚构内容')
    && emptySearch.notices === 0 && emptySearch.reports === 0 && emptySearch.complaints === 0
    && cleared.notices === messageBaseline.notices && cleared.reports === messageBaseline.reports,
    await shot(page, 'n7-message-search'))

  await page.clickByText('举报', { selector: '.notice-kind-filter button', exact: false })
  await sleep(250)
  const reportKind = await page.eval(() => ({
    notices: document.querySelectorAll('.system-notice').length,
    text: document.querySelector('.system-notice')?.innerText ?? '',
    selected: document.querySelector('.notice-kind-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
  await page.clickByText('全部类型', { selector: '.notice-kind-filter button', exact: false })
  await sleep(250)
  const kindReset = await page.eval(() => document.querySelectorAll('.system-notice').length)
  step('N8', '通知按类型筛选', '“举报”类型只剩 1 条举报通知；“全部类型”恢复全部',
    `report=${reportKind.notices} selected=${reportKind.selected} text=${reportKind.text.includes('举报')} reset=${kindReset} baseline=${messageBaseline.notices}`,
    reportKind.notices === 1 && reportKind.selected.includes('举报') && reportKind.text.includes('举报')
    && kindReset === messageBaseline.notices,
    await shot(page, 'n8-notice-kind'))

  await writeFile(join(evidenceDir, 'messages-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
