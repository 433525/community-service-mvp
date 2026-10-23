// A+ A+ 受理领域纯函数单测（状态机）。
//
// 运行：npm run test:unit
// 依赖：Node 内置 node:test + node:assert/strict，直接跑 src/**/*.ts（--experimental-strip-types）。
// 数据：只用 src/domain/fixtures.ts 的合成种子或本文件内构造的合成对象，不含任何真实个人信息。
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  HIGH_RISK_STOP_SCREENING_NOTICE,
  applyIntakeAction,
  findIntakeDuplicateCandidates,
  getAllowedIntakeActions,
  getIntakeActionTarget,
  isIntakeOverdue,
  isOpenIntakeStatus,
  normalizeDuplicateText,
  validateIntakeAction,
  validateIntakeCase,
} from '../../src/domain/intake.ts'
import {
  syntheticClosedInformationalCase,
  syntheticHighRiskStopScreeningCase,
  syntheticIntakeCases,
  syntheticOpenOverdueCase,
  syntheticReferralPendingCase,
  syntheticWaitingForMoreInfoCase,
} from '../../src/domain/fixtures.ts'

// 种子的登记检查点仍为“未知”，常规动作会被检查点门槛拦下。
// 这里给种子追加一条检查点更新事件，得到“同意已确认 + 必填信息完整”的记录，
// 用于测试动作本身的状态机行为，而不是测试门槛。
function withConfirmedCheckpoint(source, at) {
  const checkpointEvent = {
    id: `${source.id}-CP-TEST-1`,
    at,
    kind: 'checkpoint-update',
    actorRole: 'demo-intake',
    action: null,
    fromStatus: source.status,
    toStatus: source.status,
    reasonCode: null,
    note: '登记检查点更新（测试构造的合成数据）。',
    consentStatus: 'confirmed',
    requiredInfoComplete: true,
  }
  return {
    ...source,
    consentStatus: 'confirmed',
    requiredInfoComplete: true,
    updatedAt: at,
    events: [...source.events, checkpointEvent],
  }
}

// SYNTH-001（初筛中）→ 检查点已确认，可直接测试初筛相关动作。
const screeningReadyCase = withConfirmedCheckpoint(syntheticOpenOverdueCase, '2026-10-20T05:00:00.000Z')

// SYNTH-002（待补充）→ 检查点已确认。
const waitingReadyCase = withConfirmedCheckpoint(
  syntheticWaitingForMoreInfoCase,
  '2026-10-18T05:00:00.000Z',
)

// SYNTH-003 截断到“已受理待分诊”，用于测试 REFER 动作。
const triageReadyCase = withConfirmedCheckpoint(
  {
    ...syntheticReferralPendingCase,
    status: '已受理待分诊',
    riskFlags: [],
    updatedAt: '2026-10-19T03:00:00.000Z',
    events: syntheticReferralPendingCase.events.slice(0, 3),
  },
  '2026-10-19T03:30:00.000Z',
)

function errorText(validation) {
  return validation.errors.join(' | ')
}

function assertIncludesError(validation, needle) {
  assert.equal(validation.ok, false, `期望校验失败，实际通过。errors=${errorText(validation)}`)
  assert.ok(
    validation.errors.some((message) => message.includes(needle)),
    `期望错误信息包含“${needle}”，实际：${errorText(validation)}`,
  )
}

describe('isOpenIntakeStatus', () => {
  test('开放状态返回 true', () => {
    for (const status of ['已收件', '初筛中', '待补充', '已转介已接收']) {
      assert.equal(isOpenIntakeStatus(status), true, `${status} 应视为开放`)
    }
  })

  test('结束状态返回 false', () => {
    for (const status of ['已拒绝', '已撤回', '已关闭（未提供服务）', '已结束（服务结果未核实）', '已提供信息']) {
      assert.equal(isOpenIntakeStatus(status), false, `${status} 应视为已结束`)
    }
  })
})

describe('getAllowedIntakeActions', () => {
  test('已收件只允许开工与直接结束类动作', () => {
    const actions = getAllowedIntakeActions('已收件')
    assert.ok(actions.includes('BEGIN_SCREENING'))
    assert.ok(actions.includes('PROVIDE_INFORMATION'))
    assert.ok(actions.includes('REJECT'))
    assert.ok(actions.includes('WITHDRAW'))
    assert.equal(actions.includes('ACCEPT_FOR_TRIAGE'), false, '已收件不能直接进入待分诊')
    assert.equal(actions.includes('REFER'), false, '已收件不能直接转介')
    assert.equal(actions.includes('CONFIRM_REFERRAL'), false, '已收件没有待确认转介可确认')
  })

  test('已受理待分诊允许转介与高风险交接，不再允许重新开工', () => {
    const actions = getAllowedIntakeActions('已受理待分诊')
    assert.ok(actions.includes('REFER'))
    assert.ok(actions.includes('RECORD_HIGH_RISK_HANDOFF'))
    assert.ok(actions.includes('CLOSE_FOLLOW_UP'))
    assert.equal(actions.includes('BEGIN_SCREENING'), false)
    assert.equal(actions.includes('RESUME_SCREENING'), false)
  })

  test('已提供信息只保留“转入待分诊”这一条前进路径', () => {
    const actions = getAllowedIntakeActions('已提供信息')
    assert.deepEqual(actions, ['ACCEPT_FOR_TRIAGE'])
  })

  test('已结束状态没有任何动作', () => {
    assert.deepEqual(getAllowedIntakeActions('已拒绝'), [])
    assert.deepEqual(getAllowedIntakeActions('已关闭（未提供服务）'), [])
  })
})

describe('getIntakeActionTarget', () => {
  test('有目标状态的动作直接给出目标状态', () => {
    assert.equal(getIntakeActionTarget('BEGIN_SCREENING'), '初筛中')
    assert.equal(getIntakeActionTarget('REQUEST_INFORMATION'), '待补充')
    assert.equal(getIntakeActionTarget('ACCEPT_FOR_TRIAGE', '已提供信息'), '已受理待分诊')
    assert.equal(getIntakeActionTarget('REFERRAL_FAILED'), '已受理待分诊')
    assert.equal(getIntakeActionTarget('CLOSE_FOLLOW_UP'), '已结束（服务结果未核实）')
  })

  test('高风险交接不改变状态，需传入当前状态', () => {
    assert.equal(getIntakeActionTarget('RECORD_HIGH_RISK_HANDOFF', '已转介待确认'), '已转介待确认')
    assert.throws(
      () => getIntakeActionTarget('RECORD_HIGH_RISK_HANDOFF'),
      /不改变状态/,
      '缺少当前状态时应抛出明确错误',
    )
  })
})

describe('validateIntakeAction', () => {
  test('合法动作通过校验', () => {
    const validation = validateIntakeAction({
      case: screeningReadyCase,
      action: 'REQUEST_INFORMATION',
      at: '2026-10-20T09:00:00.000Z',
      actorRole: 'demo-intake',
      reasonCode: 'INFO_INSUFFICIENT',
      note: '合成演练：材料不足，请求补充。',
    })
    assert.deepEqual(validation.errors, [])
    assert.equal(validation.ok, true)
  })

  test('带转介对象与依据的 REFER 通过校验', () => {
    const validation = validateIntakeAction({
      case: triageReadyCase,
      action: 'REFER',
      at: '2026-10-19T09:00:00.000Z',
      actorRole: 'demo-referral',
      referralTarget: '演练-虚构机构-01',
      note: '合成演练：按演练口径转介。',
    })
    assert.deepEqual(validation.errors, [])
    assert.equal(validation.ok, true)
  })

  test('当前状态不允许的动作被拒绝', () => {
    const validation = validateIntakeAction({
      case: waitingReadyCase,
      action: 'BEGIN_SCREENING',
      at: '2026-10-18T09:00:00.000Z',
      actorRole: 'demo-intake',
    })
    assertIncludesError(validation, '不允许动作 BEGIN_SCREENING')
  })

  test('动作时间早于记录更新时间被拒绝', () => {
    const validation = validateIntakeAction({
      case: screeningReadyCase,
      action: 'REQUEST_INFORMATION',
      at: '2026-10-20T00:00:00.000Z',
      actorRole: 'demo-intake',
      reasonCode: 'INFO_INSUFFICIENT',
      note: '合成演练：时间早于更新时间。',
    })
    assertIncludesError(validation, '动作时间不能早于记录更新时间')
  })

  test('高风险记录的普通动作被阻止并给出高风险提示', () => {
    const validation = validateIntakeAction({
      case: syntheticHighRiskStopScreeningCase,
      action: 'ACCEPT_FOR_TRIAGE',
      at: '2026-10-20T09:00:00.000Z',
      actorRole: 'demo-intake',
    })
    assertIncludesError(validation, '高风险')
    assert.ok(
      validation.errors.includes(HIGH_RISK_STOP_SCREENING_NOTICE),
      `应原样带上高风险停止通知，实际：${errorText(validation)}`,
    )
  })

  test('无高风险标记的记录不能登记人工交接结果', () => {
    const validation = validateIntakeAction({
      case: screeningReadyCase,
      action: 'RECORD_HIGH_RISK_HANDOFF',
      at: '2026-10-20T09:00:00.000Z',
      actorRole: 'demo-review',
      note: '合成演练：无标记却尝试登记交接。',
      handoffOutcome: 'accepted',
      handoffOwner: '演练-人工交接-01',
    })
    assertIncludesError(validation, 'HIGH_RISK_STOP_SCREENING')
  })

  test('REFER 缺少转介对象失败', () => {
    const validation = validateIntakeAction({
      case: triageReadyCase,
      action: 'REFER',
      at: '2026-10-19T09:00:00.000Z',
      actorRole: 'demo-referral',
      note: '合成演练：按演练口径转介。',
    })
    assertIncludesError(validation, '必须填写虚构演练对象')
  })

  test('高风险交接：缺交接结果失败', () => {
    const validation = validateIntakeAction({
      case: syntheticHighRiskStopScreeningCase,
      action: 'RECORD_HIGH_RISK_HANDOFF',
      at: '2026-10-20T09:00:00.000Z',
      actorRole: 'demo-review',
      note: '合成演练：登记人工交接。',
    })
    assertIncludesError(validation, '请选择本次演练人工交接结果')
  })

  test('高风险交接：有人接手但缺接手人失败', () => {
    const validation = validateIntakeAction({
      case: syntheticHighRiskStopScreeningCase,
      action: 'RECORD_HIGH_RISK_HANDOFF',
      at: '2026-10-20T09:00:00.000Z',
      actorRole: 'demo-review',
      note: '合成演练：登记人工交接。',
      handoffOutcome: 'accepted',
    })
    assertIncludesError(validation, '必须填写虚构接手人')
  })

  test('高风险交接：暂无人接手却填了接手人失败', () => {
    const validation = validateIntakeAction({
      case: syntheticHighRiskStopScreeningCase,
      action: 'RECORD_HIGH_RISK_HANDOFF',
      at: '2026-10-20T09:00:00.000Z',
      actorRole: 'demo-review',
      note: '合成演练：登记人工交接。',
      handoffOutcome: 'not-accepted',
      handoffOwner: '演练-人工交接-02',
    })
    assertIncludesError(validation, '不能填写接手人')
  })

  test('高风险交接：结果与接手人匹配时通过', () => {
    const validation = validateIntakeAction({
      case: syntheticHighRiskStopScreeningCase,
      action: 'RECORD_HIGH_RISK_HANDOFF',
      at: '2026-10-20T09:00:00.000Z',
      actorRole: 'demo-review',
      note: '合成演练：登记人工交接。',
      handoffOutcome: 'accepted',
      handoffOwner: '演练-人工交接-01',
    })
    assert.deepEqual(validation.errors, [])
    assert.equal(validation.ok, true)
  })
})

describe('applyIntakeAction', () => {
  test('不改原对象，新记录状态与事件正确', () => {
    const before = JSON.stringify(screeningReadyCase)
    const eventCount = screeningReadyCase.events.length

    const result = applyIntakeAction({
      case: screeningReadyCase,
      action: 'REQUEST_INFORMATION',
      at: '2026-10-20T09:00:00.000Z',
      actorRole: 'demo-intake',
      reasonCode: 'INFO_INSUFFICIENT',
      note: '合成演练：材料不足，请求补充。',
    })

    assert.equal(result.ok, true, errorText(result))
    const nextCase = result.nextCase
    assert.ok(nextCase)

    // 原对象不可变
    assert.equal(JSON.stringify(screeningReadyCase), before, '原记录被就地修改')
    assert.equal(screeningReadyCase.events.length, eventCount)
    assert.equal(screeningReadyCase.status, '初筛中')

    // 新记录
    assert.equal(nextCase.status, '待补充')
    assert.equal(nextCase.events.length, eventCount + 1)
    assert.notEqual(nextCase, screeningReadyCase)
    assert.notEqual(nextCase.events, screeningReadyCase.events)
    assert.equal(nextCase.updatedAt, '2026-10-20T09:00:00.000Z')

    const lastEvent = nextCase.events[nextCase.events.length - 1]
    assert.equal(lastEvent.kind, 'status-change')
    assert.equal(lastEvent.action, 'REQUEST_INFORMATION')
    assert.equal(lastEvent.fromStatus, '初筛中')
    assert.equal(lastEvent.toStatus, '待补充')
    assert.equal(lastEvent.reasonCode, 'INFO_INSUFFICIENT')
    assert.equal(lastEvent.id, `${screeningReadyCase.id}-EVT-${eventCount + 1}`)

    // 待补充状态自动补齐 MISSING_INFORMATION 标记
    assert.ok(nextCase.riskFlags.some((flag) => flag.code === 'MISSING_INFORMATION'))
    // 新记录本身必须仍然自洽
    assert.deepEqual(validateIntakeCase(nextCase).errors, [])
  })

  test('失败时返回 ok:false、nextCase 为 null，且原对象不变', () => {
    const before = JSON.stringify(screeningReadyCase)

    const result = applyIntakeAction({
      case: screeningReadyCase,
      action: 'REFER',
      at: '2026-10-20T09:00:00.000Z',
      actorRole: 'demo-referral',
      referralTarget: '演练-虚构机构-01',
      note: '合成演练：不合法的转介。',
    })

    assert.equal(result.ok, false)
    assert.equal(result.nextCase, null)
    assert.ok(result.errors.length > 0, '失败时必须给出错误信息')
    assert.equal(JSON.stringify(screeningReadyCase), before, '失败路径不应修改原记录')
  })
})

describe('isIntakeOverdue', () => {
  test('未到期返回 false', () => {
    assert.equal(isIntakeOverdue(syntheticWaitingForMoreInfoCase, '2026-10-20T08:00:00.000Z'), false)
  })

  test('已到期返回 true', () => {
    assert.equal(isIntakeOverdue(syntheticOpenOverdueCase, '2026-10-20T08:00:00.000Z'), true)
  })

  test('已结束记录即使有截止时间也不算逾期', () => {
    assert.equal(
      isIntakeOverdue({ ...syntheticOpenOverdueCase, status: '已拒绝', owner: null, nextStep: null }, '2027-01-01T00:00:00.000Z'),
      false,
    )
  })
})

describe('重复候选匹配', () => {
  test('normalizeDuplicateText 去首尾空白、折叠空白、忽略大小写', () => {
    assert.equal(normalizeDuplicateText('  演练-001  '), '演练-001')
    assert.equal(normalizeDuplicateText('  ABC   Def  '), 'abc def')
    assert.equal(normalizeDuplicateText('\t演练\n摘要 '), '演练 摘要')
  })

  test('标签命中（含额外空白与大小写差异）', () => {
    const duplicateCase = {
      ...syntheticClosedInformationalCase,
      id: 'SYNTH-TEST-DUP',
      label: '  Duplicate   Sample  ',
      summary: '  Same   Summary  ',
    }
    const hits = findIntakeDuplicateCandidates([...syntheticIntakeCases, duplicateCase], {
      label: 'duplicate sample',
      summary: '与其他记录完全不同的摘要',
    })
    assert.deepEqual(hits.map((item) => item.id), ['SYNTH-TEST-DUP'])
  })

  test('摘要命中（仅摘要相同）', () => {
    const hits = findIntakeDuplicateCandidates(syntheticIntakeCases, {
      label: '演练-999',
      summary: `  ${syntheticWaitingForMoreInfoCase.summary}  `,
    })
    assert.deepEqual(hits.map((item) => item.id), ['SYNTH-002'])
  })

  test('标签与摘要都不同则不命中', () => {
    const hits = findIntakeDuplicateCandidates(syntheticIntakeCases, {
      label: '演练-404',
      summary: '合成演练：不存在的摘要文本。',
    })
    assert.deepEqual(hits, [])
  })

  test('空输入不会匹配所有记录', () => {
    assert.deepEqual(findIntakeDuplicateCandidates(syntheticIntakeCases, { label: '   ', summary: '' }), [])
  })
})

describe('validateIntakeCase', () => {
  test('全部合成种子通过校验', () => {
    for (const intakeCase of syntheticIntakeCases) {
      const validation = validateIntakeCase(intakeCase)
      assert.deepEqual(validation.errors, [], `${intakeCase.id} 校验失败：${errorText(validation)}`)
      assert.equal(validation.ok, true)
    }
  })

  test('缺少必填字段与非法状态时失败', () => {
    const broken = {
      ...syntheticClosedInformationalCase,
      id: 'SYNTH-BROKEN',
      label: '   ',
      status: '不存在的状态',
    }
    const validation = validateIntakeCase(broken)
    assert.equal(validation.ok, false)
    assertIncludesError(validation, '记录缺少演练标签')
    assertIncludesError(validation, '记录状态必须与时间线最后状态一致')
  })

  test('已结束记录不需要负责人等开放字段', () => {
    const validation = validateIntakeCase(syntheticClosedInformationalCase)
    assert.equal(validation.ok, true)
    assert.equal(syntheticClosedInformationalCase.owner, null)
    assert.equal(syntheticClosedInformationalCase.nextStep, null)
    assert.equal(syntheticClosedInformationalCase.dueAt, null)
  })
})
