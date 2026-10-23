// Web Vitals 计算口径的单元回归：CLS 会话窗口与 TBT。
// 运行：npm run test:unit
import assert from 'node:assert/strict'
import test from 'node:test'
import { blockingTime, clsFromShifts } from '../lib/web-vitals.mjs'

test('clsFromShifts：没有偏移时结果为 0', () => {
  assert.equal(clsFromShifts([]), 0)
})

test('clsFromShifts：单个偏移等于其分数', () => {
  assert.equal(clsFromShifts([{ start: 100, value: 0.05 }]), 0.05)
})

test('clsFromShifts：1 秒内的连续偏移累加到同一窗口', () => {
  const shifts = [
    { start: 100, value: 0.02 },
    { start: 600, value: 0.03 },
    { start: 1500, value: 0.01 },
  ]
  assert.ok(Math.abs(clsFromShifts(shifts) - 0.06) < 1e-9)
})

test('clsFromShifts：间隔超过 1 秒另开窗口，取最大窗口而不是总和', () => {
  const shifts = [
    { start: 100, value: 0.02 },
    { start: 300, value: 0.02 },
    { start: 3000, value: 0.05 },
    { start: 3400, value: 0.01 },
  ]
  assert.ok(Math.abs(clsFromShifts(shifts) - 0.06) < 1e-9)
})

test('clsFromShifts：窗口超过 5 秒必须切窗，不能无限累加', () => {
  const shifts = [
    { start: 0, value: 0.03 },
    { start: 900, value: 0.03 },
    { start: 1800, value: 0.03 },
    { start: 2700, value: 0.03 },
    { start: 3600, value: 0.03 },
    { start: 4500, value: 0.03 },
    { start: 5200, value: 0.03 },
  ]
  // 前 6 条落在 0–4500ms 的同一窗口（0.18），最后一条超窗，另开窗口（0.03）。
  assert.ok(Math.abs(clsFromShifts(shifts) - 0.18) < 1e-9)
})

test('blockingTime：只累加超过 50ms 的部分', () => {
  assert.equal(blockingTime([]), 0)
  assert.equal(blockingTime([{ duration: 30 }, { duration: 50 }]), 0)
  assert.equal(blockingTime([{ duration: 130 }, { duration: 60 }]), 80 + 10)
})
