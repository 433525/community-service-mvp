// Post-fix verification for the audit findings (B + A+ + mobile/keyboard).
// Run: node tools/check-fixes2.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-fixes2')
const args = new Map(process.argv.slice(2).map((raw) => {
  const [key, ...rest] = raw.replace(/^--/, '').split('=')
  return [key, rest.join('=')]
}))
const base = (args.get('base') || 'http://127.0.0.1:5180').replace(/\/$/, '')
const COMMUNITY_KEY = 'community-mvp.synthetic-state.v1'
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `fix2-${name}.png`)
  await page.screenshot(file)
  return file
}
async function communityStore(page, fn) {
  return page.eval((source) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    return (new Function('store', `return (${source})(store)`))(store)
  }, fn.toString())
}
async function intakeStore(page, fn, args) {
  return page.eval((source, extra) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('intake')
    return (new Function('store', 'args', `return (${source})(store, args)`))(store, extra)
  }, fn.toString(), args ?? null)
}
async function clickCardButton(page, cardText, label) {
  const result = await page.eval((text, wanted) => {
    const norm = (v) => (v || '').replace(/\s+/g, ' ').trim()
    const card = Array.from(document.querySelectorAll('.post-card')).find((node) => norm(node.innerText).includes(text))
    const button = card && Array.from(card.querySelectorAll('button')).find((node) => norm(node.innerText) === wanted && !node.disabled)
    if (!button) return { ok: false }
    button.scrollIntoView({ block: 'center' })
    button.click()
    return { ok: true }
  }, cardText, label)
  if (!result?.ok) throw new Error(`clickCardButton ${cardText} / ${label} failed`)
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  // setup
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.post-card')

  // B1 reviewNote private
  const note = '审计B-仅审核员可见备注-ZZZ'
  await page.eval((key, noteText) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    const envelope = JSON.parse(store.readBackupJson())
    envelope.state.posts[0].reviewNote = noteText
    localStorage.setItem(key, JSON.stringify(envelope))
  }, COMMUNITY_KEY, note)
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.post-card')
  const publicText = await page.bodyText()
  const ownProfileNote = await page.eval(() => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    store.posts[0].reviewNote
    return document.body.innerText.includes('审计B-仅审核员可见备注-ZZZ')
  })
  step('B1', '审核员备注不在公开卡片渲染', '社区/首页卡片不包含 reviewNote 文本',
    `public=${publicText.includes(note)}`, !publicText.includes(note) && !ownProfileNote,
    await shot(page, 'b1-reviewnote-private'))

  // reset state
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')

  // B2 duplicate report toast
  await page.clickByText('举报', { selector: '.post-actions button', exact: true })
  await page.waitForText('举报理由（帖子）')
  await page.fillByLabel('举报理由', '修复验证：虚构举报理由')
  await page.clickByText('提交本机举报')
  await page.waitForText('举报已进入本机审核队列。')
  await page.clickByText('举报', { selector: '.post-actions button', exact: true })
  await page.waitForText('举报理由（帖子）')
  await page.fillByLabel('举报理由', '修复验证：重复举报')
  await page.clickByText('提交本机举报')
  await page.waitForText('已有一条待处理的本机举报')
  const duplicateToast = await page.bodyText()
  step('B2', '重复举报提示真实结果', '第二次显示“已有一条待处理的本机举报”',
    `toast=${duplicateToast.includes('已有一条待处理的本机举报')}`,
    duplicateToast.includes('已有一条待处理的本机举报'), await shot(page, 'b2-duplicate-report'))

  // B3 hide active order auto-close
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')
  await clickCardButton(page, '帮忙把两箱演练物资', '演练接单')
  await page.waitForText('已接单（本机演练）')
  await page.setMembership('reviewer')
  await page.clickByText('审核', { selector: '.side-nav button', exact: false })
  await page.waitForText('内容与举报审核')
  await page.fillByLabel('本次审核或处理理由', '修复验证：下架进行中订单')
  await page.clickByText('下架帖子', { selector: '.moderation-page button', exact: true })
  await sleep(500)
  const hiddenOrder = await communityStore(page, (store) => {
    const post = store.posts.find((item) => item.title.includes('帮忙把两箱演练物资'))
    return {
      status: post?.orderStatus,
      lastActor: post?.orderEvents?.at(-1)?.actor,
      lastType: post?.orderEvents?.at(-1)?.type,
      notices: store.notificationsReadAt !== undefined,
      noticeText: store.threads.filter((t) => t.kind === 'system').flatMap((t) => t.messages).map((m) => m.content).join(' '),
    }
  })
  await page.setMembership('member')
  await page.clickByText('我的', { selector: '.side-nav button', exact: false })
  await page.waitForText('我的发布')
  await page.clickByText('服务记录', { selector: '.profile-tabs button', exact: false })
  await sleep(300)
  const profileText = await page.bodyText()
  step('B3', '下架进行中订单自动关闭并通知', '订单 cancelled、最后事件 reviewer/cancel、成员端显示已下架说明',
    `status=${hiddenOrder.status} last=${hiddenOrder.lastType}/${hiddenOrder.lastActor} profileHasHidden=${profileText.includes('已被审核下架')} notice=${hiddenOrder.noticeText.includes('自动关闭')}`,
    hiddenOrder.status === 'cancelled-local-demo' && hiddenOrder.lastType === 'cancel' && hiddenOrder.lastActor === 'reviewer'
    && profileText.includes('已被审核下架') && hiddenOrder.noticeText.includes('自动关闭'),
    await shot(page, 'b3-hidden-order-closed'))

  // A+ channel validation and complaint deadlock
  await page.navigate(`${base}/`)
  await page.waitForSelector('#app')
  await page.waitForText('新建演练记录')
  const aplus = await intakeStore(page, (store) => {
    const baseInput = { label: '修复验证', summary: '修复验证摘要', owner: '演练-受理席-01', nextStep: '核对', dueAt: '2026-10-25T10:00', highRisk: false, highRiskNote: '' }
    const communityNoPost = store.createCase({ ...baseInput, sourceChannel: 'community-entry-local' })
    const manualWithPost = store.createCase({ ...baseInput, sourceChannel: 'manual-entry', sourcePostId: 'SYNTH-POST-X' })
    const previousRole = store.currentDemoRole
    store.currentDemoRole = 'demo-review'
    const caseId = store.cases[0]?.id
    const deadlock = caseId
      ? store.submitComplaint({ caseId, targetRole: 'demo-referral', description: '修复验证：复核死锁组合' })
      : { ok: false, errors: ['no-case'] }
    store.currentDemoRole = previousRole
    return { communityNoPost, manualWithPost, deadlock }
  })
  step('A1', '社区来源与帖子 ID 一致性', '缺帖子 ID 的社区来源、非社区来源带帖子 ID 均被拒绝',
    `communityNoPost=${JSON.stringify(aplus.communityNoPost.errors)} manualWithPost=${JSON.stringify(aplus.manualWithPost.errors)}`,
    aplus.communityNoPost.ok === false && aplus.manualWithPost.ok === false,
    await shot(page, 'a1-channel-validation'))
  step('A2', '投诉复核死锁组合被拒绝', '提交人 review + 被投诉 referral 时提交失败并解释',
    `deadlock=${JSON.stringify(aplus.deadlock.errors)}`,
    aplus.deadlock.ok === false && (aplus.deadlock.errors ?? []).some((text) => text.includes('没有可用的复核角色')),
    await shot(page, 'a2-complaint-deadlock'))

  // A5 high-risk filter keeps detail in sync with the filtered queue
  await page.clickByText('高风险', { selector: '.filters .filter', exact: true })
  await sleep(350)
  const filterSync = await page.eval(() => {
    const firstRow = document.querySelector('.queue-item')
    const detail = document.querySelector('.detail-panel')
    const rowText = (firstRow?.innerText || '').replace(/\s+/g, ' ').trim()
    const detailText = (detail?.innerText || '').replace(/\s+/g, ' ').trim()
    const idMatch = rowText.match(/SYNTH-\d+/)?.[0] ?? ''
    return { id: idMatch, detailHasId: idMatch ? detailText.includes(idMatch) : false }
  })
  step('A5', '高风险筛选后详情同步', '筛选后详情面板显示筛选结果中的记录',
    `rowId=${filterSync.id} detailHasId=${filterSync.detailHasId}`,
    Boolean(filterSync.id) && filterSync.detailHasId,
    await shot(page, 'a5-filter-sync'))

  // A+ mobile layout + dialog keyboard
  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(500)
  const mobile = await page.eval(() => {
    const banner = document.querySelector('.synthetic-banner')
    const copy = document.querySelector('.synthetic-copy')
    const nav = document.querySelector('.mobile-nav')
    const navRect = nav?.getBoundingClientRect()
    return {
      innerWidth: window.innerWidth,
      docWidth: document.documentElement.scrollWidth,
      copyWidth: Math.round(copy?.getBoundingClientRect().width ?? 0),
      copyHeight: Math.round(copy?.getBoundingClientRect().height ?? 0),
      bannerHeight: Math.round(banner?.getBoundingClientRect().height ?? 0),
      navVisibleHeight: navRect ? Math.max(0, Math.min(window.visualViewport?.height ?? 0, navRect.bottom) - navRect.top) : 0,
      navHeight: navRect ? Math.round(navRect.height) : 0,
    }
  })
  step('A3', 'A+ 移动端 390px 布局', 'innerWidth=390、无横向溢出、横幅正文列宽>0、底部导航完整可见',
    `inner=${mobile.innerWidth} doc=${mobile.docWidth} copy=${mobile.copyWidth}x${mobile.copyHeight} nav=${mobile.navVisibleHeight}/${mobile.navHeight}`,
    mobile.innerWidth === 390 && mobile.docWidth <= 390 && mobile.copyWidth > 100
    && mobile.navHeight > 0 && mobile.navVisibleHeight >= mobile.navHeight - 1,
    await shot(page, 'a3-mobile-layout'))
  await page.eval(() => {
    const button = Array.from(document.querySelectorAll('button')).find((node) => (node.innerText || '').includes('新建演练记录'))
    button?.focus()
    button?.click()
  })
  await sleep(400)
  const dialogFocus = await page.eval(() => ({
    open: Boolean(document.querySelector('#create-title')),
    focusInside: document.querySelector('.modal')?.contains(document.activeElement) ?? false,
    tag: document.activeElement?.tagName,
  }))
  await page.eval(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  await sleep(300)
  const dialogAfter = await page.eval(() => ({
    open: Boolean(document.querySelector('#create-title')),
    activeText: (document.activeElement?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
  }))
  step('A4', 'A+ 弹层焦点与 Esc', '打开后焦点进入弹层、Esc 关闭、焦点回到触发按钮',
    `focusInside=${dialogFocus.focusInside} open=${dialogFocus.open} afterOpen=${dialogAfter.open} active=${dialogAfter.activeText}`,
    dialogFocus.open && dialogFocus.focusInside && !dialogAfter.open && dialogAfter.activeText.includes('新建'),
    await shot(page, 'a4-dialog-keyboard'))
  await page.client.send('Emulation.clearDeviceMetricsOverride')

  // B reading-large topbar mobile
  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(300)
  await page.clickSelector('.reading-toggle')
  await sleep(400)
  const topbar = await page.eval(() => {
    const bar = document.querySelector('.topbar')
    const brand = document.querySelector('.brand')
    const right = document.querySelector('.topbar-right')
    const rect = (node) => node?.getBoundingClientRect()
    return {
      clientWidth: bar?.clientWidth,
      scrollWidth: bar?.scrollWidth,
      brandRight: rect(brand)?.right ?? 0,
      rightLeft: rect(right)?.left ?? 0,
      height: rect(bar)?.height,
    }
  })
  step('B4', '大字模式移动端顶栏不重叠', 'topbar 无横向溢出、品牌与右侧操作不重叠',
    `client=${topbar.clientWidth} scroll=${topbar.scrollWidth} brandRight=${Math.round(topbar.brandRight)} rightLeft=${Math.round(topbar.rightLeft)} height=${Math.round(topbar.height)}`,
    (topbar.scrollWidth ?? 0) <= (topbar.clientWidth ?? 0) + 1 && topbar.brandRight <= topbar.rightLeft,
    await shot(page, 'b4-reading-topbar'))
  await page.client.send('Emulation.clearDeviceMetricsOverride')

  // B5 remaining low-contrast publish sub-label
  await page.clickByText('发布', { selector: '.side-nav button', exact: false })
  await page.waitForText('发布一件小事')
  const labelColor = await page.eval(() => {
    const node = document.querySelector('.mode-options button small')
    return node ? getComputedStyle(node).color : ''
  })
  step('B5', '发布类型副说明对比度修复', '颜色不再是 154,163,155；改为深色',
    `color=${labelColor}`, labelColor === 'rgb(95, 109, 100)',
    await shot(page, 'b5-publish-label'))

  await writeFile(join(evidenceDir, 'fix2-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
