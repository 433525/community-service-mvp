// Page health probe: console errors, uncaught exceptions and failed resources per route.
// Run: node tools/probe-errors.mjs --base=http://127.0.0.1:5180
import { withBrowser, sleep } from './cdp.mjs'

const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const tabs = [
  { label: '首页', slug: 'home' },
  { label: '社区', slug: 'community' },
  { label: '发布', slug: 'publish' },
  { label: '消息', slug: 'messages' },
  { label: '我的', slug: 'profile' },
  { label: '审核', slug: 'moderation' },
]

await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.setMembership('member')
  for (const tab of tabs) {
    await page.setMembership(tab.slug === 'moderation' ? 'reviewer' : 'member')
    await page.eval((label) => {
      const node = Array.from(document.querySelectorAll('.side-nav button')).find((item) => (item.innerText || '').includes(label))
      node?.click()
    }, tab.label)
    await sleep(350)
  }

  // Exercise the main dialogs once (help + safety + A+ create).
  await page.setMembership('member')
  await page.eval(() => { const node = Array.from(document.querySelectorAll('.side-nav button')).find((item) => (item.innerText || '').includes('首页')); node?.click() })
  await page.clickSelector('.help-toggle')
  await sleep(300)
  await page.eval(() => document.querySelector('.help-dialog')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await sleep(200)
  await page.eval(() => { const node = Array.from(document.querySelectorAll('button')).find((item) => (item.innerText || '').includes('查看说明')); node?.click() })
  await sleep(300)
  await page.eval(() => document.querySelector('[aria-labelledby="safety-title"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await sleep(200)

  await page.navigate(`${base}/`)
  await page.waitForSelector('#app')
  await page.eval(() => { const node = Array.from(document.querySelectorAll('button')).find((item) => (item.innerText || '').includes('新建演练记录')); node?.click() })
  await sleep(400)
  await page.eval(() => document.querySelector('.modal-backdrop')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await sleep(300)

  console.log(JSON.stringify({
    pageErrors: page.pageErrors,
    consoleErrors: page.consoleErrors,
  }, null, 2))
  if (page.pageErrors.length || page.consoleErrors.length) process.exitCode = 1
})
