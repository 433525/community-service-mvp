/**
 * 运行时缓存淘汰策略（纯函数，可在 Node 里单测）。
 *
 * 对齐 Workbox `ExpirationPlugin` 的语义（developers.google.com/web/tools/workbox/guides/storage-quota）：
 * - `maxEntries`：单个缓存的条目上限，超出后从最旧的开始淘汰；
 * - `maxAgeSeconds`：条目超过最长期限即视为过期，下次访问缓存时清除；
 * - `purgeOnQuotaError`：配额写满时允许清空缓存后重试一次（本模块提供判定函数 `isQuotaExceededError`）。
 *
 * 手写实现与 Workbox 的差异：元数据不走 IndexedDB，而是写入响应头 `x-sw-cached-at`
 * （同源响应，可读可改；SW 重启后仍保留），淘汰时按该时间戳排序。
 *
 * 注意：`public/sw.js` 是零依赖的独立脚本，不能 import 本文件；
 *      其中的同名常量与本文件保持手工同步，改动时两边都要改（check-offline 有对应断言）。
 */

/** 单个版本缓存里「运行时条目」（非预缓存）的最大数量。 */
export const SW_CACHE_MAX_ENTRIES = 64

/** 运行时条目的最长保留期：7 天（毫秒）。 */
export const SW_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** 写入缓存时加盖的时间戳响应头（毫秒 Unix 时间）。 */
export const SW_CACHED_AT_HEADER = 'x-sw-cached-at'

export interface CacheEntryMeta {
  /** 条目的标识（Request URL 或路径）。 */
  key: string
  /** 写入缓存的时间戳（毫秒）；缺失或非法按 0 处理（最旧，优先淘汰）。 */
  cachedAt: number
}

/** 条目是否已超出最长保留期；时间戳非法视为过期（无法证明新鲜就当不新鲜）。 */
export function isCacheEntryStale(
  cachedAt: number,
  now: number,
  maxAgeMs: number = SW_CACHE_MAX_AGE_MS,
): boolean {
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) return true
  if (now < cachedAt) return false // 时钟回拨：不因此误删
  return now - cachedAt > maxAgeMs
}

/**
 * 选出应被淘汰的条目 key。
 *
 * 规则（与 ExpirationPlugin 一致的两段式）：
 * 1. 先删全部过期条目；
 * 2. 剩余条目仍超过 maxEntries 时，从最旧开始删到不超限。
 *
 * 排序按 cachedAt 升序，时间戳相同按 key 字典序，保证结果确定（可测）。
 */
export function selectEvictionKeys(
  entries: CacheEntryMeta[],
  maxEntries: number = SW_CACHE_MAX_ENTRIES,
  now: number,
  maxAgeMs: number = SW_CACHE_MAX_AGE_MS,
): string[] {
  const stale = entries.filter((entry) => isCacheEntryStale(entry.cachedAt, now, maxAgeMs))
  const fresh = entries
    .filter((entry) => !isCacheEntryStale(entry.cachedAt, now, maxAgeMs))
    .sort((a, b) => (a.cachedAt - b.cachedAt) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const evictions = stale.map((entry) => entry.key)
  const overflow = fresh.length - maxEntries
  if (overflow > 0) evictions.push(...fresh.slice(0, overflow).map((entry) => entry.key))
  return evictions
}

/**
 * 是否为存储配额耗尽错误。
 *
 * 覆盖三种形态（MDN QuotaExceededError）：
 * - 现代 DOMException：`name === 'QuotaExceededError'`；
 * - 旧式 code：`22`（QUOTA_EXCEEDED_ERR）；
 * - 部分实现只给 message（如 'The quota has been exceeded'），做兜底匹配。
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown }
  if (candidate.name === 'QuotaExceededError') return true
  if (candidate.code === 22) return true
  return typeof candidate.message === 'string' && /quota/i.test(candidate.message)
}
