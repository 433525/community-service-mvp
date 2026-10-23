// Temporary probe: find horizontal overflow offenders at 390px emulation.
import { withBrowser, sleep } from './cdp.mjs'

const base = (process.argv.find((arg) => arg.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7)

await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  for (const path of ['/community.html', '/']) {
    await page.navigate(`${base}${path}`)
    await page.waitForSelector('#app')
    await sleep(500)
    await page.client.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    })
    await sleep(600)
    const result = await page.eval(() => {
      const vw = window.innerWidth
      const all = Array.from(document.querySelectorAll('body *'))
      const offenders = all
        .map((el) => {
          const rect = el.getBoundingClientRect()
          return { el, rect }
        })
        .filter(({ rect }) => rect.width > 0 && rect.right > 391)
        .sort((a, b) => b.rect.right - a.rect.right)
        .slice(0, 8)
        .map(({ el, rect }) => ({
          tag: el.tagName,
          cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
          text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          x: Math.round(rect.x),
          w: Math.round(rect.width),
          right: Math.round(rect.right),
          position: getComputedStyle(el).position,
        }))
      return {
        innerWidth: vw,
        visualWidth: window.visualViewport?.width,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? null,
        offenders,
      }
    })
    console.log(`\n=== ${path} ===`)
    console.log(JSON.stringify(result, null, 2))
    await page.client.send('Emulation.clearDeviceMetricsOverride')
    await sleep(200)
  }
})
