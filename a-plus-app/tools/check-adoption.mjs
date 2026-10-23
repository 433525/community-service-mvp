// Adoption verification: design tokens, readable body sizes, A+ required semantics.
// Run: node tools/check-adoption.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-adoption')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `adoption-${name}.png`)
  await page.screenshot(file)
  return file
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  // B desktop tokens + body size
  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.post-card')
  // Persist the synthetic community archive so the A+ bridge has something to read.
  await page.clickSelector('.post-save')
  await sleep(300)
  const bTokens = await page.eval(() => {
    const root = getComputedStyle(document.documentElement)
    const content = document.querySelector('.post-content')
    const title = document.querySelector('.post-title')
    return {
      textBody: root.getPropertyValue('--text-body').trim(),
      textTitle: root.getPropertyValue('--text-title').trim(),
      tapMin: root.getPropertyValue('--tap-min').trim(),
      contentSize: content ? getComputedStyle(content).fontSize : '',
      titleSize: title ? getComputedStyle(title).fontSize : '',
    }
  })
  // 2026-10-21 产品级重构：阅读型社区正文基线 14px -> 16px，标题 17px -> 20px。
  step('T1', 'B 设计 token 与正文可读性', '--text-body=16px、正文 16px、标题 20px、触控 44px',
    `tokens=${bTokens.textBody}/${bTokens.textTitle}/${bTokens.tapMin} content=${bTokens.contentSize} title=${bTokens.titleSize}`,
    bTokens.textBody === '16px' && bTokens.tapMin === '44px' && bTokens.contentSize === '16px' && bTokens.titleSize === '20px',
    await shot(page, 'b-desktop'))

  // B mobile size
  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(400)
  const bMobile = await page.eval(() => ({
    content: getComputedStyle(document.querySelector('.post-content')).fontSize,
    title: getComputedStyle(document.querySelector('.post-title')).fontSize,
    input: (() => {
      const input = document.querySelector('.comment-form input')
      return input ? getComputedStyle(input).fontSize : ''
    })(),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))
  step('T2', 'B 移动端正文与标题', '正文 16px、标题 17px、无横向溢出',
    `content=${bMobile.content} title=${bMobile.title} overflow=${bMobile.overflow}`,
    bMobile.content === '16px' && bMobile.title === '17px' && bMobile.overflow <= 1,
    await shot(page, 'b-mobile'))
  await page.client.send('Emulation.clearDeviceMetricsOverride')

  // A+ tokens + bridge content + required semantics
  await page.navigate(`${base}/`)
  await page.waitForSelector('#app')
  await page.waitForText('社区求助（本机演练）')
  await page.clickByText('社区求助（本机演练）', { selector: 'button', exact: true })
  await page.waitForText('我确认本次登记只使用本机合成演练数据')
  await sleep(300)
  const aplus = await page.eval(() => {
    const root = getComputedStyle(document.documentElement)
    const content = document.querySelector('.bridge-post-content')
    return {
      textBody: root.getPropertyValue('--text-body').trim(),
      tapMin: root.getPropertyValue('--tap-min').trim(),
      contentSize: content ? getComputedStyle(content).fontSize : '',
    }
  })
  // 2026-10-21 产品级重构：内部工作台正文基线 13px -> 14px。
  step('T3', 'A+ token 与登记面板正文', '--text-body=14px、桥面板正文 14px、触控 44px',
    `token=${aplus.textBody} content=${aplus.contentSize} tap=${aplus.tapMin}`,
    aplus.textBody === '14px' && aplus.contentSize === '14px' && aplus.tapMin === '44px',
    await shot(page, 'aplus-bridge'))
  await page.eval(() => document.querySelector('.modal-backdrop .icon-button')?.click())
  await sleep(300)

  await page.eval(() => {
    const button = Array.from(document.querySelectorAll('button')).find((node) => (node.innerText || '').includes('新建演练记录'))
    button?.focus()
    button?.click()
  })
  await page.waitForSelector('#create-title')
  const required = await page.eval(() => {
    const ids = ['record-summary', 'record-source', 'record-owner', 'record-due', 'record-next']
    return ids.map((id) => {
      const node = document.getElementById(id)
      return {
        id,
        required: node?.required === true || node?.getAttribute('aria-required') === 'true',
        describedby: node?.getAttribute('aria-describedby') ?? '',
      }
    })
  })
  step('T4', 'A+ 表单必填语义', '摘要/来源/负责人/截止/下一步暴露 required 或 aria-required；摘要关联错误提示',
    `fields=${required.map((f) => `${f.id}:${f.required}`).join(',')} summaryDesc=${required.find((f) => f.id === 'record-summary')?.describedby}`,
    required.every((field) => field.required) && required.find((f) => f.id === 'record-summary')?.describedby === 'create-record-error',
    await shot(page, 'aplus-required'))

  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(400)
  const aplusMobile = await page.eval(() => ({
    inputSize: getComputedStyle(document.getElementById('record-owner')).fontSize,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))
  step('T5', 'A+ 移动端输入字号', '输入 16px、无横向溢出',
    `input=${aplusMobile.inputSize} overflow=${aplusMobile.overflow}`,
    aplusMobile.inputSize === '16px' && aplusMobile.overflow <= 1,
    await shot(page, 'aplus-mobile'))
  await page.client.send('Emulation.clearDeviceMetricsOverride')

  // T6: B secondary surfaces migrated to tokens
  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')
  const bSecondary = await page.eval(() => ({
    footnote: getComputedStyle(document.querySelector('.page-footnote')).fontSize,
    content: getComputedStyle(document.querySelector('.post-content')).fontSize,
  }))
  await page.clickSelector('.help-toggle')
  await page.waitForSelector('.help-dialog')
  const helpBody = await page.eval(() => getComputedStyle(document.querySelector('.help-grid p')).fontSize)
  await page.eval(() => document.querySelector('.help-dialog')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await sleep(250)
  await page.clickByText('我的', { selector: '.side-nav button', exact: false })
  await page.waitForText('我的发布')
  const storageBody = await page.eval(() => getComputedStyle(document.querySelector('.profile-storage-card p')).fontSize)
  step('T6', 'B 次级文字 token 迁移', '页脚 13px、正文 16px、帮助正文 13px、存档说明 13px',
    `footnote=${bSecondary.footnote} content=${bSecondary.content} help=${helpBody} storage=${storageBody}`,
    bSecondary.footnote === '13px' && bSecondary.content === '16px' && helpBody === '13px' && storageBody === '13px',
    await shot(page, 'b-secondary'))

  // T7: error toast becomes assertive alert (A+ unreadable-archive guard)
  await page.navigate(`${base}/`)
  await page.waitForSelector('#app')
  await page.eval(() => localStorage.setItem('a-plus.synthetic-intake.v1', '{broken archive'))
  await page.reload()
  await page.waitForSelector('#app')
  await page.waitForText('重置演练')
  await page.clickByText('重置演练', { selector: 'button', exact: true })
  await page.waitForText('请先点“下载无法读取的旧存档”')
  const toastState = await page.eval(() => {
    const toast = document.querySelector('.toast')
    return { role: toast?.getAttribute('role'), live: toast?.getAttribute('aria-live'), text: toast?.innerText ?? '' }
  })
  step('T7', '错误提示使用 assertive alert', '错误 toast 为 role=alert、aria-live=assertive',
    `role=${toastState.role} live=${toastState.live} text=${toastState.text.slice(0, 30)}`,
    toastState.role === 'alert' && toastState.live === 'assertive',
    await shot(page, 'aplus-error-toast'))
  await page.eval(() => localStorage.removeItem('a-plus.synthetic-intake.v1'))

  // T8: A+ gate copy token size
  await page.reload()
  await page.waitForSelector('#app')
  await page.waitForText('新建演练记录')
  const gate = await page.eval(() => getComputedStyle(document.querySelector('.intake-gate-copy')).fontSize)
  step('T8', 'A+ 承接说明字号', 'A+ 顶部登记说明 13px',
    `gate=${gate}`, gate === '13px', await shot(page, 'aplus-gate'))

  await writeFile(join(evidenceDir, 'adoption-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
