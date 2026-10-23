// 无脚本兜底闸门：禁用页面脚本后，两个入口必须给出可读、可操作的说明页。
// 运行：node tools/check-noscript.mjs [--base=http://127.0.0.1:5180]
// 依赖：仅 Node 标准库 + tools/cdp.mjs。
//
// 为什么要单独测：`<noscript>` 的内容在脚本可用时完全不参与渲染，任何常规回归都覆盖不到；
// 而“用户禁用脚本 / 浏览器过旧无法执行 ES 模块”正是最需要说明的一句话场景。
// 断言：可见与居中、文案、重载链接、跨入口链接、320px 无横向溢出、宽屏卡片宽度受控。

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const evidenceDir = join(root, '..', 'docs', '运营准备', 'evidence-noscript')
const base = (process.argv.find((arg) => arg.startsWith('--base=')) || '--base=http://127.0.0.1:5180')
  .slice('--base='.length)
  .replace(/\/+$/, '')

const pages = [
  { id: 'aplus', path: '/', title: 'A+ 受理工作台', selfHref: '/', otherHref: '/community.html', otherLabel: '/community.html' },
  { id: 'community', path: '/community.html', title: 'B 社区端', selfHref: '/community.html', otherHref: '/', otherLabel: '受理工作台' },
]

const steps = []
let failures = 0

function step(id, expected, actual, ok) {
  steps.push({ id, expected, actual, ok })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${JSON.stringify(actual)}`)
}

await mkdir(evidenceDir, { recursive: true })

await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.client.send('Emulation.setScriptExecutionDisabled', { value: true })

  for (const entry of pages) {
    for (const width of [1440, 320]) {
      const height = width === 320 ? 720 : 900
      await page.client.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width < 720,
      })
      await page.navigate(`${base}${entry.path}`)
      await sleep(260)

      const reading = await page.eval(() => {
        const card = document.querySelector('noscript div div')
        const rect = card?.getBoundingClientRect()
        const links = card ? [...card.querySelectorAll('a')].map((a) => a.getAttribute('href')) : []
        return {
          found: Boolean(card),
          text: document.body.innerText,
          links,
          rect: rect ? { left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height } : null,
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          renderedApp: Boolean(document.querySelector('#app')?.firstElementChild),
        }
      })

      const tag = `${entry.id}-${width}`
      step(`N1-${tag} 兜底内容可见`, '卡片存在且高度 > 0', {
        found: reading.found, height: Math.round(reading.rect?.height ?? 0), app: reading.renderedApp,
      }, reading.found && (reading.rect?.height ?? 0) > 120 && !reading.renderedApp)

      step(`N2-${tag} 说明文案完整`, '含“需要启用 JavaScript”与“合成数据”', {
        hasNeed: reading.text.includes('需要启用 JavaScript'),
        hasScope: reading.text.includes('合成数据'),
        hasBrowser: reading.text.includes('Chrome'),
      }, reading.text.includes('需要启用 JavaScript') && reading.text.includes('合成数据') && reading.text.includes('Chrome'))

      step(`N3-${tag} 重载与跨入口链接`, `含 ${entry.selfHref} 与 ${entry.otherHref}`,
        reading.links, reading.links.includes(entry.selfHref) && reading.links.includes(entry.otherHref))

      step(`N4-${tag} 无横向溢出`, 'scrollWidth ≤ innerWidth', {
        scrollWidth: reading.scrollWidth, innerWidth: reading.innerWidth,
      }, reading.scrollWidth <= reading.innerWidth)

      if (width === 1440) {
        const centered = reading.rect
          ? Math.abs((reading.rect.left + reading.rect.right) / 2 - reading.innerWidth / 2)
          : Number.POSITIVE_INFINITY
        step(`N5-${tag} 宽屏卡片居中且宽度受控`, '居中误差 ≤ 8px，宽度 480–600px', {
          width: Math.round(reading.rect?.width ?? 0), centerOffset: Number(centered.toFixed(1)),
        }, centered <= 8 && (reading.rect?.width ?? 0) >= 480 && (reading.rect?.width ?? 0) <= 600)
      } else {
        const fits = reading.rect ? reading.rect.left >= 0 && reading.rect.right <= reading.innerWidth + 0.5 : false
        step(`N5-${tag} 320px 卡片不越界`, '卡片左右均在视口内', {
          left: Math.round(reading.rect?.left ?? -1), right: Math.round(reading.rect?.right ?? -1), innerWidth: reading.innerWidth,
        }, fits)
      }

      // 截图只作证据，不计入断言：断言的判定都在上面的 DOM/盒模型读数里。
      const buffer = await page.screenshot(join(evidenceDir, `noscript-${tag}.png`))
      if (!buffer) console.log(`[NOTE] ${tag} 截图未返回数据（不影响判定）`)
    }
  }
})

await writeFile(join(evidenceDir, 'noscript-report.json'), JSON.stringify({
  ranAt: new Date().toISOString(),
  base,
  failures,
  steps,
}, null, 2), 'utf8')

console.log(`\n无脚本兜底：${steps.length} 项，失败 ${failures}（证据见 docs/运营准备/evidence-noscript/）`)
process.exitCode = failures ? 1 : 0
