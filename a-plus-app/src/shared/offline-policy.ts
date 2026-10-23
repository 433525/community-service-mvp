/**
 * 离线提示的纯判定逻辑（不接触 DOM / Vue，可在 Node 里单测）。
 *
 * 依据 MDN Service Worker API 与 vite-plugin-pwa「prompt for update」的推荐做法：
 * - 新版本安装完成后停在 waiting，由用户点「更新」才 `SKIP_WAITING` 并刷新；
 * - 提示是非阻断的（banner / toast），不锁滚动、不抢焦点；
 * - 离线与「有新版本」是两种独立状态，同时成立时只提示离线——
 *   此时点「更新」也拉不到新资源，先让用户知道当前看到的是本机缓存。
 */

export type OfflineNoticeKind = 'none' | 'offline' | 'update'

export interface OfflineNoticeInput {
  /** `navigator.onLine` 的当前值（仅代表网卡链路，不代表真的能连到服务器）。 */
  online: boolean
  /** 是否已有安装完成、正在等待接管的新版本 Service Worker。 */
  updateReady: boolean
  /** 用户是否已对本次更新点了「稍后」。 */
  updateDismissed: boolean
  /** 用户是否已关掉本次离线提示。 */
  offlineDismissed: boolean
}

/** 解析当前应展示的提示类型；两种状态互斥，离线优先。 */
export function resolveOfflineNotice(input: OfflineNoticeInput): OfflineNoticeKind {
  if (!input.online) return input.offlineDismissed ? 'none' : 'offline'
  if (input.updateReady && !input.updateDismissed) return 'update'
  return 'none'
}

/** 标签页重新可见时主动检查更新的最小间隔，避免频繁切页就发一次 sw.js 请求。 */
export const UPDATE_CHECK_INTERVAL_MS = 60_000

/**
 * 是否值得在本次可见性变化时主动 `registration.update()`。
 * 时钟回拨或没有历史记录时放行一次；否则按最小间隔节流。
 */
export function shouldCheckForUpdate(
  now: number,
  lastCheckedAt: number | null,
  minIntervalMs: number = UPDATE_CHECK_INTERVAL_MS,
): boolean {
  if (lastCheckedAt === null || !Number.isFinite(lastCheckedAt)) return true
  if (now < lastCheckedAt) return true
  return now - lastCheckedAt >= minIntervalMs
}

/** 离线提示文案：区分「完全断网」与「能上网时的更新提示」，便于抽取断言。 */
export function offlineNoticeText(kind: OfflineNoticeKind): string {
  if (kind === 'offline') return '当前网络不可用，正在显示本机已缓存的内容'
  if (kind === 'update') return '新版本已就绪，更新后可用最新内容'
  return ''
}
