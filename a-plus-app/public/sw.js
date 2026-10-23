/*
 * 离线缓存 Service Worker（构建时注入版本号与预缓存清单）。
 *
 * 策略（对齐 Workbox 的三种标准策略，但零依赖手写）：
 * - 页面导航：network-first，3 秒超时回退缓存（对抗 lie-fi），成功后顺手更新缓存；
 * - /assets/*（文件名带内容哈希，不可变）：cache-first；
 * - 其他同源 GET：stale-while-revalidate。
 *
 * 版本：缓存名带构建 ID；构建 ID 变化时新 SW 安装，activate 阶段删掉旧缓存。
 * 更新：新版本停在 waiting，由页面提示用户确认后 postMessage SKIP_WAITING 接管，
 *       首次安装（还没有 active worker）直接 skipWaiting，避免首访被等待卡住。
 *
 * 注意：本文件由 vite.config.ts 的 offline-sw 插件在 closeBundle 阶段替换
 *      下面两行的占位符（版本号、预缓存清单），占位符写法不要改。
 */

const BUILD_ID = '__SW_BUILD_ID__'
const PRECACHE = __SW_PRECACHE__

const CACHE_PREFIX = 'community-offline-'
const CACHE_NAME = CACHE_PREFIX + BUILD_ID
const NAV_TIMEOUT_MS = 3000

// —— 运行时缓存淘汰（对齐 Workbox ExpirationPlugin 语义）——
// 与 src/shared/cache-expiration.ts 手工同步，改动时两边都要改。
const SW_CACHE_MAX_ENTRIES = 64
const SW_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const SW_CACHED_AT_HEADER = 'x-sw-cached-at'
/** 预缓存路径永不参与淘汰（删了会破坏离线可用）。 */
const PRECACHE_PATHS = new Set(PRECACHE.map((url) => new URL(url, self.location.origin).pathname))

const OFFLINE_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>暂时无法载入 · 社区服务演练</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f2f5f4;color:#12232a;
       font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  .card{width:100%;max-width:480px;padding:28px;border:1px solid #d7dfdc;border-radius:20px;background:#fff}
  h1{margin:0 0 10px;font-size:21px}
  p{margin:0 0 14px;color:#3f5259;font-size:15px;line-height:1.75}
  a{display:inline-flex;min-height:44px;align-items:center;padding:0 20px;border-radius:999px;
    border:1px solid #cfdad6;background:#f4f7f6;color:#14343c;font-weight:600;text-decoration:none}
</style></head>
<body><div class="card">
  <h1>这一页还没缓存</h1>
  <p>当前网络不可用，本机也没有这一页的副本。已打开过的页面仍可离线查看。</p>
  <a href="/">重新载入</a>
</div></body></html>`

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // 逐个 add：Cache.addAll 只要有一个非 2xx 就会整体失败（MDN），
      // 单个资源 404 不应该让整个离线能力装不上。
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }))
          } catch {
            /* 单个资源失败就跳过，其余仍可用 */
          }
        }),
      )
      // 首次安装没有旧 worker，直接接管；升级时留在 waiting 等用户确认。
      if (!self.registration.active) await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.map((key) => (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME ? caches.delete(key) : null)),
      )
      // 激活时顺手做一次家政：清掉过期/超量的运行时条目。
      const current = await caches.open(CACHE_NAME)
      await trimCache(current)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }
  // 供页面/回归脚本触发一次缓存淘汰，并把结果回发给来源。
  if (event.data && event.data.type === 'TRIM_CACHE') {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_NAME)
        const result = await trimCache(cache)
        if (event.source && 'postMessage' in event.source) {
          event.source.postMessage({ type: 'TRIM_CACHE_DONE', ...result })
        }
      })(),
    )
  }
})

/** 超时即失败，但不断开底层请求；超时后返回缓存。 */
function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network-timeout')), timeoutMs)
    fetch(request).then(
      (response) => {
        clearTimeout(timer)
        resolve(response)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** 写入缓存前加盖时间戳头，作为淘汰排序的依据（Workbox 用 IndexedDB，这里零依赖）。 */
function stampResponse(response) {
  const headers = new Headers(response.headers)
  headers.set(SW_CACHED_AT_HEADER, String(Date.now()))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isQuotaError(error) {
  return Boolean(error) && (error.name === 'QuotaExceededError' || error.code === 22
    || (typeof error.message === 'string' && /quota/i.test(error.message)))
}

/**
 * 淘汰当前缓存里的运行时条目：先删过期，再按写入时间从旧到新删到不超限。
 * 预缓存条目（PRECACHE_PATHS）跳过。返回 { deleted, remaining }。
 */
async function trimCache(cache, { maxEntries = SW_CACHE_MAX_ENTRIES, maxAgeMs = SW_CACHE_MAX_AGE_MS } = {}) {
  const now = Date.now()
  const keys = await cache.keys()
  const runtime = []
  for (const key of keys) {
    const path = new URL(key.url).pathname
    if (PRECACHE_PATHS.has(path)) continue
    const cached = await cache.match(key, { ignoreVary: true })
    const at = Number(cached?.headers.get(SW_CACHED_AT_HEADER)) || 0
    runtime.push({ key, path, at, stale: !Number.isFinite(at) || at <= 0 || (now >= at && now - at > maxAgeMs) })
  }
  const stale = runtime.filter((entry) => entry.stale)
  const fresh = runtime
    .filter((entry) => !entry.stale)
    .sort((a, b) => (a.at - b.at) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const evict = stale.slice()
  const overflow = fresh.length - maxEntries
  if (overflow > 0) evict.push(...fresh.slice(0, overflow))
  await Promise.all(evict.map((entry) => cache.delete(entry.key)))
  return { deleted: evict.length, remaining: (await cache.keys()).length }
}

async function putQuietly(cache, key, response) {
  try {
    await cache.put(key, stampResponse(response.clone()))
  } catch (error) {
    if (isQuotaError(error)) {
      // purgeOnQuotaError 等价：配额写满时清空可再生的运行时条目后重试一次。
      try {
        await trimCache(cache, { maxEntries: 0 })
        await cache.put(key, stampResponse(response.clone()))
      } catch {
        /* 重试仍失败就放弃本次写入，响应照常返回 */
      }
    }
    /* 其余情况（响应不可缓存等）忽略 */
  }
}

async function handleNavigation(request) {
  const url = new URL(request.url)
  const key = url.pathname === '/' ? '/index.html' : url.pathname

  try {
    const response = await fetchWithTimeout(request, NAV_TIMEOUT_MS)
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME)
      putQuietly(cache, key, response)
    }
    return response
  } catch {
    // 只回退到该路径自己的缓存副本：多入口站点不能用「随便一个外壳」兜底，
    // 否则用户在 A+ 工作台里点了一个不存在的路径，会看到社区端的界面。
    const cached = await caches.match(key, { ignoreVary: true })
    if (cached) return cached
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreVary: true })
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME)
    putQuietly(cache, request, response)
  }
  return response
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request, { ignoreVary: true })
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) putQuietly(cache, request, response)
      return response
    })
    .catch(() => null)

  if (cached) return cached
  const fresh = await network
  return fresh || new Response('', { status: 504, statusText: 'Offline' })
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // sw.js 自身不经过这里，但仍防御性跳过，避免缓存住 SW 脚本。
  if (url.pathname === '/sw.js') return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
    return
  }
  event.respondWith(staleWhileRevalidate(request))
})
