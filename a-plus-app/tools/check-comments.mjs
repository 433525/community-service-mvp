// Comment moderation: create, approve, hide, restore, and filter states.
// Run: node tools/check-comments.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-comments')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `comments-${name}.png`)
  await page.screenshot(file)
  return file
}
async function listCount(page) {
  return page.eval(() => ({
    cards: document.querySelectorAll('.moderation-comment-list article').length,
    empty: document.querySelector('.moderation-comment-list .empty-state')?.innerText ?? '',
    selected: document.querySelector('.comments-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
}
async function hasOurComment(page) {
  return page.eval(() => Array.from(document.querySelectorAll('.moderation-comment-list article'))
    .some((node) => (node.innerText || '').includes('评论筛选验证')))
}
async function clickOurButton(page, label) {
  return page.eval((wanted) => {
    const card = Array.from(document.querySelectorAll('.moderation-comment-list article'))
      .find((node) => (node.innerText || '').includes('评论筛选验证'))
    const button = card && Array.from(card.querySelectorAll('button')).find((node) => (node.innerText || '').trim() === wanted)
    if (!button) return false
    button.click()
    return true
  }, label)
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

  const opened = await page.eval(() => {
    const card = document.querySelector('.post-card')
    const button = Array.from(card?.querySelectorAll('.post-actions button') ?? []).find((node) => (node.innerText || '').includes('条评论'))
    if (!button) return false
    button.click()
    return true
  })
  if (!opened) throw new Error('comment toggle not found')
  const typed = await page.eval(() => {
    const input = document.querySelector('.comment-form input')
    if (!input) return false
    input.value = '评论筛选验证：这是一条虚构评论。'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })
  if (!typed) throw new Error('comment input not found')
  await page.clickByText('发送', { selector: '.comment-form button', exact: true })
  await page.waitForText('评论已提交审核')

  await page.setMembership('reviewer')
  await page.clickByText('审核', { selector: '.side-nav button', exact: false })
  await page.waitForText('内容与举报审核')
  await page.waitForSelector('.comments-filter')
  await page.fillByLabel('本次审核或处理理由', '评论筛选验证：审核理由')
  const pending = await listCount(page)
  step('C1', '评论默认待审筛选', '5 个筛选、默认待审选中、显示 1 条待审评论',
    `cards=${pending.cards} selected=${pending.selected}`,
    pending.cards === 1 && pending.selected.includes('待审'),
    await shot(page, 'c1-pending'))

  await page.clickByText('通过评论', { selector: '.moderation-comment-list button', exact: true })
  await sleep(300)
  const afterApprove = await listCount(page)
  step('C2', '通过评论后待审为空', '待审列表变空并显示空态',
    `cards=${afterApprove.cards} empty=${afterApprove.empty.includes('没有评论')}`,
    afterApprove.cards === 0 && afterApprove.empty.includes('没有评论'),
    await shot(page, 'c2-approved-empty'))

  await page.clickByText('通过', { selector: '.comments-filter button', exact: false })
  await sleep(250)
  const approved = await listCount(page)
  const approvedHasOurs = await hasOurComment(page)
  step('C3', '筛选已通过评论', '通过列表包含刚通过的评论',
    `cards=${approved.cards} ours=${approvedHasOurs} selected=${approved.selected}`,
    approvedHasOurs && approved.selected.includes('通过'),
    await shot(page, 'c3-approved'))

  await page.fillByLabel('本次审核或处理理由', '评论筛选验证：下架理由')
  const hideClicked = await clickOurButton(page, '下架评论')
  await sleep(300)
  const approvedAfterHide = await hasOurComment(page)
  await page.clickByText('下架', { selector: '.comments-filter button', exact: false })
  await sleep(250)
  const hidden = await listCount(page)
  const hiddenHasOurs = await hasOurComment(page)
  step('C4', '下架评论并可筛选', '点击下架后通过列表移除；下架筛选包含该评论',
    `clicked=${hideClicked} approvedStill=${approvedAfterHide} hiddenOurs=${hiddenHasOurs} selected=${hidden.selected}`,
    hideClicked && !approvedAfterHide && hiddenHasOurs && hidden.selected.includes('下架'),
    await shot(page, 'c4-hidden'))

  await page.fillByLabel('本次审核或处理理由', '评论筛选验证：恢复理由')
  const restoreClicked = await clickOurButton(page, '恢复评论为通过')
  await sleep(300)
  const hiddenAfterRestore = await hasOurComment(page)
  await page.clickByText('通过', { selector: '.comments-filter button', exact: false })
  await sleep(250)
  const restored = await hasOurComment(page)
  step('C5', '恢复评论为通过', '下架列表移除；通过列表重新包含该评论',
    `clicked=${restoreClicked} hiddenStill=${hiddenAfterRestore} restored=${restored}`,
    restoreClicked && !hiddenAfterRestore && restored,
    await shot(page, 'c5-restored'))

  await page.clickByText('全部', { selector: '.comments-filter button', exact: false })
  await sleep(250)
  const all = await listCount(page)
  const allHasOurs = await hasOurComment(page)
  step('C6', '全部评论', '全部筛选保留该已通过评论',
    `cards=${all.cards} ours=${allHasOurs} selected=${all.selected}`,
    allHasOurs && all.selected.includes('全部'),
    await shot(page, 'c6-all'))

  await writeFile(join(evidenceDir, 'comments-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
