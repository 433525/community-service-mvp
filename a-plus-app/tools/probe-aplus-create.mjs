import { withBrowser, sleep } from './cdp.mjs'
const base = 'http://127.0.0.1:5180'
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/`)
  await page.waitForSelector('#app')
  await sleep(400)
  await page.clickByText('新建演练记录', { selector: 'button', exact: false })
  await sleep(500)
  const r = await page.eval(() => {
    const modal = document.querySelector('.modal')
    return {
      exists: Boolean(modal),
      title: document.querySelector('#create-title')?.innerText ?? null,
      html: modal?.outerHTML?.slice(0, 700) ?? '',
      active: document.activeElement?.outerHTML?.slice(0, 160) ?? '',
      errors: [],
    }
  })
  console.log(JSON.stringify(r, null, 2))
  await page.screenshot('../docs/运营准备/probe-aplus-create.png')
})
