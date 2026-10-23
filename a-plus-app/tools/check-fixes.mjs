// "Fix problems first" verification suite (2026-10-21 round 6).
// Covers: community archive round-trip and legacy compatibility, A+ progress
// projection back into the community profile, A+ duplicate-review branch, and
// probes A+ bridge behaviour with one malformed approved help post.
// Run: node tools/check-fixes.mjs --base=http://127.0.0.1:5180

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const evidenceDir = join(repoRoot, '..', 'docs', '运营准备', 'evidence-fixes')

const COMMUNITY_KEY = 'community-mvp.synthetic-state.v1'
const HELP_TITLE = '求助：修复轮验证社区登记（合成）'
const SECOND_HELP_TITLE = HELP_TITLE

const args = new Map()
for (const raw of process.argv.slice(2)) {
  const [key, ...rest] = raw.replace(/^--/, '').split('=')
  args.set(key, rest.join('='))
}
const base = (args.get('base') || 'http://127.0.0.1:5180').replace(/\/$/, '')
const prefix = args.get('prefix') || 'fix'

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

async function communityStoreEval(page, fn) {
  return page.eval((source) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    return (new Function('store', `return (${source})(store)`))(store)
  }, fn.toString())
}

async function intakeStoreEval(page, fn) {
  return page.eval((source) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('intake')
    return (new Function('store', `return (${source})(store)`))(store)
  }, fn.toString())
}

async function clickCardButton(page, cardText, labels) {
  const result = await page.eval((text, wanted) => {
    const normText = (value) => (value || '').replace(/\s+/g, ' ').trim()
    const cards = Array.from(document.querySelectorAll('.post-card'))
    const card = cards.find((node) => normText(node.innerText).includes(normText(text)))
    if (!card) return { ok: false, reason: 'card-not-found' }
    const buttons = Array.from(card.querySelectorAll('button'))
    for (const label of wanted) {
      const button = buttons.find((node) => normText(node.innerText) === label && !node.disabled)
      if (button) {
        button.scrollIntoView({ block: 'center', inline: 'nearest' })
        button.click()
        return { ok: true, label }
      }
    }
    return { ok: false, reason: 'button-not-found', available: buttons.map((node) => normText(node.innerText)) }
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

async function publishHelp(page, title, content) {
  await page.clickByText('发布', { selector: '.side-nav button', exact: false })
  await page.waitForText('发布一件小事')
  await page.fillByLabel('标题', title)
  await page.fillByLabel('需求说明', content)
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

    // rich state: completed order + report + notice + read cursor
    const fixtureTitle = '帮忙把两箱演练物资搬到活动室'
    await page.clickByText('社区', { selector: '.side-nav button', exact: false })
    await page.waitForSelector('.post-card')
    await clickCardButton(page, fixtureTitle, ['演练接单'])
    await page.waitForText('已接单（本机演练）')
    await clickCardButton(page, fixtureTitle, ['发起完成申请'])
    await fillCardNote(page, fixtureTitle, '修复轮：完成申请说明')
    await clickCardButton(page, fixtureTitle, ['发起本机申请'])
    await page.waitForText('待确认完成（本机演练）')
    await clickCardButton(page, fixtureTitle, ['代合成求助方确认完成（演练）'])
    await page.waitForText('已完成（本机演练，未结算）')

    await page.clickByText('举报', { selector: '.post-actions button', exact: true })
    await page.waitForText('举报理由（帖子）')
    await page.fillByLabel('举报理由', '修复轮：虚构举报理由')
    await page.clickByText('提交本机举报')
    await page.waitForText('举报已进入本机审核队列。')

    await publishHelp(page, HELP_TITLE, '这是修复轮用于验证存档往返与 A+ 联动的虚构求助，内容固定。')
    await approveFirstPending(page, '修复轮：审核通过')
    await page.clickByText('消息', { selector: '.side-nav button', exact: false })
    await page.waitForText('系统通知')
    await page.clickByText('全部标为已读')
    await sleep(300)

    // ------------------------------------------- F1 archive round-trip
    const backup = await communityStoreEval(page, (store) => {
      const raw = store.readBackupJson()
      const parsed = JSON.parse(raw)
      return {
        raw,
        posts: parsed.state.posts.length,
        reports: parsed.state.reports.length,
        audit: parsed.state.auditLog.length,
        readAt: parsed.state.notificationsReadAt ?? null,
        events: parsed.state.posts.reduce((sum, post) => sum + (post.orderEvents?.length ?? 0), 0),
        envelope: { app: parsed.app, kind: parsed.kind, schemaVersion: parsed.schemaVersion },
      }
    })
    step('F1a', '导出本机存档快照', '快照包含订单事件、举报、审核日志与已读游标',
      `posts=${backup.posts} events=${backup.events} reports=${backup.reports} audit=${backup.audit} readAt=${backup.readAt}`,
      backup.events >= 3 && backup.reports >= 1 && backup.audit >= 1 && typeof backup.readAt === 'string',
      await shot(page, '1-backup'))

    await page.eval((key, raw) => localStorage.setItem(key, raw), COMMUNITY_KEY, backup.raw)
    await page.reload()
    await page.waitForSelector('.community-app')
    await page.setMembership('member')
    const roundTrip = await communityStoreEval(page, (store) => ({
      status: store.storageStatus,
      posts: store.posts.length,
      reports: store.reports.length,
      audit: store.auditLog.length,
      readAt: store.notificationsReadAt ?? null,
      events: store.posts.reduce((sum, post) => sum + (post.orderEvents?.length ?? 0), 0),
    }))
    step('F1b', '存档写回后重新载入', 'storageStatus=saved，帖子/事件/举报/审核日志/已读游标全部保留',
      `status=${roundTrip.status} posts=${roundTrip.posts} events=${roundTrip.events} reports=${roundTrip.reports} audit=${roundTrip.audit} readAt=${typeof roundTrip.readAt}`,
      roundTrip.status === 'saved' && roundTrip.posts === backup.posts && roundTrip.events === backup.events
      && roundTrip.reports === backup.reports && roundTrip.audit === backup.audit && typeof roundTrip.readAt === 'string',
      await shot(page, '2-roundtrip'))

    // ------------------------------------------- F2 legacy compatibility
    const legacyWritten = await page.eval((key, raw) => {
      const envelope = JSON.parse(raw)
      delete envelope.state.notificationsReadAt
      for (const post of envelope.state.posts) delete post.orderEvents
      for (const report of envelope.state.reports) delete report.reporter
      localStorage.setItem(key, JSON.stringify(envelope))
      return true
    }, COMMUNITY_KEY, backup.raw)
    await page.reload()
    await page.waitForSelector('.community-app')
    await page.setMembership('member')
    const legacy = await communityStoreEval(page, (store) => {
      const completed = store.posts.find((post) => post.orderStatus === 'completed-local-demo')
      return {
        status: store.storageStatus,
        readAt: store.notificationsReadAt ?? null,
        events: completed?.orderEvents ?? null,
        reporter: store.reports[0]?.reporter ?? null,
        reports: store.reports.length,
      }
    })
    step('F2', '旧存档兼容（缺已读游标/订单事件/举报人）', 'saved；已读游标按最后一条历史通知补齐；旧订单事件与举报人保持缺失，不猜测补写',
      `status=${legacy.status} readAt=${typeof legacy.readAt} events=${legacy.events} reporter=${legacy.reporter} reports=${legacy.reports}`,
      legacyWritten && legacy.status === 'saved' && typeof legacy.readAt === 'string'
      && legacy.events === null && legacy.reporter === null && legacy.reports >= 1,
      await shot(page, '3-legacy'))
    // restore rich state for the following steps
    await page.eval((key, raw) => localStorage.setItem(key, raw), COMMUNITY_KEY, backup.raw)
    await page.reload()
    await page.waitForSelector('.community-app')
    await page.setMembership('member')

    // ------------------------------------- F3 A+ register demo help + progress projection
    await page.navigate(`${base}/`)
    await page.waitForSelector('#app')
    await page.waitForText('社区求助（本机演练）')
    await page.clickByText('社区求助（本机演练）', { selector: 'button', exact: true })
    await page.waitForText('我确认本次登记只使用本机合成演练数据')
    await page.eval(() => {
      const checkbox = document.querySelector('.modal-backdrop .synthetic-confirm input')
      if (checkbox && !checkbox.checked) checkbox.click()
    })
    await page.clickByText('登记到 A+ 队列', {
      selector: 'button',
      exact: true,
      withinSelector: '.bridge-post',
      withinText: HELP_TITLE,
    })
    await page.waitForText('未写回社区帖状态')
    await sleep(300)
    // locate the registered A+ case by its community source post id
    const demoPostId = await page.eval((key) => {
      const envelope = JSON.parse(localStorage.getItem(key))
      const post = envelope.state.posts.find((item) => item.title.includes('修复轮验证社区登记'))
      return post?.id ?? ''
    }, COMMUNITY_KEY)
    const registeredById = await intakeStoreEval(page, (store) => {
      const item = store.cases.find((entry) => entry.sourcePostId)
      return {
        sourceCases: store.cases.filter((entry) => entry.sourcePostId).length,
        postId: item?.sourcePostId ?? '',
        caseId: item?.id ?? '',
        status: item?.status ?? '',
      }
    })
    step('F3a', 'A+ 登记演示求助', '生成带 sourcePostId 的 A+ 记录',
      `sourceCases=${registeredById.sourceCases} postId=${registeredById.postId} case=${registeredById.caseId} status=${registeredById.status}`,
      registeredById.sourceCases === 1 && registeredById.postId === demoPostId,
      await shot(page, '4-aplus-registered'))

    await page.navigate(`${base}/community.html`)
    await page.waitForSelector('.community-app')
    await page.setMembership('member')
    await page.clickByText('我的', { selector: '.side-nav button', exact: false })
    await page.waitForText('我的发布')
    await page.clickByText('服务记录', { selector: '.profile-tabs button', exact: false })
    await page.waitForText('A+ 受理进度（本机演练）')
    await page.waitForExpression("document.querySelector('.intake-progress-detail') !== null", { timeoutMs: 8000 }).catch(() => {})
    const progress = await page.eval((title) => {
      const rows = Array.from(document.querySelectorAll('.service-record-row'))
      const row = rows.find((node) => node.innerText.includes('修复轮验证社区登记'))
      return {
        rowFound: Boolean(row),
        hasProgress: Boolean(row?.querySelector('.intake-progress-detail')),
        text: row?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 220) ?? '',
        globalText: document.body.innerText.includes('A+ 受理进度'),
      }
    }, HELP_TITLE)
    step('F3b', 'A+ 进度回显到社区“服务记录”', '本人求助行出现 A+ 状态/最近事件',
      `rowFound=${progress.rowFound} hasProgress=${progress.hasProgress} text=${progress.text}`,
      progress.rowFound && progress.hasProgress && progress.globalText,
      await shot(page, '5-aplus-progress'))

    // ------------------------------------- F4 A+ duplicate-review branch
    await page.clickByText('发布', { selector: '.side-nav button', exact: false })
    await page.waitForText('发布一件小事')
    await page.fillByLabel('标题', SECOND_HELP_TITLE)
    await page.fillByLabel('需求说明', '这是修复轮用于验证存档往返与 A+ 联动的虚构求助，内容固定。')
    await page.fillByLabel('希望时段', '本周五 15:00')
    await page.fillByLabel('预计时长', '约 1 小时')
    await page.checkSelector('.confirm-synthetic input')
    await page.clickSelector('.publish-form .submit-button')
    await page.waitForText('我的发布')
    await approveFirstPending(page, '修复轮：第二篇同内容求助审核通过')
    const secondPostId = await page.eval((key) => {
      const envelope = JSON.parse(localStorage.getItem(key))
      const posts = envelope.state.posts.filter((item) => item.title.includes('修复轮验证社区登记'))
      const newest = posts.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      return newest?.id ?? ''
    }, COMMUNITY_KEY)

    await page.navigate(`${base}/`)
    await page.waitForSelector('#app')
    await page.waitForText('社区求助（本机演练）')
    await page.clickByText('社区求助（本机演练）', { selector: 'button', exact: true })
    await page.waitForText('我确认本次登记只使用本机合成演练数据')
    await page.eval(() => {
      const checkbox = document.querySelector('.modal-backdrop .synthetic-confirm input')
      if (checkbox && !checkbox.checked) checkbox.click()
    })
    await page.clickByText('登记到 A+ 队列', {
      selector: 'button',
      exact: true,
      withinSelector: '.bridge-post',
      withinText: secondPostId,
    })
    await page.waitForText('发现标签或摘要完全相同的已有记录')
    await shot(page, '6-aplus-duplicate-review')
    const reviewVisible = await page.eval(() => ({
      hasExplanation: Boolean(document.querySelector('#community-duplicate-explanation')),
      checkboxes: document.querySelectorAll('.modal-backdrop .synthetic-confirm input').length,
      hasConfirm: Array.from(document.querySelectorAll('.modal-backdrop button')).some((node) => node.innerText.includes('确认仍创建独立记录')),
    }))
    step('F4a', 'A+ 重复登记进入人工复核', '出现复核说明、两个确认框与“确认仍创建独立记录”',
      `hasExplanation=${reviewVisible.hasExplanation} checkboxes=${reviewVisible.checkboxes} hasConfirm=${reviewVisible.hasConfirm}`,
      reviewVisible.hasExplanation && reviewVisible.checkboxes >= 2 && reviewVisible.hasConfirm)

    await page.eval(() => {
      document.querySelectorAll('.modal-backdrop .synthetic-confirm input').forEach((checkbox) => {
        if (!checkbox.checked) checkbox.click()
      })
    })
    await page.setValue('#community-duplicate-explanation', '虚构复核说明：已人工核对候选，仍需保留独立来源记录。')
    await sleep(200)
    await page.clickByText('确认仍创建独立记录', { selector: '.modal-backdrop button', exact: true })
    await page.waitForText('已创建独立演练记录')
    await sleep(300)
    const duplicateResult = await intakeStoreEval(page, (store) => {
      const cases = store.cases.filter((entry) => entry.sourcePostId)
      const second = cases.find((entry) => (entry.events ?? []).some((event) => event.kind === 'duplicate-review'))
      return {
        sourceCases: cases.length,
        secondId: second?.id ?? '',
        secondPostId: second?.sourcePostId ?? '',
        hasReviewEvent: Boolean(second),
        related: (second?.relatedCaseIds ?? []).length,
      }
    })
    step('F4b', '人工复核后创建独立 A+ 记录', '第二条来源记录创建成功，含 duplicate-review 事件与候选关联',
      `sourceCases=${duplicateResult.sourceCases} second=${duplicateResult.secondId} hasReviewEvent=${duplicateResult.hasReviewEvent} related=${duplicateResult.related}`,
      duplicateResult.sourceCases === 2 && duplicateResult.secondId !== ''
      && duplicateResult.hasReviewEvent && duplicateResult.related >= 1,
      await shot(page, '7-aplus-duplicate-created'))

    // ----------------------------- F5 probe: malformed approved help post
    const originalRaw = await page.eval((key) => localStorage.getItem(key), COMMUNITY_KEY)
    const probe = await page.eval((key) => {
      const envelope = JSON.parse(localStorage.getItem(key))
      envelope.state.posts.push({
        id: 'SYNTH-POST-BROKEN-HELP',
        mode: 'help',
        title: '损坏的合成求助（修复轮探针）',
        content: '缺少 orderStatus 的坏数据，仅用于探测读取器行为。',
        author: { id: 'SYNTH-AUTHOR-001', name: '演练居民·小禾（虚构）', synthetic: true },
        location: '演练社区（虚构）',
        createdAt: new Date().toISOString(),
        likeCount: 0,
        likedByMe: false,
        favorited: false,
        moderation: 'approved',
        comments: [],
        synthetic: true,
      })
      localStorage.setItem(key, JSON.stringify(envelope))
      return true
    }, COMMUNITY_KEY)
    await page.eval(() => {
      document.querySelectorAll('.modal-backdrop .icon-button, .modal-backdrop .dialog-close').forEach((node) => node.click())
    })
    await sleep(300)
    // reload A+ app so the bridge reads the modified community storage
    await page.navigate(`${base}/`)
    await page.waitForSelector('#app')
    await page.waitForText('社区求助（本机演练）')
    await page.clickByText('社区求助（本机演练）', { selector: 'button', exact: true })
    await page.waitForText('社区求助（本机演练）')
    await sleep(500)
    const probeResult = await page.eval(() => {
      const modal = document.querySelector('.modal-backdrop')
      return {
        statusText: document.querySelector('.bridge-status')?.innerText?.trim() ?? '',
        warningText: Array.from(modal?.querySelectorAll('.notice-inline') ?? []).map((node) => node.innerText.replace(/\s+/g, ' ').trim()).join(' | '),
        validRows: modal?.querySelectorAll('.bridge-post').length ?? 0,
        hasRegisterButton: Array.from(modal?.querySelectorAll('button') ?? []).some((node) => node.innerText.includes('登记到 A+ 队列')),
        hardError: modal?.innerText.includes('社区演练存档读取失败') ?? false,
      }
    })
    observations.malformedBridgeProbe = probeResult
    step('F5', 'A+ 读取包含损坏记录的存档', '跳过损坏记录并继续列出有效求助，状态与警告可见，不整份失败',
      `status=${probeResult.statusText} rows=${probeResult.validRows} warning=${probeResult.warningText.slice(0, 80)} hardError=${probeResult.hardError}`,
      probeResult.statusText.includes('跳过 1 条')
      && probeResult.validRows >= 1
      && probeResult.warningText.includes('无法解析')
      && probeResult.hasRegisterButton
      && !probeResult.hardError,
      await shot(page, '8-malformed-probe'))
    // restore the valid community archive
    await page.eval((key, raw) => localStorage.setItem(key, raw), COMMUNITY_KEY, originalRaw)
    if (probe) observations.malformedRestored = true

    observations.pageErrors = page.pageErrors
    observations.consoleErrors = page.consoleErrors
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
  lines.push(`# 修复轮验证运行记录（${summary.prefix}）`)
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
  lines.push('## 探针结果')
  lines.push('')
  lines.push('```json')
  lines.push(JSON.stringify(summary.observations?.malformedBridgeProbe ?? {}, null, 2))
  lines.push('```')
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
