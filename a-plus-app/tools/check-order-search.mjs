// Messages order-thread search: thread title, post title, and message content.
// Run: node tools/check-order-search.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-order-search')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `order-search-${name}.png`)
  await page.screenshot(file)
  return file
}
async function setSearch(page, value) {
  await page.eval((term) => {
    const input = document.querySelector('.message-search-row input')
    input.value = term
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await sleep(300)
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
  await page.eval(() => {
    const norm = (v) => (v || '').replace(/\s+/g, ' ').trim()
    const card = Array.from(document.querySelectorAll('.post-card')).find((node) => norm(node.innerText).includes('帮忙把两箱'))
    const button = card && Array.from(card.querySelectorAll('button')).find((node) => norm(node.innerText) === '演练接单')
    button?.click()
  })
  await page.waitForText('已接单（本机演练）')
  await page.clickByText('消息', { selector: '.side-nav button', exact: false })
  await page.waitForText('订单内留言')
  await page.waitForSelector('.thread-item')
  await page.clickSelector('.thread-item')
  await page.waitForSelector('.chat-composer textarea')
  await page.eval(() => {
    const textarea = document.querySelector('.chat-composer textarea')
    textarea.value = '订单搜索关键词：楼门口交接即可。'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.clickByText('保存订单留言', { selector: '.chat-composer button', exact: true })
  await page.waitForText('已保存订单内留言')

  const initial = await page.eval(() => ({
    threads: document.querySelectorAll('.thread-item').length,
    hasMessage: document.body.innerText.includes('订单搜索关键词'),
    selected: document.querySelector('.thread-item.active')?.innerText ?? '',
  }))
  step('S1', '订单留言初始', '接单后消息页有 1 条订单线程，刚发送的留言可见',
    `threads=${initial.threads} message=${initial.hasMessage} selected=${initial.selected.includes('帮忙')}`,
    initial.threads === 1 && initial.hasMessage && initial.selected.includes('帮忙'),
    await shot(page, 's1-initial'))

  await setSearch(page, '订单搜索关键词')
  const byMessage = await page.eval(() => ({
    threads: document.querySelectorAll('.thread-item').length,
    visible: document.body.innerText.includes('订单搜索关键词'),
  }))
  step('S2', '按留言内容搜索', '只剩匹配线程且留言可见',
    `threads=${byMessage.threads} visible=${byMessage.visible}`,
    byMessage.threads === 1 && byMessage.visible,
    await shot(page, 's2-by-message'))

  await setSearch(page, '不存在的订单词')
  const empty = await page.eval(() => ({
    threads: document.querySelectorAll('.thread-item').length,
    emptyText: document.querySelector('.thread-list .empty-state')?.innerText ?? '',
  }))
  step('S3', '无匹配线程空态', '线程列表为空并显示“没有匹配的订单留言”',
    `threads=${empty.threads} empty=${empty.emptyText.includes('没有匹配的订单留言')}`,
    empty.threads === 0 && empty.emptyText.includes('没有匹配的订单留言'),
    await shot(page, 's3-empty'))

  await page.clickSelector('.message-search-row button')
  await sleep(300)
  const cleared = await page.eval(() => document.querySelectorAll('.thread-item').length)
  step('S4', '清除搜索恢复线程', '清除后恢复 1 条订单线程',
    `threads=${cleared}`, cleared === 1,
    await shot(page, 's4-cleared'))

  await writeFile(join(evidenceDir, 'order-search-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
