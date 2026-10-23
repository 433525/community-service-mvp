// Moderation content status filter verification.
// Run: node tools/check-moderation.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-moderation-filter')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `moderation-${name}.png`)
  await page.screenshot(file)
  return file
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('reviewer')
  await page.clickByText('审核', { selector: '.side-nav button', exact: false })
  await page.waitForText('内容与举报审核')
  await page.waitForSelector('.moderation-filter')

  const initial = await page.eval(() => ({
    filters: document.querySelectorAll('.moderation-filter button').length,
    cards: document.querySelectorAll('.moderation-content-list article').length,
    counts: Array.from(document.querySelectorAll('.moderation-filter button')).map((node) => ({
      label: node.innerText.replace(/\s+/g, ' ').trim(),
      selected: node.getAttribute('aria-selected'),
    })),
  }))
  step('M1', '内容筛选初始态', '5 个状态筛选、显示全部内容、默认“全部”选中',
    `filters=${initial.filters} cards=${initial.cards} counts=${initial.counts.map((item) => item.label).join('|')} selected=${initial.counts.filter((item) => item.selected === 'true').length}`,
    initial.filters === 5 && initial.cards > 0 && initial.counts.filter((item) => item.selected === 'true').length === 1,
    await shot(page, 'm1-initial'))

  await page.clickByText('下架', { selector: '.moderation-filter button', exact: false })
  await sleep(250)
  const hidden = await page.eval(() => ({
    cards: document.querySelectorAll('.moderation-content-list article').length,
    empty: document.querySelector('.moderation-content-list .empty-state')?.innerText ?? '',
    selected: document.querySelector('.moderation-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
  step('M2', '筛选“下架”', '列表切换到下架内容；默认无下架时显示空态',
    `cards=${hidden.cards} empty=${hidden.empty.includes('没有内容')} selected=${hidden.selected}`,
    hidden.cards === 0 && hidden.empty.includes('没有内容') && hidden.selected.includes('下架'),
    await shot(page, 'm2-hidden'))

  await page.clickByText('通过', { selector: '.moderation-filter button', exact: false })
  await sleep(250)
  const approved = await page.eval(() => ({
    cards: document.querySelectorAll('.moderation-content-list article').length,
    empty: Boolean(document.querySelector('.moderation-content-list .empty-state')),
    selected: document.querySelector('.moderation-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
  step('M3', '筛选“通过”', '显示审核通过内容、无空态、选中态跟随',
    `cards=${approved.cards} empty=${approved.empty} selected=${approved.selected}`,
    approved.cards > 0 && !approved.empty && approved.selected.includes('通过'),
    await shot(page, 'm3-approved'))

  await page.clickByText('待审', { selector: '.moderation-filter button', exact: false })
  await sleep(250)
  const pending = await page.eval(() => ({
    cards: document.querySelectorAll('.moderation-content-list article').length,
    empty: document.querySelector('.moderation-content-list .empty-state')?.innerText ?? '',
  }))
  step('M4', '筛选“待审”', '默认没有待审内容时显示空态',
    `cards=${pending.cards} empty=${pending.empty.includes('没有内容')}`,
    pending.cards === 0 && pending.empty.includes('没有内容'),
    await shot(page, 'm4-pending'))

  // Create one pending report, then verify report filters.
  await page.setMembership('member')
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')
  await page.clickByText('举报', { selector: '.post-actions button', exact: true })
  await page.waitForText('举报理由（帖子）')
  await page.fillByLabel('举报理由', '筛选验证：虚构举报理由')
  await page.clickByText('提交本机举报')
  await page.waitForText('举报已进入本机审核队列。')
  await page.setMembership('reviewer')
  await page.clickByText('审核', { selector: '.side-nav button', exact: false })
  await page.waitForText('内容与举报审核')
  await page.waitForSelector('.reports-filter')
  const reportsInitial = await page.eval(() => ({
    filters: document.querySelectorAll('.reports-filter button').length,
    cards: document.querySelectorAll('.moderation-report-list article').length,
    selected: document.querySelector('.reports-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
  step('M5', '举报筛选初始态', '4 个状态筛选、默认“待处理”选中、显示 1 条待处理举报',
    `filters=${reportsInitial.filters} cards=${reportsInitial.cards} selected=${reportsInitial.selected}`,
    reportsInitial.filters === 4 && reportsInitial.cards === 1 && reportsInitial.selected.includes('待处理'),
    await shot(page, 'm5-reports'))

  await page.clickByText('已处理', { selector: '.reports-filter button', exact: false })
  await sleep(250)
  const reportsResolved = await page.eval(() => ({
    cards: document.querySelectorAll('.moderation-report-list article').length,
    empty: document.querySelector('.moderation-report-list .empty-state')?.innerText ?? '',
  }))
  step('M6', '筛选已处理举报', '无已处理举报时显示空态',
    `cards=${reportsResolved.cards} empty=${reportsResolved.empty.includes('没有举报')}`,
    reportsResolved.cards === 0 && reportsResolved.empty.includes('没有举报'),
    await shot(page, 'm6-reports-resolved'))

  await page.clickByText('全部', { selector: '.reports-filter button', exact: false })
  await sleep(250)
  const reportsAll = await page.eval(() => ({
    cards: document.querySelectorAll('.moderation-report-list article').length,
    empty: Boolean(document.querySelector('.moderation-report-list .empty-state')),
  }))
  step('M7', '筛选全部举报', '返回全部举报记录',
    `cards=${reportsAll.cards} empty=${reportsAll.empty}`,
    reportsAll.cards === 1 && !reportsAll.empty,
    await shot(page, 'm7-reports-all'))

  const messageInitial = await page.eval(() => ({
    filters: document.querySelectorAll('.messages-filter button').length,
    cards: document.querySelectorAll('.moderation-message-list article').length,
  }))
  await page.clickByText('已下架', { selector: '.messages-filter button', exact: false })
  await sleep(250)
  const messageHidden = await page.eval(() => ({
    cards: document.querySelectorAll('.moderation-message-list article').length,
    empty: document.querySelector('.moderation-message-list .empty-state')?.innerText ?? '',
  }))
  step('M8', '订单留言筛选', '3 个筛选；默认全部；已下架为空时显示空态',
    `filters=${messageInitial.filters} all=${messageInitial.cards} hidden=${messageHidden.cards} empty=${messageHidden.empty.includes('没有订单留言')}`,
    messageInitial.filters === 3 && messageHidden.cards === 0 && messageHidden.empty.includes('没有订单留言'),
    await shot(page, 'm8-messages'))

  // Persist all four filters, reload, then reset them.
  await page.clickByText('下架', { selector: '.moderation-filter button', exact: false })
  await page.clickByText('通过', { selector: '.comments-filter button', exact: false })
  await page.clickByText('全部', { selector: '.reports-filter button', exact: false })
  await page.clickByText('未下架', { selector: '.messages-filter button', exact: false })
  await sleep(350)
  const stored = await page.eval(() => localStorage.getItem('community-mvp.moderation-filters.v1'))
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('reviewer')
  await page.clickByText('审核', { selector: '.side-nav button', exact: false })
  await page.waitForText('内容与举报审核')
  await page.waitForSelector('.moderation-filter-bar')
  const restored = await page.eval(() => ({
    content: document.querySelector('.moderation-filter button[aria-selected="true"]')?.innerText ?? '',
    comment: document.querySelector('.comments-filter button[aria-selected="true"]')?.innerText ?? '',
    report: document.querySelector('.reports-filter button[aria-selected="true"]')?.innerText ?? '',
    message: document.querySelector('.messages-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
  step('M9', '审核筛选跨刷新保留', '四组筛选恢复为下架/通过/全部/未下架，且本机偏好已写入',
    `stored=${Boolean(stored)} content=${restored.content} comment=${restored.comment} report=${restored.report} message=${restored.message}`,
    Boolean(stored) && restored.content.includes('下架') && restored.comment.includes('通过')
    && restored.report.includes('全部') && restored.message.includes('未下架'),
    await shot(page, 'm9-persisted'))

  await page.clickByText('重置筛选', { selector: '.moderation-filter-bar button', exact: true })
  await page.waitForText('已重置审核筛选')
  await sleep(250)
  const reset = await page.eval(() => ({
    content: document.querySelector('.moderation-filter button[aria-selected="true"]')?.innerText ?? '',
    comment: document.querySelector('.comments-filter button[aria-selected="true"]')?.innerText ?? '',
    report: document.querySelector('.reports-filter button[aria-selected="true"]')?.innerText ?? '',
    message: document.querySelector('.messages-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
  step('M10', '重置筛选恢复默认', '内容全部、评论待审、举报待处理、留言全部',
    `content=${reset.content} comment=${reset.comment} report=${reset.report} message=${reset.message}`,
    reset.content.includes('全部') && reset.comment.includes('待审')
    && reset.report.includes('待处理') && reset.message.includes('全部'),
    await shot(page, 'm10-reset'))

  // Search combines with status filters.
  await page.eval(() => {
    const input = document.querySelector('.moderation-search input')
    input.value = '帮忙'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(300)
  const searchPosts = await page.eval(() => ({
    cards: document.querySelectorAll('.moderation-content-list article').length,
    text: document.querySelector('.moderation-content-list article')?.innerText ?? '',
  }))
  step('M11', '搜索叠加内容筛选', '搜索“帮忙”后内容列表只剩匹配帖子',
    `cards=${searchPosts.cards} hasTerm=${searchPosts.text.includes('帮忙')}`,
    searchPosts.cards === 1 && searchPosts.text.includes('帮忙'),
    await shot(page, 'm11-search-posts'))

  await page.clickSelector('.moderation-search button')
  await page.eval(() => {
    const input = document.querySelector('.moderation-search input')
    input.value = '虚构举报'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(300)
  const searchReports = await page.eval(() => ({
    reports: document.querySelectorAll('.moderation-report-list article').length,
    posts: document.querySelectorAll('.moderation-content-list article').length,
  }))
  step('M12', '搜索叠加举报筛选', '搜索“虚构举报”后只剩匹配举报',
    `reports=${searchReports.reports} posts=${searchReports.posts}`,
    searchReports.reports === 1 && searchReports.posts === 0,
    await shot(page, 'm12-search-reports'))

  await page.clickSelector('.moderation-search button')
  await page.eval(() => {
    const input = document.querySelector('.moderation-search input')
    input.value = '不存在的审核词'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(300)
  const emptySearch = await page.eval(() => ({
    posts: document.querySelectorAll('.moderation-content-list article').length,
    comments: document.querySelectorAll('.moderation-comment-list article').length,
    reports: document.querySelectorAll('.moderation-report-list article').length,
    messages: document.querySelectorAll('.moderation-message-list article').length,
  }))
  await page.clickSelector('.moderation-search button')
  await sleep(300)
  const cleared = await page.eval(() => document.querySelectorAll('.moderation-content-list article').length)
  step('M13', '无结果与清除搜索', '无匹配时各列表为空；清除后恢复全部内容',
    `posts=${emptySearch.posts} comments=${emptySearch.comments} reports=${emptySearch.reports} messages=${emptySearch.messages} cleared=${cleared}`,
    emptySearch.posts === 0 && emptySearch.comments === 0 && emptySearch.reports === 0 && emptySearch.messages === 0 && cleared === 4,
    await shot(page, 'm13-search-clear'))

  const auditBaseline = await page.eval(() => document.querySelectorAll('.moderation-audit-list article').length)
  await page.eval(() => {
    const input = document.querySelector('.moderation-search input')
    input.value = '提交举报'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(300)
  const auditSearch = await page.eval(() => ({
    cards: document.querySelectorAll('.moderation-audit-list article').length,
    text: document.querySelector('.moderation-audit-list article')?.innerText ?? '',
  }))
  await page.clickSelector('.moderation-search button')
  await sleep(300)
  const auditCleared = await page.eval(() => document.querySelectorAll('.moderation-audit-list article').length)
  step('M14', '搜索审核日志', '搜索“提交举报”保留匹配日志；清除后恢复全部日志',
    `baseline=${auditBaseline} matched=${auditSearch.cards} text=${auditSearch.text.includes('提交举报')} cleared=${auditCleared}`,
    auditBaseline > 0 && auditSearch.cards > 0 && auditSearch.text.includes('提交举报') && auditCleared === auditBaseline,
    await shot(page, 'm14-search-audit'))

  await page.clickByText('提交举报', { selector: '.audit-filter button', exact: false })
  await sleep(250)
  const auditAction = await page.eval(() => ({
    cards: document.querySelectorAll('.moderation-audit-list article').length,
    selected: document.querySelector('.audit-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('reviewer')
  await page.clickByText('审核', { selector: '.side-nav button', exact: false })
  await page.waitForText('内容与举报审核')
  await page.waitForSelector('.audit-filter')
  const auditRestored = await page.eval(() => ({
    cards: document.querySelectorAll('.moderation-audit-list article').length,
    selected: document.querySelector('.audit-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
  step('M15', '审核日志动作筛选并持久化', '筛选“提交举报”只剩该动作日志；刷新后仍保留筛选',
    `matched=${auditAction.cards} selected=${auditAction.selected} restored=${auditRestored.cards}/${auditRestored.selected}`,
    auditAction.cards === 1 && auditAction.selected.includes('提交举报')
    && auditRestored.cards === 1 && auditRestored.selected.includes('提交举报'),
    await shot(page, 'm15-audit-action'))

  await page.clickByText('重置筛选', { selector: '.moderation-filter-bar button', exact: true })
  await sleep(300)
  const auditReset = await page.eval(() => ({
    cards: document.querySelectorAll('.moderation-audit-list article').length,
    selected: document.querySelector('.audit-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
  step('M16', '重置包含日志筛选', '重置后日志筛选回到全部，日志恢复全部',
    `cards=${auditReset.cards} selected=${auditReset.selected}`,
    auditReset.cards === auditBaseline && auditReset.selected.includes('全部'),
    await shot(page, 'm16-audit-reset'))

  await writeFile(join(evidenceDir, 'moderation-filter-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
