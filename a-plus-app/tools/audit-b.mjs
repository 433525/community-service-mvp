// Read-only defect audit for the B controlled-community demo.
// Drives an isolated headless Chrome against the already-running preview.
// Run: node tools/audit-b.mjs --base=http://127.0.0.1:5180
// Evidence: docs/运营准备/evidence-audit-b/

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep, CdpClient } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const evidenceDir = join(repoRoot, '..', 'docs', '运营准备', 'evidence-audit-b')
const COMMUNITY_KEY = 'community-mvp.synthetic-state.v1'

const args = new Map()
for (const raw of process.argv.slice(2)) {
  const [key, ...rest] = raw.replace(/^--/, '').split('=')
  args.set(key, rest.join('='))
}
const base = (args.get('base') || 'http://127.0.0.1:5180').replace(/\/$/, '')

const findings = []
const checks = []
const observations = {}

function finding(id, title, severity, kind, expected, actual, evidence) {
  findings.push({ id, title, severity, kind, expected, actual, evidence })
  console.log(`[FINDING ${severity}] ${id} ${title} — ${actual}`)
}

function check(id, name, expected, actual, ok, evidence = '') {
  checks.push({ id, name, expected, actual, ok, evidence })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

async function shot(page, name) {
  const file = join(evidenceDir, `${name}.png`)
  try { await page.client.send('Page.bringToFront') } catch { /* ignore */ }
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.screenshot(file)
      return file
    } catch (error) {
      lastError = error
      await sleep(500)
    }
  }
  throw lastError
}

async function text(page, name) {
  const file = join(evidenceDir, `${name}.txt`)
  await page.savePageText(file)
  return file
}

async function shotText(page, name) {
  await page.scrollToTop()
  const png = await shot(page, name)
  const txt = await text(page, name)
  return { png, txt }
}

async function storeEval(page, fn) {
  return page.eval((source) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    return (new Function('store', `return (${source})(store)`))(store)
  }, fn.toString())
}

async function storeStatus(page) {
  return storeEval(page, (store) => store.storageStatus)
}

async function reset(page, { member = true } = {}) {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  if (member) {
    await page.setMembership('member')
    await page.waitForSelector('.post-card')
  }
}

async function goTab(page, label) {
  await page.clickByText(label, { selector: '.side-nav button', exact: false })
  await sleep(300)
}

async function waitToastGone(page) {
  await page.waitForExpression("!document.querySelector('.toast-message')", { timeoutMs: 9000 })
}

async function readToast(page) {
  return norm(await page.eval(() => document.querySelector('.toast-message')?.innerText ?? ''))
}

async function waitToastAppear(page) {
  await page.waitForExpression("document.querySelector('.toast-message')?.innerText.length > 0", { timeoutMs: 6000 })
  await sleep(120)
  return readToast(page)
}

async function cardByText(page, text) {
  return page.eval((wanted) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim()
    const cards = Array.from(document.querySelectorAll('.post-card'))
    const card = cards.find((node) => normalize(node.innerText).includes(normalize(wanted)))
    return card ? { ok: true, text: normalize(card.innerText).slice(0, 1200) } : {
      ok: false,
      cards: cards.map((node) => normalize(node.innerText).slice(0, 80)),
    }
  }, text)
}

async function clickCardButton(page, cardText, labels) {
  const result = await page.eval((text, wanted) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim()
    const cards = Array.from(document.querySelectorAll('.post-card'))
    const card = cards.find((node) => normalize(node.innerText).includes(normalize(text)))
    if (!card) return { ok: false, reason: 'card-not-found', cards: cards.map((node) => normalize(node.innerText).slice(0, 60)) }
    const buttons = Array.from(card.querySelectorAll('button'))
    for (const label of wanted) {
      const button = buttons.find((node) => normalize(node.innerText) === label && !node.disabled)
      if (button) {
        button.scrollIntoView({ block: 'center', inline: 'nearest' })
        button.click()
        return { ok: true, label }
      }
    }
    return { ok: false, reason: 'button-not-found', wanted, available: buttons.map((node) => normalize(node.innerText)) }
  }, cardText, labels)
  if (!result?.ok) throw new Error(`clickCardButton(${cardText}) failed: ${JSON.stringify(result)}`)
  await sleep(250)
  return result
}

async function fillCardNote(page, cardText, value) {
  const result = await page.eval((text, nextValue) => {
    const normalize = (input) => (input || '').replace(/\s+/g, ' ').trim()
    const cards = Array.from(document.querySelectorAll('.post-card'))
    const card = cards.find((node) => normalize(node.innerText).includes(normalize(text)))
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

async function cardButtons(page, cardText) {
  return page.eval((text) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim()
    const cards = Array.from(document.querySelectorAll('.post-card'))
    const card = cards.find((node) => normalize(node.innerText).includes(normalize(text)))
    if (!card) return { found: false, buttons: [] }
    return {
      found: true,
      buttons: Array.from(card.querySelectorAll('button')).map((node) => normalize(node.innerText)),
      cardText: normalize(card.innerText).slice(0, 1600),
    }
  }, cardText)
}

async function clickModerationCardButton(page, cardText, label) {
  const result = await page.eval((text, wanted) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim()
    const cards = Array.from(document.querySelectorAll('.feedback-card'))
    const card = cards.find((node) => normalize(node.innerText).includes(normalize(text)))
    if (!card) return { ok: false, reason: 'card-not-found', cards: cards.map((node) => normalize(node.innerText).slice(0, 60)) }
    const button = Array.from(card.querySelectorAll('button')).find((node) => normalize(node.innerText) === wanted && !node.disabled)
    if (!button) return { ok: false, reason: 'button-not-found', available: Array.from(card.querySelectorAll('button')).map((node) => normalize(node.innerText)) }
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
    button.click()
    return { ok: true }
  }, cardText, label)
  if (!result?.ok) throw new Error(`clickModerationCardButton(${cardText}) failed: ${JSON.stringify(result)}`)
  await sleep(350)
}

async function publishHelp(page, title, marker) {
  await page.clickByText('发布', { selector: '.side-nav button', exact: false })
  await page.waitForText('发布一件小事')
  await page.fillByLabel('标题', title)
  await page.fillByLabel('需求说明', marker)
  await page.fillByLabel('希望时段', '本周五 15:00')
  await page.fillByLabel('预计时长', '约 1 小时')
  await page.checkSelector('.confirm-synthetic input')
  await page.clickSelector('.publish-form .submit-button')
  await page.waitForText('我的发布')
  await sleep(300)
}

async function approvePending(page, title, reason) {
  await page.clickByText('审核', { selector: '.side-nav button', exact: false })
  await page.waitForText('内容与举报审核')
  await page.setMembership('reviewer')
  await page.fillByLabel('本次审核或处理理由', reason)
  await page.clickByText('通过', {
    selector: '.moderation-page button',
    exact: true,
    withinSelector: '.feedback-card',
    withinText: title,
  })
  await sleep(400)
}

async function setMembership(page, role) {
  await page.setMembership(role)
  await sleep(150)
}

async function readEnvelope(page) {
  const envelope = await page.readLocalStorageJson(COMMUNITY_KEY)
  if (!envelope || envelope.__parseError) throw new Error('no valid community envelope in localStorage')
  return envelope
}

async function writeEnvelopeAndReload(page, envelope, { member = true } = {}) {
  envelope.savedAt = new Date().toISOString()
  await page.writeLocalStorage(COMMUNITY_KEY, JSON.stringify(envelope))
  await page.reload()
  await page.waitForSelector('.community-app')
  if (member) {
    await page.setMembership('member')
    await page.waitForSelector('.post-card')
  }
}

async function saveOnce(page) {
  await goTab(page, '社区')
  await page.waitForSelector('.post-card')
  await clickCardButton(page, '帮忙把两箱', ['♡ 7'])
  await sleep(250)
}

async function cEval(client, fn, ...args) {
  const expression = typeof fn === 'function'
    ? `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(',')})`
    : String(fn)
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`tab eval failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
  }
  return result.result?.value
}

async function newTab(session, url) {
  const response = await fetch(`http://127.0.0.1:${session.port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!response.ok) throw new Error(`could not open second tab: HTTP ${response.status}`)
  const target = await response.json()
  const client = await CdpClient.open(target.webSocketDebuggerUrl)
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const ready = await cEval(client, () => document.readyState === 'complete' && Boolean(document.querySelector('.community-app'))).catch(() => false)
    if (ready) return { client, target }
    await sleep(150)
  }
  throw new Error('second tab did not become ready')
}

async function main() {
  await mkdir(evidenceDir, { recursive: true })

  await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
    observations.build = await page.eval(async () => {
      const scripts = Array.from(document.querySelectorAll('script[src]')).map((node) => node.getAttribute('src'))
      return { url: location.href, title: document.title, scripts }
    })

    // ------------------------------------------------------------------
    // A. reviewer-only reviewNote is rendered in the public feed
    // ------------------------------------------------------------------
    await reset(page)
    await saveOnce(page)
    const envA = await readEnvelope(page)
    const reviewPost = envA.state.posts.find((post) => post.id === 'SYNTH-POST-001')
    if (!reviewPost) throw new Error('fixture post SYNTH-POST-001 missing')
    const reviewMarker = '审计B-仅审核员可见备注-ZZZ'
    reviewPost.reviewNote = reviewMarker
    await writeEnvelopeAndReload(page, envA)
    const homeReviewText = await page.bodyText()
    const homeA = await shotText(page, 'A1-reviewnote-home')
    const homeHasMarker = homeReviewText.includes(reviewMarker)
    await goTab(page, '社区')
    const communityReviewText = await page.bodyText()
    const communityA = await shotText(page, 'A2-reviewnote-community')
    const communityHasMarker = communityReviewText.includes(reviewMarker)
    const reviewStore = await storeEval(page, (store) => {
      const post = store.posts.find((item) => item.id === 'SYNTH-POST-001')
      return { author: post?.author?.id, moderation: post?.moderation, reviewNote: post?.reviewNote }
    })
    await writeFile(join(evidenceDir, 'A-reviewnote-store.json'), JSON.stringify(reviewStore, null, 2), 'utf8')
    check(
      'A1',
      '审核备注只应在审核端/本人处可见',
      '首页与社区信息流不显示其他作者的 reviewNote',
      `home=${homeHasMarker} community=${communityHasMarker} note=${reviewStore.reviewNote}`,
      !homeHasMarker && !communityHasMarker,
      `${homeA.png} | ${communityA.png}`,
    )
    if (homeHasMarker || communityHasMarker) {
      finding('A', '审核员私有备注被公开渲染到首页与社区信息流', 'P1', '实测缺陷',
        'reviewNote 属于审核员备注，不应出现在其他成员可见的公开卡片上（本人“我的发布”可显示“审核说明”）。',
        `注入合法存档后，其他作者 SYNTH-POST-001 的 reviewNote “${reviewMarker}” 同时出现在首页和社区卡片；源码 PostCard.vue:188 无条件渲染 post.reviewNote。`,
        'A1-reviewnote-home.png / A2-reviewnote-community.png / A-reviewnote-store.json')
    }

    // ------------------------------------------------------------------
    // B. duplicate report: store de-dupes but UI reports success
    // ------------------------------------------------------------------
    await reset(page)
    await goTab(page, '社区')
    await clickCardButton(page, '帮忙把两箱', ['举报'])
    await page.fillByLabel('举报理由', '审计B-重复举报-第一次')
    await page.clickByText('提交本机举报')
    const toast1 = await waitToastAppear(page)
    const report1 = await storeEval(page, (store) => ({
      reports: store.reports.length,
      createReports: store.auditLog.filter((entry) => entry.action === 'create-report').length,
    }))
    await waitToastGone(page)
    await clickCardButton(page, '帮忙把两箱', ['举报'])
    await page.fillByLabel('举报理由', '审计B-重复举报-第二次')
    await page.clickByText('提交本机举报')
    const toast2 = await waitToastAppear(page)
    const report2 = await storeEval(page, (store) => ({
      reports: store.reports.length,
      createReports: store.auditLog.filter((entry) => entry.action === 'create-report').length,
      ids: store.reports.map((item) => item.id),
    }))
    const dupB = await shotText(page, 'B1-duplicate-report-toast')
    check(
      'B1',
      '重复举报的界面反馈应与实际结果一致',
      '第二次提交提示“已有待处理举报，未重复提交”',
      `toast1=${toast1} toast2=${toast2} reports=${report1.reports}->${report2.reports}`,
      report2.reports === 1 && toast2.includes('未重复'),
      dupB.png,
    )
    if (!(report2.reports === 1 && toast2.includes('未重复'))) {
      finding('B', '重复举报未写入却提示“已进入审核队列”', 'P2', '实测缺陷',
        'store.reportContent 返回 already=true 时，界面应提示已有待处理举报，不应显示成功提交。',
        `第二次提交后 reports 仍为 ${report2.reports}、create-report 日志仍为 ${report2.createReports}，但 toast 仍是“${toast2}”；PostCard.vue:113-117 与 MessagesView.vue:68-72 忽略 result.already/result.message。`,
        'B1-duplicate-report-toast.png')
    }

    // ------------------------------------------------------------------
    // C. hiding a help post removes all member-side order controls
    // ------------------------------------------------------------------
    await reset(page)
    await goTab(page, '社区')
    await clickCardButton(page, '帮忙把两箱', ['演练接单'])
    await page.waitForText('已接单（本机演练）')
    await setMembership(page, 'reviewer')
    await page.clickByText('审核', { selector: '.side-nav button', exact: false })
    await page.waitForText('内容与举报审核')
    await page.fillByLabel('本次审核或处理理由', '审计B-下架进行中求助')
    await clickModerationCardButton(page, '帮忙把两箱', '下架帖子')
    await sleep(400)
    const hiddenStore = await storeEval(page, (store) => {
      const post = store.posts.find((item) => item.title.includes('帮忙把两箱'))
      return { moderation: post?.moderation, orderStatus: post?.orderStatus, acceptedByMe: post?.acceptedByMe }
    })
    await setMembership(page, 'member')
    await goTab(page, '社区')
    const communityAfterHide = await page.bodyText()
    const hiddenC1 = await shotText(page, 'C1-hidden-community')
    await goTab(page, '消息')
    const messagesAfterHide = await page.bodyText()
    const hiddenC2 = await shotText(page, 'C2-hidden-messages')
    await goTab(page, '我的')
    await page.clickByText('服务记录', { selector: '.profile-tabs button', exact: false })
    await sleep(300)
    const profileAfterHide = await page.eval(() => {
      const rows = Array.from(document.querySelectorAll('.service-record-row'))
      const row = rows.find((node) => (node.innerText || '').includes('帮忙把两箱'))
      return {
        rows: rows.length,
        rowText: row ? (row.innerText || '').replace(/\s+/g, ' ').trim() : '',
        buttons: row ? Array.from(row.querySelectorAll('button')).map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()) : [],
      }
    })
    await page.scrollToText('帮忙把两箱')
    const hiddenC3 = await shotText(page, 'C3-hidden-profile')
    await writeFile(join(evidenceDir, 'C-hidden-state.json'), JSON.stringify({ hiddenStore, profileAfterHide }, null, 2), 'utf8')
    check(
      'C1',
      '下架后进行中订单在成员端仍有明确处置路径',
      '成员仍能查看/关闭进行中订单，或页面明确说明只能等审核恢复',
      `communityHasCard=${communityAfterHide.includes('帮忙把两箱')} messagesHasOrder=${messagesAfterHide.includes('帮忙把两箱')} profileRow=${Boolean(profileAfterHide.rowText)} buttons=${JSON.stringify(profileAfterHide.buttons)} status=${hiddenStore.orderStatus}`,
      false,
      `${hiddenC1.png} | ${hiddenC2.png} | ${hiddenC3.png}`,
    )
    if (profileAfterHide.rowText && !profileAfterHide.buttons.length) {
      finding('C', '下架进行中求助后，成员端订单失去留言与关闭入口', 'P2', '实测缺陷',
        '下架应停止留言，但进行中订单仍应有可理解的处置路径（关闭/查看），或系统自动关闭并说明；不应在成员端变成无操作入口的滞留订单。',
        `下架后：社区卡片消失、消息页订单列表无该单、我的服务记录仍有“已下架”行但没有任何按钮；orderStatus 仍为 ${hiddenStore.orderStatus}，只能由审核员恢复或重置数据。`,
        'C1-hidden-community.png / C2-hidden-messages.png / C3-hidden-profile.png / C-hidden-state.json')
    }
    // restore to confirm state is not lost
    await setMembership(page, 'reviewer')
    await page.clickByText('审核', { selector: '.side-nav button', exact: false })
    await page.waitForText('内容与举报审核')
    await page.fillByLabel('本次审核或处理理由', '审计B-恢复进行中求助')
    await clickModerationCardButton(page, '帮忙把两箱', '恢复为通过')
    await sleep(400)
    const restored = await storeEval(page, (store) => {
      const post = store.posts.find((item) => item.title.includes('帮忙把两箱'))
      return { moderation: post?.moderation, orderStatus: post?.orderStatus }
    })
    check('C2', '恢复审核后订单状态保留', 'moderation=approved、orderStatus 不变', JSON.stringify(restored), restored.moderation === 'approved' && restored.orderStatus === 'accepted-local-demo')

    // ------------------------------------------------------------------
    // D. completion-request notice points at a page without a confirm control
    // ------------------------------------------------------------------
    await reset(page)
    const ownTitle = `审计B-本人求助-${Date.now().toString(36)}`
    await publishHelp(page, ownTitle, '审计B 通知指向验证用虚构求助。')
    await approvePending(page, ownTitle, '审计B-通过本人求助')
    await setMembership(page, 'member')
    await goTab(page, '社区')
    await clickCardButton(page, ownTitle, ['代合成邻居接单（演练）'])
    await page.waitForText('已接单（本机演练）')
    await clickCardButton(page, ownTitle, ['代合成接单方申请完成（演练）'])
    await page.waitForText('待确认完成（本机演练）')
    await goTab(page, '消息')
    const messagesD = await page.bodyText()
    const noticeLine = messagesD.split('\n').find((line) => line.includes('核对后确认'))
      ?? messagesD.split('\n').find((line) => line.includes('服务记录'))
      ?? ''
    await goTab(page, '我的')
    await page.clickByText('服务记录', { selector: '.profile-tabs button', exact: false })
    await sleep(300)
    const profileD = await page.eval(() => {
      const row = Array.from(document.querySelectorAll('.service-record-row')).find((node) => (node.innerText || '').includes('审计B-本人求助'))
      return {
        rowText: row ? (row.innerText || '').replace(/\s+/g, ' ').trim() : '',
        buttons: row ? Array.from(row.querySelectorAll('button')).map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()) : [],
        pageHasConfirm: (document.body.innerText || '').includes('确认完成'),
      }
    })
    await page.scrollToText('审计B-本人求助')
    const noticeD = await shotText(page, 'D1-service-record-no-confirm')
    await writeFile(join(evidenceDir, 'D-notice-vs-profile.json'), JSON.stringify({ noticeLine, profileD }, null, 2), 'utf8')
    check(
      'D1',
      '“我的 → 服务记录”能完成通知要求的确认',
      '通知说去服务记录确认时，服务记录应提供确认入口或明确指路',
      `notice=${noticeLine} profileButtons=${JSON.stringify(profileD.buttons)} pageHasConfirm=${profileD.pageHasConfirm}`,
      profileD.buttons.some((label) => label.includes('确认完成')),
      noticeD.png,
    )
    if (!profileD.buttons.some((label) => label.includes('确认完成'))) {
      finding('D', '系统通知引导到“我的 → 服务记录”，该页却没有确认完成入口', 'P2', '实测缺陷',
        '合成接单方发起完成申请后，通知应把用户带到实际可确认的位置，或在服务记录提供确认按钮。',
        `通知原文含“请在“我的 → 服务记录”核对后确认”，但服务记录行只有展示文本，没有任何按钮；页面仅在社区卡片上提供“确认完成”。通知文案见 store.ts:1358。`,
        'D1-service-record-no-confirm.png / D-notice-vs-profile.json')
    }

    // ------------------------------------------------------------------
    // E. legacy completion-requested post without orderEvents is stuck
    // ------------------------------------------------------------------
    const envE = await readEnvelope(page)
    const legacyPost = envE.state.posts.find((post) => post.title === ownTitle)
    if (!legacyPost) throw new Error('own help post not found for legacy probe')
    delete legacyPost.orderEvents
    await writeEnvelopeAndReload(page, envE)
    await goTab(page, '社区')
    const legacyCard = await cardButtons(page, ownTitle)
    const legacyE = await shotText(page, 'E1-legacy-completion-stuck')
    check(
      'E1',
      '旧存档缺少 orderEvents 时仍可继续完成流程',
      '状态 completion-requested 且无事件时应能确认完成或明确提示不可恢复',
      `buttons=${JSON.stringify(legacyCard.buttons)} status=${legacyPost.orderStatus}`,
      legacyCard.buttons.some((label) => label.includes('确认完成')),
      legacyE.png,
    )
    if (!legacyCard.buttons.some((label) => label.includes('确认完成'))) {
      finding('E', '旧存档的“待确认完成”订单无法确认，成为滞留状态', 'P2', '实测缺陷',
        '旧存档允许缺少 orderEvents；卡片也提示“后续操作会从当前状态继续记录”，因此 completion-requested 应可确认完成或至少给出恢复路径。',
        `删除事件后状态仍为 completion-requested；卡片只保留“取消/关闭订单（演练）”，没有“确认完成”。confirmOrderCompletion 要求最后一条事件必须是 synthetic-counterpart 的 request-completion（store.ts:1380-1383），PostCard 的 showConfirmCompletion 同样依赖事件。`,
        'E1-legacy-completion-stuck.png')
    }

    // ------------------------------------------------------------------
    // F. orderEvents cap is enforced on load but not on write
    // ------------------------------------------------------------------
    await reset(page)
    await saveOnce(page)
    const envF = await readEnvelope(page)
    const capTitle = '审计B-事件上限'
    const capPost = {
      id: 'SYNTH-POST-AUDIT-CAP',
      mode: 'help',
      title: capTitle,
      content: '审计B 合法合成求助：用于验证 orderEvents 上限的写入路径。',
      category: '待分类',
      timeWindow: '本周六 09:00',
      duration: '约 1 小时',
      specialNote: '仅合成数据',
      author: { id: 'SYNTH-DEMO-USER', name: '演练用户·我（虚构）', synthetic: true },
      location: '演练社区（虚构）',
      createdAt: new Date().toISOString(),
      likeCount: 0,
      likedByMe: false,
      favorited: false,
      moderation: 'approved',
      comments: [],
      orderStatus: 'accepted-local-demo',
      orderEvents: Array.from({ length: 99 }, (_, index) => ({
        id: `SYNTH-ORDER-EVENT-CAP-${String(index + 1).padStart(3, '0')}`,
        type: index === 0 ? 'accept' : 'resume-after-dispute',
        actor: 'demo-side',
        note: `审计B 预置事件 ${index + 1}`,
        createdAt: new Date(Date.now() - (99 - index) * 1000).toISOString(),
        synthetic: true,
      })),
      synthetic: true,
    }
    envF.state.posts.push(capPost)
    await writeEnvelopeAndReload(page, envF)
    await goTab(page, '社区')
    const capBefore = await cardButtons(page, capTitle)
    await clickCardButton(page, capTitle, ['发起争议（演练）'])
    await fillCardNote(page, capTitle, '审计B 第100条事件')
    await clickCardButton(page, capTitle, ['提交本机记录'])
    await page.waitForText('争议处理中（本机演练）')
    const after100 = await storeEval(page, (store) => {
      const post = store.posts.find((item) => item.title === '审计B-事件上限')
      return { count: post?.orderEvents?.length, status: post?.orderStatus }
    })
    await clickCardButton(page, capTitle, ['撤销争议继续履约（演练）'])
    await fillCardNote(page, capTitle, '审计B 第101条事件')
    await clickCardButton(page, capTitle, ['提交本机记录'])
    await page.waitForText('已接单（本机演练）')
    const after101 = await storeEval(page, (store) => {
      const post = store.posts.find((item) => item.title === '审计B-事件上限')
      return { count: post?.orderEvents?.length, status: post?.orderStatus }
    })
    const capF1 = await shotText(page, 'F1-event-cap-before-reload')
    await page.reload()
    await page.waitForSelector('.community-app')
    const statusAfterReload = await storeStatus(page)
    await page.setMembership('member')
    await goTab(page, '我的')
    const capProfileText = await page.bodyText()
    const capF2 = await shotText(page, 'F2-event-cap-recovery')
    check(
      'F1',
      '订单事件超过上限时写入应被拒绝或压缩',
      '第 101 条事件不应生成不可再载入的存档',
      `after100=${after100.count} after101=${after101.count} statusAfterReload=${statusAfterReload}`,
      after101.count <= 100 && statusAfterReload !== 'recovery-required',
      `${capF1.png} / ${capF2.png}`,
    )
    if (after101.count > 100 || statusAfterReload === 'recovery-required') {
      finding('F', '订单事件达到上限后仍可继续写入，刷新即进入“存档需恢复”', 'P2', '实测缺陷',
        'isPost 在载入时拒绝超过 100 条 orderEvents，写入路径也应在追加前检查上限，避免生成自身无法读取的存档。',
        `预置 99 条合法事件后，两次争议/撤销操作把事件写到 ${after101.count} 条并保存成功；刷新后 storageStatus=${statusAfterReload}，整份存档被停止写入并显示恢复提示。` +
        `（页面：${capProfileText.includes('需要处理') ? '显示存档需要处理' : '未显示恢复提示'}）`,
        'F1-event-cap-before-reload.png / F2-event-cap-recovery.png')
    }

    // ------------------------------------------------------------------
    // G. recovery-required + download + reset flow
    // ------------------------------------------------------------------
    await reset(page)
    await saveOnce(page)
    await page.writeLocalStorage(COMMUNITY_KEY, '{broken json')
    await page.reload()
    await page.waitForSelector('.community-app')
    await page.setMembership('member')
    await goTab(page, '社区')
    const likeBefore = await page.eval(() => {
      const card = Array.from(document.querySelectorAll('.post-card')).find((node) => (node.innerText || '').includes('帮忙把两箱'))
      return card?.querySelector('.post-actions button')?.innerText?.replace(/\s+/g, ' ').trim() ?? ''
    })
    await clickCardButton(page, '帮忙把两箱', [likeBefore])
    const recoveryToast = await waitToastAppear(page)
    const recoveryState = await storeEval(page, (store) => ({ status: store.storageStatus, error: store.storageError }))
    await goTab(page, '我的')
    const recoveryProfileText = await page.bodyText()
    const recoveryG1 = await shotText(page, 'G1-recovery-profile')
    check(
      'G1',
      '损坏存档提示与写入阻断',
      '显示恢复提示、保留原文入口，并阻止写入',
      `toast=${recoveryToast} status=${recoveryState.status} hasDownload=${recoveryProfileText.includes('下载原始存档')}`,
      recoveryState.status === 'recovery-required' && recoveryProfileText.includes('下载原始存档') && recoveryToast.includes('已停止所有写入'),
      recoveryG1.png,
    )
    await page.clickByText('重置演练数据', { selector: '.profile-storage-card button', exact: false })
    await page.waitForSelector('.van-dialog', { timeoutMs: 5000 })
    const dialogText = norm(await page.eval(() => document.querySelector('.van-dialog')?.innerText ?? ''))
    const recoveryG2 = await shot(page, 'G2-reset-confirm-dialog')
    await page.clickByText('覆盖并重置', { selector: '.van-dialog button', exact: true, timeoutMs: 5000 })
    await sleep(600)
    const afterReset = await storeEval(page, (store) => ({
      status: store.storageStatus,
      unreadable: store.unreadableStoredData,
      posts: store.posts.length,
      firstId: store.posts[0]?.id,
    }))
    const rawAfterReset = await page.readLocalStorage(COMMUNITY_KEY)
    let resetParsed = null
    try { resetParsed = JSON.parse(rawAfterReset) } catch { /* ignore */ }
    const recoveryG3 = await shotText(page, 'G3-recovery-after-reset')
    check(
      'G2',
      '损坏存档可下载原文并重置恢复',
      '重置对话框说明覆盖风险；确认后写入合法初始存档，恢复提示消失',
      `dialogHasWarning=${dialogText.includes('覆盖')} after=${JSON.stringify(afterReset)} rawValid=${Boolean(resetParsed)} firstId=${afterReset.firstId}`,
      dialogText.includes('覆盖') && afterReset.status === 'saved' && afterReset.unreadable === null && Boolean(resetParsed) && afterReset.firstId !== 'SYNTH-POST-001',
      `${recoveryG2} / ${recoveryG3.png}`,
    )
    if (!(dialogText.includes('覆盖') && afterReset.status === 'saved' && Boolean(resetParsed))) {
      finding('G', '损坏存档的恢复/重置流程未通过', 'P1', '实测缺陷',
        '确认覆盖损坏存档后应写入合法初始存档并解除恢复状态。',
        `重置后 status=${afterReset.status} unreadable=${afterReset.unreadable} rawValid=${Boolean(resetParsed)} dialog=${dialogText.slice(0, 120)}`,
        'G2-reset-confirm-dialog.png / G3-recovery-after-reset.png')
    }

    // ------------------------------------------------------------------
    // H. multi-tab conflict
    // ------------------------------------------------------------------
    await reset(page)
    await saveOnce(page)
    await goTab(page, '社区')
    const beforeTab = await storeEval(page, (store) => {
      const post = store.posts.find((item) => item.title.includes('帮忙把两箱'))
      return { likedByMe: post?.likedByMe, likeCount: post?.likeCount, status: store.storageStatus }
    })
    const second = await newTab(page, `${base}/community.html`)
    try {
      await cEval(second.client, () => {
        const select = document.querySelector('.membership-panel select')
        if (!select) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
        setter.call(select, 'member')
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })
      await sleep(300)
      await cEval(second.client, () => {
        const nav = Array.from(document.querySelectorAll('.side-nav button')).find((node) => (node.innerText || '').includes('社区'))
        nav?.click()
      })
      await sleep(500)
      const tabBLiked = await cEval(second.client, () => {
        const card = Array.from(document.querySelectorAll('.post-card')).find((node) => (node.innerText || '').includes('帮忙把两箱'))
        const button = card?.querySelector('.post-actions button')
        if (!button) return { ok: false }
        button.click()
        return { ok: true, label: (button.innerText || '').replace(/\s+/g, ' ').trim() }
      })
      if (!tabBLiked?.ok) throw new Error(`second tab could not like: ${JSON.stringify(tabBLiked)}`)
      await sleep(500)
      const tabBRaw = await cEval(second.client, (key) => window.localStorage.getItem(key), COMMUNITY_KEY)
      const tabBEnvelope = tabBRaw ? JSON.parse(tabBRaw) : null
      const tabBPost = tabBEnvelope?.state?.posts?.find((post) => post.title.includes('帮忙把两箱')) ?? null
      // wait for tab A to receive the storage event
      let status = ''
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        status = await storeStatus(page)
        if (status === 'conflict') break
        await sleep(200)
      }
      await goTab(page, '我的')
      const conflictText = await page.bodyText()
      const conflictH1 = await shotText(page, 'H1-conflict-profile')
      await goTab(page, '社区')
      const cardBeforeBlocked = await storeEval(page, (store) => {
        const post = store.posts.find((item) => item.title.includes('帮忙把两箱'))
        return { likedByMe: post?.likedByMe, likeCount: post?.likeCount }
      })
      const firstLikeLabel = await page.eval(() => {
        const card = Array.from(document.querySelectorAll('.post-card')).find((node) => (node.innerText || '').includes('帮忙把两箱'))
        return card?.querySelector('.post-actions button')?.innerText?.replace(/\s+/g, ' ').trim() ?? ''
      })
      await clickCardButton(page, '帮忙把两箱', [firstLikeLabel])
      const conflictToast = await waitToastAppear(page)
      const cardAfterBlocked = await storeEval(page, (store) => {
        const post = store.posts.find((item) => item.title.includes('帮忙把两箱'))
        return { likedByMe: post?.likedByMe, likeCount: post?.likeCount }
      })
      const conflictH2 = await shotText(page, 'H2-conflict-write-blocked')
      await goTab(page, '我的')
      await page.clickByText('重新载入', { selector: '.profile-storage-card button', exact: true, timeoutMs: 5000 })
      await sleep(500)
      const afterReloadH = await storeEval(page, (store) => {
        const post = store.posts.find((item) => item.title.includes('帮忙把两箱'))
        return { likedByMe: post?.likedByMe, likeCount: post?.likeCount, status: store.storageStatus }
      })
      const conflictH3 = await shotText(page, 'H3-conflict-reloaded')
      check(
        'H1',
        '多标签冲突提示、写入阻断与重新载入',
        '其他标签写入后显示冲突提示、拒绝本页写入，重新载入后看到最新状态',
        `statusAfterOtherTab=${status} conflictBanner=${conflictText.includes('其他标签页')} blockedToast=${conflictToast} stateBefore=${JSON.stringify(cardBeforeBlocked)} stateAfter=${JSON.stringify(cardAfterBlocked)} tabB=${JSON.stringify(tabBPost ? { likedByMe: tabBPost.likedByMe, likeCount: tabBPost.likeCount } : null)} reloaded=${JSON.stringify(afterReloadH)}`,
        status === 'conflict'
          && conflictText.includes('其他标签页')
          && conflictToast.includes('其他标签页')
          && JSON.stringify(cardBeforeBlocked) === JSON.stringify(cardAfterBlocked)
          && afterReloadH.status === 'saved'
          && Boolean(tabBPost)
          && afterReloadH.likedByMe === tabBPost.likedByMe
          && afterReloadH.likeCount === tabBPost.likeCount,
        `${conflictH1.png} / ${conflictH2.png} / ${conflictH3.png}`,
      )
      if (!(status === 'conflict' && conflictText.includes('其他标签页') && afterReloadH.status === 'saved' && Boolean(tabBPost) && afterReloadH.likedByMe === tabBPost.likedByMe)) {
        finding('H', '多标签冲突提示/恢复流程未通过', 'P1', '实测缺陷',
          '其他标签页写入后本页应提示冲突、拒绝覆盖，重新载入后显示最新状态。',
          `status=${status} banner=${conflictText.includes('其他标签页')} toast=${conflictToast} reloaded=${JSON.stringify(afterReloadH)}`,
          'H1-conflict-profile.png / H2-conflict-write-blocked.png / H3-conflict-reloaded.png')
      }
    } finally {
      try { second.client.close() } catch { /* ignore */ }
      try {
        await fetch(`http://127.0.0.1:${page.port}/json/close/${second.target.id}`)
      } catch { /* ignore */ }
      try { await page.client.send('Page.bringToFront') } catch { /* ignore */ }
      await sleep(300)
    }

    // ------------------------------------------------------------------
    // I. unread count, document.title, refresh persistence, mark read
    // ------------------------------------------------------------------
    await reset(page)
    const unreadTitle = `审计B-未读通知-${Date.now().toString(36)}`
    await publishHelp(page, unreadTitle, '审计B 未读通知验证用虚构求助。')
    await approvePending(page, unreadTitle, '审计B-通过未读通知验证')
    await setMembership(page, 'member')
    await sleep(500)
    const unreadAfterApprove = await storeEval(page, (store) => store.unreadNoticeCount)
    const titleAfterApprove = await page.title()
    const badgesAfterApprove = await page.eval(() => Array.from(document.querySelectorAll('.nav-badge')).map((node) => node.innerText))
    const unreadI1 = await shotText(page, 'I1-unread-badge')
    await page.reload()
    await page.waitForSelector('.community-app')
    await sleep(300)
    const unreadAfterRefresh = await storeEval(page, (store) => store.unreadNoticeCount)
    const titleAfterRefresh = await page.title()
    const visitorBadge = await page.eval(() => ({ badges: Array.from(document.querySelectorAll('.nav-badge')).map((node) => node.innerText), title: document.title }))
    await page.clickSelector('.topbar-message')
    await sleep(300)
    const visitorMessagesText = await page.bodyText()
    const unreadI2 = await shotText(page, 'I2-visitor-unread-gate')
    await setMembership(page, 'member')
    await page.waitForText('订单内留言')
    const markReadButton = await page.eval(() => Boolean(document.querySelector('.notice-mark-read')))
    await page.clickByText('全部标为已读', { selector: '.notice-mark-read', exact: false })
    await waitToastAppear(page)
    await sleep(300)
    const afterMarkRead = await storeEval(page, (store) => ({ unread: store.unreadNoticeCount, readAt: store.notificationsReadAt }))
    const titleAfterMarkRead = await page.title()
    const unreadI3 = await shotText(page, 'I3-marked-read')
    await page.reload()
    await page.waitForSelector('.community-app')
    await sleep(300)
    const afterReadRefresh = await storeEval(page, (store) => ({ unread: store.unreadNoticeCount, readAt: store.notificationsReadAt }))
    const titleAfterReadRefresh = await page.title()
    check(
      'I1',
      '未读计数、document.title、刷新与已读游标',
      '新增通知后角标=1、title 带 (1)；刷新后仍为 1；标记已读后为 0 且刷新保持',
      `afterApprove=${unreadAfterApprove} title=${JSON.stringify(titleAfterApprove)} badges=${JSON.stringify(badgesAfterApprove)} afterRefresh=${unreadAfterRefresh} titleRefresh=${JSON.stringify(titleAfterRefresh)} markButton=${markReadButton} afterRead=${JSON.stringify(afterMarkRead)} titleRead=${JSON.stringify(titleAfterMarkRead)} afterReadRefresh=${JSON.stringify(afterReadRefresh)}`,
      unreadAfterApprove === 1
        && titleAfterApprove.startsWith('(1)')
        && unreadAfterRefresh === 1
        && titleAfterRefresh.startsWith('(1)')
        && markReadButton
        && afterMarkRead.unread === 0
        && !titleAfterMarkRead.startsWith('(')
        && afterReadRefresh.unread === 0
        && !titleAfterReadRefresh.startsWith('('),
      `${unreadI1.png} / ${unreadI2.png} / ${unreadI3.png}`,
    )
    if (!(unreadAfterApprove === 1 && unreadAfterRefresh === 1 && afterMarkRead.unread === 0 && afterReadRefresh.unread === 0)) {
      finding('I', '未读通知/标题角标/刷新保持未通过', 'P1', '实测缺陷',
        '未读计数与 document.title 应在刷新后保持，标记已读后清零且持久化。',
        `afterApprove=${unreadAfterApprove} afterRefresh=${unreadAfterRefresh} afterRead=${JSON.stringify(afterMarkRead)} afterReadRefresh=${JSON.stringify(afterReadRefresh)}`,
        'I1-unread-badge.png / I2-visitor-unread-gate.png / I3-marked-read.png')
    }
    // Visitor gate observation (role boundary; not counted as a failure by itself)
    check(
      'I2',
      '访客身份下未读角标与消息页可达性',
      '若角标对访客可见，消息页应能解释并允许查看/标记，或角标不对访客展示',
      `visitorBadges=${JSON.stringify(visitorBadge.badges)} visitorTitle=${JSON.stringify(visitorBadge.title)} visitorMessagesText=${visitorMessagesText.includes('这是受控社区')}`,
      true,
      unreadI2.png,
    )
    // second notice after a read cursor exists
    await setMembership(page, 'reviewer')
    await page.clickByText('审核', { selector: '.side-nav button', exact: false })
    await page.waitForText('内容与举报审核')
    await page.fillByLabel('本次审核或处理理由', '审计B-下架产生新未读')
    await clickModerationCardButton(page, unreadTitle, '下架帖子')
    await sleep(400)
    await setMembership(page, 'member')
    await sleep(300)
    const unreadAfterSecond = await storeEval(page, (store) => store.unreadNoticeCount)
    const titleAfterSecond = await page.title()
    const unreadI4 = await shotText(page, 'I4-unread-again')
    check(
      'I3',
      '已读游标之后的新通知重新计入未读',
      '下架本人发布产生新通知，未读=1、title 带 (1)',
      `unread=${unreadAfterSecond} title=${JSON.stringify(titleAfterSecond)}`,
      unreadAfterSecond === 1 && titleAfterSecond.startsWith('(1)'),
      unreadI4.png,
    )

    // ------------------------------------------------------------------
    // J. reading-mode persistence and draft restore (confirmation reset)
    // ------------------------------------------------------------------
    await reset(page)
    const readingInitial = await page.eval(() => ({
      large: document.querySelector('.community-app')?.classList.contains('reading-large') ?? null,
      pressed: document.querySelector('.reading-toggle')?.getAttribute('aria-pressed'),
      stored: window.localStorage.getItem('community-mvp.reading-mode.v1'),
    }))
    await page.clickSelector('.reading-toggle')
    await sleep(250)
    const readingLarge = await page.eval(() => ({
      large: document.querySelector('.community-app')?.classList.contains('reading-large') ?? null,
      pressed: document.querySelector('.reading-toggle')?.getAttribute('aria-pressed'),
      stored: window.localStorage.getItem('community-mvp.reading-mode.v1'),
    }))
    const readingJ1 = await shot(page, 'J1-reading-large')
    await page.reload()
    await page.waitForSelector('.community-app')
    await page.setMembership('member')
    const readingAfterReload = await page.eval(() => ({
      large: document.querySelector('.community-app')?.classList.contains('reading-large') ?? null,
      pressed: document.querySelector('.reading-toggle')?.getAttribute('aria-pressed'),
      stored: window.localStorage.getItem('community-mvp.reading-mode.v1'),
    }))
    await page.clickSelector('.reading-toggle')
    await sleep(250)
    const readingNormal = await page.eval(() => ({
      large: document.querySelector('.community-app')?.classList.contains('reading-large') ?? null,
      stored: window.localStorage.getItem('community-mvp.reading-mode.v1'),
    }))
    check(
      'J1',
      '大字阅读模式持久化与关闭清理',
      '开启后 class/key=large，刷新保持，关闭后 class 移除且 key 删除',
      `initial=${JSON.stringify(readingInitial)} large=${JSON.stringify(readingLarge)} reload=${JSON.stringify(readingAfterReload)} normal=${JSON.stringify(readingNormal)}`,
      readingInitial.large === false
        && readingLarge.large === true && readingLarge.pressed === 'true' && readingLarge.stored === 'large'
        && readingAfterReload.large === true && readingAfterReload.stored === 'large'
        && readingNormal.large === false && readingNormal.stored === null,
      readingJ1,
    )

    const draftTitle = `审计B-草稿-${Date.now().toString(36)}`
    const draftContent = '审计B 发布草稿恢复验证用虚构正文，不应恢复虚构内容确认。'
    await goTab(page, '发布')
    await page.fillByLabel('标题', draftTitle)
    await page.fillByLabel('需求说明', draftContent)
    await sleep(700)
    const draftRaw = await page.readLocalStorage('community-mvp.publish-draft.v1')
    const draftJson = draftRaw ? JSON.parse(draftRaw) : null
    await goTab(page, '首页')
    await goTab(page, '发布')
    await page.waitForText('已恢复上次未提交的本机草稿')
    const restoredDraft = await page.eval(() => ({
      title: document.querySelector('.publish-form input')?.value ?? '',
      content: document.querySelector('.publish-form textarea')?.value ?? '',
      confirm: document.querySelector('.confirm-synthetic input')?.checked ?? null,
      hint: document.querySelector('.draft-hint')?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
    }))
    const draftJ2 = await shot(page, 'J2-draft-restored')
    await page.reload()
    await page.waitForSelector('.community-app')
    await page.setMembership('member')
    await goTab(page, '发布')
    await page.waitForText('已恢复上次未提交的本机草稿')
    const restoredAfterReload = await page.eval(() => ({
      title: document.querySelector('.publish-form input')?.value ?? '',
      confirm: document.querySelector('.confirm-synthetic input')?.checked ?? null,
    }))
    await page.clickByText('清除草稿', { selector: '.draft-hint button', exact: false })
    await sleep(250)
    const clearedDraft = await page.eval(() => ({
      key: window.localStorage.getItem('community-mvp.publish-draft.v1'),
      title: document.querySelector('.publish-form input')?.value ?? '',
    }))
    const draftJ3 = await shot(page, 'J3-draft-cleared')
    check(
      'J2',
      '发布草稿保存/恢复/确认不复原/清除',
      '草稿保存标题与正文；恢复后 title/content 一致但确认框为 false；刷新仍恢复；清除后 key 删除、标题清空',
      `savedTitle=${draftJson?.title} restored=${JSON.stringify(restoredDraft)} afterReload=${JSON.stringify(restoredAfterReload)} cleared=${JSON.stringify(clearedDraft)}`,
      draftJson?.title === draftTitle
        && restoredDraft.title === draftTitle
        && restoredDraft.content === draftContent
        && restoredDraft.confirm === false
        && restoredAfterReload.title === draftTitle
        && restoredAfterReload.confirm === false
        && clearedDraft.key === null
        && clearedDraft.title === '',
      `${draftJ2} / ${draftJ3}`,
    )

    // ------------------------------------------------------------------
    // K. activity signup/cancel and "my activities"
    // ------------------------------------------------------------------
    await reset(page)
    await goTab(page, '社区')
    await clickCardButton(page, '周六步道清洁', ['演练报名'])
    const activityToast = await waitToastAppear(page)
    const activityAfterSignup = await storeEval(page, (store) => {
      const post = store.posts.find((item) => item.title.includes('周六步道清洁'))
      return { signedUpByMe: post?.signedUpByMe, count: post?.eventSignupCount, capacity: post?.eventCapacity }
    })
    const activityK1 = await shotText(page, 'K1-activity-signed-up')
    await goTab(page, '我的')
    await page.clickByText('我的活动', { selector: '.profile-tabs button', exact: false })
    await sleep(300)
    const myActivityRow = await page.eval(() => {
      const row = Array.from(document.querySelectorAll('.service-record-row')).find((node) => (node.innerText || '').includes('周六步道清洁'))
      return { text: row ? (row.innerText || '').replace(/\s+/g, ' ').trim() : '', buttons: row ? Array.from(row.querySelectorAll('button')).map((node) => node.innerText) : [] }
    })
    await page.clickByText('取消演练报名', { selector: '.service-record-row button', exact: true })
    await waitToastAppear(page)
    const activityAfterCancel = await storeEval(page, (store) => {
      const post = store.posts.find((item) => item.title.includes('周六步道清洁'))
      return { signedUpByMe: post?.signedUpByMe, count: post?.eventSignupCount }
    })
    await sleep(250)
    const activityRowsAfterCancel = await page.eval(() => document.querySelectorAll('.service-record-row').length)
    const activityK2 = await shotText(page, 'K2-activity-cancelled')
    check(
      'K1',
      '活动报名/我的活动/取消报名闭环',
      '报名后 signedUpByMe=true、count+1；我的活动显示该活动；取消后 count 回落且行移除',
      `toast=${activityToast} afterSignup=${JSON.stringify(activityAfterSignup)} row=${JSON.stringify(myActivityRow)} afterCancel=${JSON.stringify(activityAfterCancel)} rowsAfter=${activityRowsAfterCancel}`,
      activityAfterSignup.signedUpByMe === true
        && activityAfterSignup.count === 9
        && myActivityRow.text.includes('周六步道清洁')
        && activityAfterCancel.signedUpByMe === false
        && activityAfterCancel.count === 8
        && activityRowsAfterCancel === 0,
      `${activityK1.png} / ${activityK2.png}`,
    )
    if (!(activityAfterSignup.signedUpByMe === true && activityAfterCancel.signedUpByMe === false)) {
      finding('K', '活动报名/取消或“我的活动”未通过', 'P1', '实测缺陷',
        '报名应写入 signedUpByMe 并增加计数，取消应回落并从“我的活动”移除。',
        `afterSignup=${JSON.stringify(activityAfterSignup)} afterCancel=${JSON.stringify(activityAfterCancel)}`,
        'K1-activity-signed-up.png / K2-activity-cancelled.png')
    }

    // Self-signup on an own activity: record as observation, not a hard finding yet.
    const ownActivityTitle = `审计B-自建活动-${Date.now().toString(36)}`
    await goTab(page, '发布')
    await page.clickByText('志愿发布', { selector: '.mode-options button', exact: false })
    await page.clickByText('活动招募', { selector: '.submode-row button', exact: true })
    await page.fillByLabel('标题', ownActivityTitle)
    await page.fillByLabel('活动介绍', '审计B 自建活动，用于检查发布者是否能报自己的活动。')
    await page.setValue('input[type="datetime-local"]', '2026-10-26T10:00')
    await page.fillByLabel('名额上限', '5')
    await page.checkSelector('.confirm-synthetic input')
    await page.clickSelector('.publish-form .submit-button')
    await page.waitForText('我的发布')
    await approvePending(page, ownActivityTitle, '审计B-通过自建活动')
    await setMembership(page, 'member')
    await goTab(page, '社区')
    await clickCardButton(page, ownActivityTitle, ['演练报名'])
    await sleep(300)
    const ownActivitySignup = await storeEval(page, (store) => {
      const post = store.posts.find((item) => item.title.startsWith('审计B-自建活动'))
      return { author: post?.author?.id, signedUpByMe: post?.signedUpByMe, count: post?.eventSignupCount, capacity: post?.eventCapacity }
    })
    const ownActivityK3 = await shotText(page, 'K3-own-activity-signup')
    check(
      'K2',
      '发布者报名自己活动（角色边界观察）',
      '记录实际行为，供产品确认是否应禁止或显示为主办方',
      JSON.stringify(ownActivitySignup),
      true,
      ownActivityK3.png,
    )

    // ------------------------------------------------------------------
    // L. legacy archive without reports/auditLog/read cursor/orderEvents
    // ------------------------------------------------------------------
    await reset(page)
    await saveOnce(page)
    const envL = await readEnvelope(page)
    delete envL.state.reports
    delete envL.state.auditLog
    delete envL.state.notificationsReadAt
    for (const post of envL.state.posts) {
      delete post.orderEvents
      delete post.reviewNote
    }
    for (const report of envL.state.reports ?? []) delete report.reporter
    await writeEnvelopeAndReload(page, envL)
    const legacyLoad = await storeEval(page, (store) => ({
      status: store.storageStatus,
      reports: store.reports.length,
      audit: store.auditLog.length,
      readAt: store.notificationsReadAt,
      unread: store.unreadNoticeCount,
      posts: store.posts.length,
    }))
    const legacyL1 = await shotText(page, 'L1-legacy-optional-fields')
    check(
      'L1',
      '旧存档缺少新增可选字段仍可加载',
      '不进入 recovery；reports/auditLog 为空；已读游标按历史最后一条通知补齐；unread=0',
      JSON.stringify(legacyLoad),
      legacyLoad.status === 'saved' && legacyLoad.reports === 0 && legacyLoad.audit === 0 && legacyLoad.readAt === '2026-10-20T02:00:00.000Z' && legacyLoad.unread === 0,
      legacyL1.png,
    )
    if (!(legacyLoad.status === 'saved' && legacyLoad.unread === 0)) {
      finding('L', '旧存档可选字段兼容未通过', 'P1', '实测缺陷',
        '缺少 reports/auditLog/notificationsReadAt/orderEvents 的旧存档应正常载入。',
        JSON.stringify(legacyLoad),
        'L1-legacy-optional-fields.png')
    }

    // ------------------------------------------------------------------
    // M. self-accept role boundary
    // ------------------------------------------------------------------
    await reset(page)
    const ownHelpTitle = `审计B-不可自接-${Date.now().toString(36)}`
    await publishHelp(page, ownHelpTitle, '审计B 自接单边界验证用虚构求助。')
    await approvePending(page, ownHelpTitle, '审计B-通过自接单边界')
    await setMembership(page, 'member')
    await goTab(page, '社区')
    const ownCardButtons = await cardButtons(page, ownHelpTitle)
    const acceptResult = await storeEval(page, (store) => {
      const post = store.posts.find((item) => item.title.includes('不可自接'))
      return post ? store.acceptOrder(post.id) : { ok: false, errors: ['missing post'] }
    })
    const otherCardButtons = await cardButtons(page, '帮忙把两箱')
    const ownM1 = await shotText(page, 'M1-self-accept-boundary')
    check(
      'M1',
      '本人求助不能自接单',
      '本人卡片无“演练接单”按钮，store.acceptOrder 拒绝；他人卡片仍有“演练接单”',
      `ownButtons=${JSON.stringify(ownCardButtons.buttons)} accept=${JSON.stringify(acceptResult)} otherHasAccept=${otherCardButtons.buttons.includes('演练接单')}`,
      !ownCardButtons.buttons.includes('演练接单')
        && ownCardButtons.buttons.includes('代合成邻居接单（演练）')
        && acceptResult.ok === false
        && otherCardButtons.buttons.includes('演练接单'),
      ownM1.png,
    )
    if (!(acceptResult.ok === false && !ownCardButtons.buttons.includes('演练接单'))) {
      finding('M', '本人求助自接单边界未生效', 'P1', '实测缺陷',
        '发布者不能接自己的求助单，应只显示“代合成邻居接单（演练）”。',
        `ownButtons=${JSON.stringify(ownCardButtons.buttons)} accept=${JSON.stringify(acceptResult)}`,
        'M1-self-accept-boundary.png')
    }

    observations.pageErrors = page.pageErrors
    observations.consoleErrors = page.consoleErrors
    observations.titles = {
      unreadAfterApprove: titleAfterApprove,
      unreadAfterRefresh: titleAfterRefresh,
      titleAfterMarkRead,
      titleAfterReadRefresh,
      titleAfterSecond,
    }
    observations.visitorUnread = { ...visitorBadge, messagesGate: visitorMessagesText.includes('这是受控社区') }
    observations.ownActivitySignup = ownActivitySignup
    observations.legacyLoad = legacyLoad
  })

  const summary = { runAt: new Date().toISOString(), base, findings, checks, observations }
  await writeFile(join(evidenceDir, 'audit-b-run-record.json'), JSON.stringify(summary, null, 2), 'utf8')
  console.log(`\nchecks=${checks.filter((item) => item.ok).length}/${checks.length}; findings=${findings.length}`)
  if (findings.length > 0) process.exitCode = 2
}

main().catch(async (error) => {
  try {
    await mkdir(evidenceDir, { recursive: true })
    await writeFile(join(evidenceDir, 'audit-b-run-error.txt'), String(error?.stack || error), 'utf8')
  } catch { /* ignore */ }
  console.error(error)
  process.exitCode = 1
})
