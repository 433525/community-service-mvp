import { withBrowser, sleep } from './cdp.mjs'
const base = 'http://127.0.0.1:5180'
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.clickSelector('.post-save')
  await sleep(400)
  await page.navigate(`${base}/`)
  await page.waitForSelector('#app')
  await page.clickByText('社区求助（本机演练）', { selector: 'button', exact: true })
  await page.waitForText('我确认本次登记只使用本机合成演练数据')
  const r = await page.eval(() => {
    const el = document.querySelector('.bridge-post-content')
    const root = getComputedStyle(document.documentElement)
    return {
      found: Boolean(el),
      cls: el?.className,
      inline: el?.getAttribute('style'),
      computed: el ? getComputedStyle(el).fontSize : null,
      rootVar: root.getPropertyValue('--text-body'),
      elVar: el ? getComputedStyle(el).getPropertyValue('--text-body') : null,
      parentSize: el?.parentElement ? getComputedStyle(el.parentElement).fontSize : null,
      parentCls: el?.parentElement?.className,
      sheets: Array.from(document.styleSheets).map(s => s.href || 'inline'),
    }
  })
  console.log(JSON.stringify(r, null, 2))
})
