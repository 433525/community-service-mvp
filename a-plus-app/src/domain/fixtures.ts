// Synthetic fixtures only. 演练-* labels and codes are placeholders; no real people,
// contacts, locations, or health/child details are represented.

import {
  DEFAULT_SERVICE_TYPE,
  DEFAULT_SYNTHETIC_SOURCE_CHANNEL,
  type IntakeAction,
  type IntakeCase,
  type IntakeEvent,
  type IntakeReasonCode,
  type IntakeStatus,
} from './intake'

export const SYNTHETIC_NOW = '2026-10-20T08:00:00.000Z'

function createdEvent(
  id: string,
  at: string,
  status: IntakeStatus,
  note: string,
): IntakeEvent {
  return {
    id,
    at,
    kind: 'created',
    actorRole: 'demo-intake',
    action: null,
    fromStatus: null,
    toStatus: status,
    reasonCode: null,
    note,
  }
}

function statusEvent(
  id: string,
  at: string,
  action: IntakeAction,
  fromStatus: IntakeStatus,
  toStatus: IntakeStatus,
  note: string,
  reasonCode: IntakeReasonCode | null = null,
): IntakeEvent {
  return {
    id,
    at,
    kind: 'status-change',
    actorRole: 'demo-intake',
    action,
    fromStatus,
    toStatus,
    reasonCode,
    note,
  }
}

function flagEvent(
  id: string,
  at: string,
  kind: 'risk-flag' | 'timeout',
  status: IntakeStatus,
  note: string,
): IntakeEvent {
  return {
    id,
    at,
    kind,
    actorRole: null,
    action: null,
    fromStatus: status,
    toStatus: status,
    reasonCode: null,
    note,
  }
}

export const syntheticOpenOverdueCase: IntakeCase = {
  id: 'SYNTH-001',
  label: '演练-001',
  summary: '演练摘要：一般性咨询的模拟登记，当前处于常规初筛阶段。',
  serviceType: DEFAULT_SERVICE_TYPE,
  sourceChannel: DEFAULT_SYNTHETIC_SOURCE_CHANNEL,
  status: '初筛中',
  riskFlags: [
    {
      code: 'OVERDUE',
      label: '演练已逾期',
      severity: 'attention',
      note: '仅标记演练待办逾期；不自动联系或关闭。',
      raisedAt: '2026-10-20T02:00:00.000Z',
    },
  ],
  owner: '演练-受理席-01',
  nextStep: '完成常规初筛并记录分流依据',
  dueAt: '2026-10-18T09:00:00.000Z',
  createdAt: '2026-10-17T01:00:00.000Z',
  updatedAt: '2026-10-20T02:00:00.000Z',
  events: [
    createdEvent(
      'SYNTH-001-E1',
      '2026-10-17T01:00:00.000Z',
      '已收件',
      '演练记录创建（合成数据）。',
    ),
    statusEvent(
      'SYNTH-001-E2',
      '2026-10-17T02:00:00.000Z',
      'BEGIN_SCREENING',
      '已收件',
      '初筛中',
      '开始常规初筛。',
    ),
    flagEvent(
      'SYNTH-001-E3',
      '2026-10-20T02:00:00.000Z',
      'timeout',
      '初筛中',
      '超时检查仅添加逾期标记；状态未改变，也未自动联系或关闭。',
    ),
  ],
}

export const syntheticWaitingForMoreInfoCase: IntakeCase = {
  id: 'SYNTH-002',
  label: '演练-002',
  summary: '演练摘要：模拟登记信息不完整，等待补充材料。',
  serviceType: DEFAULT_SERVICE_TYPE,
  sourceChannel: 'community-entry-local',
  status: '待补充',
  riskFlags: [
    {
      code: 'MISSING_INFORMATION',
      label: '等待补充信息',
      severity: 'attention',
      note: '常规初筛暂停，等待模拟材料补充。',
      raisedAt: '2026-10-18T03:00:00.000Z',
    },
  ],
  owner: '演练-受理席-02',
  nextStep: '复核演练补充材料 演练-补充-02',
  dueAt: '2026-10-24T09:00:00.000Z',
  createdAt: '2026-10-18T01:00:00.000Z',
  updatedAt: '2026-10-18T03:00:00.000Z',
  events: [
    createdEvent(
      'SYNTH-002-E1',
      '2026-10-18T01:00:00.000Z',
      '已收件',
      '演练记录创建（合成数据）。',
    ),
    statusEvent(
      'SYNTH-002-E2',
      '2026-10-18T02:00:00.000Z',
      'BEGIN_SCREENING',
      '已收件',
      '初筛中',
      '开始常规初筛。',
    ),
    statusEvent(
      'SYNTH-002-E3',
      '2026-10-18T03:00:00.000Z',
      'REQUEST_INFORMATION',
      '初筛中',
      '待补充',
      '模拟材料不足，等待补充。',
      'INFO_INSUFFICIENT',
    ),
  ],
}

export const syntheticReferralPendingCase: IntakeCase = {
  id: 'SYNTH-003',
  label: '演练-003',
  summary: '演练摘要：模拟完成内部转介登记，等待外部接收确认。',
  serviceType: DEFAULT_SERVICE_TYPE,
  sourceChannel: 'other-fictional',
  status: '已转介待确认',
  riskFlags: [
    {
      code: 'EXTERNAL_CONFIRMATION_PENDING',
      label: '等待外部确认',
      severity: 'attention',
      note: '仅等待确认，不代表已接收或已提供服务。',
      raisedAt: '2026-10-19T04:00:00.000Z',
    },
  ],
  owner: '演练-转介席-03',
  nextStep: '等待演练外部对接码 演练-转介-03 的接收确认',
  dueAt: '2026-10-26T09:00:00.000Z',
  createdAt: '2026-10-19T01:00:00.000Z',
  updatedAt: '2026-10-19T04:00:00.000Z',
  events: [
    createdEvent(
      'SYNTH-003-E1',
      '2026-10-19T01:00:00.000Z',
      '已收件',
      '演练记录创建（合成数据）。',
    ),
    statusEvent(
      'SYNTH-003-E2',
      '2026-10-19T02:00:00.000Z',
      'BEGIN_SCREENING',
      '已收件',
      '初筛中',
      '开始常规初筛。',
    ),
    statusEvent(
      'SYNTH-003-E3',
      '2026-10-19T03:00:00.000Z',
      'ACCEPT_FOR_TRIAGE',
      '初筛中',
      '已受理待分诊',
      '常规初筛完成，转入待分诊。',
    ),
    statusEvent(
      'SYNTH-003-E4',
      '2026-10-19T04:00:00.000Z',
      'REFER',
      '已受理待分诊',
      '已转介待确认',
      '登记模拟外部转介，等待接收确认。',
    ),
  ],
}

export const syntheticClosedInformationalCase: IntakeCase = {
  id: 'SYNTH-004',
  label: '演练-004',
  summary: '演练摘要：仅提供公开信息，未进入服务履行。',
  serviceType: DEFAULT_SERVICE_TYPE,
  sourceChannel: DEFAULT_SYNTHETIC_SOURCE_CHANNEL,
  status: '已提供信息',
  riskFlags: [],
  owner: null,
  nextStep: null,
  dueAt: null,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T02:00:00.000Z',
  events: [
    createdEvent(
      'SYNTH-004-E1',
      '2026-10-14T01:00:00.000Z',
      '已收件',
      '演练记录创建（合成数据）。',
    ),
    statusEvent(
      'SYNTH-004-E2',
      '2026-10-14T02:00:00.000Z',
      'PROVIDE_INFORMATION',
      '已收件',
      '已提供信息',
      '已提供公开信息，未进入服务履行。',
      'INFORMATION_PROVIDED',
    ),
  ],
}

export const syntheticHighRiskStopScreeningCase: IntakeCase = {
  id: 'SYNTH-005',
  label: '演练-005',
  summary: '演练摘要：触发高风险停止初筛标记的模拟记录，等待人工按外部流程处理。',
  serviceType: DEFAULT_SERVICE_TYPE,
  sourceChannel: 'community-entry-local',
  status: '初筛中',
  riskFlags: [
    {
      code: 'HIGH_RISK_STOP_SCREENING',
      label: '高风险：停止常规初筛',
      severity: 'high',
      note: '仅标记停止常规初筛；原型不发送紧急通知，也不代表已联系外部或已派发救援。',
      raisedAt: '2026-10-20T01:00:00.000Z',
    },
  ],
  owner: '演练-受理席-05',
  nextStep: '停止常规初筛；按机构已批准的外部升级流程进行人工处置（原型不发送通知）',
  dueAt: '2026-10-21T09:00:00.000Z',
  createdAt: '2026-10-20T00:30:00.000Z',
  updatedAt: '2026-10-20T01:00:00.000Z',
  events: [
    createdEvent(
      'SYNTH-005-E1',
      '2026-10-20T00:30:00.000Z',
      '已收件',
      '演练记录创建（合成数据）。',
    ),
    statusEvent(
      'SYNTH-005-E2',
      '2026-10-20T00:45:00.000Z',
      'BEGIN_SCREENING',
      '已收件',
      '初筛中',
      '开始常规初筛。',
    ),
    flagEvent(
      'SYNTH-005-E3',
      '2026-10-20T01:00:00.000Z',
      'risk-flag',
      '初筛中',
      '新增高风险停止初筛标记；未执行任何通知、联系或派发。',
    ),
  ],
}

export const syntheticIntakeCases: readonly IntakeCase[] = [
  syntheticOpenOverdueCase,
  syntheticWaitingForMoreInfoCase,
  syntheticReferralPendingCase,
  syntheticClosedInformationalCase,
  syntheticHighRiskStopScreeningCase,
]
