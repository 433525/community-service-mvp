/**
 * route-state.ts — 无依赖的查询串状态同步。
 *
 * 两个入口都是单文件应用，没有引入 vue-router：页签与选中记录直接写进查询串，
 * 使链接可分享、刷新可还原、浏览器前进/后退可用。设计要点：
 * 1. 只改查询串，不触发导航，也不会与页面内 `#锚点` 冲突；
 * 2. 默认值不写入 URL，链接保持简短（例如首页就是 `/community.html`）；
 * 3. 非安全上下文或 file:// 下 History API 可能抛错，失败时静默降级，界面状态仍然可用；
 * 4. popstate 只在前进/后退时触发，且触发时 location 已更新（MDN）。
 */

export type RouteValues = Record<string, string | null | undefined>

function getWindow(): Window | null {
  return typeof window === 'undefined' ? null : window
}

function currentRelativeUrl(): string {
  const win = getWindow()
  if (!win) return ''
  return `${win.location.pathname}${win.location.search}${win.location.hash}`
}

/** 读取查询参数；缺失或解码失败时返回空串，调用方无需处理 null。 */
export function readRouteParam(name: string): string {
  const win = getWindow()
  if (!win) return ''
  try {
    return new URLSearchParams(win.location.search).get(name)?.trim() ?? ''
  } catch {
    return ''
  }
}

/**
 * 写入查询参数：空值删除该键；URL 未变化时不新增历史记录。
 * 返回是否真的改变了地址（用于测试与调用方判断）。
 */
export function writeRoute(
  values: RouteValues,
  options: { replace?: boolean; clearHash?: boolean } = {},
): boolean {
  const win = getWindow()
  if (!win || !win.history || typeof win.history.pushState !== 'function') return false
  try {
    const url = new URL(win.location.href)
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === undefined || value === '') url.searchParams.delete(key)
      else url.searchParams.set(key, value)
    }
    // 切换页签时旧的页内锚点已不存在，清掉可避免刷新后停留在失效位置。
    if (options.clearHash) url.hash = ''
    const next = `${url.pathname}${url.search}${url.hash}`
    if (next === currentRelativeUrl()) return false
    if (options.replace) win.history.replaceState(win.history.state, '', next)
    else win.history.pushState(win.history.state, '', next)
    return true
  } catch {
    // 沙箱 iframe、file:// 或历史记录配额异常：保留当前界面状态，不回滚用户操作。
    return false
  }
}

/** 监听浏览器前进/后退；返回解绑函数，组件卸载时必须调用。 */
export function onRoutePop(handler: () => void): () => void {
  const win = getWindow()
  if (!win) return () => {}
  const listener = () => { handler() }
  win.addEventListener('popstate', listener)
  return () => { win.removeEventListener('popstate', listener) }
}

/** 当前查询串签名，用于忽略与路由无关的 popstate（例如页内锚点后退）。 */
export function routeSignature(): string {
  const win = getWindow()
  return win ? win.location.search : ''
}

/** 生成当前页面的可分享绝对地址，只保留传入的参数。 */
export function buildShareUrl(values: RouteValues): string {
  const win = getWindow()
  if (!win) return ''
  try {
    const url = new URL(win.location.href)
    url.search = ''
    url.hash = ''
    for (const [key, value] of Object.entries(values)) {
      if (value) url.searchParams.set(key, value)
    }
    return url.toString()
  } catch {
    return ''
  }
}
