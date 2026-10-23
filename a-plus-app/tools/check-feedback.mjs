// Completed-order local feedback: form, persistence, duplicate/invalid guard, profile display.
// Run: node tools/check-feedback.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-feedback')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `feedback-${name}.png`)
  await page.screenshot(file)
  return file
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
  if (!result?.ok) throw new Error(`clickCardButton ${cardText}/${label} failed`)
}
async function storeEval(page, fn) {
  return page.eval((source) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    return (new Function('store', `return (${source})(store)`))(store)
  }, fn.toString())
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')
  const title = '帮忙把两箱演练物资'

  await clickCardButton(page, title, '演练接单')
  await page.waitForText('已接单（本机演练）')
  await clickCardButton(page, title, '发起完成申请')
  await page.clickByText('发起本机申请', { selector: '.order-action-form button', exact: true })
  await page.waitForText('待确认完成（本机演练）')
  await clickCardButton(page, title, '代合成求助方确认完成（演练）')
  await sleep(500)

  const formVisible = await page.eval(() => Boolean(document.querySelector('.order-feedback-form')))
  step('F1', '完成后显示体验入口', '已完成订单在本机参与者侧显示体验记录表单',
    `form=${formVisible}`, formVisible,
    await shot(page, 'f1-form'))

  await page.selectValue('.order-feedback-form select', '4')
  await page.eval(() => {
    const textarea = document.querySelector('.order-feedback-form textarea')
    textarea.value = '本机演练体验：沟通清晰，流程顺畅。'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.clickByText('保存体验记录', { selector: '.order-feedback-form button', exact: true })
  await page.waitForText('已保存本机演练体验记录')
  await sleep(300)
  const saved = await storeEval(page, (store) => {
    const post = store.posts.find((item) => item.title.includes('帮忙把两箱演练物资'))
    return {
      rating: post?.orderFeedback?.rating,
      note: post?.orderFeedback?.note,
      formGone: !document.querySelector('.order-feedback-form'),
      summary: document.querySelector('.order-feedback-summary')?.innerText ?? '',
    }
  })
  step('F2', '保存体验记录', '评分 4、说明保存；表单消失，显示本机体验摘要',
    `rating=${saved.rating} note=${Boolean(saved.note)} formGone=${saved.formGone} summary=${saved.summary.includes('★★★★')}`,
    saved.rating === 4 && saved.note && saved.formGone && saved.summary.includes('★★★★'),
    await shot(page, 'f2-saved'))

  const guards = await storeEval(page, (store) => {
    const post = store.posts.find((item) => item.title.includes('帮忙把两箱演练物资'))
    return {
      duplicate: store.submitOrderFeedback(post.id, 5, '重复'),
      invalid: store.submitOrderFeedback(post.id, 9, '非法'),
    }
  })
  step('F3', '重复与非法评分被拒绝', '重复提交与 9 星都返回失败，分别给出重复和评分范围提示',
    `duplicate=${JSON.stringify(guards.duplicate.errors)} invalid=${JSON.stringify(guards.invalid.errors)}`,
    guards.duplicate.ok === false && (guards.duplicate.errors ?? []).some((text) => text.includes('已经有一条'))
    && guards.invalid.ok === false && (guards.invalid.errors ?? []).some((text) => text.includes('1–5')),
    await shot(page, 'f3-guards'))

  await page.clickByText('我的', { selector: '.side-nav button', exact: false })
  await page.waitForText('我的发布')
  await page.clickByText('服务记录', { selector: '.profile-tabs button', exact: false })
  await sleep(300)
  const profileText = await page.bodyText()
  step('F4', '服务记录显示体验', '服务记录包含本机体验记录与说明',
    `hasFeedback=${profileText.includes('本机体验记录')} hasNote=${profileText.includes('沟通清晰')}`,
    profileText.includes('本机体验记录') && profileText.includes('沟通清晰'),
    await shot(page, 'f4-profile'))

  const backupRaw = await storeEval(page, (store) => store.readBackupJson())
  await page.eval((raw) => localStorage.setItem('community-mvp.synthetic-state.v1', raw), backupRaw)
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')
  const roundTrip = await storeEval(page, (store) => ({
    rating: store.posts.find((item) => item.title.includes('帮忙把两箱演练物资'))?.orderFeedback?.rating,
    storage: store.storageStatus,
  }))
  step('F5', '体验记录随备份原文重载', '写回本机备份后刷新，评分仍为 4、存档 saved',
    `rating=${roundTrip.rating} storage=${roundTrip.storage}`,
    roundTrip.rating === 4 && roundTrip.storage === 'saved',
    await shot(page, 'f5-roundtrip'))

  await page.clickByText('我的', { selector: '.side-nav button', exact: false })
  await page.waitForText('我的发布')
  await page.clickByText('服务记录', { selector: '.profile-tabs button', exact: false })
  await sleep(300)
  const aggregate = await page.eval(() => ({
    summary: document.querySelector('.service-feedback-summary')?.innerText ?? '',
    filters: document.querySelectorAll('.profile-order-filter button').length,
  }))
  await page.clickByText('有体验', { selector: '.profile-order-filter button', exact: false })
  await sleep(250)
  const feedbackOnly = await page.eval(() => document.querySelectorAll('.service-record-row').length)
  await page.clickByText('全部', { selector: '.profile-order-filter button', exact: false })
  await sleep(250)
  const allRecords = await page.eval(() => document.querySelectorAll('.service-record-row').length)
  step('F7', '服务记录体验聚合', '显示 1 条体验、平均 4.0 星；“有体验”筛选 1 条，全部恢复',
    `summary=${aggregate.summary.includes('1 条')} avg=${aggregate.summary.includes('4.0')} filters=${aggregate.filters} feedback=${feedbackOnly} all=${allRecords}`,
    aggregate.summary.includes('1 条') && aggregate.summary.includes('4.0') && aggregate.filters === 5
    && feedbackOnly === 1 && allRecords >= 1,
    await shot(page, 'f7-aggregate'))

  const distribution = await page.eval(() => Array.from(document.querySelectorAll('.feedback-distribution span'))
    .map((node) => node.innerText.replace(/\s+/g, ' ').trim()))
  step('F8', '体验评分分布', '分布显示 5 档，4★ 1 条、5★ 0 条',
    `buckets=${distribution.length} rows=${distribution.join('|')}`,
    distribution.length === 5 && distribution.some((text) => text.includes('4★') && text.endsWith('1'))
    && distribution.some((text) => text.includes('5★') && text.endsWith('0')),
    await shot(page, 'f8-distribution'))

  // Simulate a member who did not participate: feedback must not render on the public card.
  await page.eval(() => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('community')
    const envelope = JSON.parse(localStorage.getItem('community-mvp.synthetic-state.v1'))
    const post = envelope.state.posts.find((item) => item.title.includes('帮忙把两箱演练物资'))
    delete post.acceptedByMe
    localStorage.setItem('community-mvp.synthetic-state.v1', JSON.stringify(envelope))
  })
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')
  const outsider = await page.eval(() => ({
    summary: Boolean(document.querySelector('.order-feedback-summary')),
    note: document.body.innerText.includes('沟通清晰'),
  }))
  step('F6', '非参与者不看到体验记录', '未参与该订单的成员看不到体验摘要与说明',
    `summary=${outsider.summary} note=${outsider.note}`,
    !outsider.summary && !outsider.note,
    await shot(page, 'f6-outsider'))

  await writeFile(join(evidenceDir, 'feedback-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
