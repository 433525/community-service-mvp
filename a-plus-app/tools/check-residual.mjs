// Residual-risk verification: R1 legacy hidden order migration, R2 partial event
// completion tolerance, R4 profile -> card deep link, R5 report dedupe at capacity.
// Run: node tools/check-residual.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-residual')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const COMMUNITY_KEY = 'community-mvp.synthetic-state.v1'
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `residual-${name}.png`)
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
  await page.fillByLabel('需求说明', '残余风险验证：虚构求助，用于完成与深链。')
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
  await page.fillByLabel('本次审核或处理理由', '残余风险验证：审核通过')
  await page.clickByText('通过', { selector: '.moderation-page button', exact: true })
  await sleep(400)
  await page.setMembership('member')
  await page.clickByText('我的', { selector: '.side-nav button', exact: false })
  await page.waitForText('我的发布')
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.home-todo')

  // R1: legacy hidden + active order migrates to cancelled on load
  const fixture = '帮忙把两箱演练物资'
  await page.eval((key, fixtureTitle) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    const envelope = JSON.parse(store.readBackupJson())
    const post = envelope.state.posts.find((item) => item.title.includes(fixtureTitle))
    post.moderation = 'hidden'
    post.orderStatus = 'accepted-local-demo'
    post.orderEvents = [{ id: 'EVT-LEGACY-ACCEPT', type: 'accept', actor: 'synthetic-counterpart', note: '旧存档接单', createdAt: new Date().toISOString(), synthetic: true }]
    localStorage.setItem(key, JSON.stringify(envelope))
  }, COMMUNITY_KEY, fixture)
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await sleep(300)
  const migrated = await storeEval(page, (store) => {
    const post = store.posts.find((item) => item.title.includes('帮忙把两箱演练物资'))
    const events = post?.orderEvents ?? []
    const last = events[events.length - 1]
    return {
      status: post?.orderStatus,
      eventCount: events.length,
      lastType: last?.type,
      lastActor: last?.actor,
      storage: store.storageStatus,
    }
  })
  step('R1', '旧存档下架+进行中订单载入迁移', 'orderStatus=cancelled、最后事件 reviewer/cancel、存档仍可读',
    `status=${migrated.status} events=${migrated.eventCount} last=${migrated.lastType}/${migrated.lastActor} storage=${migrated.storage}`,
    migrated.status === 'cancelled-local-demo' && migrated.lastType === 'cancel' && migrated.lastActor === 'reviewer' && migrated.storage === 'saved',
    await shot(page, 'r1-hidden-migration'))

  // R2/R4: publish own help, force legacy partial completion-requested
  const title = '求助：残余风险深链与完成（合成）'
  await page.clickByText('首页', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.home-todo')
  await publishHelp(page, title)
  await approveLatest(page)
  const postId = await storeEval(page, (store) => store.posts.find((p) => p.title.includes('残余风险深链'))?.id ?? '')
  await page.eval((key, id) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    const envelope = JSON.parse(store.readBackupJson())
    const post = envelope.state.posts.find((item) => item.id === id)
    post.orderStatus = 'completion-requested'
    post.orderEvents = [{ id: 'EVT-LEGACY-ACCEPT-2', type: 'accept', actor: 'synthetic-counterpart', note: '旧存档接单', createdAt: new Date().toISOString(), synthetic: true }]
    localStorage.setItem(key, JSON.stringify(envelope))
  }, COMMUNITY_KEY, postId)
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.clickByText('我的', { selector: '.side-nav button', exact: false })
  await page.waitForText('我的发布')
  await page.clickByText('服务记录', { selector: '.profile-tabs button', exact: false })
  await sleep(300)
  const recordText = await page.bodyText()
  const hasDeepLink = recordText.includes('去社区动态处理')
  await page.clickByText('去社区动态处理', { selector: 'button', exact: true })
  await sleep(600)
  const deepLink = await page.eval((id) => {
    const card = document.querySelector(`[data-post-id="${CSS.escape(id)}"]`)
    return {
      tab: document.querySelector('.page-heading h1')?.innerText ?? '',
      highlighted: card?.classList.contains('post-jump-highlight') ?? false,
      focused: document.activeElement === card,
      hasConfirm: Array.from(card?.querySelectorAll('button') ?? []).some((node) => (node.innerText || '').trim() === '确认完成'),
    }
  }, postId)
  step('R4', '服务记录深链定位到社区卡片', '点击后切到社区、目标卡片高亮/聚焦、确认按钮在卡片内',
    `link=${hasDeepLink} tab=${deepLink.tab} highlighted=${deepLink.highlighted} focused=${deepLink.focused} confirm=${deepLink.hasConfirm}`,
    hasDeepLink && deepLink.highlighted && deepLink.focused && deepLink.hasConfirm,
    await shot(page, 'r4-deep-link'))

  await page.clickByText('确认完成', { selector: '.post-jump-highlight button', exact: true })
  await sleep(400)
  const completed = await storeEval(page, (store) => store.posts.find((p) => p.title.includes('残余风险深链'))?.orderStatus)
  step('R2', '部分事件的旧待确认订单可完成', '只剩 accept 事件时仍显示确认并完成',
    `status=${completed}`, completed === 'completed-local-demo',
    await shot(page, 'r2-partial-event-completion'))

  // R5: 200 pending reports; duplicate target still gets "already" before capacity error
  const capacity = await storeEval(page, (store) => {
    const demo = { id: 'SYNTH-DEMO-USER', name: '演练居民', synthetic: true }
    const target = store.posts.find((post) => post.mode === 'help' && post.moderation === 'approved')
    const other = store.posts.find((post) => post.mode !== 'help' && post.moderation === 'approved')
    store.reports = Array.from({ length: 200 }, (_, index) => ({
      id: `SYNTH-REPORT-CAP-${index + 1}`,
      targetType: 'post',
      targetId: target.id,
      reason: '容量验证',
      status: 'pending',
      reporter: demo,
      createdAt: new Date().toISOString(),
      synthetic: true,
    }))
    return {
      duplicate: store.reportContent('post', target.id, '容量验证重复'),
      fresh: store.reportContent('post', other.id, '容量验证新目标'),
    }
  })
  step('R5', '举报上限前先查重', '同一目标返回已存在；新目标才提示数量上限',
    `duplicate=${capacity.duplicate.already} ${capacity.duplicate.message} | fresh=${(capacity.fresh.errors ?? []).join('')}`,
    capacity.duplicate.already === true && (capacity.fresh.errors ?? []).some((text) => text.includes('数量已达上限')),
    await shot(page, 'r5-report-dedupe'))

  // R3: at 100 events the action area is replaced by a stop notice.
  const lockedTarget = await page.eval((key) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    const envelope = JSON.parse(store.readBackupJson())
    const post = envelope.state.posts.find((item) => item.mode === 'help' && item.moderation === 'approved')
    post.orderStatus = 'accepted-local-demo'
    post.orderEvents = Array.from({ length: 100 }, (_, index) => ({
      id: `EVT-R3-${String(index + 1).padStart(3, '0')}`,
      type: 'accept',
      actor: 'synthetic-counterpart',
      note: '上限界面验证',
      createdAt: new Date(Date.now() + index).toISOString(),
      synthetic: true,
    }))
    localStorage.setItem(key, JSON.stringify(envelope))
    return { id: post.id, title: post.title }
  }, COMMUNITY_KEY)
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')
  await sleep(300)
  const lockedUi = await page.eval((id) => {
    const card = document.querySelector(`[data-post-id="${CSS.escape(id)}"]`)
    return {
      notice: card?.querySelector('.order-locked-note')?.innerText ?? '',
      actionButtons: Array.from(card?.querySelectorAll('.order-actions button') ?? []).filter((node) => !node.disabled).length,
    }
  }, lockedTarget.id)
  const lockedStore = await storeEval(page, (store) => {
    const target = store.posts.find((item) => item.mode === 'help'
      && item.orderStatus === 'accepted-local-demo'
      && (item.orderEvents?.length ?? 0) >= 100)
    return { result: target ? store.raiseOrderDispute(target.id, '上限界面验证') : null }
  })
  step('R3', '100 条事件时订单操作提前停用', '卡片显示上限说明、无可点订单按钮；store 仍拒绝追加',
    `notice=${lockedUi.notice.slice(0, 20)} buttons=${lockedUi.actionButtons} store=${JSON.stringify(lockedStore.result?.errors ?? [])}`,
    lockedUi.notice.includes('100 条上限') && lockedUi.actionButtons === 0
    && lockedStore.result?.ok === false,
    await shot(page, 'r3-event-lock'))

  await writeFile(join(evidenceDir, 'residual-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
