// A+ 备份序列化 / 解析 / 迁移的单测。
//
// 运行：npm run test:unit
// 依赖：Node 内置 node:test + node:assert/strict，直接跑 src/**/*.ts（--experimental-strip-types）。
// 数据：只用 src/domain/fixtures.ts 的合成种子或本文件内构造的合成对象，不含任何真实个人信息。
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { validateIntakeCase } from '../../src/domain/intake.ts'
import { parseIntakeBackup, serializeIntakeBackup } from '../../src/domain/intake-backup.ts'
import { syntheticIntakeCases, syntheticOpenOverdueCase } from '../../src/domain/fixtures.ts'
// 契约守卫：订单事件上限是跨入口共享的常量，改动必须有意识地同步测试。
import { ORDER_EVENT_LIMIT } from '../../src/community/types.ts'

// 独立投诉复核记录（合成）：待复核状态，且留有可用复核角色 demo-referral。
const syntheticComplaint = {
  id: 'SYNTH-C1',
  caseId: 'SYNTH-001',
  targetRole: 'demo-review',
  submittedByRole: 'demo-intake',
  description: '合成演练：针对复核席演示角色的演练投诉，仅用于测试。',
  status: '待复核',
  submittedAt: '2026-10-20T06:00:00.000Z',
  reviewedAt: null,
  reviewerRole: null,
  resolution: '',
}

function serializeBase({ selectedId = 'SYNTH-002', intakePaused = true, complaints = [syntheticComplaint] } = {}) {
  return serializeIntakeBackup(syntheticIntakeCases, selectedId, intakePaused, complaints)
}

// 先拿到一份合法备份对象，再定向破坏某个字段，确保失败分支只由被破坏的字段触发。
function parseMutated(mutate) {
  const base = JSON.parse(serializeBase())
  mutate(base)
  return parseIntakeBackup(JSON.stringify(base))
}

function assertRejected(result, needle) {
  assert.equal(result.ok, false, '非法备份必须被拒绝')
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, '拒绝时必须给出错误信息')
  assert.ok(
    result.errors.every((message) => typeof message === 'string' && message.trim() !== ''),
    `错误信息不能为空串：${JSON.stringify(result.errors)}`,
  )
  if (needle) {
    assert.ok(
      result.errors.some((message) => message.includes(needle)),
      `期望错误信息包含“${needle}”，实际：${result.errors.join(' | ')}`,
    )
  }
}

describe('serializeIntakeBackup → parseIntakeBackup 往返', () => {
  test('记录、选中项、暂停开关与投诉都保持不变', () => {
    const parsed = parseIntakeBackup(serializeBase())
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.errors.join(' | '))

    const backup = parsed.backup
    assert.equal(backup.app, 'a-plus-intake')
    assert.equal(backup.kind, 'synthetic-rehearsal')
    assert.equal(backup.schemaVersion, 1)
    assert.equal(Number.isNaN(Date.parse(backup.savedAt)), false, 'savedAt 必须是可解析时间')

    assert.equal(backup.cases.length, syntheticIntakeCases.length)
    assert.deepEqual(
      backup.cases.map((item) => item.id),
      syntheticIntakeCases.map((item) => item.id),
      '记录顺序必须保持',
    )
    assert.deepEqual(backup.cases, JSON.parse(JSON.stringify(syntheticIntakeCases)))

    assert.equal(backup.selectedId, 'SYNTH-002')
    assert.equal(backup.intakePaused, true)

    assert.equal(backup.complaints.length, 1)
    assert.deepEqual(backup.complaints, [syntheticComplaint])

    assert.ok(Array.isArray(parsed.warnings), 'warnings 必须是数组')
    assert.deepEqual(parsed.warnings, [])

    for (const item of backup.cases) {
      const validation = validateIntakeCase(item)
      assert.deepEqual(validation.errors, [], `${item.id} 往返后校验失败：${validation.errors.join(' | ')}`)
    }
  })

  test('默认参数：未传暂停开关与投诉时按 false / 空数组还原', () => {
    const raw = serializeIntakeBackup([syntheticOpenOverdueCase], null)
    const parsed = parseIntakeBackup(raw)
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.errors.join(' | '))
    assert.equal(parsed.backup.intakePaused, false)
    assert.equal(parsed.backup.selectedId, null)
    assert.deepEqual(parsed.backup.complaints, [])
    assert.deepEqual(parsed.warnings, [])
  })

  test('选中的记录不存在时回退到首条并给出 warning', () => {
    const parsed = parseIntakeBackup(serializeBase({ selectedId: 'SYNTH-不存在' }))
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.errors.join(' | '))
    assert.equal(parsed.backup.selectedId, 'SYNTH-001')
    assert.equal(parsed.warnings.length, 1)
    assert.ok(parsed.warnings[0].includes('已改为首条记录'), parsed.warnings.join(' | '))
  })
})

describe('parseIntakeBackup 拒绝非法备份', () => {
  test('不是 JSON', () => {
    assertRejected(parseIntakeBackup('这不是 JSON {'), '不是有效的 JSON')
  })

  test('缺少 app 标识', () => {
    assertRejected(parseMutated((backup) => {
      delete backup.app
    }), '格式或版本不受支持')
  })

  test('缺少 kind 标识', () => {
    assertRejected(parseMutated((backup) => {
      delete backup.kind
    }), '格式或版本不受支持')
  })

  test('schemaVersion 不是 1', () => {
    assertRejected(parseMutated((backup) => {
      backup.schemaVersion = 2
    }), '格式或版本不受支持')
  })

  test('包含未知顶层字段', () => {
    assertRejected(parseMutated((backup) => {
      backup.unexpectedField = true
    }), '格式或版本不受支持')
  })

  test('cases 为空数组', () => {
    assertRejected(parseMutated((backup) => {
      backup.cases = []
    }), '1 至 1000')
  })

  test('事件结构非法（未知事件类型）', () => {
    assertRejected(parseMutated((backup) => {
      backup.cases[0].events[0].kind = 'not-a-real-kind'
    }), '字段缺失或类型错误')
  })

  test('事件带了不该有的高风险交接字段', () => {
    assertRejected(parseMutated((backup) => {
      backup.cases[0].events[0].handoffOutcome = 'accepted'
    }), '字段缺失或类型错误')
  })

  test('记录编号重复', () => {
    assertRejected(parseMutated((backup) => {
      backup.cases[1].id = backup.cases[0].id
    }), '记录编号重复')
  })

  test('记录状态与时间线不一致（结构合法但业务自洽校验失败）', () => {
    assertRejected(parseMutated((backup) => {
      backup.cases[3].status = '已拒绝'
    }), '记录状态必须与时间线最后状态一致')
  })

  test('投诉关联了不存在的记录', () => {
    assertRejected(parseMutated((backup) => {
      backup.complaints[0].caseId = 'SYNTH-404'
    }), '投诉记录关联的演练记录不存在')
  })
})

describe('serializeIntakeBackup 的边界', () => {
  test('空记录列表抛 RangeError', () => {
    assert.throws(() => serializeIntakeBackup([], null), RangeError)
    assert.throws(() => serializeIntakeBackup([], null), /1 至 1000/)
  })

  test('超过记录上限抛 RangeError', () => {
    const tooManyCases = Array.from({ length: 1001 }, (_, index) => ({
      ...syntheticOpenOverdueCase,
      id: `SYNTH-BULK-${index}`,
    }))
    assert.throws(() => serializeIntakeBackup(tooManyCases, null), RangeError)
    assert.throws(() => serializeIntakeBackup(tooManyCases, null), /1 至 1000/)
  })

  test('超过投诉上限抛 RangeError', () => {
    const tooManyComplaints = Array.from({ length: 1001 }, (_, index) => ({
      ...syntheticComplaint,
      id: `SYNTH-BULK-C-${index}`,
    }))
    assert.throws(
      () => serializeIntakeBackup([syntheticOpenOverdueCase], null, false, tooManyComplaints),
      RangeError,
    )
  })
})

describe('社区订单事件上限契约', () => {
  test('ORDER_EVENT_LIMIT 必须为 100', () => {
    assert.equal(ORDER_EVENT_LIMIT, 100)
  })
})
