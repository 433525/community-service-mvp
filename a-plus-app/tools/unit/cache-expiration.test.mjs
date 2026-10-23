// 运行时缓存淘汰策略的纯逻辑回归（对齐 Workbox ExpirationPlugin 语义）。
// 运行：npm run test:unit
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SW_CACHE_MAX_AGE_MS,
  SW_CACHE_MAX_ENTRIES,
  SW_CACHED_AT_HEADER,
  isCacheEntryStale,
  isQuotaExceededError,
  selectEvictionKeys,
} from '../../src/shared/cache-expiration.ts'

const NOW = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1000

test('常量口径：64 条上限、7 天保留期、时间戳头名固定', () => {
  assert.equal(SW_CACHE_MAX_ENTRIES, 64)
  assert.equal(SW_CACHE_MAX_AGE_MS, 7 * DAY)
  assert.equal(SW_CACHED_AT_HEADER, 'x-sw-cached-at')
})

test('超过最长期限的条目视为过期（边界：恰好 7 天不算过期）', () => {
  assert.equal(isCacheEntryStale(NOW - SW_CACHE_MAX_AGE_MS - 1, NOW), true)
  assert.equal(isCacheEntryStale(NOW - SW_CACHE_MAX_AGE_MS, NOW), false)
  assert.equal(isCacheEntryStale(NOW - 1000, NOW), false)
})

test('时间戳缺失/非法/为 0 时按过期处理（无法证明新鲜就当不新鲜）', () => {
  assert.equal(isCacheEntryStale(0, NOW), true)
  assert.equal(isCacheEntryStale(Number.NaN, NOW), true)
  assert.equal(isCacheEntryStale(-5, NOW), true)
})

test('时钟回拨不误删：now 早于 cachedAt 时视为新鲜', () => {
  assert.equal(isCacheEntryStale(NOW + 60_000, NOW), false)
})

test('先删过期条目，与数量上限无关', () => {
  const entries = [
    { key: '/a', cachedAt: NOW - 1000 },
    { key: '/b', cachedAt: NOW - 30 * DAY },
  ]
  assert.deepEqual(selectEvictionKeys(entries, 64, NOW), ['/b'])
})

test('未过期但超量时从最旧开始淘汰到恰好不超限', () => {
  const entries = Array.from({ length: 66 }, (_, i) => ({ key: `/r/${i}`, cachedAt: NOW - (66 - i) * 1000 }))
  const evictions = selectEvictionKeys(entries, 64, NOW)
  assert.equal(evictions.length, 2)
  assert.deepEqual(evictions, ['/r/0', '/r/1'])
})

test('时间戳相同的条目按 key 字典序淘汰，结果确定', () => {
  const entries = [
    { key: '/b', cachedAt: NOW - 1000 },
    { key: '/a', cachedAt: NOW - 1000 },
    { key: '/c', cachedAt: NOW - 1000 },
  ]
  assert.deepEqual(selectEvictionKeys(entries, 2, NOW), ['/a'])
})

test('过期 + 超量同时存在时先过期、再最旧', () => {
  const entries = [
    { key: '/stale', cachedAt: NOW - 30 * DAY },
    { key: '/old', cachedAt: NOW - 5000 },
    { key: '/new', cachedAt: NOW - 100 },
  ]
  assert.deepEqual(selectEvictionKeys(entries, 1, NOW), ['/stale', '/old'])
})

test('不超量且无过期时不淘汰任何条目', () => {
  const entries = [{ key: '/a', cachedAt: NOW - 1000 }]
  assert.deepEqual(selectEvictionKeys(entries, 64, NOW), [])
})

test('配额错误识别：现代 name、旧式 code 22、message 兜底', () => {
  assert.equal(isQuotaExceededError(new DOMException('full', 'QuotaExceededError')), true)
  assert.equal(isQuotaExceededError({ name: 'QuotaExceededError' }), true)
  assert.equal(isQuotaExceededError({ code: 22 }), true)
  assert.equal(isQuotaExceededError(new Error('The quota has been exceeded')), true)
  assert.equal(isQuotaExceededError(new TypeError('Failed to fetch')), false)
  assert.equal(isQuotaExceededError(null), false)
  assert.equal(isQuotaExceededError('QuotaExceededError'), false)
})
