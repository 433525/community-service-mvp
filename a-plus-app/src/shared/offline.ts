/**
 * 离线可用与版本更新：Service Worker 注册、在线状态、更新提示。
 *
 * 文档依据：
 * - MDN《Service Worker API》：首次访问即下载安装；已有 worker 时新版本进入 waiting，
 *   需要 `skipWaiting()` + `clients.claim()` 才能立即接管；仅 HTTPS / localhost 可用。
 * - vite-plugin-pwa《Prompt for update》：默认（prompt）模式下不自动接管，
 *   由 UI 提示用户点「更新」，再 `postMessage({ type: 'SKIP_WAITING' })` 并刷新。
 * - Workbox `NetworkFirst` 的 `networkTimeoutSeconds`：用于对抗 lie-fi
 *   （连上了 Wi-Fi 但实际没有出口），超时先给缓存、网络回来后仍会更新缓存。
 *
 * 取舍：
 * - 只在生产构建里注册；`npm run dev` 不注册，避免开发时反复命中旧缓存。
 * - 注册失败（隐私模式、非安全上下文、浏览器不支持）完全静默：页面退化为普通静态站，
 *   不打印 warn/error，以免把「可接受的降级」误报成页面异常。
 * - 更新由用户确认，不自动刷新：工作台里可能正在填表或开着弹层。
 */

import { computed, readonly, ref } from 'vue'
import {
  resolveOfflineNotice,
  shouldCheckForUpdate,
  type OfflineNoticeKind,
} from './offline-policy'

const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const updateReady = ref(false)
const updateDismissed = ref(false)
const offlineDismissed = ref(false)
const updating = ref(false)
const waitingWorker = ref<ServiceWorker | null>(null)

let installed = false
let registration: ServiceWorkerRegistration | null = null
let lastUpdateCheckAt: number | null = null
let reloadRequested = false

export interface OfflineSupportOptions {
  /** 便于测试或特殊环境关闭 Service Worker，只保留在线状态提示。 */
  serviceWorker?: boolean
}

function handleOnline() {
  online.value = true
  // 回到在线后重新给一次提示机会，避免上次的「知道了」一直压着。
  offlineDismissed.value = false
}

function handleOffline() {
  online.value = false
  offlineDismissed.value = false
}

/** 标记「有新版本在等待」，由用户决定何时接管。 */
function markWaiting(worker: ServiceWorker | null, controller: ServiceWorker | null) {
  if (!worker) return
  waitingWorker.value = worker
  // 首次安装时还没有受控页面，claim 之后下次刷新就是新版本，不需要打扰用户。
  if (!controller) return
  updateReady.value = true
  updateDismissed.value = false
}

function watchRegistration(reg: ServiceWorkerRegistration, container: ServiceWorkerContainer) {
  if (reg.waiting) markWaiting(reg.waiting, container.controller)

  reg.addEventListener('updatefound', () => {
    const installing = reg.installing
    if (!installing) return
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') markWaiting(reg.waiting ?? installing, container.controller)
    })
  })
}

/**
 * 安装离线支持：监听在线状态，并在生产构建里注册 `/sw.js`。
 * 重复调用是幂等的，两个入口各自调用一次即可。
 */
export function installOfflineSupport(options: OfflineSupportOptions = {}) {
  if (installed || typeof window === 'undefined') return
  installed = true

  online.value = navigator.onLine
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  const container = 'serviceWorker' in navigator ? navigator.serviceWorker : null
  if (options.serviceWorker === false || !container || !import.meta.env.PROD) return

  try {
    container.addEventListener('controllerchange', () => {
      // 用户点过「更新」才刷新；首次 claim 不打断当前页面。
      if (reloadRequested) window.location.reload()
    })

    container
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        registration = reg
        watchRegistration(reg, container)
      })
      .catch(() => {
        /* 注册失败按普通静态站运行，不打扰用户 */
      })

    // 长驻标签页（工作台一开一整天）切回来时顺便查一次更新，60 秒内不重复查。
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !registration) return
      const now = Date.now()
      if (!shouldCheckForUpdate(now, lastUpdateCheckAt)) return
      lastUpdateCheckAt = now
      registration.update().catch(() => {})
    })
  } catch {
    /* 同上：不支持或被策略拦截时静默降级 */
  }
}

/** 用户确认更新：让等待中的 worker 立即接管，随后整页刷新。 */
export function applyUpdate() {
  const worker = waitingWorker.value
  reloadRequested = true
  updating.value = true

  if (!worker) {
    window.location.reload()
    return
  }

  worker.postMessage({ type: 'SKIP_WAITING' })

  // 兜底：个别浏览器不派发 controllerchange（或 worker 已被回收），3 秒后仍刷新一次。
  // 刷新本身是最新页面，不会造成循环。
  window.setTimeout(() => {
    if (reloadRequested) window.location.reload()
  }, 3000)
}

export function dismissUpdate() {
  updateDismissed.value = true
}

export function dismissOffline() {
  offlineDismissed.value = true
}

/** 供提示条组件读取的只读状态与动作。 */
export function useOfflineNotice() {
  const kind = computed<OfflineNoticeKind>(() =>
    resolveOfflineNotice({
      online: online.value,
      updateReady: updateReady.value,
      updateDismissed: updateDismissed.value,
      offlineDismissed: offlineDismissed.value,
    }),
  )

  return {
    kind,
    updating: readonly(updating),
    online: readonly(online),
    applyUpdate,
    dismissUpdate,
    dismissOffline,
  }
}
