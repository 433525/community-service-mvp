/**
 * 资源载入失败自愈（弱网抖动 / 发版后旧分块被删）。
 *
 * 依据 Vite 官方文档「Load Error Handling」：
 * - 动态导入或其预加载失败时会派发 `vite:preloadError`，`event.payload` 是原始错误；
 * - 调用 `event.preventDefault()` 可以阻止错误继续抛出；
 * - 文档同时要求 HTML 响应设置 `Cache-Control: no-cache`，否则旧页面会一直引用
 *   已被新版本删除的分块（部署说明见 docs/部署说明-2026-10-22.md）。
 *
 * 本实现的取舍：
 * - 自动刷新在 60 秒内只做一次，避免弱网下刷新死循环；
 * - 冷却记录优先落 sessionStorage，不可用（隐私模式 / 存储被禁）时退化为模块内存；
 * - 冷却期内不阻止默认行为，让上层的异步组件错误态接管，给用户手动重试的入口。
 */
const RELOAD_KEY = 'app.chunk-recovery.at.v1'
export const RELOAD_COOLDOWN_MS = 60_000

/** 是否应该自动刷新：无记录、超出冷却、时钟回拨都放行一次。 */
export function shouldAutoReload(now: number, lastAt: number | null): boolean {
  if (lastAt === null || !Number.isFinite(lastAt)) return true
  if (now < lastAt) return true
  return now - lastAt >= RELOAD_COOLDOWN_MS
}

function readLastReload(): number | null {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function writeLastReload(at: number) {
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(at))
  } catch {
    /* 存储不可用时只保留内存标记 */
  }
}

export interface ChunkRecoveryOptions {
  /** 触发刷新前的回调，用于埋点或提示。 */
  onReloading?: () => void
  /** 便于测试注入；默认 Date.now。 */
  now?: () => number
  /** 便于测试注入；默认整页重载。 */
  reload?: () => void
}

/** 监听 Vite 的预加载失败事件；返回解绑函数。 */
export function installChunkRecovery(options: ChunkRecoveryOptions = {}) {
  const now = options.now ?? (() => Date.now())
  const reload = options.reload ?? (() => window.location.reload())
  let memoryLast: number | null = null

  const handle = (event: Event) => {
    const detail = event as Event & { payload?: unknown; detail?: { payload?: unknown } }
    const error = detail.payload ?? detail.detail?.payload
    console.error('[chunk] 资源载入失败', error)

    const at = now()
    const last = readLastReload() ?? memoryLast
    if (!shouldAutoReload(at, last)) return

    memoryLast = at
    writeLastReload(at)
    event.preventDefault()
    options.onReloading?.()
    reload()
  }

  window.addEventListener('vite:preloadError', handle as EventListener)
  return () => window.removeEventListener('vite:preloadError', handle as EventListener)
}

export interface LoadRetryOptions {
  /** 额外重试次数，默认 1 次。 */
  retries?: number
  /** 重试前的等待，默认 400ms，覆盖瞬时的连接重置。 */
  delayMs?: number
}

/**
 * 对动态导入做有限重试：弱网瞬断时不立刻把用户推到错误页。
 * 失败到上限后抛出最后一次错误，由 `<Suspense>` / asyncView 的错误组件接管。
 */
export async function loadWithRetry<T>(
  loader: () => Promise<T>,
  { retries = 1, delayMs = 400 }: LoadRetryOptions = {},
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await loader()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
  throw lastError
}
