// Read-only A+ intake / community-bridge defect audit (synthetic data only).
// Drives the already-running preview at http://127.0.0.1:5180 with a throwaway
// headless Chrome profile. Never writes app source, never touches the server.
//
// Run: node tools/audit-aplus.mjs --base=http://127.0.0.1:5180 --group=community
//
// Evidence: ../docs/运营准备/evidence-audit-aplus/

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const evidenceDir = join(repoRoot, '..', 'docs', '运营准备', 'evidence-audit-aplus')

const COMMUNITY_KEY = 'community-mvp.synthetic-state.v1'
const INTAKE_KEY = 'a-plus.synthetic-intake.v1'

const args = new Map()
for (const raw of process.argv.slice(2)) {
  const [key, ...rest] = raw.replace(/^--/, '').split('=')
  args.set(key, rest.join('='))
}
const base = (args.get('base') || 'http://127.0.0.1:5180').replace(/\/$/, '')
const group = args.get('group') || 'all'

const steps = []
const observations = {}
let failures = 0

function step(id, title, expected, actual, ok, files = []) {
  steps.push({ id, title, expected, actual, ok, files })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${title} — ${actual}`)
}

async function shot(page, name) {
  const file = join(evidenceDir, `${name}.png`)
  await page.screenshot(file)
  return file
}

async function saveText(name, text) {
  await mkdir(evidenceDir, { recursive: true })
  const file = join(evidenceDir, `${name}.txt`)
  await writeFile(file, text, 'utf8')
  return file
}

async function saveJson(name, value) {
  await mkdir(evidenceDir, { recursive: true })
  const file = join(evidenceDir, `${name}.json`)
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8')
  return file
}

async function intakeStoreEval(page, fn) {
  return page.eval((source) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('intake')
    return (new Function('store', `return (${source})(store)`))(store)
  }, fn.toString())
}

async function communityStoreEval(page, fn) {
  return page.eval((source) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    return (new Function('store', `return (${source})(store)`))(store)
  }, fn.toString())
}

async function intakeStoreEvalArgs(page, fn, ...args) {
  return page.eval((source, ...values) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('intake')
    const names = values.map((_, index) => `a${index}`)
    const call = `return (${source})(store${names.length ? `, ${names.join(', ')}` : ''})`
    return (new Function('store', ...names, call))(store, ...values)
  }, fn.toString(), ...args)
}

async function intakeSnapshot(page) {
  return intakeStoreEval(page, (store) => ({
    storageStatus: store.storageStatus,
    intakePaused: store.intakePaused,
    selectedId: store.selectedId,
    cases: JSON.parse(JSON.stringify(store.cases)),
    complaints: JSON.parse(JSON.stringify(store.complaints)),
  }))
}

async function aplusReady(page) {
  await page.waitForSelector('#app')
  await page.waitForText('受控登记队列')
}

async function openBridge(page) {
  await page.clickByText('社区求助（本机演练）', { selector: 'button', exact: true })
  await page.waitForSelector('.bridge-modal')
  await sleep(250)
}

async function closeModal(page) {
  const closed = await page.eval(() => {
    const modal = document.querySelector('.modal-backdrop')
    if (!modal) return true
    const close = Array.from(modal.querySelectorAll('button'))
      .find((node) => node.getAttribute('aria-label') === '关闭')
    if (close) { close.click(); return true }
    return false
  })
  await sleep(250)
  return closed
}

async function registerPost(page, title) {
  const checked = await page.eval(() => {
    const checkbox = document.querySelector('.bridge-modal .synthetic-confirm input')
    if (!checkbox) return { ok: false, reason: 'no-checkbox' }
    if (!checkbox.checked) checkbox.click()
    return { ok: true, checked: checkbox.checked }
  })
  if (!checked?.ok) throw new Error(`registerPost checkbox failed: ${JSON.stringify(checked)}`)
  await sleep(150)
  const result = await page.eval((wanted) => {
    const norm = (value) => (value || '').replace(/\s+/g, ' ').trim()
    const cards = Array.from(document.querySelectorAll('.bridge-post'))
    const card = cards.find((node) => norm(node.innerText).includes(norm(wanted)))
    if (!card) return { ok: false, reason: 'post-not-found' }
    const button = Array.from(card.querySelectorAll('button'))
      .find((node) => norm(node.innerText) === '登记到 A+ 队列')
    if (!button) return { ok: false, reason: 'button-not-found', text: norm(card.innerText).slice(0, 160) }
    button.scrollIntoView({ block: 'center' })
    button.click()
    return { ok: true }
  }, title)
  if (!result?.ok) throw new Error(`registerPost(${title}) failed: ${JSON.stringify(result)}`)
  await sleep(400)
}

async function seedCommunityArchive(page) {
  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await sleep(400)
  const raw = await communityStoreEval(page, (store) => store.readBackupJson())
  const seeded = await page.eval((key, source) => {
    const envelope = JSON.parse(source)
    const demoAuthor = { id: 'SYNTH-DEMO-USER', name: '演练用户·我（虚构）', synthetic: true }
    const now = new Date().toISOString()
    const make = (id, title, status, extra = {}) => ({
      id,
      mode: 'help',
      title,
      content: '仅用于 A+ 端审计的虚构求助内容，不含真实个人信息。',
      category: '演练分类',
      timeWindow: '本周六 10:00',
      duration: '约 1 小时',
      specialNote: '合成数据，仅本机演练。',
      author: demoAuthor,
      location: '演练社区（虚构）',
      createdAt: now,
      likeCount: 0,
      likedByMe: false,
      favorited: false,
      moderation: 'approved',
      comments: [],
      synthetic: true,
      orderStatus: status,
      ...extra,
    })
    envelope.state.posts.push(
      make('AUDIT-POST-open', '审计求助：待接单状态（合成）', 'open'),
      make('AUDIT-POST-accepted', '审计求助：已接单状态（合成）', 'accepted-local-demo'),
      make('AUDIT-POST-completion', '审计求助：待确认完成状态（合成）', 'completion-requested'),
      make('AUDIT-POST-completed', '审计求助：已完成状态（合成）', 'completed-local-demo'),
      make('AUDIT-POST-cancelled', '审计求助：已取消状态（合成）', 'cancelled-local-demo'),
      make('AUDIT-POST-disputed', '审计求助：争议状态（合成）', 'disputed-local-demo'),
      make('AUDIT-POST-dup-a', '审计求助：完全重复内容（合成）', 'open'),
      make('AUDIT-POST-dup-b', '审计求助：完全重复内容（合成）', 'open'),
    )
    localStorage.setItem(key, JSON.stringify(envelope))
    return {
      savedAt: envelope.savedAt,
      posts: envelope.state.posts.length,
      helpPosts: envelope.state.posts.filter((post) => post.mode === 'help').length,
    }
  }, COMMUNITY_KEY, raw)
  return { raw, seeded }
}

async function communityGroup(page) {  // ---------------------------------------------------------------- seed
  const seeded = await seedCommunityArchive(page)
  const rawValid = await page.eval((key) => localStorage.getItem(key), COMMUNITY_KEY)
  observations.seeded = seeded.seeded

  await page.navigate(`${base}/`)
  await aplusReady(page)
  const before = await intakeSnapshot(page)

  await openBridge(page)
  const bridge = await page.eval(() => {
    const rows = Array.from(document.querySelectorAll('.bridge-post'))
    return {
      rows: rows.length,
      statusText: document.querySelector('.bridge-status')?.innerText?.trim() ?? '',
      tags: Array.from(document.querySelectorAll('.bridge-post .tag')).map((node) => node.innerText.replace(/\s+/g, ' ').trim()),
      rowTitles: rows.map((node) => node.querySelector('.bridge-post-head strong')?.innerText?.trim() ?? ''),
      warningCount: document.querySelectorAll('.bridge-modal .notice-inline[role="alert"]').length,
    }
  })
  observations.bridgeInitial = bridge
  const allStatusesShown = [
    '待接单（本机演练）',
    '已接单（本机演练）',
    '待确认完成（本机演练）',
    '已完成（本机演练，未结算）',
    '已取消/关闭（本机演练）',
    '争议处理中（本机演练）',
  ].every((label) => bridge.tags.some((tag) => tag === `社区状态：${label}`))
  step('C1', '社区读取器接受全部 6 种订单状态', '审核通过的 9 条合成求助（含初始存档 1 条）全部列出，6 种状态标签可见，非求助动态被忽略',
    `rows=${bridge.rows} statusText=${bridge.statusText} allStatuses=${allStatusesShown} titles=${JSON.stringify(bridge.rowTitles)}`,
    bridge.rows === 9 && allStatusesShown && bridge.warningCount === 0,
    [await shot(page, 'c1-bridge-all-statuses')])

  // ---------------------------------------------------- first registration
  await registerPost(page, 'AUDIT-POST-open')
  await page.waitForText('未写回社区帖状态')
  const afterFirst = await intakeSnapshot(page)
  const firstCase = afterFirst.cases.find((item) => item.sourcePostId === 'AUDIT-POST-open')
  const rawAfterFirst = await page.eval((key) => localStorage.getItem(key), COMMUNITY_KEY)
  observations.firstRegistration = {
    caseId: firstCase?.id,
    status: firstCase?.status,
    sourceChannel: firstCase?.sourceChannel,
    sourcePostId: firstCase?.sourcePostId,
    summary: firstCase?.summary,
    rawUnchanged: rawAfterFirst === rawValid,
  }
  step('C2', '首次登记社区求助', '生成带 sourcePostId / community-entry-local 的 A+ 记录，社区存档原样未写回',
    `case=${firstCase?.id} channel=${firstCase?.sourceChannel} postId=${firstCase?.sourcePostId} rawUnchanged=${rawAfterFirst === rawValid}`,
    firstCase?.status === '已收件' && firstCase?.sourceChannel === 'community-entry-local'
      && firstCase?.sourcePostId === 'AUDIT-POST-open' && rawAfterFirst === rawValid,
    [await shot(page, 'c2-registered')])

  // Re-open and confirm no duplicate registration
  await closeModal(page)
  await openBridge(page)
  const reopen = await page.eval(() => {
    const cards = Array.from(document.querySelectorAll('.bridge-post'))
    const card = cards.find((node) => node.innerText.includes('AUDIT-POST-open'))
    return {
      cardText: card?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 220) ?? '',
      hasRegisterButton: Array.from(card?.querySelectorAll('button') ?? []).some((node) => node.innerText.includes('登记到 A+ 队列')),
    }
  })
  const afterReopen = await intakeSnapshot(page)
  const sourceCount = afterReopen.cases.filter((item) => item.sourcePostId).length
  step('C3', '登记后进度回显与重复打开去重', '面板显示“已登记 + A+ 记录号”，再次打开不新增记录',
    `registeredText=${reopen.cardText} hasRegisterButton=${reopen.hasRegisterButton} sourceCases=${sourceCount}`,
    reopen.cardText.includes('已登记') && !reopen.hasRegisterButton && sourceCount === 1,
    [await shot(page, 'c3-reopen-no-duplicate')])

  // ------------------------------------------- duplicate review (same text)
  await registerPost(page, 'AUDIT-POST-dup-a')
  await page.waitForText('未写回社区帖状态')
  await sleep(250)
  await registerPost(page, 'AUDIT-POST-dup-b')
  await page.waitForText('人工重复复核')
  await sleep(300)
  const review = await page.eval(() => {
    const modal = document.querySelector('.bridge-modal')
    return {
      heading: modal?.querySelector('#community-bridge-title')?.innerText?.trim() ?? '',
      text: modal?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 700) ?? '',
      checkboxes: modal?.querySelectorAll('.synthetic-confirm input').length ?? 0,
      hasExplanation: Boolean(modal?.querySelector('#community-duplicate-explanation')),
      confirmDisabled: Array.from(modal?.querySelectorAll('.modal-footer button') ?? [])
        .find((node) => node.innerText.includes('确认仍创建独立记录'))?.disabled ?? null,
    }
  })
  const duringReview = await intakeSnapshot(page)
  const duplicateCount = duringReview.cases.filter((item) => item.sourcePostId).length
  observations.duplicateReview = { ...review, sourceCases: duplicateCount }
  step('C4a', '重复候选进入人工复核', '复核分支暂停创建，展示复核说明与两个确认框，候选未合并/未覆盖',
    `heading=${review.heading} checkboxes=${review.checkboxes} explanation=${review.hasExplanation} sourceCases=${duplicateCount} confirmDisabled=${review.confirmDisabled}`,
    review.checkboxes === 2 && review.hasExplanation && duplicateCount === 2 && review.confirmDisabled === true,
    [await shot(page, 'c4a-duplicate-review')])

  const confirmed = await page.eval(() => {
    document.querySelectorAll('.bridge-modal .synthetic-confirm input').forEach((node) => { if (!node.checked) node.click() })
    const area = document.querySelector('#community-duplicate-explanation')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(area, '虚构复核：两条社区帖内容相同但来源帖子不同，登记为独立记录。')
    area.dispatchEvent(new Event('input', { bubbles: true }))
    area.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })
  await sleep(250)
  await page.clickByText('确认仍创建独立记录', { selector: '.bridge-modal button', exact: true })
  await page.waitForText('已创建独立演练记录')
  await sleep(300)
  const afterDup = await intakeSnapshot(page)
  const dupCases = afterDup.cases.filter((item) => item.sourcePostId)
  const second = dupCases.find((item) => item.sourcePostId === 'AUDIT-POST-dup-b')
  const dupEvent = second?.events?.find((event) => event.kind === 'duplicate-review')
  const rawAfterDup = await page.eval((key) => localStorage.getItem(key), COMMUNITY_KEY)
  step('C4b', '人工复核后创建独立记录', '新增记录含 duplicate-review 事件、候选关联，社区存档未写回',
    `sourceCases=${dupCases.length} second=${second?.id} reviewEvent=${Boolean(dupEvent)} candidates=${JSON.stringify(dupEvent?.duplicateCandidateIds ?? [])} related=${JSON.stringify(second?.relatedCaseIds ?? [])} rawUnchanged=${rawAfterDup === rawValid}`,
    Boolean(second) && Boolean(dupEvent) && (dupEvent?.duplicateCandidateIds?.length ?? 0) === 1
      && (second?.relatedCaseIds?.length ?? 0) === 1 && rawAfterDup === rawValid,
    [await shot(page, 'c4b-duplicate-created')])
  await closeModal(page)

  // --------------------------------------------- progress echo in community
  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.clickByText('我的', { selector: '.side-nav button', exact: false })
  await page.waitForText('我的发布')
  await page.clickByText('服务记录', { selector: '.profile-tabs button', exact: false })
  await sleep(600)
  const progress = await page.eval(() => {
    const rows = Array.from(document.querySelectorAll('.service-record-row'))
    const row = rows.find((node) => node.innerText.includes('审计求助：待接单状态'))
    const dupRow = rows.find((node) => node.innerText.includes('审计求助：完全重复内容'))
    return {
      rows: rows.length,
      rowFound: Boolean(row),
      hasProgress: Boolean(row?.querySelector('.intake-progress-detail')),
      text: row?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 300) ?? '',
      dupFound: Boolean(dupRow),
      dupText: dupRow?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 300) ?? '',
      panelText: document.querySelector('.intake-progress-panel')?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 300) ?? '',
    }
  })
  observations.progress = progress
  step('C5', '登记后 A+ 进度回显到社区“服务记录”', '本人求助行显示 A+ 状态与最近事件',
    `rowFound=${progress.rowFound} hasProgress=${progress.hasProgress} text=${progress.text} dupFound=${progress.dupFound}`,
    progress.rowFound && progress.hasProgress && progress.text.includes('已收件')
      && progress.dupFound && progress.text.includes('已登记到本机受理队列'),
    [await shot(page, 'c5-progress')])

  // ------------------------------ malformed record: skip + warning, no wipe
  await page.navigate(`${base}/`)
  await aplusReady(page)
  const corrupted = await page.eval((key, source) => {
    const envelope = JSON.parse(source)
    envelope.state.posts.push({
      id: 'AUDIT-POST-broken',
      mode: 'help',
      content: '缺少标题的审计坏数据。',
      author: { id: 'SYNTH-DEMO-USER', name: '演练用户（虚构）', synthetic: true },
      location: '演练社区（虚构）',
      createdAt: new Date().toISOString(),
      likeCount: 0,
      likedByMe: false,
      favorited: false,
      moderation: 'approved',
      comments: [],
      synthetic: true,
      orderStatus: 'open',
    })
    localStorage.setItem(key, JSON.stringify(envelope))
    return localStorage.getItem(key)
  }, COMMUNITY_KEY, rawValid)
  await openBridge(page)
  await sleep(400)
  const malformed = await page.eval(() => {
    const modal = document.querySelector('.bridge-modal')
    return {
      statusText: document.querySelector('.bridge-status')?.innerText?.trim() ?? '',
      rows: modal?.querySelectorAll('.bridge-post').length ?? 0,
      warningText: Array.from(modal?.querySelectorAll('.notice-inline') ?? [])
        .map((node) => node.innerText.replace(/\s+/g, ' ').trim()).join(' | '),
      hardError: modal?.innerText.includes('社区演练存档读取失败') ?? false,
      raw: localStorage.getItem('community-mvp.synthetic-state.v1'),
    }
  })
  observations.malformed = { ...malformed, raw: undefined }
  step('C6', '损坏记录跳过且整份读取不失败（回归）', '有效求助照常列出，显示跳过 1 条警告，原始存档未修改',
    `status=${malformed.statusText} rows=${malformed.rows} warning=${malformed.warningText.slice(0, 100)} hardError=${malformed.hardError} rawUnchanged=${malformed.raw === corrupted}`,
    malformed.rows === 9 && malformed.statusText.includes('跳过 1 条')
      && malformed.warningText.includes('无法解析')
      && malformed.warningText.includes('缺少标题或正文') && !malformed.hardError
      && malformed.raw === corrupted,
    [await shot(page, 'c6-malformed-skipped')])

  // ------------------------------------- archive-level corruption is stopped
  await closeModal(page)
  const casesBeforeCorrupt = await intakeSnapshot(page)
  await page.eval((key) => localStorage.setItem(key, '{this is not json'), COMMUNITY_KEY)
  await openBridge(page)
  await sleep(300)
  const badJson = await page.eval(() => ({
    statusText: document.querySelector('.bridge-status')?.innerText?.trim() ?? '',
    message: document.querySelector('.bridge-modal .empty-state')?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
    rows: document.querySelectorAll('.bridge-post').length,
    raw: localStorage.getItem('community-mvp.synthetic-state.v1'),
  }))
  const casesAfterCorrupt = await intakeSnapshot(page)
  step('C7', '社区存档整体损坏时只提示、不登记', '读取停止并提示，不展示可登记列表，A+ 记录与社区原文均不变',
    `status=${badJson.statusText} rows=${badJson.rows} msg=${badJson.message.slice(0, 80)} aplusCasesUnchanged=${casesAfterCorrupt.cases.length === casesBeforeCorrupt.cases.length} rawUnchanged=${badJson.raw === '{this is not json'}`,
    badJson.rows === 0 && badJson.message.includes('不是有效的 JSON')
      && casesAfterCorrupt.cases.length === casesBeforeCorrupt.cases.length && badJson.raw === '{this is not json',
    [await shot(page, 'c7-community-bad-json')])

  await closeModal(page)
  await page.eval((key, source) => {
    const envelope = JSON.parse(source)
    envelope.schemaVersion = 999
    localStorage.setItem(key, JSON.stringify(envelope))
  }, COMMUNITY_KEY, rawValid)
  await openBridge(page)
  await sleep(300)
  const badVersion = await page.eval(() => ({
    statusText: document.querySelector('.bridge-status')?.innerText?.trim() ?? '',
    message: document.querySelector('.bridge-modal .empty-state')?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
  }))
  step('C8', '社区存档版本不符时停止读取', '提示版本/结构不兼容，不展示列表，不写回',
    `status=${badVersion.statusText} msg=${badVersion.message.slice(0, 100)}`,
    badVersion.statusText.includes('读取失败') && badVersion.message.includes('不兼容'),
    [await shot(page, 'c8-community-bad-version')])

  // restore a valid archive for later groups
  await closeModal(page)
  await page.eval((key, raw) => localStorage.setItem(key, raw), COMMUNITY_KEY, rawValid)
  await page.navigate(`${base}/`)
  await aplusReady(page)
  observations.afterCommunity = await intakeSnapshot(page)
}

async function selectCase(page, id) {
  const result = await page.eval((caseId) => {
    const cards = Array.from(document.querySelectorAll('.queue-item'))
    const card = cards.find((node) => node.innerText.includes(caseId))
    if (!card) return { ok: false, reason: 'card-not-found' }
    card.scrollIntoView({ block: 'center' })
    card.click()
    return { ok: true }
  }, id)
  if (!result?.ok) throw new Error(`selectCase(${id}) failed: ${JSON.stringify(result)}`)
  await sleep(350)
}

async function setRole(page, role) {
  await page.setValue('select[aria-label="切换演示角色"]', role)
  await sleep(250)
  const current = await page.eval(() => document.querySelector('select[aria-label="切换演示角色"]')?.value)
  if (current !== role) throw new Error(`role switch failed: wanted ${role}, got ${current}`)
}

async function checkModalConfirm(page) {
  const result = await page.eval(() => {
    const checkbox = document.querySelector('.modal .synthetic-confirm input')
    if (!checkbox) return { ok: false, reason: 'no-checkbox' }
    if (!checkbox.checked) checkbox.click()
    return { ok: true, checked: checkbox.checked }
  })
  if (!result?.ok) throw new Error(`checkModalConfirm failed: ${JSON.stringify(result)}`)
  await sleep(120)
}

async function createManualRecord(page, { label, summary, source }) {
  await page.clickByText('新建演练记录', { selector: '.heading-actions button', exact: false })
  await page.waitForText('新建演练记录')
  await page.setValue('#record-label', label)
  await page.setValue('#record-summary', summary)
  await page.setValue('#record-source', source)
  await checkModalConfirm(page)
  await page.clickByText('创建演练记录', { selector: '.modal-footer button', exact: true })
  await sleep(600)
  return page.eval(() => ({
    toast: document.querySelector('.toast')?.innerText?.trim() ?? '',
    modalOpen: Boolean(document.querySelector('.modal-backdrop')),
  }))
}

async function raiseHighRisk(page, caseId) {
  await selectCase(page, caseId)
  await page.clickByText('标记高风险 · 停止初筛', { selector: '.detail-actions button', exact: false })
  await page.waitForSelector('#high-risk-note')
  await page.setValue('#high-risk-note', '审计：虚构的高风险停止初筛依据，不含真实个人信息。')
  await checkModalConfirm(page)
  await page.clickByText('停止初筛并记录', { selector: '.modal-footer button', exact: true })
  await sleep(650)
  return page.eval(() => ({ toast: document.querySelector('.toast')?.innerText?.trim() ?? '' }))
}

async function recordHandoff(page, caseId, outcome, owner) {
  await selectCase(page, caseId)
  await page.clickByText('记录演练人工交接', { selector: '.detail-actions button', exact: false })
  await page.waitForSelector('#action-select')
  await page.setValue('#action-select', 'RECORD_HIGH_RISK_HANDOFF')
  await page.waitForSelector('#handoff-outcome')
  await page.setValue('#handoff-outcome', outcome)
  if (owner) await page.setValue('#handoff-owner', owner)
  await page.setValue('#transition-note', `审计：虚构人工交接说明（${outcome}）。`)
  await checkModalConfirm(page)
  await page.clickByText('保存交接记录', { selector: '.modal-footer button', exact: true })
  await sleep(650)
  return page.eval(() => ({ toast: document.querySelector('.toast')?.innerText?.trim() ?? '' }))
}

async function submitComplaint(page, caseId, target, description) {
  await selectCase(page, caseId)
  await page.clickByText('提交投诉（演示角色）', { selector: '.detail-actions button', exact: false })
  await page.waitForText('提交演示投诉')
  if (target) await page.setValue('#complaint-target', target)
  await page.setValue('#complaint-description', description)
  await checkModalConfirm(page)
  await page.clickByText('提交到复核队列', { selector: '.modal-footer button', exact: true })
  await sleep(650)
  return page.eval(() => ({
    toast: document.querySelector('.toast')?.innerText?.trim() ?? '',
    modalOpen: Boolean(document.querySelector('.modal-backdrop')),
  }))
}

async function selectComplaint(page, id) {
  const result = await page.eval((complaintId) => {
    const rows = Array.from(document.querySelectorAll('.complaint-panel .queue-item'))
    const row = rows.find((node) => node.innerText.includes(complaintId))
    if (!row) return { ok: false, reason: 'complaint-row-not-found' }
    row.scrollIntoView({ block: 'center' })
    row.click()
    return { ok: true }
  }, id)
  if (!result?.ok) throw new Error(`selectComplaint(${id}) failed: ${JSON.stringify(result)}`)
  await sleep(300)
}

async function complaintReviewState(page) {
  return page.eval(() => {
    const detail = document.querySelector('.complaint-detail')
    const confirm = Array.from(detail?.querySelectorAll('button') ?? [])
      .find((node) => node.innerText.replace(/\s+/g, ' ').trim() === '确认复核')
    return {
      text: detail?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 500) ?? '',
      alert: Array.from(detail?.querySelectorAll('.notice-inline[role="alert"]') ?? [])
        .map((node) => node.innerText.replace(/\s+/g, ' ').trim()).join(' | '),
      confirmDisabled: confirm?.disabled ?? null,
    }
  })
}

async function shotComplaintReason(page, name) {
  await page.eval(() => {
    const alert = document.querySelector('.complaint-detail .notice-inline[role="alert"]')
    if (alert) alert.scrollIntoView({ block: 'center' })
  })
  await sleep(180)
  return shot(page, name)
}

async function actionsGroup(page) {
  const existingCommunity = await page.eval((key) => localStorage.getItem(key), COMMUNITY_KEY)
  if (!existingCommunity) {
    await seedCommunityArchive(page)
  }
  await page.navigate(`${base}/`)
  await aplusReady(page)

  // ------------------------------------------------ source channel (manual)
  const createdOther = await createManualRecord(page, {
    label: '审计-手工-其他虚构来源',
    summary: '审计用手工登记：来源渠道选择其他虚构来源，仅本机合成数据。',
    source: 'other-fictional',
  })
  await settle(page)
  const bySource = await intakeStoreEval(page, (store) => {
    const other = store.cases.find((item) => item.label === '审计-手工-其他虚构来源')
    const community = store.cases.find((item) => item.label === '审计-手工-社区入口无帖子')
    return {
      other: other ? { id: other.id, sourceChannel: other.sourceChannel, sourcePostId: other.sourcePostId ?? null } : null,
      community,
    }
  })
  const createdCommunity = await createManualRecord(page, {
    label: '审计-手工-社区入口无帖子',
    summary: '审计用手工登记：来源渠道选择社区入口，但没有社区帖子 ID。',
    source: 'community-entry-local',
  })
  await settle(page)
  const afterCommunity = await intakeStoreEval(page, (store) => {
    const item = store.cases.find((entry) => entry.label === '审计-手工-社区入口无帖子')
    return item ? { id: item.id, sourceChannel: item.sourceChannel, sourcePostId: item.sourcePostId ?? null } : null
  })
  observations.sourceChannel = { createdOther, bySource: bySource.other, createdCommunity, afterCommunity }
  step('A1', '手动登记的来源渠道校验', '合法来源可保存；“社区入口”标记缺少社区帖子 ID 时应被拒绝或明确提示',
    `other=${JSON.stringify(bySource.other)} communityEntry=${JSON.stringify(afterCommunity)} toast=${createdCommunity.toast}`,
    Boolean(bySource.other) && bySource.other.sourceChannel === 'other-fictional'
      && Boolean(afterCommunity) === false,
    [await shot(page, 'a1-manual-source-channel')])

  // ---------------------------------------------- high-risk stop + handoff
  const stopResult = await raiseHighRisk(page, 'SYNTH-001')
  const stopped = await intakeStoreEval(page, (store) => {
    const item = store.cases.find((entry) => entry.id === 'SYNTH-001')
    return {
      id: item?.id,
      status: item?.status,
      flags: (item?.riskFlags ?? []).map((flag) => flag.code),
      nextStep: item?.nextStep,
      eventKinds: (item?.events ?? []).map((event) => event.kind),
    }
  })
  const detailButtons = await page.eval(() => Array.from(document.querySelectorAll('.detail-actions button'))
    .map((node) => node.innerText.replace(/\s+/g, ' ').trim()))
  step('A2', '高风险停止初筛后锁定常规操作', '追加高风险标记、下一步改为人工处置提示、仅保留人工交接动作',
    `status=${stopped.status} flags=${JSON.stringify(stopped.flags)} nextStep=${stopped.nextStep} buttons=${JSON.stringify(detailButtons)} toast=${stopResult.toast}`,
    stopped.flags.includes('HIGH_RISK_STOP_SCREENING') && stopped.nextStep.includes('停止常规初筛')
      && detailButtons.some((text) => text.includes('记录演练人工交接'))
      && !detailButtons.some((text) => text.includes('更新登记检查点'))
      && !detailButtons.some((text) => text.includes('调整负责人'))
      && !detailButtons.some((text) => text.includes('记录模拟联系结果')),
    [await shot(page, 'a2-high-risk-stop')])

  await recordHandoff(page, 'SYNTH-005', 'not-accepted')
  await recordHandoff(page, 'SYNTH-005', 'accepted', '演练-复核席-02')
  const handoff = await intakeStoreEval(page, (store) => {
    const item = store.cases.find((entry) => entry.id === 'SYNTH-005')
    const events = (item?.events ?? []).filter((event) => event.kind === 'risk-handoff')
    return {
      status: item?.status,
      flags: (item?.riskFlags ?? []).map((flag) => flag.code),
      handoffs: events.map((event) => ({ outcome: event.handoffOutcome, owner: event.handoffOwner ?? null })),
      timelineKinds: (item?.events ?? []).map((event) => event.kind),
    }
  })
  step('A3', '高风险人工交接可反复记录且不解除风险', '状态保持开放、风险标记保留、两条交接事件（暂无人接手/有人接手）均追加',
    `status=${handoff.status} flags=${JSON.stringify(handoff.flags)} handoffs=${JSON.stringify(handoff.handoffs)} kinds=${JSON.stringify(handoff.timelineKinds)}`,
    handoff.status === '初筛中' && handoff.flags.includes('HIGH_RISK_STOP_SCREENING')
      && handoff.handoffs.length === 2
      && handoff.handoffs[0].outcome === 'not-accepted'
      && handoff.handoffs[1].outcome === 'accepted' && handoff.handoffs[1].owner === '演练-复核席-02',
    [await shot(page, 'a3-handoff')])

  // ------------------------------------------- complaint role deadlock probe
  await setRole(page, 'demo-review')
  const deadlockSubmit = await submitComplaint(page, 'SYNTH-002', 'demo-referral',
    '审计用虚构投诉：复核席投诉转介席，检查是否仍存在可复核角色。')
  await settle(page)
  const complaints = await intakeStoreEval(page, (store) => store.complaints.map((item) => ({
    id: item.id,
    caseId: item.caseId,
    status: item.status,
    submittedByRole: item.submittedByRole,
    targetRole: item.targetRole,
    reviewerRole: item.reviewerRole,
  })))
  const deadlockComplaint = complaints.find((item) => item.submittedByRole === 'demo-review'
    && item.targetRole === 'demo-referral')
  await setRole(page, 'demo-referral')
  await selectComplaint(page, deadlockComplaint.id)
  const asReferral = await complaintReviewState(page)
  const asReferralShot = await shotComplaintReason(page, 'a4a-deadlock-referral')
  await setRole(page, 'demo-review')
  const asReviewer = await complaintReviewState(page)
  const asReviewerShot = await shotComplaintReason(page, 'a4b-deadlock-reviewer')
  await setRole(page, 'demo-intake')
  const asIntake = await complaintReviewState(page)
  const asIntakeShot = await shotComplaintReason(page, 'a4c-deadlock-intake')
  observations.complaintDeadlock = {
    complaint: deadlockComplaint,
    toast: deadlockSubmit.toast,
    asReferral,
    asReviewer,
    asIntake,
  }
  step('A4', '投诉复核角色闭环', '任一可达演示角色都应能完成复核，或提交时阻止形成无人可复核的投诉',
    `complaint=${deadlockComplaint.id} submitted=${deadlockComplaint.submittedByRole} target=${deadlockComplaint.targetRole} referralAlert=${asReferral.alert} reviewerAlert=${asReviewer.alert} intakeAlert=${asIntake.alert} disabled=${asReferral.confirmDisabled}/${asReviewer.confirmDisabled}/${asIntake.confirmDisabled}`,
    [asReferral, asReviewer, asIntake].some((state) => state.confirmDisabled === false),
    [asReferralShot, asReviewerShot, asIntakeShot])

  // ------------------------------------------------ normal complaint review
  await submitComplaint(page, 'SYNTH-002', 'demo-review',
    '审计用虚构投诉：受理席投诉复核席，随后由转介席复核。')
  await settle(page)
  const normalComplaint = await intakeStoreEval(page, (store) => {
    const item = store.complaints.find((entry) => entry.submittedByRole === 'demo-intake'
      && entry.targetRole === 'demo-review')
    return item ? { id: item.id, status: item.status, caseId: item.caseId } : null
  })
  const caseBeforeReview = await intakeStoreEvalArgs(page, (store, caseId) => {
    const item = store.cases.find((entry) => entry.id === caseId)
    return { eventCount: item?.events.length ?? 0, riskFlags: item?.riskFlags.length ?? 0 }
  }, normalComplaint.caseId)
  await setRole(page, 'demo-referral')
  await selectComplaint(page, normalComplaint.id)
  await page.setValue('.complaint-detail textarea', '审计：已核对虚构投诉，完成演示复核。')
  await page.clickByText('确认复核', { selector: '.complaint-detail button', exact: true })
  await sleep(650)
  const reviewed = await intakeStoreEvalArgs(page, (store, complaintId, caseId) => {
    const item = store.complaints.find((entry) => entry.id === complaintId)
    const intakeCase = store.cases.find((entry) => entry.id === caseId)
    return {
      status: item?.status,
      reviewerRole: item?.reviewerRole,
      resolution: item?.resolution,
      eventCount: intakeCase?.events.length ?? 0,
      riskFlags: intakeCase?.riskFlags.length ?? 0,
    }
  }, normalComplaint.id, normalComplaint.caseId)
  step('A5', '独立投诉复核并保持 case 时间线不变', '待复核投诉可由非提交人/非被投诉角色复核，case 事件与风险标记不变',
    `complaint=${normalComplaint.id} status=${reviewed.status} reviewer=${reviewed.reviewerRole} caseEvents=${caseBeforeReview.eventCount}->${reviewed.eventCount} caseFlags=${caseBeforeReview.riskFlags}->${reviewed.riskFlags}`,
    reviewed.status === '已复核' && reviewed.reviewerRole === 'demo-referral'
      && reviewed.eventCount === caseBeforeReview.eventCount
      && reviewed.riskFlags === caseBeforeReview.riskFlags,
    [await shot(page, 'a5-complaint-reviewed')])

  // ---------------------------------------------------- pause/resume + reload
  await setRole(page, 'demo-intake')
  await page.clickByText('暂停新登记', { selector: '.intake-gate button', exact: true })
  await sleep(350)
  const pausedUi = await page.eval(() => ({
    gate: document.querySelector('.intake-gate .intake-gate-copy strong')?.innerText?.trim() ?? '',
    createDisabled: document.querySelector('.heading-actions .button.primary')?.disabled ?? null,
    pausePressed: document.querySelector('.intake-gate button')?.getAttribute('aria-pressed'),
  }))
  await openBridge(page)
  const pausedBridge = await page.eval(() => ({
    notice: document.querySelector('.bridge-modal .notice-inline[role="alert"]')?.innerText?.trim().slice(0, 80) ?? '',
    disabledButtons: Array.from(document.querySelectorAll('.bridge-post button'))
      .filter((node) => node.innerText.includes('登记到 A+ 队列')).map((node) => node.disabled),
  }))
  await closeModal(page)
  await page.reload()
  await aplusReady(page)
  const pausedReload = await page.eval(() => ({
    gate: document.querySelector('.intake-gate .intake-gate-copy strong')?.innerText?.trim() ?? '',
    createDisabled: document.querySelector('.heading-actions .button.primary')?.disabled ?? null,
  }))
  await page.clickByText('恢复新登记', { selector: '.intake-gate button', exact: true })
  await sleep(350)
  const resumed = await page.eval(() => ({
    gate: document.querySelector('.intake-gate .intake-gate-copy strong')?.innerText?.trim() ?? '',
    createDisabled: document.querySelector('.heading-actions .button.primary')?.disabled ?? null,
  }))
  observations.pause = { pausedUi, pausedBridge, pausedReload, resumed }
  step('A6', '暂停/恢复新登记并跨刷新保持', '暂停后新建与社区登记入口均禁用，刷新后仍暂停；恢复后可用',
    `paused=${pausedUi.gate} createDisabled=${pausedUi.createDisabled} bridge=${pausedBridge.notice} bridgeDisabled=${JSON.stringify(pausedBridge.disabledButtons)} reload=${pausedReload.gate} resumed=${resumed.gate}`,
    pausedUi.gate.includes('已暂停') && pausedUi.createDisabled === true
      && pausedBridge.notice.includes('已暂停') && pausedBridge.disabledButtons.every(Boolean)
      && pausedReload.gate.includes('已暂停') && pausedReload.createDisabled === true
      && resumed.gate.includes('开放') && resumed.createDisabled === false,
    [await shot(page, 'a6-paused')])

  // ------------------------------- filter/search vs. selected detail mismatch
  await selectCase(page, 'SYNTH-002')
  const detailBeforeFilter = await page.eval(() => document.querySelector('.detail-id')?.innerText?.trim() ?? '')
  await page.clickByText('高风险', { selector: '.queue-panel .filters button', exact: true })
  await sleep(350)
  const filterMismatch = await page.eval(() => ({
    detail: document.querySelector('.detail-id')?.innerText?.trim() ?? '',
    queueIds: Array.from(document.querySelectorAll('.queue-panel .queue-item .queue-id'))
      .map((node) => node.innerText.replace(/\s+/g, ' ').trim()),
    selectedCards: document.querySelectorAll('.queue-panel .queue-item.selected').length,
    filterActive: document.querySelector('.queue-panel .filters button.active')?.innerText?.trim() ?? '',
  }))
  observations.filterMismatch = { detailBeforeFilter, ...filterMismatch }
  await page.setValue('input[aria-label="搜索演练记录"]', '审计-不存在的关键词')
  await sleep(350)
  const searchMismatch = await page.eval(() => ({
    detail: document.querySelector('.detail-id')?.innerText?.trim() ?? '',
    queueCount: document.querySelectorAll('.queue-panel .queue-item').length,
    emptyText: document.querySelector('.queue-panel .empty-state')?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
  }))
  observations.searchMismatch = searchMismatch
  step('A7', '筛选/搜索后详情与队列保持一致', '切换筛选或搜索过滤掉当前记录后，详情不应继续展示不在当前队列中的记录',
    `detailBefore=${detailBeforeFilter} filter=${filterMismatch.filterActive} queue=${JSON.stringify(filterMismatch.queueIds)} filterDetail=${filterMismatch.detail} selectedCards=${filterMismatch.selectedCards} searchQueue=${searchMismatch.queueCount} searchDetail=${searchMismatch.detail}`,
    (filterMismatch.detail === '' || filterMismatch.queueIds.some((text) => text.includes(filterMismatch.detail.split('·')[0].trim())))
      && searchMismatch.detail === '' && searchMismatch.queueCount === 0,
    [await shot(page, 'a7-filter-detail-mismatch')])
  await page.setValue('input[aria-label="搜索演练记录"]', '')
  await sleep(200)
  await page.clickByText('全部记录', { selector: '.queue-panel .filters button', exact: true })
  await sleep(300)

  observations.actionsSnapshot = await intakeSnapshot(page)
}

async function settle(page, ms = 250) {
  await sleep(ms)
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

async function pauseIntake(page) {
  await page.clickByText('暂停新登记', { selector: '.intake-gate button', exact: true })
  await page.waitForText('新登记已暂停')
  await sleep(300)
}

async function resumeIntake(page) {
  await page.clickByText('恢复新登记', { selector: '.intake-gate button', exact: true })
  await page.waitForText('新登记开放')
  await sleep(300)
}

async function exportBackupViaUi(page) {
  await page.clickByText('查看备份文本', { selector: '.banner-actions button', exact: true })
  await page.waitForSelector('#backup-text')
  await sleep(250)
  return page.eval(() => document.querySelector('#backup-text').value)
}

async function closeBackupText(page) {
  const open = await page.eval(() => Boolean(document.querySelector('#backup-text')))
  if (!open) return
  await page.clickByText('关闭备份文本', { selector: 'button', exact: true })
  await sleep(250)
}

async function importBackupViaUi(page, text, name = 'audit-aplus-backup.json') {
  const fired = await page.eval((payload, fileName) => {
    const input = document.querySelector('input[type=file]')
    if (!input) return { ok: false, reason: 'file-input-missing' }
    const transfer = new DataTransfer()
    transfer.items.add(new File([payload], fileName, { type: 'application/json' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, bytes: payload.length }
  }, text, name)
  if (!fired?.ok) throw new Error(`importBackupViaUi failed: ${JSON.stringify(fired)}`)
  await sleep(1100)
  return page.eval(() => ({
    toast: document.querySelector('.toast')?.innerText?.trim() ?? '',
    statusText: document.querySelector('.storage-status')?.innerText?.trim().slice(0, 160) ?? '',
    backupPanelValue: document.querySelector('#backup-text')?.value ?? null,
    backupPanelOpen: Boolean(document.querySelector('#backup-text')),
  }))
}

function snapshotProjection(snapshot) {
  return JSON.stringify({
    cases: snapshot.cases,
    complaints: snapshot.complaints,
    intakePaused: snapshot.intakePaused,
    selectedId: snapshot.selectedId,
  })
}

function backupProjection(backup) {
  return JSON.stringify({
    cases: backup.cases,
    complaints: backup.complaints,
    intakePaused: backup.intakePaused,
    selectedId: backup.selectedId,
  })
}

async function backupGroup(page) {
  const existingCommunity = await page.eval((key) => localStorage.getItem(key), COMMUNITY_KEY)
  if (!existingCommunity) {
    await seedCommunityArchive(page)
  }
  await page.navigate(`${base}/`)
  await aplusReady(page)

  // ------------------------------------------------- export while paused
  await pauseIntake(page)
  const pausedState = await intakeSnapshot(page)
  const exportedText = await exportBackupViaUi(page)
  await saveText('b0-exported-backup', exportedText)
  const exported = JSON.parse(exportedText)
  observations.export = {
    paused: exported.intakePaused,
    cases: exported.cases.length,
    complaints: exported.complaints.length,
    selectedId: exported.selectedId,
    bytes: exportedText.length,
    keys: Object.keys(exported),
  }
  step('B1a', '暂停状态下导出完整备份', '备份含 intakePaused=true、案例、投诉与选中记录',
    `paused=${exported.intakePaused} cases=${exported.cases.length} complaints=${exported.complaints.length} selected=${exported.selectedId} bytes=${exportedText.length}`,
    exported.intakePaused === true && exported.intakePaused === pausedState.intakePaused
      && exported.cases.length === pausedState.cases.length
      && exported.complaints.length === pausedState.complaints.length,
    [await shot(page, 'b1a-export')])
  await closeBackupText(page)
  await resumeIntake(page)

  // Change state after export, then show a backup-text snapshot of the changed state.
  await createManualRecord(page, {
    label: '审计-备份后修改记录',
    summary: '审计用：导出之后新增的记录，用于验证导入是否完整回滚。',
    source: 'other-fictional',
  })
  await settle(page)
  const modifiedState = await intakeSnapshot(page)
  const staleText = await exportBackupViaUi(page)
  const imported = await importBackupViaUi(page, exportedText)
  const afterImport = await intakeSnapshot(page)
  await page.eval(() => document.querySelector('#backup-text')?.scrollIntoView({ block: 'center' }))
  await sleep(200)
  const stalePanelShot = await shot(page, 'b1c-stale-backup-text')
  const roundTripOk = snapshotProjection(afterImport) === backupProjection(exported)
  const stalePanelStillOld = imported.backupPanelOpen && imported.backupPanelValue === staleText
  observations.importRoundTrip = {
    toast: imported.toast,
    casesBefore: modifiedState.cases.length,
    casesAfter: afterImport.cases.length,
    pausedAfter: afterImport.intakePaused,
    roundTripOk,
    stalePanelStillOld,
    stalePanelBytes: imported.backupPanelValue?.length ?? null,
    exportedBytes: exportedText.length,
  }
  step('B1b', '备份导出→导入往返（含暂停、投诉、高风险交接）', '导入后案例/投诉/暂停/选中与导出完全一致，导出后新增记录被回滚',
    `toast=${imported.toast} cases=${modifiedState.cases.length}->${afterImport.cases.length} paused=${afterImport.intakePaused} roundTrip=${roundTripOk}`,
    roundTripOk && afterImport.intakePaused === true
      && !afterImport.cases.some((item) => item.label === '审计-备份后修改记录')
      && imported.toast.includes('已导入并保存演练备份'),
    [await shot(page, 'b1b-roundtrip')])
  step('B1c', '导入成功后备份文本面板同步', '面板应关闭或刷新为导入后的快照，不能继续展示导入前的旧 JSON',
    `stalePanel=${stalePanelStillOld} panelOpen=${imported.backupPanelOpen} panelBytes=${imported.backupPanelValue?.length ?? null} exportedBytes=${exportedText.length}`,
    !stalePanelStillOld,
    [stalePanelShot])
  await closeBackupText(page)
  await resumeIntake(page)

  // ------------------------------------------------------- tampered fields
  const rawBeforeTamper = await page.eval((key) => localStorage.getItem(key), INTAKE_KEY)
  const variants = []
  const version = cloneJson(exported); version.schemaVersion = 2
  variants.push({ name: '版本号 2', data: version, expect: '备份格式或版本不受支持' })
  const badStatus = cloneJson(exported)
  badStatus.cases.find((item) => item.id === 'SYNTH-001').status = '已完结'
  variants.push({ name: '非法状态', data: badStatus, expect: '字段缺失或类型错误' })
  const badChannel = cloneJson(exported)
  badChannel.cases.find((item) => item.id === 'SYNTH-001').sourceChannel = 'real-channel'
  variants.push({ name: '非法来源渠道', data: badChannel, expect: '字段缺失或类型错误' })
  const badComplaint = cloneJson(exported)
  if (badComplaint.complaints.length) {
    badComplaint.complaints[0].caseId = 'SYNTH-999'
    variants.push({ name: '投诉关联不存在的案例', data: badComplaint, expect: '投诉记录' })
  }
  const dupSource = cloneJson(exported)
  const noSource = dupSource.cases.filter((item) => !item.sourcePostId).slice(0, 2)
  for (const item of noSource) item.sourcePostId = 'AUDIT-POST-ghost'
  variants.push({ name: '重复社区来源帖子 ID', data: dupSource, expect: '社区来源帖子 ID 重复' })

  const tamperResults = []
  for (const variant of variants) {
    const before = await intakeSnapshot(page)
    const rawBefore = await page.eval((key) => localStorage.getItem(key), INTAKE_KEY)
    const result = await importBackupViaUi(page, JSON.stringify(variant.data), `tamper-${encodeURIComponent(variant.name)}.json`)
    const after = await intakeSnapshot(page)
    const rawAfter = await page.eval((key) => localStorage.getItem(key), INTAKE_KEY)
    const unchanged = snapshotProjection(before) === snapshotProjection(after) && rawBefore === rawAfter
    const rejected = result.toast.includes(variant.expect)
    tamperResults.push({ name: variant.name, toast: result.toast, unchanged, rejected })
    if (!unchanged) await importBackupViaUi(page, exportedText)
  }
  observations.tamper = tamperResults
  step('B2', '字段篡改/版本不符导入全部拒绝且保留原数据', '五种篡改均提示具体错误，导入前后内存状态与本机原始存档不变',
    tamperResults.map((item) => `${item.name}:rejected=${item.rejected},unchanged=${item.unchanged},toast=${item.toast.slice(0, 60)}`).join(' | '),
    tamperResults.every((item) => item.rejected && item.unchanged),
    [await shot(page, 'b2-tamper-rejected')])
  const rawAfterTamper = await page.eval((key) => localStorage.getItem(key), INTAKE_KEY)
  observations.tamperRawUnchanged = rawAfterTamper === rawBeforeTamper

  // ------------------------------------------- storage write failure import
  const beforeWriteFail = await intakeSnapshot(page)
  const rawBeforeWriteFail = await page.eval((key) => localStorage.getItem(key), INTAKE_KEY)
  await page.eval((key) => {
    window.__auditOriginalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('QuotaExceededError', 'QuotaExceededError')
      return window.__auditOriginalSetItem.call(this, name, value)
    }
  }, INTAKE_KEY)
  const writeFail = await importBackupViaUi(page, exportedText)
  const afterWriteFail = await intakeSnapshot(page)
  const rawAfterWriteFail = await page.eval((key) => localStorage.getItem(key), INTAKE_KEY)
  await page.eval(() => {
    if (window.__auditOriginalSetItem) {
      Storage.prototype.setItem = window.__auditOriginalSetItem
      delete window.__auditOriginalSetItem
    }
  })
  observations.writeFailure = {
    toast: writeFail.toast,
    stateUnchanged: snapshotProjection(beforeWriteFail) === snapshotProjection(afterWriteFail),
    rawUnchanged: rawBeforeWriteFail === rawAfterWriteFail,
  }
  step('B3', '导入写入失败时不改动原数据', '提示无法写入，内存状态与本机存档保持导入前内容',
    `toast=${writeFail.toast} stateUnchanged=${observations.writeFailure.stateUnchanged} rawUnchanged=${observations.writeFailure.rawUnchanged}`,
    writeFail.toast.includes('无法写入本机存档，当前演练数据未变更')
      && observations.writeFailure.stateUnchanged && observations.writeFailure.rawUnchanged,
    [await shot(page, 'b3-write-failure')])

  // -------------------------- forged sourcePostId / sourceChannel mismatch
  const forged = cloneJson(exported)
  const forgedCase = forged.cases.find((item) => item.id === 'SYNTH-001')
  forgedCase.sourceChannel = 'manual-entry'
  forgedCase.sourcePostId = 'AUDIT-POST-accepted'
  const forgedImport = await importBackupViaUi(page, JSON.stringify(forged), 'forged-source-link.json')
  const forgedState = await intakeStoreEval(page, (store) => {
    const item = store.cases.find((entry) => entry.id === 'SYNTH-001')
    return { sourceChannel: item?.sourceChannel, sourcePostId: item?.sourcePostId ?? null, toast: '' }
  })
  await openBridge(page)
  const forgedBridge = await page.eval(() => {
    const cards = Array.from(document.querySelectorAll('.bridge-post'))
    const card = cards.find((node) => node.innerText.includes('AUDIT-POST-accepted'))
    return {
      found: Boolean(card),
      text: card?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 260) ?? '',
      hasRegisterButton: Array.from(card?.querySelectorAll('button') ?? [])
        .some((node) => node.innerText.includes('登记到 A+ 队列')),
    }
  })
  await page.eval(() => {
    const card = Array.from(document.querySelectorAll('.bridge-post'))
      .find((node) => node.innerText.includes('AUDIT-POST-accepted'))
    if (card) card.scrollIntoView({ block: 'center' })
  })
  await sleep(180)
  const forgedBridgeShot = await shot(page, 'b4b-forged-bridge')
  await closeModal(page)
  observations.forgedLink = { toast: forgedImport.toast, forgedState, forgedBridge }
  step('B4', '来源渠道与社区帖子 ID 的一致性校验', '导入应拒绝 manual-entry 渠道携带社区帖子 ID，避免伪造“已登记”并阻断真实登记',
    `toast=${forgedImport.toast} state=${JSON.stringify(forgedState)} bridge=${JSON.stringify(forgedBridge)}`,
    forgedImport.toast.includes('不受支持') || forgedImport.toast.includes('字段') || forgedImport.toast.includes('来源'),
    [await shot(page, 'b4-forged-link'), forgedBridgeShot])
  await importBackupViaUi(page, exportedText)
  await resumeIntake(page)

  // -------------------------------------------------------- BOM JSON import
  const beforeBom = await intakeSnapshot(page)
  const rawBeforeBom = await page.eval((key) => localStorage.getItem(key), INTAKE_KEY)
  const bomImport = await importBackupViaUi(page, `\uFEFF${exportedText}`, 'bom-backup.json')
  const afterBom = await intakeSnapshot(page)
  const rawAfterBom = await page.eval((key) => localStorage.getItem(key), INTAKE_KEY)
  observations.bom = {
    toast: bomImport.toast,
    stateUnchanged: snapshotProjection(beforeBom) === snapshotProjection(afterBom),
    rawUnchanged: rawBeforeBom === rawAfterBom,
  }
  step('B5', 'UTF-8 BOM 备份导入兼容', '带 UTF-8 BOM 的备份（记事本另存常见）应能解析导入，或至少提示 BOM 问题',
    `toast=${bomImport.toast} stateUnchanged=${observations.bom.stateUnchanged}`,
    !bomImport.toast.includes('不是有效的 JSON'),
    [await shot(page, 'b5-bom')])

  // --------------------------------- recovery-required protection on reset
  await page.eval((key) => localStorage.setItem(key, '{broken a-plus save for audit'), INTAKE_KEY)
  await page.reload()
  await aplusReady(page)
  const recovery = await page.eval(() => ({
    statusText: document.querySelector('.storage-status')?.innerText?.trim().slice(0, 180) ?? '',
    createDisabled: document.querySelector('.heading-actions .button.primary')?.disabled ?? null,
    hasUnreadableDownload: Array.from(document.querySelectorAll('.banner-actions button'))
      .some((node) => node.innerText.includes('下载无法读取的旧存档')),
  }))
  const recoveryBannerShot = await shot(page, 'b6a-recovery-banner')
  await openBridge(page)
  const recoveryBridge = await page.eval(() => ({
    notice: Array.from(document.querySelectorAll('.bridge-modal .notice-inline'))
      .map((node) => node.innerText.replace(/\s+/g, ' ').trim())
      .find((text) => text.includes('当前 A+ 存档无法读取')) ?? '',
    disabledButtons: Array.from(document.querySelectorAll('.bridge-post button'))
      .filter((node) => node.innerText.includes('登记到 A+ 队列')).map((node) => node.disabled),
  }))
  await closeModal(page)
  const createOpened = await page.eval(() => {
    const button = document.querySelector('.heading-actions .button.primary')
    if (!button || button.disabled) return false
    button.click()
    return true
  })
  await sleep(300)
  let recoveryCreateError = ''
  if (createOpened) {
    await page.setValue('#record-label', '审计-恢复态新建')
    await page.setValue('#record-summary', '审计用：在发现不可读旧存档时尝试新建记录。')
    await checkModalConfirm(page)
    await page.clickByText('创建演练记录', { selector: '.modal-footer button', exact: true })
    await sleep(500)
    recoveryCreateError = await page.eval(() => Array.from(document.querySelectorAll('.modal .form-error'))
      .map((node) => node.innerText.replace(/\s+/g, ' ').trim()).join(' | '))
    const recoveryCreateShot = await shot(page, 'b6b-recovery-create-error')
    observations.recoveryCreateShot = recoveryCreateShot
    await page.clickByText('取消', { selector: '.modal-footer button', exact: true })
    await sleep(250)
  }
  const rawUnreadable = await page.eval((key) => localStorage.getItem(key), INTAKE_KEY)
  await page.clickByText('重置演练', { selector: '.banner-actions button', exact: true })
  await sleep(700)
  const afterReset = await page.eval((key) => ({
    statusText: document.querySelector('.storage-status')?.innerText?.trim().slice(0, 160) ?? '',
    raw: localStorage.getItem(key),
  }), INTAKE_KEY)
  let resetRawValid = false
  try { resetRawValid = Boolean(JSON.parse(afterReset.raw).cases) } catch { resetRawValid = false }
  observations.recovery = {
    recovery,
    recoveryBridge,
    createOpened,
    recoveryCreateError,
    unreadableLost: afterReset.raw !== rawUnreadable,
    resetRawValid,
  }
  step('B6', '无法读取旧存档时的保护', '界面声明“尚未覆盖”，重置/新建不应在未保留原文的情况下丢弃不可读旧存档',
    `status=${recovery.statusText} download=${recovery.hasUnreadableDownload} bridgeNotice=${recoveryBridge.notice.slice(0, 40)} bridgeDisabled=${JSON.stringify(recoveryBridge.disabledButtons)} createDisabled=${recovery.createDisabled} createOpened=${createOpened} createError=${recoveryCreateError.slice(0, 80)} unreadableLost=${observations.recovery.unreadableLost} resetValid=${resetRawValid} resetStatus=${afterReset.statusText}`,
    recovery.statusText.includes('无法读取') && recovery.hasUnreadableDownload
      && recoveryBridge.notice.length > 0 && recoveryBridge.disabledButtons.every(Boolean)
      && recovery.createDisabled === true && observations.recovery.unreadableLost === false,
    [recoveryBannerShot, observations.recoveryCreateShot, await shot(page, 'b6-recovery-reset')])

  const recoveryImport = await importBackupViaUi(page, exportedText, 'recover-from-backup.json')
  const afterRecoveryImport = await intakeSnapshot(page)
  step('B7', '重置后仍可用合法备份恢复', '导入导出备份后案例/投诉/暂停状态与备份一致',
    `toast=${recoveryImport.toast} cases=${afterRecoveryImport.cases.length} paused=${afterRecoveryImport.intakePaused} roundTrip=${snapshotProjection(afterRecoveryImport) === backupProjection(exported)}`,
    snapshotProjection(afterRecoveryImport) === backupProjection(exported)
      && recoveryImport.toast.includes('已导入并保存演练备份'),
    [await shot(page, 'b7-recovered')])

  // ----------------------------------------- stale backup text after reset
  const staleBeforeReset = await exportBackupViaUi(page)
  await page.clickByText('重置演练', { selector: '.banner-actions button', exact: true })
  await sleep(700)
  const afterResetPanel = await page.eval(() => ({
    panelOpen: Boolean(document.querySelector('#backup-text')),
    panelValue: document.querySelector('#backup-text')?.value ?? null,
    statusText: document.querySelector('.storage-status')?.innerText?.trim().slice(0, 120) ?? '',
    queueCount: document.querySelectorAll('.queue-panel .queue-item').length,
  }))
  observations.resetStalePanel = {
    panelStillOld: afterResetPanel.panelOpen && afterResetPanel.panelValue === staleBeforeReset,
    queueCount: afterResetPanel.queueCount,
    statusText: afterResetPanel.statusText,
  }
  await page.eval(() => document.querySelector('#backup-text')?.scrollIntoView({ block: 'center' }))
  await sleep(200)
  const resetStaleShot = await shot(page, 'b8-stale-after-reset')
  step('B8', '重置演练后备份文本同步', '全文替换（重置/导入）后，已展开的备份文本应关闭或刷新，不能继续展示旧快照',
    `panelOpen=${afterResetPanel.panelOpen} panelStillOld=${observations.resetStalePanel.panelStillOld} queue=${afterResetPanel.queueCount} status=${afterResetPanel.statusText}`,
    !observations.resetStalePanel.panelStillOld,
    [resetStaleShot])
  await closeBackupText(page)

  // ----------------------------------- business-required summary on import
  const emptySummary = cloneJson(exported)
  const emptySummaryCase = emptySummary.cases.find((item) => item.id === 'SYNTH-002')
  emptySummaryCase.summary = ''
  const beforeEmptySummary = await intakeSnapshot(page)
  const emptySummaryImport = await importBackupViaUi(page, JSON.stringify(emptySummary), 'empty-summary.json')
  const afterEmptySummary = await intakeSnapshot(page)
  const emptySummaryAccepted = snapshotProjection(beforeEmptySummary) !== snapshotProjection(afterEmptySummary)
  observations.emptySummary = {
    toast: emptySummaryImport.toast,
    accepted: emptySummaryAccepted,
    storedSummary: afterEmptySummary.cases.find((item) => item.id === 'SYNTH-002')?.summary ?? null,
  }
  step('B9', '导入必填摘要校验', '创建表单要求“模拟登记摘要”必填，导入也应拒绝空摘要记录',
    `accepted=${emptySummaryAccepted} toast=${emptySummaryImport.toast} summary=${JSON.stringify(observations.emptySummary.storedSummary)}`,
    !emptySummaryAccepted,
    [await shot(page, 'b9-empty-summary')])
  if (emptySummaryAccepted) await importBackupViaUi(page, exportedText)

  observations.afterBackup = await intakeSnapshot(page)
}

async function main() {
  await mkdir(evidenceDir, { recursive: true })
  await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
    page.client.on('Page.javascriptDialogOpening', () => {
      page.client.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
    })

    await page.navigate(`${base}/`)
    await page.clearLocalStorage()
    await page.reload()
    await aplusReady(page)

    if (group === 'all' || group === 'community') {
      await communityGroup(page)
    }
    if (group === 'all' || group === 'actions') {
      await actionsGroup(page)
    }
    if (group === 'all' || group === 'backup') {
      await backupGroup(page)
    }

    observations.pageErrors = page.pageErrors
    observations.consoleErrors = page.consoleErrors
    step('Z1', '页面运行无未捕获异常', 'Runtime.exceptionThrown 与 console.error 为 0',
      `pageErrors=${page.pageErrors.length} consoleErrors=${page.consoleErrors.length}`,
      page.pageErrors.length === 0 && page.consoleErrors.length === 0)
  })

  const summary = { runAt: new Date().toISOString(), base, group, steps, failures, observations }
  await saveJson(`run-record-${group}`, summary)
  console.log(`\n${steps.length - failures}/${steps.length} checks passed; failures=${failures}`)
  if (failures > 0) process.exitCode = 1
}

main().catch(async (error) => {
  try {
    await mkdir(evidenceDir, { recursive: true })
    await writeFile(join(evidenceDir, 'run-error.txt'), String(error?.stack || error), 'utf8')
  } catch { /* ignore */ }
  console.error(error)
  process.exitCode = 1
})
