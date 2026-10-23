// 离线提示与更新检查策略的纯逻辑回归。
// 运行：npm run test:unit
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  UPDATE_CHECK_INTERVAL_MS,
  offlineNoticeText,
  resolveOfflineNotice,
  shouldCheckForUpdate,
} from '../../src/shared/offline-policy.ts'

const base = { online: true, updateReady: false, updateDismissed: false, offlineDismissed: false }

test('在线且无新版本时不显示任何提示', () => {
  assert.equal(resolveOfflineNotice(base), 'none')
})

test('离线时显示离线提示', () => {
  assert.equal(resolveOfflineNotice({ ...base, online: false }), 'offline')
})

test('用户关掉离线提示后本次不再出现', () => {
  assert.equal(resolveOfflineNotice({ ...base, online: false, offlineDismissed: true }), 'none')
})

test('有新版本时显示更新提示', () => {
  assert.equal(resolveOfflineNotice({ ...base, updateReady: true }), 'update')
})

test('点过「稍后」后本次更新提示不再出现', () => {
  assert.equal(resolveOfflineNotice({ ...base, updateReady: true, updateDismissed: true }), 'none')
})

test('离线与更新同时成立时只提示离线（此时更新拉不到资源）', () => {
  assert.equal(resolveOfflineNotice({ ...base, online: false, updateReady: true }), 'offline')
})

test('两种提示的文案互不相同且不为空；none 为空串', () => {
  const offline = offlineNoticeText('offline')
  const update = offlineNoticeText('update')
  assert.ok(offline.length > 0 && update.length > 0)
  assert.notEqual(offline, update)
  assert.equal(offlineNoticeText('none'), '')
  assert.ok(offline.includes('离线') || offline.includes('网络'))
  assert.ok(update.includes('新版本'))
})

test('没有历史记录时首次可见性变化会触发更新检查', () => {
  assert.equal(shouldCheckForUpdate(1000, null), true)
})

test('默认 60 秒内不重复检查更新', () => {
  assert.equal(UPDATE_CHECK_INTERVAL_MS, 60_000)
  assert.equal(shouldCheckForUpdate(30_000, 1_000), false)
  assert.equal(shouldCheckForUpdate(60_999, 1_000), false)
  assert.equal(shouldCheckForUpdate(61_000, 1_000), true)
})

test('时钟回拨或非有限时间戳时放行一次，避免永久不检查', () => {
  assert.equal(shouldCheckForUpdate(500, 10_000), true)
  assert.equal(shouldCheckForUpdate(10_000, Number.NaN), true)
})

test('支持自定义检查间隔', () => {
  assert.equal(shouldCheckForUpdate(5_000, 1_000, 3_000), true)
  assert.equal(shouldCheckForUpdate(2_000, 1_000, 3_000), false)
})
