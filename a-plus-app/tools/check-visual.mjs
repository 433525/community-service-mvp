import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

/**
 * 视觉回归基线（无第三方依赖）。
 *
 * 为什么按字节比对：两个入口都是纯本地渲染，不引外部字体/图片，Chrome 同一版本
 * 在同一台机器上截图是确定性的（已验证连续多次哈希一致）。按字节比较能发现
 * 1px 偏移与颜色变化，比缩略图肉眼比对可靠。浏览器版本变化会导致整批哈希变化，
 * 此时用 `--update` 重建基线，并在交付文档里记录版本。
 *
 * 用法：
 *   node tools/check-visual.mjs            # 比对
 *   node tools/check-visual.mjs --update   # 重建基线
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const baselineDir = join(root, 'tools', 'visual-baseline')
const evidenceDir = join(root, '..', 'docs', '运营准备', 'evidence-visual-regression')
const base = (process.argv.find((arg) => arg.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const update = process.argv.includes('--update')

async function setViewport(page, width, height, mobile = false) {
  await page.client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  await sleep(220)
}

async function shot(page) {
  const { data } = await page.client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  }, { timeoutMs: 30000 })
  return Buffer.from(data, 'base64')
}

async function clickNav(page, label) {
  const clicked = await page.eval((text) => {
    const buttons = Array.from(document.querySelectorAll('.side-nav button, .mobile-nav button'))
    const target = buttons.find((button) => button.innerText.includes(text)
      && !button.hasAttribute('disabled')
      && button.getBoundingClientRect().width > 0)
    target?.click()
    return Boolean(target)
  }, label)
  if (!clicked) throw new Error(`导航项“${label}”当前不可见`)
}

async function openCommunity(page, width, height) {
  await setViewport(page, width, height, width < 720)
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.page-stack')
  await sleep(260)
}

async function openIntake(page, width, height) {
  await setViewport(page, width, height, width < 720)
  await page.navigate(`${base}/`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.app-shell')
  await sleep(260)
}

/** 点击第一个可见文本匹配的按钮（与 tools/snapshot-dom.mjs 的 clickText 同口径）。 */
async function clickText(page, selector, text) {
  const ok = await page.eval((sel, label) => {
    const node = Array.from(document.querySelectorAll(sel))
      .find((item) => (item.textContent || '').includes(label) && !item.hasAttribute('disabled'))
    if (!node) return false
    node.click()
    return true
  }, selector, text)
  if (!ok) throw new Error(`clickText(${selector}, ${text}) failed`)
  await sleep(260)
}

const states = [
  {
    id: 'b-home-1440',
    note: 'B 首页 · 桌面',
    run: async (page) => { await openCommunity(page, 1440, 1000) },
  },
  {
    id: 'b-home-banner-1440',
    note: 'B 首页公告轮播 · 第三张',
    run: async (page) => {
      await openCommunity(page, 1440, 1000)
      // 用圆点直接切到第三张，避免按钮滚动影响截图位置。
      await page.eval(() => document.querySelector('#home-banner-tab-recruit')?.click())
      await sleep(520)
    },
  },
  {
    id: 'b-community-1440',
    note: 'B 社区动态 · 桌面',
    run: async (page) => {
      await openCommunity(page, 1440, 1000)
      await clickNav(page, '社区')
      await page.waitForSelector('.feed-list')
      await sleep(260)
    },
  },
  {
    id: 'b-publish-1440',
    note: 'B 发布表单 · 桌面',
    run: async (page) => {
      await openCommunity(page, 1440, 1000)
      await clickNav(page, '发布')
      await page.waitForSelector('.publish-page')
      await sleep(360)
    },
  },
  {
    id: 'b-moderation-1440',
    note: 'B 内容与举报审核 · 桌面',
    run: async (page) => {
      await openCommunity(page, 1440, 1000)
      await page.setMembership('reviewer')
      await clickNav(page, '审核')
      await page.waitForSelector('#moderation-posts')
      await sleep(320)
    },
  },
  {
    id: 'b-messages-390',
    note: 'B 消息与通知 · 移动端',
    run: async (page) => {
      await openCommunity(page, 390, 844)
      await clickNav(page, '消息')
      await page.waitForSelector('.messages-page')
      await sleep(320)
    },
  },
  {
    id: 'b-profile-390',
    note: 'B 我的 · 移动端',
    run: async (page) => {
      await openCommunity(page, 390, 844)
      await clickNav(page, '我的')
      await page.waitForSelector('.profile-page')
      await sleep(360)
    },
  },
  {
    id: 'b-home-390',
    note: 'B 首页 · 移动端',
    run: async (page) => { await openCommunity(page, 390, 844) },
  },
  {
    id: 'aplus-queue-1440',
    note: 'A+ 登记队列 · 桌面',
    run: async (page) => { await openIntake(page, 1440, 1000) },
  },
  {
    id: 'aplus-queue-390',
    note: 'A+ 登记队列 · 移动端',
    run: async (page) => { await openIntake(page, 390, 844) },
  },
  {
    id: 'aplus-help-1440',
    note: 'A+ 使用说明弹层 · 桌面',
    run: async (page) => {
      await openIntake(page, 1440, 1000)
      await page.clickSelector('.icon-button[aria-label="打开使用说明"]')
      await page.waitForSelector('.help-modal')
      await sleep(360)
    },
  },
  {
    id: 'aplus-dialog-create-1440',
    note: 'A+ 新建演练记录弹层 · 桌面',
    run: async (page) => {
      await openIntake(page, 1440, 1000)
      await clickText(page, '.heading-actions .button', '新建演练记录')
      await page.waitForSelector('.modal')
      // 默认截止是「今天 +2 天 17:00」（defaultDueDate），逐日变化会破坏基线，
      // 截图前钉成固定值（只改渲染，不触发 v-model）。
      await page.eval(() => {
        const input = document.querySelector('#record-due')
        if (input) input.value = '2026-10-25T17:00'
      })
      await sleep(360)
    },
  },
  {
    id: 'aplus-dialog-transition-1440',
    note: 'A+ 更新登记状态弹层 · 桌面',
    run: async (page) => {
      await openIntake(page, 1440, 1000)
      await clickText(page, '.detail-actions .button', '更新登记状态')
      await page.waitForSelector('.modal')
      // 截止字段在案例缺 dueAt 时回退到「今天 +2 天」，钉成固定值保证基线稳定。
      await page.eval(() => {
        const input = document.querySelector('#transition-due')
        if (input) input.value = '2026-10-25T17:00'
      })
      await sleep(360)
    },
  },
  {
    id: 'aplus-dialog-highrisk-1440',
    note: 'A+ 标记高风险弹层 · 桌面',
    run: async (page) => {
      await openIntake(page, 1440, 1000)
      await clickText(page, '.detail-actions .button', '标记高风险')
      await page.waitForSelector('.modal')
      await sleep(360)
    },
  },
  {
    id: 'aplus-dialog-complaint-1440',
    note: 'A+ 提交演示投诉弹层 · 桌面',
    run: async (page) => {
      await openIntake(page, 1440, 1000)
      await clickText(page, '.detail-head-side .detail-link', '提交投诉')
      await page.waitForSelector('.modal')
      await sleep(360)
    },
  },
]

await mkdir(evidenceDir, { recursive: true })
await mkdir(baselineDir, { recursive: true })

const results = []
let failures = 0

await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  console.log(`浏览器：${page.browserVersion?.Browser ?? 'unknown'}`)
  for (const state of states) {
    await state.run(page)
    const buffer = await shot(page)
    const hash = createHash('sha256').update(buffer).digest('hex')
    const file = join(baselineDir, `${state.id}.png`)
    if (update) {
      await writeFile(file, buffer)
      results.push({ id: state.id, note: state.note, status: 'updated', hash })
      console.log(`[UPDATE] ${state.id} — ${hash.slice(0, 12)}`)
      continue
    }
    if (!existsSync(file)) {
      await writeFile(join(evidenceDir, `${state.id}.actual.png`), buffer)
      results.push({ id: state.id, note: state.note, status: 'missing-baseline', hash })
      failures += 1
      console.log(`[FAIL] ${state.id} — 缺少基线（用 --update 生成）`)
      continue
    }
    const expected = createHash('sha256').update(await readFile(file)).digest('hex')
    if (expected === hash) {
      results.push({ id: state.id, note: state.note, status: 'pass', hash })
      console.log(`[PASS] ${state.id}`)
    } else {
      await writeFile(join(evidenceDir, `${state.id}.actual.png`), buffer)
      results.push({ id: state.id, note: state.note, status: 'changed', expected, actual: hash })
      failures += 1
      console.log(`[FAIL] ${state.id} — 像素输出变化（实际图已存 evidence-visual-regression）`)
    }
  }
  results.push({ browser: page.browserVersion?.Browser ?? 'unknown', base, update })
})

await writeFile(join(evidenceDir, 'visual-regression.json'), JSON.stringify({
  ranAt: new Date().toISOString(),
  base,
  update,
  failures,
  results,
}, null, 2), 'utf8')
console.log(`视觉回归：${states.length} 个状态，失败 ${failures}`)
process.exitCode = failures ? 1 : 0
