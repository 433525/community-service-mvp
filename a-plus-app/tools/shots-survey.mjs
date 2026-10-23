import { withBrowser, sleep } from './cdp.mjs'
import { mkdir, writeFile } from 'node:fs/promises'

const base = 'http://127.0.0.1:5181'
const out = 'D:/Users/10974/Documents/ChatGPT/网页开发/a-plus-app/.survey'
await mkdir(out, { recursive: true })

async function shot(page, name) {
  const { data } = await page.client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, { timeoutMs: 30000 })
  await writeFile(`${out}/${name}.png`, Buffer.from(data, 'base64'))
  console.log('saved', name)
}

await withBrowser({ headless: true }, async (page) => {
  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await page.navigate(`${base}/`)
  await page.waitForSelector('.app-shell')
  await sleep(600)
  await shot(page, 'aplus-1440')

  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(400)
  await shot(page, 'aplus-390')

  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await sleep(800)
  await shot(page, 'b-home-1440')

  await page.eval(() => {
    const btn = Array.from(document.querySelectorAll('.side-nav button')).find((b) => b.innerText.includes('社区'))
    btn?.click()
  })
  await sleep(600)
  await shot(page, 'b-community-1440')

  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(500)
  await shot(page, 'b-community-390')
})
