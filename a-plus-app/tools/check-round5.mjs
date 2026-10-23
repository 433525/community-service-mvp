// Solo acceptance run for the 2026-10-21 late additions (round 5):
//   - keyboard skip link
//   - "my activities" tab (signup, list, cancel)
//   - A+ community-bridge registration end-to-end (community help -> A+ case)
// Run: node tools/check-round5.mjs --base=http://127.0.0.1:5180
// Requires a static `dist` preview (npm run preview) on the given base URL.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const evidenceDir = join(repoRoot, '..', 'docs', '运营准备', 'evidence-B-order-round5')

const COMMUNITY_KEY = 'community-mvp.synthetic-state.v1'
const ACTIVITY_TITLE = '周六步道清洁'

const args = new Map()
for (const raw of process.argv.slice(2)) {
  const [key, ...rest] = raw.replace(/^--/, '').split('=')
  args.set(key, rest.join('='))
}
const base = (args.get('base') || 'http://127.0.0.1:5180').replace(/\/$/, '')
const prefix = args.get('prefix') || 'r5'

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

    // ------------------------------------------------------------- skip link
    const skip = await page.eval(() => {
      const first = document.querySelector('a[href], button, input, select, textarea')
      const link = document.querySelector('.skip-link')
      const before = link?.getBoundingClientRect()
      link?.focus()
      const after = link?.getBoundingClientRect()
      return {
        firstIsSkip: first === link,
        hiddenBefore: before ? before.bottom <= 0 : false,
        visibleAfter: after ? after.top >= 0 : false,
        text: link?.innerText?.trim(),
      }
    })
    await page.eval(() => document.querySelector('.skip-link')?.click())
    await sleep(250)
    const afterSkip = await page.eval(() => ({
      hash: location.hash,
      activeId: document.activeElement?.id,
    }))
    step('K1', '键盘跳转链接', '第一个可聚焦元素是“跳到主内容”，聚焦后可见，点击后焦点进入主内容',
      `first=${skip.firstIsSkip} hiddenBefore=${skip.hiddenBefore} visibleAfter=${skip.visibleAfter} hash=${afterSkip.hash} active=${afterSkip.activeId}`,
      skip.firstIsSkip && skip.hiddenBefore && skip.visibleAfter && afterSkip.activeId === 'community-main',
      await shot(page, '1-skip-link'))

    // ---------------------------------------------------------- my activities
    await page.clickByText('社区', { selector: '.side-nav button', exact: false })
    await page.waitForSelector('.post-card')
    await clickCardButton(page, ACTIVITY_TITLE, ['演练报名'])
    await page.waitForText('取消演练报名')
    const signedUp = await communityStoreEval(page, (store) => {
      const post = store.posts.find((item) => item.title.includes('步道清洁'))
      return { signedUpByMe: post?.signedUpByMe, count: post?.eventSignupCount }
    })
    step('A1', '社区活动演练报名', 'signedUpByMe=true、报名数 +1',
      `signedUp=${signedUp.signedUpByMe} count=${signedUp.count}`,
      signedUp.signedUpByMe === true && signedUp.count === 9, await shot(page, '2-activity-signup'))

    await page.clickByText('我的', { selector: '.side-nav button', exact: false })
    await page.waitForText('我的发布')
    await page.clickByText('我的活动', { selector: '.profile-tabs button', exact: false })
    await page.waitForText('取消演练报名')
    const activityTab = await page.eval(() => ({
      rows: document.querySelectorAll('.service-record-row').length,
      text: document.querySelector('.profile-content-section')?.innerText ?? '',
      tabSelected: Array.from(document.querySelectorAll('.profile-tabs button')).find((node) => node.innerText.includes('我的活动'))?.getAttribute('aria-selected'),
    }))
    step('A2', '“我的活动”显示已报名活动', '1 行、包含活动标题与取消入口、tab aria-selected=true',
      `rows=${activityTab.rows} selected=${activityTab.tabSelected} hasTitle=${activityTab.text.includes('步道清洁')} hasCancel=${activityTab.text.includes('取消演练报名')}`,
      activityTab.rows === 1 && activityTab.tabSelected === 'true' && activityTab.text.includes('步道清洁') && activityTab.text.includes('取消演练报名'),
      await shot(page, '3-my-activities'))
    await pageText(page, '3-my-activities')

    await page.clickByText('取消演练报名', { selector: '.service-record-row button', exact: true })
    await sleep(400)
    const cancelled = await communityStoreEval(page, (store) => {
      const post = store.posts.find((item) => item.title.includes('步道清洁'))
      return { signedUpByMe: post?.signedUpByMe, count: post?.eventSignupCount, rows: document.querySelectorAll('.service-record-row').length }
    })
    step('A3', '“我的活动”取消报名', '取消后报名数回到 8、列表为空',
      `signedUp=${cancelled.signedUpByMe} count=${cancelled.count} rows=${cancelled.rows}`,
      cancelled.signedUpByMe === false && cancelled.count === 8 && cancelled.rows === 0,
      await shot(page, '4-activity-cancelled'))

    // ------------------------------------------- A+ community bridge register
    const communityBefore = await page.eval((key) => {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw).savedAt : null
    }, COMMUNITY_KEY)

    await page.navigate(`${base}/`)
    await page.waitForSelector('#app')
    await page.waitForText('社区求助（本机演练）')
    await page.clickByText('社区求助（本机演练）', { selector: 'button', exact: true })
    await page.waitForText('我确认本次登记只使用本机合成演练数据')
    await shot(page, '5-aplus-bridge-open')

    const bridgeInfo = await page.eval(() => {
      const rows = Array.from(document.querySelectorAll('.bridge-post'))
      return {
        rows: rows.length,
        firstText: rows[0]?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 160) ?? '',
        modal: Boolean(document.querySelector('.modal-backdrop')),
      }
    })
    step('B1', 'A+ 打开社区求助读取面板', '弹层出现、列出审核通过的合成求助',
      `rows=${bridgeInfo.rows} modal=${bridgeInfo.modal} first=${bridgeInfo.firstText}`,
      bridgeInfo.modal && bridgeInfo.rows >= 1, await shot(page, '6-aplus-bridge-list'))

    await page.eval(() => {
      const checkbox = document.querySelector('.modal-backdrop .synthetic-confirm input')
      if (checkbox && !checkbox.checked) checkbox.click()
    })
    await sleep(200)
    const confirmChecked = await page.eval(() => document.querySelector('.modal-backdrop .synthetic-confirm input')?.checked === true)
    await page.clickByText('登记到 A+ 队列', { selector: '.modal-backdrop button', exact: true })
    await page.waitForText('未写回社区帖状态')
    await sleep(300)
    const registered = await intakeStoreEval(page, (store) => {
      const withSource = store.cases.filter((item) => item.sourcePostId)
      const first = withSource[0]
      return {
        confirmed: true,
        sourceCases: withSource.length,
        sourcePostId: first?.sourcePostId ?? '',
        sourceChannel: first?.sourceChannel ?? '',
        label: first?.label ?? '',
        status: first?.status ?? '',
      }
    })
    step('B2', '登记到 A+ 队列成功', '生成 1 条带 sourcePostId 的 A+ 演练记录、来源为本机社区入口',
      `sourceCases=${registered.sourceCases} channel=${registered.sourceChannel} postId=${registered.sourcePostId} label=${registered.label}`,
      registered.sourceCases === 1
      && registered.sourceChannel === 'community-entry-local'
      && registered.sourcePostId.startsWith('SYNTH-POST-')
      && registered.label.includes('社区求助'),
      await shot(page, '7-aplus-registered'))

    const communityAfter = await page.eval((key) => {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw).savedAt : null
    }, COMMUNITY_KEY)
    step('B3', 'A+ 登记不写回社区存档', '登记前后社区存档 savedAt 不变',
      `before=${communityBefore} after=${communityAfter}`,
      communityBefore !== null && communityBefore === communityAfter,
      await pageText(page, '7-aplus-registered'))

    await page.clickByText('关闭', { selector: '.modal-backdrop button', exact: true })
    await sleep(300)
    await page.clickByText('社区求助（本机演练）', { selector: 'button', exact: true })
    await page.waitForText('我确认本次登记只使用本机合成演练数据')
    const reopened = await page.eval(() => ({
      text: document.body.innerText,
      registeredTags: Array.from(document.querySelectorAll('.bridge-post .tag')).filter((node) => node.innerText.includes('已登记')).length,
    }))
    step('B4', '重新打开面板显示已登记', '已登记请求显示“已登记”标签、不会重复创建',
      `registeredTags=${reopened.registeredTags} hasRegisteredText=${reopened.text.includes('已登记')}`,
      reopened.registeredTags >= 1 && reopened.text.includes('已登记'),
      await shot(page, '8-aplus-registered-reopen'))

    const afterReopenCases = await intakeStoreEval(page, (store) => store.cases.filter((item) => item.sourcePostId).length)
    step('B5', '重复打开不会新增记录', 'sourcePostId 记录数仍为 1',
      `sourceCases=${afterReopenCases}`, afterReopenCases === 1, await shot(page, '9-aplus-no-duplicate'))

    observations.pageErrors = page.pageErrors
    observations.consoleErrors = page.consoleErrors
    observations.communityState = await page.readLocalStorageJson(COMMUNITY_KEY)
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
  lines.push(`# 第五轮功能实测运行记录（${summary.prefix}）`)
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
  lines.push('- A+ 重复复核/候选分支未覆盖（本轮只验证首次登记与重新打开不重复创建）。')
  lines.push('- 真机、读屏器、全页键盘遍历、对比度仪器未做；跳转链接只做程序化焦点验证。')
  lines.push('- 多标签冲突、存档容量上限、localStorage 故障注入、性能并发未测。')
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
