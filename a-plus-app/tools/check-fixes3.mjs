// Fix verification 3: legacy completion, order-event cap, notification landing,
// modal background inert, and A+ unreadable-archive reset guard.
// Run: node tools/check-fixes3.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-fixes3')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const COMMUNITY_KEY = 'community-mvp.synthetic-state.v1'
const INTAKE_KEY = 'a-plus.synthetic-intake.v1'
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `fix3-${name}.png`)
  await page.screenshot(file)
  return file
}
async function storeEval(page, fn) {
  return page.eval((source) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    return (new Function('store', `return (${source})(store)`))(store)
  }, fn.toString())
}
async function publishHelp(page, title) {
  await page.clickByText('发布', { selector: '.side-nav button', exact: false })
  await page.waitForText('发布一件小事')
  await page.fillByLabel('标题', title)
  await page.fillByLabel('需求说明', '修复验证：虚构求助，用于确认完成与事件上限。')
  await page.fillByLabel('希望时段', '本周五 15:00')
  await page.fillByLabel('预计时长', '约 1 小时')
  await page.checkSelector('.confirm-synthetic input')
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
  if (!result?.ok) throw new Error(`clickCardButton(${cardText}, ${label}) failed`)
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.post-card')
  const title = '求助：修复验证完成与上限（合成）'

  await publishHelp(page, title)
  await approveFirstPending(page, '修复验证：审核通过')
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')
  await clickCardButton(page, title, '代合成邻居接单（演练）')
  await page.waitForText('已接单（本机演练）')
  await clickCardButton(page, title, '代合成接单方申请完成（演练）')
  await page.waitForText('待确认完成（本机演练）')

  const notice = await storeEval(page, (store) => {
    const text = store.threads.filter((t) => t.kind === 'system').flatMap((t) => t.messages).map((m) => m.content).join(' ')
    return { mentionsCard: text.includes('社区动态'), text: text.slice(-180) }
  })
  await page.clickByText('我的', { selector: '.side-nav button', exact: false })
  await page.waitForText('我的发布')
  await page.clickByText('服务记录', { selector: '.profile-tabs button', exact: false })
  await sleep(300)
  const profileText = await page.bodyText()
  step('F1', '通知落点与服务记录入口', '通知提到“社区动态”，服务记录出现“去社区动态处理”',
    `notice=${notice.mentionsCard} button=${profileText.includes('去社区动态处理')}`,
    notice.mentionsCard && profileText.includes('去社区动态处理'),
    await shot(page, 'f1-notification-landing'))

  // legacy completion: remove orderEvents while status stays completion-requested
  const postId = await storeEval(page, (store) => store.posts.find((p) => p.title.includes('修复验证完成与上限'))?.id ?? '')
  await page.eval((key, id) => {
    const envelope = JSON.parse(localStorage.getItem(key))
    const post = envelope.state.posts.find((item) => item.id === id)
    delete post.orderEvents
    localStorage.setItem(key, JSON.stringify(envelope))
  }, COMMUNITY_KEY, postId)
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')
  const legacyConfirmVisible = await page.eval(() => document.body.innerText.includes('确认完成'))
  await clickCardButton(page, title, '确认完成')
  await sleep(400)
  const legacyDone = await storeEval(page, (store) => {
    const post = store.posts.find((p) => p.title.includes('修复验证完成与上限'))
    return { status: post?.orderStatus, events: post?.orderEvents?.length ?? 0 }
  })
  step('F2', '旧存档无事件仍可确认完成', '卡片显示“确认完成”，点击后 completed 并追加事件',
    `visible=${legacyConfirmVisible} status=${legacyDone.status} events=${legacyDone.events}`,
    legacyConfirmVisible && legacyDone.status === 'completed-local-demo' && legacyDone.events >= 1,
    await shot(page, 'f2-legacy-completion'))

  // event cap: 100 events, attempt dispute should be rejected and archive stays readable
  await page.eval((key, id) => {
    const envelope = JSON.parse(localStorage.getItem(key))
    const post = envelope.state.posts.find((item) => item.id === id)
    post.orderStatus = 'accepted-local-demo'
    post.orderEvents = Array.from({ length: 100 }, (_, index) => ({
      id: `EVT-CAP-${String(index + 1).padStart(3, '0')}`,
      type: 'accept',
      actor: 'demo-side',
      note: '上限验证事件',
      createdAt: new Date(Date.now() + index).toISOString(),
      synthetic: true,
    }))
    localStorage.setItem(key, JSON.stringify(envelope))
  }, COMMUNITY_KEY, postId)
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  const capResult = await storeEval(page, (store) => {
    const post = store.posts.find((p) => p.title.includes('修复验证完成与上限'))
    return { status: post?.orderStatus, events: post?.orderEvents?.length, result: store.raiseOrderDispute(post.id, '上限验证') }
  })
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  const capReload = await storeEval(page, (store) => ({ status: store.storageStatus, events: store.posts.find((p) => p.title.includes('修复验证完成与上限'))?.orderEvents?.length }))
  step('F3', '订单事件上限拒绝写入', '101 条写入被阻止、刷新后存档仍可读（saved）',
    `attempt=${JSON.stringify(capResult.result)} status=${capReload.status} events=${capReload.events}`,
    capResult.result.ok === false && (capResult.result.errors ?? []).some((text) => text.includes('上限'))
    && capReload.status === 'saved' && capReload.events === 100,
    await shot(page, 'f3-event-cap'))

  // inert background for B help dialog
  await page.clickSelector('.help-toggle')
  await page.waitForSelector('.help-dialog')
  const bInert = await page.eval(() => ({
    frame: document.querySelector('.app-frame')?.inert === true,
    header: document.querySelector('.topbar')?.inert === true,
    nav: document.querySelector('.mobile-nav')?.inert === true,
  }))
  await page.eval(() => document.querySelector('.help-dialog')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await sleep(300)
  const bInertAfter = await page.eval(() => document.querySelector('.app-frame')?.inert === true)
  step('F4', 'B 弹层背景 inert', '打开说明时顶栏/主内容/底栏 inert，关闭后恢复',
    `open=${JSON.stringify(bInert)} after=${bInertAfter}`,
    bInert.frame && bInert.header && bInert.nav && bInertAfter === false,
    await shot(page, 'f4-b-inert'))

  // A+ unreadable archive reset guard + inert modal background
  await page.eval((key) => localStorage.setItem(key, '{broken archive'), INTAKE_KEY)
  await page.navigate(`${base}/`)
  await page.waitForSelector('#app')
  await page.waitForText('重置演练')
  await page.clickByText('重置演练', { selector: 'button', exact: true })
  await sleep(500)
  const guardText = await page.bodyText()
  const stillBroken = await page.eval((key) => localStorage.getItem(key) === '{broken archive', INTAKE_KEY)
  step('F5', '不可读旧存档必须先下载原文', '点击重置只提示先下载，不覆盖旧存档',
    `toast=${guardText.includes('请先点“下载无法读取的旧存档”')} stillBroken=${stillBroken}`,
    guardText.includes('请先点“下载无法读取的旧存档”') && stillBroken,
    await shot(page, 'f5-unreadable-guard'))

  await page.eval((key) => localStorage.removeItem(key), INTAKE_KEY)
  await page.reload()
  await page.waitForSelector('#app')
  await page.waitForText('新建演练记录')
  await page.eval(() => {
    const button = Array.from(document.querySelectorAll('button')).find((node) => (node.innerText || '').includes('新建演练记录'))
    button?.focus()
    button?.click()
  })
  await sleep(400)
  const aplusInert = await page.eval(() => ({
    main: document.querySelector('main.main-area')?.inert === true,
    rail: document.querySelector('.side-rail')?.inert === true,
    dialog: Boolean(document.querySelector('#create-title')),
  }))
  await page.eval(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await sleep(300)
  const aplusInertAfter = await page.eval(() => document.querySelector('main.main-area')?.inert === true)
  step('F6', 'A+ 弹层背景 inert', '打开弹层时侧栏与主内容 inert，关闭后恢复',
    `open=${JSON.stringify(aplusInert)} after=${aplusInertAfter}`,
    aplusInert.dialog && aplusInert.main && aplusInert.rail && aplusInertAfter === false,
    await shot(page, 'f6-aplus-inert'))

  await writeFile(join(evidenceDir, 'fix3-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
