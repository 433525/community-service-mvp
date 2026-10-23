// 资源载入失败自愈的最小回归：冷却判定与有限重试。
// 运行：npm run test:unit
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RELOAD_COOLDOWN_MS,
  loadWithRetry,
  shouldAutoReload,
} from '../../src/shared/chunk-recovery.ts'

test('shouldAutoReload：无历史记录时允许一次自动刷新', () => {
  assert.equal(shouldAutoReload(1_000, null), true)
})

test('shouldAutoReload：冷却期内不再刷新，避免弱网刷新死循环', () => {
  const now = 1_000_000
  assert.equal(shouldAutoReload(now, now - 1), false)
  assert.equal(shouldAutoReload(now, now - (RELOAD_COOLDOWN_MS - 1)), false)
})

test('shouldAutoReload：达到冷却边界后放行', () => {
  const now = 1_000_000
  assert.equal(shouldAutoReload(now, now - RELOAD_COOLDOWN_MS), true)
  assert.equal(shouldAutoReload(now, now - RELOAD_COOLDOWN_MS * 2), true)
})

test('shouldAutoReload：时钟回拨与非法记录都放行，避免永久卡在冷却', () => {
  assert.equal(shouldAutoReload(500, 9_000), true)
  assert.equal(shouldAutoReload(9_000, Number.NaN), true)
})

test('loadWithRetry：首次失败后重试成功', async () => {
  let calls = 0
  const value = await loadWithRetry(async () => {
    calls += 1
    if (calls === 1) throw new Error('chunk 暂时不可用')
    return 'view'
  }, { delayMs: 1 })
  assert.equal(value, 'view')
  assert.equal(calls, 2)
})

test('loadWithRetry：重试次数用尽后抛出最后一次错误', async () => {
  let calls = 0
  await assert.rejects(
    loadWithRetry(async () => {
      calls += 1
      throw new Error(`第 ${calls} 次失败`)
    }, { delayMs: 1 }),
    /第 2 次失败/,
  )
  assert.equal(calls, 2)
})

test('loadWithRetry：retries=0 时只调用一次', async () => {
  let calls = 0
  await assert.rejects(
    loadWithRetry(async () => {
      calls += 1
      throw new Error('直接失败')
    }, { retries: 0 }),
    /直接失败/,
  )
  assert.equal(calls, 1)
})
