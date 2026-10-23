import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep, findFreePort } from './cdp.mjs'

/**
 * 离线可用与版本更新回归（两入口）。
 *
 * 覆盖：
 * - Service Worker 注册、作用域、首次接管、预缓存清单与版本号一致性；
 * - 真正断网（关掉预览服务，连接被拒绝）后两个入口仍能打开，含按需加载页签；
 * - 离线提示与 44px 触控、未缓存路径的站内兜底页、恢复网络后提示消失；
 * - 新版本进入 waiting → 提示 → 稍后 → 再出现 → 立即更新 → 新缓存生效、旧缓存清除；
 * - 不支持 Service Worker 的浏览器不报错、仍可用在线状态提示。
 *
 * 为什么不用 CDP 的 `Network.emulateNetworkConditions({offline:true})` 判离线：
 * 实测它只改 `navigator.onLine`，对本机回环地址的请求不拦截；用它验证会得到假通过。
 * 这里改为在独立端口起一个预览服务，断网即 kill 该进程，恢复即重启，请求真的会失败。
 *
 * 用法：node tools/check-offline.mjs
 * 注意：更新流程用例会临时改写 `dist/sw.js`（模拟发新版），结束时在 finally 里还原。
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = join(rootDir, 'dist')
const viteBin = join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
const evidenceDir = join(rootDir, '..', 'docs', '运营准备', 'evidence-offline')

const steps = []
let failures = 0

function step(id, expected, actual, ok) {
  steps.push({ id, expected, actual, ok })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${JSON.stringify(actual)}`)
}

const port = await findFreePort()
const origin = `http://127.0.0.1:${port}`
let preview = null

async function reachable(url, timeoutMs = 800) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

async function startPreview() {
  preview = spawn(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: rootDir,
    stdio: 'ignore',
    windowsHide: true,
  })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await reachable(`${origin}/community.html`)) return
    await sleep(150)
  }
  throw new Error(`preview did not start on ${origin}`)
}

async function stopPreview() {
  if (!preview) return
  const child = preview
  preview = null
  child.kill()
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await reachable(`${origin}/community.html`, 300))) return
    await sleep(120)
  }
  throw new Error('preview did not stop')
}

/** 与 vite.config.ts 中的版本号算法保持一致：HTML 内容 + 资源文件名。 */
async function expectedBuildId() {
  const assets = (await readdir(join(distDir, 'assets'))).sort()
  const pages = await Promise.all(
    ['index.html', 'community.html'].map((name) => readFile(join(distDir, name), 'utf8')),
  )
  return createHash('sha256').update([...pages, ...assets].join('\n')).digest('hex').slice(0, 12)
}

/**
 * 导航并确认「换了文档」：Page.navigate 之后旧文档常常还短暂可评估，
 * 用 performance.timeOrigin 变化作为新文档已就位的判据，避免断言打在旧页面上。
 */
async function navigateFresh(page, url, { timeoutMs = 20000 } = {}) {
  const before = await page.eval(() => performance.timeOrigin).catch(() => -1)
  await page.navigate(url, { timeoutMs })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const now = await page.eval(() => performance.timeOrigin).catch(() => before)
    if (now !== before) {
      await sleep(250)
      return
    }
    await sleep(150)
  }
  throw new Error(`document did not reload for ${url}`)
}

async function waitForServiceWorker(page) {
  await page.eval(() => {
    if (!navigator.serviceWorker) return false
    return Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((done) => setTimeout(() => done(false), 8000)),
    ])
  })
  await sleep(500)
}

async function noticeInfo(page) {
  return page.eval(() => {
    const box = document.querySelector('.offline-notice')
    if (!box) return null
    const text = box.querySelector('.offline-notice__text')
    const buttons = [...box.querySelectorAll('button')]
    const rect = box.getBoundingClientRect()
    return {
      text: text?.textContent?.trim() ?? '',
      role: text?.getAttribute('role') ?? null,
      buttons: buttons.map((button) => button.textContent.trim()),
      sizes: buttons.map((button) => {
        const item = button.getBoundingClientRect()
        return { w: Math.round(item.width), h: Math.round(item.height) }
      }),
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), right: Math.round(rect.right), bottom: Math.round(rect.bottom) },
      docWidth: document.documentElement.scrollWidth,
    }
  })
}

async function cacheSnapshot(page) {
  return page.eval(async () => {
    const names = await caches.keys()
    const cache = names.length ? await caches.open(names[0]) : null
    const keys = cache ? await cache.keys() : []
    return { names, urls: keys.map((request) => new URL(request.url).pathname) }
  })
}

const OFFLINE_TEXT = '当前网络不可用，正在显示本机已缓存的内容'
const UPDATE_TEXT = '新版本已就绪，更新后可用最新内容'
const buildId = await expectedBuildId()
const swSource = await readFile(join(distDir, 'sw.js'), 'utf8')
await mkdir(evidenceDir, { recursive: true })

await startPreview()

/* ---------------------------------------------------------------- 主流程 */
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await navigateFresh(page, `${origin}/community.html`)
  await page.waitForSelector('.community-app')
  await waitForServiceWorker(page)

  const reg = await page.eval(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      scope: registration?.scope ?? null,
      active: registration?.active?.state ?? null,
      waiting: Boolean(registration?.waiting),
    }
  })
  step('OF01-sw-registered', '首次访问即注册并激活，作用域为站点根',
    reg, reg.active === 'activated' && reg.scope === `${origin}/` && reg.waiting === false)
  step('OF02-sw-controller', '首次安装 claim 后当前页面即受控（无需手动刷新）',
    { controlled: reg.controlled }, reg.controlled)

  const expectedUrls = JSON.parse(swSource.match(/const PRECACHE = (\[[\s\S]*?\])/)?.[1] ?? '[]')
  const snapshot = await cacheSnapshot(page)
  const missing = expectedUrls.filter((url) => !snapshot.urls.includes(url))
  step('OF03-precache-complete', '预缓存清单里的资源全部落盘',
    { cached: snapshot.urls.length, expected: expectedUrls.length, missing },
    expectedUrls.length > 0 && missing.length === 0 && snapshot.names.length === 1)

  step('OF04-build-id', 'sw.js 版本号与「HTML + 资源」摘要一致，且无残留占位符',
    { buildId, placeholderLeft: swSource.includes('__SW_') },
    swSource.includes(`'${buildId}'`) && !swSource.includes('__SW_')
      && snapshot.names[0] === `community-offline-${buildId}`)

  // —— 运行时缓存淘汰（对齐 Workbox ExpirationPlugin：maxEntries / maxAge / purgeOnQuotaError）——
  // 先制造一个确定存在的运行时条目：robots.txt 不在预缓存清单里，SWR 会写入并加盖时间戳。
  await page.eval(async () => {
    await fetch('/robots.txt', { cache: 'no-cache' }).catch(() => null)
    await new Promise((done) => setTimeout(done, 600))
  })
  const stamped = await page.eval(async () => {
    const names = await caches.keys()
    const cache = await caches.open(names[0])
    const match = await cache.match('/robots.txt', { ignoreVary: true })
    return Number(match?.headers.get('x-sw-cached-at')) || 0
  })
  step('OF22-runtime-entries-stamped', '运行时写入的缓存条目带 x-sw-cached-at 时间戳头',
    { stamped }, stamped > 1_000_000_000_000)

  const trimResult = await page.eval(async () => {
    const names = await caches.keys()
    const cache = await caches.open(names[0])
    const now = Date.now()
    const staleTs = String(now - 30 * 24 * 60 * 60 * 1000)
    const puts = []
    for (let i = 0; i < 70; i += 1) {
      puts.push(cache.put(`/__trim-test__/${i}`, new Response('x', { headers: { 'x-sw-cached-at': String(now - i * 1000) } })))
    }
    for (let i = 0; i < 3; i += 1) {
      puts.push(cache.put(`/__trim-stale__/${i}`, new Response('x', { headers: { 'x-sw-cached-at': staleTs } })))
    }
    await Promise.all(puts)
    const before = (await cache.keys()).length
    const done = new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'TRIM_CACHE_DONE') resolve(event.data)
      }, { once: true })
      setTimeout(() => resolve(null), 8000)
    })
    navigator.serviceWorker.controller.postMessage({ type: 'TRIM_CACHE' })
    const result = await done
    const keys = (await cache.keys()).map((request) => new URL(request.url).pathname)
    return {
      before,
      result,
      after: keys.length,
      staleLeft: keys.filter((path) => path.startsWith('/__trim-stale__/')).length,
      testLeft: keys.filter((path) => path.startsWith('/__trim-test__/')).length,
      indexKept: keys.includes('/index.html'),
      communityKept: keys.includes('/community.html'),
    }
  })
  step('OF23-trim-evicts-stale-and-overflow', 'TRIM_CACHE：过期条目全删、超量从最旧删到 ≤64，预缓存不受影响',
    trimResult,
    Boolean(trimResult.result) && trimResult.staleLeft === 0
      && trimResult.testLeft <= 64
      && trimResult.result.deleted >= 3
      && trimResult.after <= 16 + 1 + 64 // 预缓存 16 + robots.txt + 运行时上限 64
      && trimResult.indexKept && trimResult.communityKept)

  step('OF24-quota-retry-codepath', '配额写满时的「清空后重试一次」路径存在（Workbox purgeOnQuotaError 等价）',
    { hasQuotaBranch: /QuotaExceededError|code === 22/.test(swSource), hasRetry: /trimCache\(cache, \{ maxEntries: 0 \}\)/.test(swSource) },
    /QuotaExceededError|code === 22/.test(swSource) && /trimCache\(cache, \{ maxEntries: 0 \}\)/.test(swSource))

  await page.setMembership('member').catch(() => {})

  // 真正断网：先断开预览服务，再让页面进入离线态（navigator.onLine=false）
  await stopPreview()
  await page.setOffline(true)
  await sleep(300)

  const networkDead = await page.eval(async () => {
    try {
      // 探测地址必须落在 Service Worker 作用域之外：同源请求会被 SW 用缓存应答，
      // 看不出服务是否真的停了。这里指向一个必然拒绝连接的端口。
      await fetch('http://127.0.0.1:1/probe', { cache: 'no-store' })
      return 'still-online'
    } catch {
      return 'refused'
    }
  })
  step('OF05-network-really-down', '预览服务已停止，页面侧请求确实失败（不是只改了 onLine）',
    { networkDead }, networkDead === 'refused')

  await navigateFresh(page, `${origin}/community.html`)
  await page.waitForSelector('.community-app')

  // 离线后切成员身份：证明离线可用的是信息流本身（含轮播/待办），不只是外壳。
  const membership = await page.eval(async () => {
    const select = document.querySelector('.membership-panel select')
    if (!select) return null
    select.value = 'member'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((done) => setTimeout(done, 400))
    return select.value
  })

  const offlineHome = await page.eval(() => ({
    title: document.title,
    hasApp: Boolean(document.querySelector('.community-app')),
    hasNav: Boolean(document.querySelector('.side-nav, .mobile-nav')),
    hasTopbar: Boolean(document.querySelector('.topbar')),
    hasError: Boolean(document.querySelector('.view-error')),
    hasHero: Boolean(document.querySelector('.hero-card')),
    hasBanner: Boolean(document.querySelector('.home-banner')),
    online: navigator.onLine,
  }))
  step('OF06-offline-community', '断网后 B 入口完整渲染：外壳、导航、首页信息流与公告轮播',
    { membership, ...offlineHome },
    membership === 'member' && offlineHome.hasApp && offlineHome.hasNav && offlineHome.hasTopbar
      && offlineHome.hasHero && offlineHome.hasBanner && !offlineHome.hasError
      && offlineHome.online === false && offlineHome.title.includes('邻里'))

  const offlineNotice = await noticeInfo(page)
  step('OF07-offline-notice', '离线提示可见、role=status、按钮 ≥44px、只有「知道了」',
    offlineNotice,
    Boolean(offlineNotice) && offlineNotice.text === OFFLINE_TEXT && offlineNotice.role === 'status'
      && offlineNotice.buttons.length === 1 && offlineNotice.buttons[0] === '知道了'
      && offlineNotice.sizes.every((size) => size.h >= 44 && size.w >= 44))
  await page.screenshot(join(evidenceDir, 'offline-community-1440.png'))

  const lazy = await page.eval(async () => {
    const buttons = [...document.querySelectorAll('.side-nav button, .mobile-nav button')]
    const target = buttons.find((button) => button.textContent?.includes('消息'))
    if (!target) return { clicked: false }
    target.click()
    await new Promise((done) => setTimeout(done, 1200))
    return {
      clicked: true,
      hasView: Boolean(document.querySelector('.messages-page')),
      hasError: Boolean(document.querySelector('.view-error')),
    }
  })
  step('OF08-offline-lazy-chunk', '断网下按需加载的「消息」页签可用（分块已预缓存）',
    lazy, lazy.clicked && lazy.hasView && !lazy.hasError)

  await navigateFresh(page, `${origin}/`)
  await page.waitForSelector('.app-shell')
  const offlineAplus = await page.eval(() => ({
    hasShell: Boolean(document.querySelector('.app-shell')),
    queue: document.body.innerText.includes('登记队列'),
  }))
  const aplusNotice = await noticeInfo(page)
  step('OF09-offline-aplus', '断网后 A+ 入口同样可用，并显示离线提示',
    { ...offlineAplus, notice: aplusNotice?.text ?? null },
    offlineAplus.hasShell && offlineAplus.queue && aplusNotice?.text === OFFLINE_TEXT)
  await page.screenshot(join(evidenceDir, 'offline-aplus-1440.png'))

  await navigateFresh(page, `${origin}/not-cached-page`)
  const unknown = await page.eval(() => ({
    text: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
    isBrowserError: document.body.innerText.includes('ERR_INTERNET_DISCONNECTED'),
  }))
  step('OF10-offline-unknown-path', '未缓存路径给出站内兜底页，而不是浏览器断网错误页',
    unknown, unknown.text.includes('这一页还没缓存') && !unknown.isBrowserError)

  await startPreview()
  await page.setOffline(false)
  await sleep(200)
  await navigateFresh(page, `${origin}/community.html`)
  await page.waitForSelector('.community-app')
  const backOnline = await page.eval(() => ({
    online: navigator.onLine,
    notice: document.querySelector('.offline-notice')?.textContent?.trim() ?? null,
    hasError: Boolean(document.querySelector('.view-error')),
  }))
  step('OF11-back-online', '恢复网络后提示消失、页面正常',
    backOnline, backOnline.online === true && backOnline.notice === null && !backOnline.hasError)

  // 390px：提示条不溢出、不被底栏盖住、按钮仍 ≥44px
  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(200)
  await page.setOffline(true)
  await sleep(200)
  await navigateFresh(page, `${origin}/community.html`)
  await page.waitForSelector('.community-app')
  const narrow = await noticeInfo(page)
  const withinViewport = Boolean(narrow)
    && narrow.rect.left >= 0 && narrow.rect.right <= 390
    && narrow.rect.top > 0 && narrow.rect.bottom <= 844 - 60
    && narrow.docWidth <= 390
  step('OF12-offline-390', '390px 下提示条在视口内、避开底部导航、无横向溢出',
    narrow, withinViewport && Boolean(narrow) && narrow.sizes.every((size) => size.h >= 44))
  await page.screenshot(join(evidenceDir, 'offline-community-390.png'))
  await page.setOffline(false)
  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

  const errors = {
    page: page.pageErrors.filter((line) => !line.includes('Failed to fetch')),
    console: page.consoleErrors.filter((line) => line.startsWith('error:') || line.startsWith('warning:')),
  }
  step('OF13-no-runtime-errors', '离线切换与恢复过程不产生页面异常或控制台错误',
    errors, errors.page.length === 0 && errors.console.length === 0)
})

/* ------------------------------------------------- 不支持 SW 的浏览器降级 */
await withBrowser({ windowSize: { width: 1280, height: 900 } }, async (page) => {
  await page.client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined, configurable: true })",
  })
  await page.navigate(`${origin}/community.html`)
  await page.waitForSelector('.community-app')
  await sleep(500)
  const degraded = await page.eval(() => ({
    hasApp: Boolean(document.querySelector('.community-app')),
    hasError: Boolean(document.querySelector('.view-error')),
  }))
  await page.setOffline(true)
  await sleep(500)
  const notice = await noticeInfo(page)
  step('OF14-no-service-worker', 'Service Worker 缺失时页面照常渲染，离线提示仍工作',
    { ...degraded, notice: notice?.text ?? null },
    degraded.hasApp && !degraded.hasError && notice?.text === OFFLINE_TEXT)
  const degradedErrors = {
    page: page.pageErrors.filter((line) => !line.includes('Failed to fetch')),
    console: page.consoleErrors.filter((line) => line.startsWith('error:')),
  }
  step('OF15-degraded-clean', '降级路径不产生页面异常或控制台错误',
    degradedErrors, degradedErrors.page.length === 0 && degradedErrors.console.length === 0)
  await page.setOffline(false)
})

/* ------------------------------------------------------------ 版本更新流程 */
const swPath = join(distDir, 'sw.js')
const originalSw = await readFile(swPath, 'utf8')
try {
  await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
    await navigateFresh(page, `${origin}/community.html`)
    await page.waitForSelector('.community-app')
    await waitForServiceWorker(page)
    const before = await cacheSnapshot(page)

    // 模拟「发了新版」：只改版本号，资源内容不变，等价于一次纯版本发布
    await writeFile(swPath, originalSw.replace(/(const BUILD_ID = ')[^']+(')/, '$1testbuild123$2'), 'utf8')

    await page.eval(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      await registration.update()
      return true
    })
    await page.waitForExpression(
      "Boolean(document.querySelector('.offline-notice'))",
      { timeoutMs: 20000, label: 'update notice' },
    )
    const banner = await noticeInfo(page)
    const state = await page.eval(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      return { waiting: Boolean(registration.waiting), installing: Boolean(registration.installing) }
    })
    step('OF16-update-waiting', '新版本安装后停在 waiting，不自动接管',
      state, state.waiting === true && state.installing === false)
    step('OF17-update-notice', '出现更新提示，含「立即更新 / 稍后」两个 44px 按钮',
      banner,
      banner?.text === UPDATE_TEXT && banner.buttons.join('/') === '立即更新/稍后'
        && banner.sizes.every((size) => size.h >= 44 && size.w >= 44))
    await page.screenshot(join(evidenceDir, 'update-notice-1440.png'))

    const timeOriginBeforeDismiss = await page.eval(() => performance.timeOrigin)
    await page.clickSelector('.offline-notice__ghost')
    await sleep(400)
    const dismissed = await page.eval(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      return {
        notice: document.querySelector('.offline-notice')?.textContent?.trim() ?? null,
        waiting: Boolean(registration?.waiting),
        caches: await caches.keys(),
        timeOrigin: performance.timeOrigin,
      }
    })
    step('OF18-dismiss-update', '点「稍后」只隐藏提示：版本仍在 waiting，页面不刷新',
      dismissed,
      dismissed.notice === null && dismissed.waiting === true
        && dismissed.timeOrigin === timeOriginBeforeDismiss
        && dismissed.caches.includes('community-offline-testbuild123'))

    await navigateFresh(page, `${origin}/community.html`)
    await page.waitForSelector('.community-app')
    await sleep(700)
    const again = await noticeInfo(page)
    step('OF19-update-reappears', '刷新后仍会提示（waiting 版本未丢失）',
      { text: again?.text ?? null }, again?.text === UPDATE_TEXT)

    await page.clickSelector('.offline-notice__primary')

    let after = null
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(300)
      try {
        after = await page.eval(async () => ({
          controlled: Boolean(navigator.serviceWorker.controller),
          caches: await caches.keys(),
          notice: document.querySelector('.offline-notice')?.textContent?.trim() ?? null,
        }))
      } catch {
        continue
      }
      if (after.caches.includes('community-offline-testbuild123')) break
    }
    step('OF20-update-activates', '点「立即更新」后新版本接管，提示消失',
      after, Boolean(after) && after.controlled && after.notice === null
        && after.caches.includes('community-offline-testbuild123'))
    step('OF21-old-cache-cleanup', '旧版本缓存被清除，只保留当前版本',
      { before: before.names, after: after?.caches },
      Boolean(after) && after.caches.length === 1 && after.caches[0] === 'community-offline-testbuild123')
  })
} finally {
  await writeFile(swPath, originalSw, 'utf8')
  await stopPreview()
}

await writeFile(join(evidenceDir, 'offline-run-record.json'), JSON.stringify({
  ranAt: new Date().toISOString(),
  origin,
  buildId,
  steps,
  failures,
}, null, 2), 'utf8')

console.log(`Offline regression: ${steps.length - failures}/${steps.length} passed.`)
if (failures) process.exitCode = 1
