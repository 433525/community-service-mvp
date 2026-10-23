import { withBrowser, sleep } from './cdp.mjs'
const base = 'http://127.0.0.1:5180'
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/`)
  await page.waitForSelector('#app')
  await sleep(400)
  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(600)
  const r = await page.eval(() => {
    const de = document.documentElement
    const body = document.body
    const wide = Array.from(document.querySelectorAll('body *')).map((el) => {
      const cs = getComputedStyle(el)
      return { el, w: el.getBoundingClientRect().width, minW: cs.minWidth, width: cs.width, pos: cs.position }
    }).filter((x) => x.minW !== '0px' || x.width.endsWith('px') && parseFloat(x.width) >= 400 || x.w >= 400)
      .slice(0, 12)
      .map((x) => ({ tag: x.el.tagName, cls: typeof x.el.className === 'string' ? x.el.className.slice(0,50) : '', w: Math.round(x.w), width: x.width, minW: x.minW, pos: x.pos }))
    return {
      innerWidth: window.innerWidth,
      outerWidth: window.outerWidth,
      screenWidth: screen.width,
      dpr: window.devicePixelRatio,
      visualScale: window.visualViewport?.scale,
      htmlClient: de.clientWidth,
      htmlScroll: de.scrollWidth,
      htmlRect: de.getBoundingClientRect().width,
      bodyRect: body.getBoundingClientRect().width,
      bodyClient: body.clientWidth,
      htmlZoom: getComputedStyle(de).zoom,
      bodyZoom: getComputedStyle(body).zoom,
      overflowBody: getComputedStyle(body).overflowX,
      wide,
    }
  })
  console.log(JSON.stringify(r, null, 2))
})
