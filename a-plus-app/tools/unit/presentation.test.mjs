// A+ 展示层纯函数的最小回归：文案映射、时间格式化与状态派生。
// 运行：npm run test:unit
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  caseHasHighRisk,
  caseStatusLabel,
  communityOrderStatusLabel,
  defaultDueDate,
  eventChangeValue,
  eventHeading,
  formatDate,
  roleLabel,
  toLocalInput,
  transitionReasonOptions,
} from '../../src/aplus/presentation.ts'
import { INTAKE_REASON_CODES } from '../../src/domain/intake.ts'

/** 只构造被测字段，避免测试与完整领域模型耦合。 */
const caseWith = (overrides = {}) => ({
  id: 'CASE-001',
  status: '初筛中',
  riskFlags: [],
  ...overrides,
})

test('formatDate 对缺失与非法输入给出稳定文案', () => {
  assert.equal(formatDate(null), '未设置')
  assert.equal(formatDate(undefined), '未设置')
  assert.equal(formatDate(''), '未设置')
  assert.equal(formatDate('not-a-date'), '时间无效')
})

test('formatDate 输出两位月日与 24 小时时间', () => {
  const label = formatDate('2026-10-23T06:05:00.000Z')
  // 不锁定具体时区：只校验形状，避免测试机时区差异造成假失败。
  assert.match(label, /^\d{2}\/\d{2} \d{2}:\d{2}$/)
})

test('toLocalInput 保留瞬时且不带时区后缀', () => {
  assert.equal(toLocalInput(''), '')
  assert.equal(toLocalInput('bad'), '')
  const local = toLocalInput('2026-10-23T06:05:00.000Z')
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  assert.equal(new Date(local).getTime(), new Date('2026-10-23T06:05:00.000Z').getTime())
})

test('defaultDueDate 落在两天后的 17:00', () => {
  const value = defaultDueDate()
  assert.match(value, /^\d{4}-\d{2}-\d{2}T17:00$/)
  // 断言日历日偏移，而不是相对毫秒：否则当前时刻接近 17:00 时会产生假失败。
  const expected = new Date()
  expected.setDate(expected.getDate() + 2)
  const pad = (n) => String(n).padStart(2, '0')
  assert.equal(
    value.slice(0, 10),
    `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}`,
  )
})

test('caseHasHighRisk 只识别高风险停止标记', () => {
  assert.equal(caseHasHighRisk(caseWith()), false)
  assert.equal(caseHasHighRisk(caseWith({ riskFlags: [{ code: 'OTHER_FLAG' }] })), false)
  assert.equal(caseHasHighRisk(caseWith({ riskFlags: [{ code: 'HIGH_RISK_STOP_SCREENING' }] })), true)
})

test('caseStatusLabel 对高风险与转介已接收做额外说明', () => {
  assert.equal(caseStatusLabel(caseWith()), '初筛中')
  assert.equal(caseStatusLabel(caseWith({ status: '已转介已接收' })), '已转介 · 演练确认已录入')
  assert.equal(
    caseStatusLabel(caseWith({ riskFlags: [{ code: 'HIGH_RISK_STOP_SCREENING' }] })),
    '初筛中 · 已停止常规初筛 · 风险未解除',
  )
})

test('eventHeading 优先取动作文案，其次按 kind 映射', () => {
  assert.equal(eventHeading({ action: 'BEGIN_SCREENING' }), '开始初筛')
  assert.equal(eventHeading({ kind: 'created' }), '创建演练记录')
  assert.equal(eventHeading({ kind: 'checkpoint-update' }), '更新登记检查点')
  assert.equal(eventHeading({ kind: 'unknown-kind' }), '登记状态更新')
})

test('eventChangeValue 对截止时间走日期格式化', () => {
  assert.equal(eventChangeValue('owner', ''), '未设置')
  assert.equal(eventChangeValue('nextStep', '回访'), '回访')
  assert.equal(eventChangeValue('dueAt', null), '未设置')
  assert.match(eventChangeValue('dueAt', '2026-10-23T06:05:00.000Z'), /^\d{2}\/\d{2} \d{2}:\d{2}$/)
})

test('transitionReasonOptions 在结束跟进时收敛为单一原因', () => {
  assert.deepEqual(transitionReasonOptions('CLOSE_FOLLOW_UP'), ['FOLLOW_UP_CONCLUDED'])
  assert.deepEqual(transitionReasonOptions(null), [...INTAKE_REASON_CODES])
  assert.deepEqual(transitionReasonOptions('REFER'), [...INTAKE_REASON_CODES])
  // 返回副本，调用方修改不会污染领域常量。
  const options = transitionReasonOptions('REFER')
  options.pop()
  assert.equal(INTAKE_REASON_CODES.length, transitionReasonOptions('REFER').length)
})

test('roleLabel 对未知角色不抛错', () => {
  assert.equal(roleLabel('demo-intake'), '演示 · 受理席')
  assert.equal(roleLabel(null), '未记录')
  assert.equal(roleLabel('demo-unknown'), '未记录')
})

test('communityOrderStatusLabel 覆盖社区订单状态字典', () => {
  assert.equal(communityOrderStatusLabel('open'), '待接单（本机演练）')
  assert.equal(communityOrderStatusLabel('completed-local-demo'), '已完成（本机演练，未结算）')
})
