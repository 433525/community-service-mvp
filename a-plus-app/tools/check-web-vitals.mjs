// 运行时 Web Vitals 闸门（真实文档加载，不是静态体积估算）。
// 运行：node tools/check-web-vitals.mjs [--base=http://127.0.0.1:5180] [--report]
// 依赖：仅 Node 标准库 + tools/cdp.mjs（本机 Chrome/Edge）。
//
// 采集口径（依据 GoogleChrome/web-vitals 与 web.dev 的定义）：
//   CLS  —— 只用 hadRecentInput === false 的 layout-shift，按“会话窗口”合并：
//           窗口最长 5s，相邻事件间隔 >1s 或窗口超 5s 则另开窗口，取最大窗口和；
//   LCP  —— largest-contentful-paint 最后一条的 startTime；
//   FCP  —— 首帧绘制，仅报告；
//   长任务 —— longtask 条目数与最长时长，按 >50ms 计入 TBT。
//
// 阈值：CLS ≤ 0.1、LCP ≤ 2500ms 属 web-vitals 的 good 档；长任务/TBT 上限用于兜住
// 主线程卡顿（本机合成数据、无网络，实测远低于阈值，留出的是回归余量）。
// 末尾自带 collector 自检：人为制造一次布局偏移，确认观察器真的在计数，
// 避免“采集器坏了但指标全是 0”这种假通过。
// 说明：这是本机 headless 的确定性回归，不替代真实设备、弱网与 Lighthouse 实测。

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'
import { blockingTime, clsFromShifts } from './lib/web-vitals.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const evidenceDir = join(root, '..', 'docs', '运营准备', 'evidence-web-vitals')
const base = (process.argv.find((arg) => arg.startsWith('--base=')) || '--base=http://127.0.0.1:5180')
  .slice('--base='.length)
  .replace(/\/+$/, '')
const reportOnly = process.argv.includes('--report')

const THRESHOLDS = {
  cls: 0.1,
  lcp: 2500,
  longestTask: 200,
  tbt: 300,
}

// 观察器必须在文档开始时注入，所以拼成字符串；计算函数从 tools/lib 序列化注入，
// 保证门禁与单测跑的是同一份 CLS 算法。
const COLLECTOR = `(() => {
  const shifts = []
  const longTasks = []
  const state = { lcp: 0, lcpElement: '', fcp: 0, error: '' }
  const clsOf = ${String(clsFromShifts)}
  const blockingOf = ${String(blockingTime)}
  window.__vitals = state
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) shifts.push({ start: entry.startTime, value: entry.value })
      }
    }).observe({ type: 'layout-shift', buffered: true })
    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1]
      if (last) {
        state.lcp = last.startTime
        state.lcpElement = last.element ? last.element.tagName.toLowerCase() : ''
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ start: entry.startTime, duration: entry.duration })
      }
    }).observe({ type: 'longtask', buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') state.fcp = entry.startTime
      }
    }).observe({ type: 'paint', buffered: true })
  } catch (error) {
    state.error = String(error)
  }

  window.__readVitals = () => ({
    cls: Number(clsOf(shifts).toFixed(4)),
    shiftCount: shifts.length,
    lcp: Math.round(state.lcp),
    fcp: Math.round(state.fcp),
    lcpElement: state.lcpElement,
    longTasks: longTasks.length,
    longestTask: Math.round(longTasks.reduce((value, task) => Math.max(value, task.duration), 0)),
    tbt: Math.round(blockingOf(longTasks)),
    error: state.error,
  })
})()`

async function setViewport(page, width, height) {
  await page.client.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 720,
  })
  await sleep(120)
}

async function asMember(page) {
  await page.navigate(`${base}/community.html`)
  await page.setMembership('member')
}

const states = [
  {
    id: 'b-home-1440',
    label: 'B 首页 · 桌面 · 首次访问',
    run: async (page) => {
      await setViewport(page, 1440, 1000)
      await page.navigate(`${base}/community.html`)
      await page.clearLocalStorage()
      await page.navigate(`${base}/community.html`)
    },
  },
  {
    id: 'b-home-390',
    label: 'B 首页 · 移动端 · 首次访问',
    run: async (page) => {
      await setViewport(page, 390, 844)
      await page.navigate(`${base}/community.html`)
      await page.clearLocalStorage()
      await page.navigate(`${base}/community.html`)
    },
  },
  {
    id: 'b-community-1440',
    label: 'B 社区动态 · 桌面 · 深链首次渲染',
    run: async (page) => {
      await setViewport(page, 1440, 1000)
      await asMember(page)
      await page.navigate(`${base}/community.html?tab=community`)
    },
  },
  {
    id: 'b-publish-1440',
    label: 'B 发布页 · 桌面 · 按需分块',
    run: async (page) => {
      await setViewport(page, 1440, 1000)
      await asMember(page)
      await page.navigate(`${base}/community.html?tab=publish`)
    },
  },
  {
    id: 'aplus-queue-1440',
    label: 'A+ 登记队列 · 桌面 · 首次访问',
    run: async (page) => {
      await setViewport(page, 1440, 1000)
      await page.navigate(`${base}/`)
      await page.clearLocalStorage()
      await page.navigate(`${base}/`)
    },
  },
  {
    id: 'aplus-queue-390',
    label: 'A+ 登记队列 · 移动端 · 首次访问',
    run: async (page) => {
      await setViewport(page, 390, 844)
      await page.navigate(`${base}/`)
      await page.navigate(`${base}/`)
    },
  },
]

await mkdir(evidenceDir, { recursive: true })

const results = []
let failures = 0
let browserLabel = 'unknown'

await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  browserLabel = page.browserVersion?.Browser ?? 'unknown'
  console.log(`浏览器：${browserLabel}`)
  await page.client.send('Page.addScriptToEvaluateOnNewDocument', { source: COLLECTOR })

  for (const state of states) {
    await state.run(page)
    await page.waitForSelector('#app > *', { timeoutMs: 15000 }).catch(() => {})
    await sleep(1500)
    const metrics = await page.eval(() => (typeof window.__readVitals === 'function' ? window.__readVitals() : null))
    if (!metrics) {
      failures += 1
      results.push({ id: state.id, label: state.label, status: 'no-metrics' })
      console.log(`[FAIL] ${state.id} — 未采集到指标`)
      continue
    }

    const problems = []
    if (metrics.error) problems.push(`采集异常：${metrics.error}`)
    if (metrics.cls > THRESHOLDS.cls) problems.push(`CLS ${metrics.cls} > ${THRESHOLDS.cls}`)
    if (metrics.lcp > THRESHOLDS.lcp) problems.push(`LCP ${metrics.lcp}ms > ${THRESHOLDS.lcp}ms`)
    if (metrics.longestTask > THRESHOLDS.longestTask) problems.push(`最长任务 ${metrics.longestTask}ms > ${THRESHOLDS.longestTask}ms`)
    if (metrics.tbt > THRESHOLDS.tbt) problems.push(`TBT ${metrics.tbt}ms > ${THRESHOLDS.tbt}ms`)

    const ok = problems.length === 0
    if (!ok) failures += 1
    results.push({ id: state.id, label: state.label, status: ok ? 'pass' : 'fail', metrics, problems })
    console.log(
      `[${ok ? 'PASS' : 'FAIL'}] ${state.id} — CLS ${metrics.cls} · LCP ${metrics.lcp}ms · FCP ${metrics.fcp}ms`
      + ` · 长任务 ${metrics.longTasks}（最长 ${metrics.longestTask}ms / TBT ${metrics.tbt}ms）`
      + (ok ? '' : ` → ${problems.join('；')}`),
    )
  }

  // --- collector 自检：人为制造一次布局偏移，确认观察器在计数 -------------
  await setViewport(page, 1440, 1000)
  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app', { timeoutMs: 15000 })
  await sleep(600)
  const beforeCount = await page.eval(() => window.__readVitals().shiftCount)
  await page.eval(() => new Promise((resolve) => {
    const probe = document.createElement('div')
    probe.style.height = '0px'
    probe.setAttribute('aria-hidden', 'true')
    document.body.insertBefore(probe, document.getElementById('app'))
    requestAnimationFrame(() => {
      probe.style.height = '180px'
      requestAnimationFrame(() => setTimeout(resolve, 300))
    })
  }))
  const afterCount = await page.eval(() => window.__readVitals().shiftCount)
  const probeOk = afterCount > beforeCount
  if (!probeOk) failures += 1
  results.push({
    id: 'collector:self-check',
    label: '观察器自检：人为偏移被计入',
    status: probeOk ? 'pass' : 'fail',
    metrics: { shiftCountBefore: beforeCount, shiftCountAfter: afterCount },
  })
  console.log(
    `[${probeOk ? 'PASS' : 'FAIL'}] collector:self-check — 偏移计数 ${beforeCount} → ${afterCount}`
    + (probeOk ? '' : '（观察器未计数，指标不可信）'),
  )
})

await writeFile(
  join(evidenceDir, 'web-vitals.json'),
  JSON.stringify({
    ranAt: new Date().toISOString(),
    base,
    reportOnly,
    browser: browserLabel,
    thresholds: THRESHOLDS,
    failures,
    results,
  }, null, 2),
  'utf8',
)

console.log(`\nWeb Vitals：${states.length} 个状态 + 1 项自检，失败 ${failures}（报告见 docs/运营准备/evidence-web-vitals/web-vitals.json）`)
process.exitCode = reportOnly ? 0 : (failures ? 1 : 0)
