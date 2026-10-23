// Pure, API-independent A+ intake domain for the synthetic local prototype.
// No network, persistence, contact, dispatch, or emergency notification code lives here.

export const DEFAULT_SERVICE_TYPE = '待判定/未分类'

/** 仅用于合成演练的来源标记；不创建或连接任何真实受理渠道。 */
export const SYNTHETIC_SOURCE_CHANNELS = [
  { value: 'manual-entry', label: '人工录入演练' },
  { value: 'community-entry-local', label: '社区入口演练（仅本机）' },
  { value: 'other-fictional', label: '其他虚构来源' },
] as const

export type SyntheticSourceChannel = (typeof SYNTHETIC_SOURCE_CHANNELS)[number]['value']

export const DEFAULT_SYNTHETIC_SOURCE_CHANNEL: SyntheticSourceChannel = 'manual-entry'
export const MISSING_SYNTHETIC_SOURCE_LABEL = '历史来源未记录'

export function isSyntheticSourceChannel(value: unknown): value is SyntheticSourceChannel {
  return SYNTHETIC_SOURCE_CHANNELS.some((channel) => channel.value === value)
}

export function getSyntheticSourceChannelLabel(
  value: SyntheticSourceChannel | null | undefined,
): string {
  return SYNTHETIC_SOURCE_CHANNELS.find((channel) => channel.value === value)?.label
    ?? MISSING_SYNTHETIC_SOURCE_LABEL
}

export const INTAKE_STATUSES = [
  '已收件',
  '初筛中',
  '待补充',
  '已受理待分诊',
  '已转介待确认',
  '已转介已接收',
  '已拒绝',
  '已撤回',
  '已关闭（未提供服务）',
  '已结束（服务结果未核实）',
  '已提供信息',
] as const

export type IntakeStatus = (typeof INTAKE_STATUSES)[number]

export const OPEN_INTAKE_STATUSES = [
  '已收件',
  '初筛中',
  '待补充',
  '已受理待分诊',
  '已转介待确认',
  '已转介已接收',
] as const

export function isOpenIntakeStatus(status: IntakeStatus): boolean {
  return OPEN_INTAKE_STATUSES.some((openStatus) => openStatus === status)
}

export const RISK_FLAG_CODES = [
  'HIGH_RISK_STOP_SCREENING',
  'OVERDUE',
  'MISSING_INFORMATION',
  'EXTERNAL_CONFIRMATION_PENDING',
] as const

export type RiskFlagCode = (typeof RISK_FLAG_CODES)[number]

export interface RiskFlag {
  readonly code: RiskFlagCode
  readonly label: string
  readonly severity: 'high' | 'attention' | 'info'
  readonly note: string
  readonly raisedAt: string
}

/** Illustrative demo roles only. No role/permission mapping or authorization is configured here. */
export const DEMO_ROLES = ['demo-intake', 'demo-review', 'demo-referral'] as const

export type DemoRole = (typeof DEMO_ROLES)[number]

export function isDemoRole(value: unknown): value is DemoRole {
  return DEMO_ROLES.some((role) => role === value)
}

/** 合成演练登记检查点；不是真实法律同意、身份核验或授权记录。 */
export const CONSENT_STATUSES = [
  { value: 'unknown', label: '未登记 / 未知（演练）' },
  { value: 'confirmed', label: '已确认（合成演练）' },
  { value: 'declined', label: '已拒绝（合成演练）' },
] as const

export type ConsentStatus = (typeof CONSENT_STATUSES)[number]['value']

export function isConsentStatus(value: unknown): value is ConsentStatus {
  return CONSENT_STATUSES.some((item) => item.value === value)
}

export function getConsentStatusLabel(value: ConsentStatus | null | undefined): string {
  return CONSENT_STATUSES.find((item) => item.value === (value ?? 'unknown'))?.label
    ?? CONSENT_STATUSES[0].label
}

export function getCaseConsentStatus(intakeCase: Pick<IntakeCase, 'consentStatus'>): ConsentStatus {
  return intakeCase.consentStatus ?? 'unknown'
}

export function isCaseRequiredInfoComplete(
  intakeCase: Pick<IntakeCase, 'requiredInfoComplete'>,
): boolean {
  return intakeCase.requiredInfoComplete === true
}

export function isCaseCheckpointReady(
  intakeCase: Pick<IntakeCase, 'consentStatus' | 'requiredInfoComplete'>,
): boolean {
  return getCaseConsentStatus(intakeCase) === 'confirmed'
    && isCaseRequiredInfoComplete(intakeCase)
}

export const CHECKPOINT_SYNTHETIC_NOTICE =
  '登记检查点只用于本机合成演练，是虚构流程字段，不构成真实法律同意、身份核验或服务授权。'

export const CONSENT_REQUIRED_NOTICE =
  '演练同意状态尚未确认为“已确认”：开始初筛、请求或恢复信息补充、接单、转介、跟进、模拟联系及记录已提供信息前，必须先更新检查点。此字段只控制本机合成演练，不代表真实法律同意或服务授权。'

export const CHECKPOINT_REQUIRED_NOTICE =
  '必填信息尚未标记完整：普通接单、转介、跟进或模拟联系前，必须先更新登记检查点。高风险停止与人工交接通道不受此限制。'

export function getCaseCheckpointBlockedReason(
  intakeCase: Pick<IntakeCase, 'consentStatus' | 'requiredInfoComplete'>,
): string | null {
  if (getCaseConsentStatus(intakeCase) !== 'confirmed') return CONSENT_REQUIRED_NOTICE
  if (!isCaseRequiredInfoComplete(intakeCase)) return CHECKPOINT_REQUIRED_NOTICE
  return null
}

/** 常规服务流程需要演练同意确认；安全退出和高风险人工交接不受此门槛限制。 */
export const CONSENT_REQUIRED_ACTIONS = [
  'BEGIN_SCREENING',
  'REQUEST_INFORMATION',
  'RESUME_SCREENING',
  'ACCEPT_FOR_TRIAGE',
  'REFER',
  'CONFIRM_REFERRAL',
  'REFERRAL_FAILED',
  'CLOSE_FOLLOW_UP',
  'PROVIDE_INFORMATION',
] as const

/** 需要登记检查点的普通流程动作；高风险停止与人工交接永不在此列表中。 */
export const CHECKPOINT_REQUIRED_ACTIONS = [
  'ACCEPT_FOR_TRIAGE',
  'REFER',
  'CONFIRM_REFERRAL',
  'REFERRAL_FAILED',
  'CLOSE_FOLLOW_UP',
] as const

export function intakeActionRequiresCheckpoint(action: IntakeAction): boolean {
  return CHECKPOINT_REQUIRED_ACTIONS.some((item) => item === action)
}

export function intakeActionRequiresConsent(action: IntakeAction): boolean {
  return CONSENT_REQUIRED_ACTIONS.some((item) => item === action)
}

export function getIntakeActionBlockedReason(
  action: IntakeAction,
  intakeCase: Pick<IntakeCase, 'consentStatus' | 'requiredInfoComplete'>,
): string | null {
  if (intakeActionRequiresConsent(action) && getCaseConsentStatus(intakeCase) !== 'confirmed') {
    return CONSENT_REQUIRED_NOTICE
  }
  if (intakeActionRequiresCheckpoint(action) && !isCaseRequiredInfoComplete(intakeCase)) {
    return CHECKPOINT_REQUIRED_NOTICE
  }
  return null
}

export const INTAKE_REASON_CODES = [
  'INFO_INSUFFICIENT',
  'OUT_OF_SCOPE',
  'DUPLICATE',
  'REQUESTER_WITHDREW',
  'NO_SERVICE_PATH',
  'INFORMATION_PROVIDED',
  'REFERRAL_DECLINED',
  'FOLLOW_UP_CONCLUDED',
  'OTHER',
] as const

export type IntakeReasonCode = (typeof INTAKE_REASON_CODES)[number]

export const CONTACT_SIMULATION_OUTCOMES = [
  { value: 'not-reached', label: '未接通（模拟）' },
  { value: 'reached-follow-up-needed', label: '已接通，待跟进（模拟）' },
  { value: 'reschedule', label: '约定稍后再联系（模拟）' },
] as const

export type ContactSimulationOutcome = (typeof CONTACT_SIMULATION_OUTCOMES)[number]['value']

export function getContactSimulationOutcomeLabel(outcome: ContactSimulationOutcome): string {
  return CONTACT_SIMULATION_OUTCOMES.find((item) => item.value === outcome)?.label ?? '未知模拟结果'
}

export const HIGH_RISK_HANDOFF_OUTCOMES = [
  { value: 'accepted', label: '有人接手' },
  { value: 'not-accepted', label: '暂无人接手' },
] as const

export type HighRiskHandoffOutcome = (typeof HIGH_RISK_HANDOFF_OUTCOMES)[number]['value']

export function getHighRiskHandoffOutcomeLabel(outcome: HighRiskHandoffOutcome): string {
  return HIGH_RISK_HANDOFF_OUTCOMES.find((item) => item.value === outcome)?.label ?? '未知交接结果'
}

export const INTAKE_ACTIONS = [
  'BEGIN_SCREENING',
  'REQUEST_INFORMATION',
  'RESUME_SCREENING',
  'ACCEPT_FOR_TRIAGE',
  'REFER',
  'CONFIRM_REFERRAL',
  'REFERRAL_FAILED',
  'RECORD_HIGH_RISK_HANDOFF',
  'REJECT',
  'WITHDRAW',
  'CLOSE_WITHOUT_SERVICE',
  'CLOSE_FOLLOW_UP',
  'PROVIDE_INFORMATION',
] as const

export type IntakeAction = (typeof INTAKE_ACTIONS)[number]

interface ActionDefinition {
  readonly from: readonly IntakeStatus[]
  /** 省略表示动作保持当前状态，仅追加记录而不做状态流转。 */
  readonly to?: IntakeStatus
  readonly requiresReason: boolean
  readonly requiresNote?: boolean
}

const ACTION_DEFINITIONS: Record<IntakeAction, ActionDefinition> = {
  BEGIN_SCREENING: {
    from: ['已收件'],
    to: '初筛中',
    requiresReason: false,
  },
  REQUEST_INFORMATION: {
    from: ['初筛中'],
    to: '待补充',
    requiresReason: true,
  },
  RESUME_SCREENING: {
    from: ['待补充'],
    to: '初筛中',
    requiresReason: false,
  },
  ACCEPT_FOR_TRIAGE: {
    // 补充信息已记录后，可直接进入待分诊。
    from: ['初筛中', '已提供信息'],
    to: '已受理待分诊',
    requiresReason: false,
  },
  REFER: {
    from: ['已受理待分诊'],
    to: '已转介待确认',
    requiresReason: false,
    requiresNote: true,
  },
  CONFIRM_REFERRAL: {
    from: ['已转介待确认'],
    to: '已转介已接收',
    requiresReason: false,
  },
  // 人工演练专用：仅记录转介失败并回到待分诊，不发送外部通知，不代表真实服务失败。
  REFERRAL_FAILED: {
    from: ['已转介待确认', '已转介已接收'],
    to: '已受理待分诊',
    requiresReason: true,
    requiresNote: true,
  },
  // 人工演练专用：仅登记高风险人工交接结果（有人接手 / 暂无人接手），状态不变，可反复记录，不代表真实升级已完成。
  RECORD_HIGH_RISK_HANDOFF: {
    from: OPEN_INTAKE_STATUSES,
    requiresReason: false,
    requiresNote: true,
  },
  REJECT: {
    from: ['已收件', '初筛中', '待补充', '已受理待分诊', '已转介待确认'],
    to: '已拒绝',
    requiresReason: true,
  },
  WITHDRAW: {
    from: ['已收件', '初筛中', '待补充', '已受理待分诊', '已转介待确认'],
    to: '已撤回',
    requiresReason: true,
  },
  CLOSE_WITHOUT_SERVICE: {
    from: ['已收件', '初筛中', '待补充', '已受理待分诊', '已转介待确认'],
    to: '已关闭（未提供服务）',
    requiresReason: true,
  },
  CLOSE_FOLLOW_UP: {
    from: OPEN_INTAKE_STATUSES,
    to: '已结束（服务结果未核实）',
    requiresReason: true,
    requiresNote: true,
  },
  PROVIDE_INFORMATION: {
    from: ['已收件', '初筛中', '待补充', '已受理待分诊'],
    to: '已提供信息',
    requiresReason: false,
  },
}

export function getAllowedIntakeActions(status: IntakeStatus): IntakeAction[] {
  return INTAKE_ACTIONS.filter((action) => ACTION_DEFINITIONS[action].from.includes(status))
}

export function getIntakeActionTarget(
  action: IntakeAction,
  currentStatus?: IntakeStatus,
): IntakeStatus {
  const target = ACTION_DEFINITIONS[action].to
  if (target != null) return target
  if (currentStatus != null) return currentStatus
  throw new Error(`动作 ${action} 不改变状态，需要提供当前状态才能确定目标状态。`)
}

export function intakeActionRequiresReason(action: IntakeAction): boolean {
  return ACTION_DEFINITIONS[action].requiresReason
}

export interface IntakeEvent {
  readonly id: string
  readonly at: string
  readonly kind:
    | 'created'
    | 'status-change'
    | 'follow-up-update'
    | 'contact-simulation'
    | 'risk-flag'
    | 'risk-handoff'
    | 'case-link'
    | 'duplicate-review'
    | 'checkpoint-update'
    | 'timeout'
  readonly actorRole: DemoRole | null
  readonly action: IntakeAction | null
  readonly fromStatus: IntakeStatus | null
  readonly toStatus: IntakeStatus | null
  readonly reasonCode: IntakeReasonCode | null
  readonly note: string
  readonly contactOutcome?: ContactSimulationOutcome | null
  /** 仅登记检查点更新事件使用；旧备份中的其他事件可缺省。 */
  readonly consentStatus?: ConsentStatus | null
  readonly requiredInfoComplete?: boolean | null
  /** 仅高风险人工交接事件使用；旧 v1 备份中的历史交接事件可缺省。 */
  readonly handoffOutcome?: HighRiskHandoffOutcome | null
  readonly handoffOwner?: string | null
  readonly duplicateCandidateIds?: readonly string[]
  readonly changes?: readonly {
    readonly field: 'owner' | 'nextStep' | 'dueAt'
    readonly label: string
    readonly before: string | null
    readonly after: string | null
  }[]
}

export interface IntakeCase {
  readonly id: string
  readonly label: string
  readonly summary: string
  readonly serviceType: string
  /** 合成来源渠道演练标记；缺少表示旧记录或旧 v1 备份，不自动补写。 */
  readonly sourceChannel?: SyntheticSourceChannel
  /** 可选的社区合成帖子 ID；仅用于本机单向来源识别，缺少表示非社区登记或旧记录。 */
  readonly sourcePostId?: string
  /** 合成演练登记检查点；缺少表示旧数据，按 unknown 解释。不构成真实法律同意。 */
  readonly consentStatus?: ConsentStatus
  /** 合成演练必填信息检查点；缺少表示旧数据，按 false 解释。 */
  readonly requiredInfoComplete?: boolean
  readonly status: IntakeStatus
  readonly riskFlags: readonly RiskFlag[]
  readonly owner: string | null
  readonly nextStep: string | null
  readonly dueAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly events: readonly IntakeEvent[]
  readonly reopenedFromId?: string
  readonly relatedCaseIds?: readonly string[]
}

export interface IntakeValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
}

/** 独立投诉复核记录；不写入 case 风险标记或跟进时间线。 */
export const COMPLAINT_STATUSES = ['待复核', '已复核'] as const

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number]

export const COMPLAINT_REVIEWER_ROLES = ['demo-review', 'demo-referral'] as const

export type ComplaintReviewerRole = (typeof COMPLAINT_REVIEWER_ROLES)[number]

export const COMPLAINT_SYNTHETIC_NOTICE =
  '投诉复核使用演示角色校验，不是真实账号权限、实名举报或正式申诉流程。'

export function isComplaintStatus(value: unknown): value is ComplaintStatus {
  return COMPLAINT_STATUSES.some((status) => status === value)
}

export function isComplaintReviewerRole(value: unknown): value is ComplaintReviewerRole {
  return COMPLAINT_REVIEWER_ROLES.some((role) => role === value)
}

export interface Complaint {
  readonly id: string
  readonly caseId: string
  /** 被投诉的演示角色。 */
  readonly targetRole: DemoRole
  /** 提交投诉的演示角色。 */
  readonly submittedByRole: DemoRole
  readonly description: string
  readonly status: ComplaintStatus
  readonly submittedAt: string
  readonly reviewedAt: string | null
  readonly reviewerRole: DemoRole | null
  readonly resolution: string
}

export interface ComplaintResult {
  readonly ok: boolean
  readonly errors: readonly string[]
  readonly complaint: Complaint | null
}

export function validateComplaint(
  complaint: Complaint,
  knownCaseIds?: readonly string[],
): IntakeValidation {
  const errors: string[] = []

  if (!complaint.id.trim()) errors.push('投诉记录缺少 id。')
  if (!complaint.caseId.trim()) errors.push('投诉记录缺少关联演练记录。')
  if (knownCaseIds && !knownCaseIds.includes(complaint.caseId)) {
    errors.push('投诉记录关联的演练记录不存在。')
  }
  if (!isDemoRole(complaint.targetRole)) errors.push('被投诉的演示角色无效。')
  if (!isDemoRole(complaint.submittedByRole)) errors.push('投诉提交人演示角色无效。')
  if (isDemoRole(complaint.targetRole)
    && isDemoRole(complaint.submittedByRole)
    && complaint.targetRole === complaint.submittedByRole) {
    errors.push('不能针对提交人自己的演示角色提交投诉。')
  }
  if (!complaint.description.trim()) errors.push('请填写投诉说明。')
  if (!isComplaintStatus(complaint.status)) errors.push('投诉状态无效。')
  if (!isTimestamp(complaint.submittedAt)) errors.push('投诉提交时间无效。')

  if (complaint.status === '待复核') {
    if (complaint.reviewedAt !== null) errors.push('待复核投诉不能包含复核时间。')
    if (complaint.reviewerRole !== null) errors.push('待复核投诉不能包含复核人。')
    if (complaint.resolution.trim()) errors.push('待复核投诉不能包含复核处理说明。')
  } else if (complaint.status === '已复核') {
    if (!isTimestamp(complaint.reviewedAt)) {
      errors.push('已复核投诉必须包含有效复核时间。')
    } else if (isTimestamp(complaint.submittedAt)
      && Date.parse(complaint.reviewedAt) < Date.parse(complaint.submittedAt)) {
      errors.push('复核时间不能早于投诉提交时间。')
    }
    if (!isDemoRole(complaint.reviewerRole)) {
      errors.push('已复核投诉必须包含有效复核人演示角色。')
    } else {
      if (!isComplaintReviewerRole(complaint.reviewerRole)) {
        errors.push('只有 demo-review 或 demo-referral 演示角色可以复核投诉。')
      }
      if (complaint.reviewerRole === complaint.submittedByRole) {
        errors.push('投诉提交人不能复核自己的投诉。')
      }
      if (complaint.reviewerRole === complaint.targetRole) {
        errors.push('被投诉角色不能复核针对自己的投诉。')
      }
    }
    if (!complaint.resolution.trim()) errors.push('完成复核必须填写处理说明。')
  }

  return { ok: errors.length === 0, errors }
}

export interface ComplaintSubmissionInput {
  readonly id: string
  readonly caseId: string
  readonly targetRole: DemoRole
  readonly submittedByRole: DemoRole
  readonly description: string
  readonly submittedAt: string
}

export function createComplaintRecord(input: ComplaintSubmissionInput): ComplaintResult {
  const complaint: Complaint = {
    id: input.id.trim(),
    caseId: input.caseId.trim(),
    targetRole: input.targetRole,
    submittedByRole: input.submittedByRole,
    description: input.description.trim(),
    status: '待复核',
    submittedAt: input.submittedAt,
    reviewedAt: null,
    reviewerRole: null,
    resolution: '',
  }
  const validation = validateComplaint(complaint)
  if (!validation.ok) return { ok: false, errors: validation.errors, complaint: null }
  const availableReviewers = COMPLAINT_REVIEWER_ROLES.filter(
    (role) => role !== complaint.submittedByRole && role !== complaint.targetRole,
  )
  if (!availableReviewers.length) {
    return {
      ok: false,
      errors: ['该投诉组合没有可用的复核角色（需要 demo-review 或 demo-referral，且不能是提交人或被投诉角色）。请调整投诉对象或切换提交角色后再试。'],
      complaint: null,
    }
  }
  return { ok: true, errors: [], complaint }
}

export interface ComplaintReviewInput {
  readonly complaint: Complaint
  readonly reviewerRole: DemoRole
  readonly reviewedAt: string
  readonly resolution: string
}

export function reviewComplaintRecord(input: ComplaintReviewInput): ComplaintResult {
  const errors = [...validateComplaint(input.complaint).errors]
  if (input.complaint.status !== '待复核') errors.push('只有待复核投诉可以完成复核。')
  if (!isDemoRole(input.reviewerRole)) {
    errors.push('复核人演示角色无效。')
  } else {
    if (!isComplaintReviewerRole(input.reviewerRole)) {
      errors.push('只有 demo-review 或 demo-referral 演示角色可以复核投诉。')
    }
    if (input.reviewerRole === input.complaint.submittedByRole) {
      errors.push('投诉提交人不能复核自己的投诉。')
    }
    if (input.reviewerRole === input.complaint.targetRole) {
      errors.push('被投诉角色不能复核针对自己的投诉。')
    }
  }
  if (!isTimestamp(input.reviewedAt)) {
    errors.push('复核时间无效。')
  } else if (isTimestamp(input.complaint.submittedAt)
    && Date.parse(input.reviewedAt) < Date.parse(input.complaint.submittedAt)) {
    errors.push('复核时间不能早于投诉提交时间。')
  }
  if (!input.resolution.trim()) errors.push('完成复核必须填写处理说明。')

  const nextComplaint: Complaint = {
    ...input.complaint,
    status: '已复核',
    reviewedAt: input.reviewedAt,
    reviewerRole: input.reviewerRole,
    resolution: input.resolution.trim(),
  }
  const validation = validateComplaint(nextComplaint)
  if (!validation.ok) errors.push(...validation.errors)
  if (errors.length) return { ok: false, errors: [...new Set(errors)], complaint: null }
  return { ok: true, errors: [], complaint: nextComplaint }
}

/** Exact duplicate matching only: trim, collapse whitespace, and case-fold. No fuzzy matching. */
export function normalizeDuplicateText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function findIntakeDuplicateCandidates(
  cases: readonly IntakeCase[],
  input: { readonly label: string; readonly summary: string },
): IntakeCase[] {
  const label = normalizeDuplicateText(input.label)
  const summary = normalizeDuplicateText(input.summary)
  return cases.filter((item) =>
    (label !== '' && normalizeDuplicateText(item.label) === label)
    || (summary !== '' && normalizeDuplicateText(item.summary) === summary),
  )
}

export interface IntakeActionInput {
  readonly case: IntakeCase
  readonly action: IntakeAction
  readonly at: string
  readonly actorRole: DemoRole
  readonly reasonCode?: IntakeReasonCode | null
  readonly note?: string
  readonly referralTarget?: string
  readonly owner?: string | null
  readonly nextStep?: string | null
  readonly dueAt?: string | null
  readonly handoffOutcome?: HighRiskHandoffOutcome | null
  readonly handoffOwner?: string | null
}

export interface IntakeTransitionResult {
  readonly ok: boolean
  readonly errors: readonly string[]
  readonly nextCase: IntakeCase | null
}

export const HIGH_RISK_STOP_SCREENING_NOTICE =
  '检测到高风险标记：必须立即停止常规初筛，并遵循本机构已批准的外部升级流程进行人工处理。本原型不会发送任何紧急通知，也不会自动联系、派单或派发救援。'

export const HIGH_RISK_STOP_NEXT_STEP =
  '停止常规初筛；按机构已批准的外部升级流程进行人工处置（原型不发送通知）'

export function getHighRiskStopScreeningNotice(
  input: IntakeCase | readonly RiskFlag[],
): string | null {
  const riskFlags = 'riskFlags' in input ? input.riskFlags : input
  return riskFlags.some((flag) => flag.code === 'HIGH_RISK_STOP_SCREENING')
    ? HIGH_RISK_STOP_SCREENING_NOTICE
    : null
}

function isTimestamp(value: string | null): value is string {
  return value !== null && value.trim() !== '' && !Number.isNaN(Date.parse(value))
}

function validateOpenFields(
  owner: string | null,
  nextStep: string | null,
  dueAt: string | null,
): string[] {
  const errors: string[] = []
  if (!owner?.trim()) errors.push('开放记录必须指定负责人。')
  if (!nextStep?.trim()) errors.push('开放记录必须填写下一步。')
  if (!isTimestamp(dueAt)) errors.push('开放记录必须填写有效的截止时间。')
  return errors
}

function isIntakeStatus(value: unknown): value is IntakeStatus {
  return INTAKE_STATUSES.some((status) => status === value)
}

function isIntakeAction(value: unknown): value is IntakeAction {
  return INTAKE_ACTIONS.some((action) => action === value)
}

function isIntakeReasonCode(value: unknown): value is IntakeReasonCode {
  return INTAKE_REASON_CODES.some((reasonCode) => reasonCode === value)
}

function isHighRiskHandoffOutcome(value: unknown): value is HighRiskHandoffOutcome {
  return HIGH_RISK_HANDOFF_OUTCOMES.some((item) => item.value === value)
}

function validateTimeline(events: readonly IntakeEvent[]): string[] {
  const errors: string[] = []
  if (events.length === 0) return ['时间线不能为空。']
  if (events[0]?.kind !== 'created') errors.push('时间线首条必须是创建事件。')

  const seenIds = new Set<string>()
  let currentStatus: IntakeStatus | null = null
  let previousAt: number | null = null

  events.forEach((event, index) => {
    if (!event.id.trim()) errors.push(`第 ${index + 1} 条事件缺少 id。`)
    if (seenIds.has(event.id)) errors.push(`事件 id 重复：${event.id}。`)
    seenIds.add(event.id)

    const at = Date.parse(event.at)
    if (Number.isNaN(at)) {
      errors.push(`事件 ${event.id} 的时间无效。`)
    } else {
      if (previousAt !== null && at < previousAt) {
        errors.push('时间线必须按时间顺序追加。')
      }
      previousAt = at
    }

    if (event.kind !== 'duplicate-review' && event.duplicateCandidateIds != null) {
      errors.push(`事件 ${event.id} 不能包含重复复核候选。`)
    }
    if (event.kind !== 'risk-handoff' && (event.handoffOutcome != null || event.handoffOwner != null)) {
      errors.push(`事件 ${event.id} 不能包含高风险人工交接结果。`)
    }
    if (event.kind !== 'checkpoint-update'
      && (event.consentStatus != null || event.requiredInfoComplete != null)) {
      errors.push(`事件 ${event.id} 不能包含登记检查点字段。`)
    }

    if (event.kind === 'created') {
      if (index !== 0) errors.push('创建事件必须位于时间线开头。')
      if (event.fromStatus != null) errors.push('创建事件不能有上一状态。')
      if (!isIntakeStatus(event.toStatus)) errors.push(`创建事件 ${event.id} 的状态无效。`)
      if (event.action != null) errors.push(`创建事件 ${event.id} 不能包含动作。`)
      if (event.reasonCode != null) errors.push(`创建事件 ${event.id} 不能包含原因代码。`)
      if (event.contactOutcome != null) errors.push(`创建事件 ${event.id} 不能包含模拟联系结果。`)
      if (!isDemoRole(event.actorRole)) errors.push(`创建事件 ${event.id} 缺少有效演练角色。`)
      if (!event.note.trim()) errors.push(`创建事件 ${event.id} 缺少演练说明。`)
      currentStatus = event.toStatus
      return
    }

    switch (event.kind) {
      case 'duplicate-review': {
        if (!isIntakeStatus(event.fromStatus) || !isIntakeStatus(event.toStatus)) {
          errors.push(`重复复核事件 ${event.id} 的状态无效。`)
        }
        if (event.fromStatus !== event.toStatus) {
          errors.push(`重复复核事件 ${event.id} 不得改变登记状态。`)
        }
        if (event.action != null) errors.push(`重复复核事件 ${event.id} 不能包含动作。`)
        if (event.reasonCode != null) errors.push(`重复复核事件 ${event.id} 不能包含原因代码。`)
        if (event.contactOutcome != null) {
          errors.push(`重复复核事件 ${event.id} 不能包含模拟联系结果。`)
        }
        if (!isDemoRole(event.actorRole)) {
          errors.push(`重复复核事件 ${event.id} 缺少有效演练角色。`)
        }
        if (!event.note.trim()) errors.push(`重复复核事件 ${event.id} 缺少人工复核说明。`)
        const candidateIds = event.duplicateCandidateIds
        if (!candidateIds?.length) {
          errors.push(`重复复核事件 ${event.id} 缺少候选记录。`)
        } else {
          if (new Set(candidateIds).size !== candidateIds.length) {
            errors.push(`重复复核事件 ${event.id} 的候选记录不能重复。`)
          }
          if (candidateIds.some((candidateId) => !candidateId.trim())) {
            errors.push(`重复复核事件 ${event.id} 的候选记录 id 不能为空。`)
          }
        }
        break
      }

      case 'status-change': {
        if (!isIntakeStatus(event.fromStatus) || !isIntakeStatus(event.toStatus)) {
          errors.push(`状态流转事件 ${event.id} 的状态无效。`)
        }
        if (!isDemoRole(event.actorRole)) {
          errors.push(`状态流转事件 ${event.id} 缺少有效演练角色。`)
        }
        if (event.contactOutcome != null) {
          errors.push(`状态流转事件 ${event.id} 不能包含模拟联系结果。`)
        }

        const action = event.action
        if (action == null || !isIntakeAction(action)) {
          errors.push(`状态流转事件 ${event.id} 缺少有效动作。`)
        } else if (action === 'RECORD_HIGH_RISK_HANDOFF') {
          errors.push(`状态流转事件 ${event.id} 不能使用高风险交接动作。`)
        } else {
          const definition = ACTION_DEFINITIONS[action]
          if (isIntakeStatus(event.fromStatus) && !definition.from.includes(event.fromStatus)) {
            errors.push(`状态流转事件 ${event.id} 的动作 ${action} 不允许起始状态 ${event.fromStatus}。`)
          }
          if (event.toStatus !== definition.to) {
            errors.push(`状态流转事件 ${event.id} 的目标状态与动作 ${action} 不一致。`)
          }
          if (definition.requiresReason && event.reasonCode == null) {
            errors.push(`状态流转事件 ${event.id} 的动作 ${action} 必须提供原因代码。`)
          }
          if (action === 'CLOSE_FOLLOW_UP' && event.reasonCode !== 'FOLLOW_UP_CONCLUDED') {
            errors.push(`状态流转事件 ${event.id} 结束人工跟进时必须使用专用原因代码。`)
          }
          if (definition.requiresNote && !event.note.trim()) {
            errors.push(`状态流转事件 ${event.id} 的动作 ${action} 必须填写处理说明。`)
          }
          if (action === 'CONFIRM_REFERRAL' && !event.note.trim()) {
            errors.push(`状态流转事件 ${event.id} 缺少接收确认依据。`)
          }
          if (event.reasonCode === 'OTHER' && !event.note.trim()) {
            errors.push(`状态流转事件 ${event.id} 选择“其他”时必须填写演练原因。`)
          }
          if (event.reasonCode != null && !isIntakeReasonCode(event.reasonCode)) {
            errors.push(`状态流转事件 ${event.id} 的原因代码无效。`)
          }
        }
        break
      }

      case 'risk-handoff': {
        if (!isIntakeStatus(event.fromStatus) || !isIntakeStatus(event.toStatus)) {
          errors.push(`高风险交接事件 ${event.id} 的状态无效。`)
        }
        if (event.fromStatus !== event.toStatus) {
          errors.push(`高风险交接事件 ${event.id} 不得改变登记状态。`)
        }
        if (event.action !== 'RECORD_HIGH_RISK_HANDOFF') {
          errors.push(`高风险交接事件 ${event.id} 的动作必须为 RECORD_HIGH_RISK_HANDOFF。`)
        } else {
          const definition = ACTION_DEFINITIONS.RECORD_HIGH_RISK_HANDOFF
          if (isIntakeStatus(event.fromStatus) && !definition.from.includes(event.fromStatus)) {
            errors.push(`高风险交接事件 ${event.id} 的起始状态不允许登记交接。`)
          }
          if (event.reasonCode != null && !isIntakeReasonCode(event.reasonCode)) {
            errors.push(`高风险交接事件 ${event.id} 的原因代码无效。`)
          }
        }
        if (!isDemoRole(event.actorRole)) {
          errors.push(`高风险交接事件 ${event.id} 缺少有效演练角色。`)
        }
        if (!event.note.trim()) errors.push(`高风险交接事件 ${event.id} 缺少处理说明。`)
        if (event.contactOutcome != null) {
          errors.push(`高风险交接事件 ${event.id} 不能包含模拟联系结果。`)
        }
        if (event.handoffOutcome != null) {
          if (!isHighRiskHandoffOutcome(event.handoffOutcome)) {
            errors.push(`高风险交接事件 ${event.id} 的交接结果无效。`)
          } else if (event.handoffOutcome === 'accepted' && !event.handoffOwner?.trim()) {
            errors.push(`高风险交接事件 ${event.id} 选择“有人接手”时必须填写虚构接手人。`)
          } else if (event.handoffOutcome === 'not-accepted' && event.handoffOwner?.trim()) {
            errors.push(`高风险交接事件 ${event.id} 选择“暂无人接手”时不能填写接手人。`)
          }
        } else if (event.handoffOwner != null) {
          errors.push(`高风险交接事件 ${event.id} 缺少交接结果。`)
        }
        break
      }

      case 'checkpoint-update': {
        if (!isIntakeStatus(event.fromStatus) || !isIntakeStatus(event.toStatus)) {
          errors.push(`登记检查点事件 ${event.id} 的状态无效。`)
        }
        if (event.fromStatus !== event.toStatus) {
          errors.push(`登记检查点事件 ${event.id} 不得改变登记状态。`)
        }
        if (event.action != null) errors.push(`登记检查点事件 ${event.id} 不能包含动作。`)
        if (event.reasonCode != null) errors.push(`登记检查点事件 ${event.id} 不能包含原因代码。`)
        if (event.contactOutcome != null) {
          errors.push(`登记检查点事件 ${event.id} 不能包含模拟联系结果。`)
        }
        if (!isConsentStatus(event.consentStatus)) {
          errors.push(`登记检查点事件 ${event.id} 缺少有效演练同意状态。`)
        }
        if (typeof event.requiredInfoComplete !== 'boolean') {
          errors.push(`登记检查点事件 ${event.id} 缺少必填信息完整性。`)
        }
        if (!isDemoRole(event.actorRole)) {
          errors.push(`登记检查点事件 ${event.id} 缺少有效演练角色。`)
        }
        if (!event.note.trim()) errors.push(`登记检查点事件 ${event.id} 缺少检查点更新说明。`)
        break
      }

      case 'contact-simulation': {
        if (!isIntakeStatus(event.fromStatus) || !isIntakeStatus(event.toStatus)) {
          errors.push(`模拟联系事件 ${event.id} 的状态无效。`)
        }
        if (event.action != null) errors.push(`模拟联系事件 ${event.id} 不能包含动作。`)
        if (event.reasonCode != null) errors.push(`模拟联系事件 ${event.id} 不能包含原因代码。`)
        if (!CONTACT_SIMULATION_OUTCOMES.some((item) => item.value === event.contactOutcome)) {
          errors.push(`模拟联系事件 ${event.id} 缺少有效结果。`)
        }
        if (!isDemoRole(event.actorRole)) errors.push(`模拟联系事件 ${event.id} 缺少有效演练角色。`)
        if (!event.note.trim()) errors.push(`模拟联系事件 ${event.id} 缺少演练说明。`)
        if (event.fromStatus === null || !isOpenIntakeStatus(event.fromStatus)) {
          errors.push(`模拟联系事件 ${event.id} 只能记录在开放状态。`)
        }
        if (event.fromStatus === null || event.toStatus !== event.fromStatus) {
          errors.push(`模拟联系事件 ${event.id} 不得改变登记状态。`)
        }
        break
      }

      case 'risk-flag':
      case 'timeout':
      case 'case-link':
      case 'follow-up-update': {
        if (!isIntakeStatus(event.fromStatus) || !isIntakeStatus(event.toStatus)) {
          errors.push(`事件 ${event.id} 的状态无效。`)
        }
        if (event.fromStatus !== event.toStatus) {
          errors.push(`事件 ${event.id} 不得改变登记状态。`)
        }
        if (event.action != null) errors.push(`事件 ${event.id} 不能包含动作。`)
        if (event.reasonCode != null) errors.push(`事件 ${event.id} 不能包含原因代码。`)
        if (event.contactOutcome != null) {
          errors.push(`事件 ${event.id} 不能包含模拟联系结果。`)
        }
        if (event.kind === 'timeout') {
          if (event.actorRole !== null) errors.push(`事件 ${event.id} 必须使用系统角色。`)
        } else if (event.kind === 'risk-flag') {
          if (event.actorRole !== null && !isDemoRole(event.actorRole)) {
            errors.push(`风险标记事件 ${event.id} 的演练角色无效。`)
          }
          if (!event.note.trim()) errors.push(`风险标记事件 ${event.id} 缺少说明。`)
        } else if (!isDemoRole(event.actorRole)) {
          errors.push(`事件 ${event.id} 缺少有效演练角色。`)
        }
        break
      }

      default:
        errors.push(`事件 ${event.id} 的类型无效：${String(event.kind)}。`)
        return
    }

    if (currentStatus !== null && event.fromStatus !== currentStatus) {
      errors.push(`事件 ${event.id} 的起始状态与时间线不一致。`)
    }
    if (event.toStatus !== null) currentStatus = event.toStatus
  })

  return errors
}

export function validateIntakeCase(intakeCase: IntakeCase): IntakeValidation {
  const errors: string[] = []

  if (!intakeCase.id.trim()) errors.push('记录缺少 id。')
  if (!intakeCase.label.trim()) errors.push('记录缺少演练标签。')
  if (!intakeCase.serviceType.trim()) errors.push('记录缺少服务类型。')
  if (intakeCase.sourceChannel !== undefined && !isSyntheticSourceChannel(intakeCase.sourceChannel)) {
    errors.push('来源渠道演练标记无效。')
  }
  if (intakeCase.sourcePostId !== undefined
    && (intakeCase.sourcePostId.trim() === '' || intakeCase.sourcePostId !== intakeCase.sourcePostId.trim())) {
    errors.push('社区来源帖子 ID 不能为空或包含首尾空白。')
  }
  if (intakeCase.consentStatus !== undefined && !isConsentStatus(intakeCase.consentStatus)) {
    errors.push('演练同意状态无效。')
  }
  if (intakeCase.requiredInfoComplete !== undefined
    && typeof intakeCase.requiredInfoComplete !== 'boolean') {
    errors.push('必填信息完整性必须是布尔值。')
  }
  if (!isTimestamp(intakeCase.createdAt)) errors.push('创建时间无效。')
  if (!isTimestamp(intakeCase.updatedAt)) errors.push('更新时间无效。')
  if (
    isTimestamp(intakeCase.createdAt) &&
    isTimestamp(intakeCase.updatedAt) &&
    Date.parse(intakeCase.updatedAt) < Date.parse(intakeCase.createdAt)
  ) {
    errors.push('更新时间不能早于创建时间。')
  }

  const relatedIds = intakeCase.relatedCaseIds ?? []
  if (new Set(relatedIds).size !== relatedIds.length) errors.push('关联记录不能重复。')
  if (relatedIds.some((id) => !id.trim())) errors.push('关联记录 id 不能为空。')
  if (relatedIds.includes(intakeCase.id)) errors.push('记录不能关联自身。')
  if (intakeCase.reopenedFromId) {
    if (intakeCase.reopenedFromId === intakeCase.id) errors.push('重开来源不能是记录自身。')
    if (!relatedIds.includes(intakeCase.reopenedFromId)) errors.push('重开来源必须列在关联记录中。')
  }
  intakeCase.events
    .filter((event) => event.kind === 'duplicate-review')
    .forEach((event) => {
      for (const candidateId of event.duplicateCandidateIds ?? []) {
        if (candidateId === intakeCase.id) errors.push('重复复核候选不能是记录自身。')
        if (!relatedIds.includes(candidateId)) errors.push('重复复核候选必须列在关联记录中。')
      }
    })

  const checkpointEvents = intakeCase.events.filter((event) => event.kind === 'checkpoint-update')
  const lastCheckpointEvent = checkpointEvents[checkpointEvents.length - 1]
  if (lastCheckpointEvent) {
    if (getCaseConsentStatus(intakeCase) !== lastCheckpointEvent.consentStatus
      || isCaseRequiredInfoComplete(intakeCase) !== lastCheckpointEvent.requiredInfoComplete) {
      errors.push('记录中的登记检查点必须与时间线最后一次检查点更新一致。')
    }
  } else if (getCaseConsentStatus(intakeCase) !== 'unknown'
    || isCaseRequiredInfoComplete(intakeCase)) {
    errors.push('登记检查点已设置，但时间线缺少对应的检查点更新记录。')
  }

  if (isOpenIntakeStatus(intakeCase.status)) {
    errors.push(...validateOpenFields(intakeCase.owner, intakeCase.nextStep, intakeCase.dueAt))
  } else if (intakeCase.dueAt !== null && !isTimestamp(intakeCase.dueAt)) {
    errors.push('截止时间无效。')
  }

  const seenFlags = new Set<RiskFlagCode>()
  intakeCase.riskFlags.forEach((flag) => {
    if (seenFlags.has(flag.code)) errors.push(`风险标记重复：${flag.code}。`)
    seenFlags.add(flag.code)
    if (!flag.note.trim()) errors.push(`风险标记 ${flag.code} 缺少说明。`)
    if (!isTimestamp(flag.raisedAt)) errors.push(`风险标记 ${flag.code} 的时间无效。`)
  })

  const highRiskFlag = intakeCase.riskFlags.find((flag) => flag.code === 'HIGH_RISK_STOP_SCREENING')
  const highRiskEvents = intakeCase.events.filter((event) => event.kind === 'risk-flag')
  const handoffEvents = intakeCase.events.filter((event) => event.kind === 'risk-handoff')
  if (highRiskFlag) {
    if (highRiskEvents.length !== 1) errors.push('高风险停止标记必须对应唯一的风险标记事件。')
    if (handoffEvents.length === 0 && intakeCase.nextStep !== HIGH_RISK_STOP_NEXT_STEP) {
      errors.push('高风险停止标记生效后，首次人工交接前下一步必须为停止常规初筛的人工处置提示。')
    }
    if (isTimestamp(highRiskFlag.raisedAt)
      && !highRiskEvents.some((event) => event.at === highRiskFlag.raisedAt)) {
      errors.push('高风险标记时间必须与时间线风险事件一致。')
    }
  } else if (highRiskEvents.length > 0) {
    errors.push('时间线存在高风险标记事件，但记录中缺少对应风险标记。')
  }

  const highRiskAt = highRiskFlag && isTimestamp(highRiskFlag.raisedAt)
    ? Date.parse(highRiskFlag.raisedAt)
    : null
  if (highRiskAt === null) {
    handoffEvents.forEach((event) => errors.push(`高风险交接事件 ${event.id} 缺少高风险停止标记。`))
  } else {
    const flagEventIndex = intakeCase.events.findIndex((event) =>
      event.kind === 'risk-flag' && event.at === highRiskFlag?.raisedAt,
    )
    if (flagEventIndex >= 0) {
      const eventsAfterFlag = intakeCase.events.slice(flagEventIndex + 1)
      if (eventsAfterFlag.some((event) => event.kind !== 'risk-handoff')) {
        errors.push('高风险停止初筛后只能追加人工交接结果，不能继续常规操作。')
      }
    }
    handoffEvents.forEach((event) => {
      const eventIndex = intakeCase.events.indexOf(event)
      if (
        !isTimestamp(event.at)
        || Date.parse(event.at) < highRiskAt
        || (flagEventIndex >= 0 && eventIndex <= flagEventIndex)
      ) {
        errors.push(`高风险交接事件 ${event.id} 不能早于高风险停止标记。`)
      }
    })
  }

  if (highRiskFlag && isTimestamp(highRiskFlag.raisedAt)) {
    intakeCase.events.forEach((event) => {
      if (event.kind === 'contact-simulation'
        && isTimestamp(event.at)
        && Date.parse(event.at) >= Date.parse(highRiskFlag.raisedAt)) {
        errors.push(`高风险停止标记生效后不能追加模拟联系事件：${event.id}。`)
      }
    })
  }

  errors.push(...validateTimeline(intakeCase.events))
  const lastEvent = intakeCase.events[intakeCase.events.length - 1]
  if (lastEvent && lastEvent.toStatus !== intakeCase.status) {
    errors.push('记录状态必须与时间线最后状态一致。')
  }

  return { ok: errors.length === 0, errors }
}

export function validateIntakeAction(input: IntakeActionInput): IntakeValidation {
  const errors = [...validateIntakeCase(input.case).errors]

  if (!isTimestamp(input.at)) {
    errors.push('动作时间无效。')
  } else if (
    isTimestamp(input.case.updatedAt) &&
    Date.parse(input.at) < Date.parse(input.case.updatedAt)
  ) {
    errors.push('动作时间不能早于记录更新时间。')
  }

  const definition: ActionDefinition | undefined = ACTION_DEFINITIONS[input.action]
  if (!definition) {
    return { ok: false, errors: [...errors, '未知动作。'] }
  }

  if (!definition.from.some((status) => status === input.case.status)) {
    errors.push(`状态“${input.case.status}”不允许动作 ${input.action}。`)
  }

  const blockedReason = getIntakeActionBlockedReason(input.action, input.case)
  if (blockedReason) errors.push(blockedReason)

  if (definition.requiresReason && input.reasonCode == null) {
    errors.push(`动作 ${input.action} 必须提供原因代码。`)
  }
  if (input.action === 'CLOSE_FOLLOW_UP' && input.reasonCode !== 'FOLLOW_UP_CONCLUDED') {
    errors.push('结束人工跟进时必须选择专用原因代码。')
  }
  if (definition.requiresNote && !input.note?.trim()) {
    errors.push(`动作 ${input.action} 必须填写处理说明。`)
  }
  if (input.action === 'REFER' && !input.referralTarget?.trim()) {
    errors.push('登记转介时必须填写虚构演练对象。')
  }
  if (input.action === 'CONFIRM_REFERRAL' && !input.note?.trim()) {
    errors.push('请填写虚构演练中的接收确认依据；本原型不会发送转介或收到真实回执。')
  }
  if (input.reasonCode === 'OTHER' && !input.note?.trim()) {
    errors.push('选择“其他”时，请在处理说明中写明演练原因。')
  }
  if (
    input.reasonCode != null &&
    !INTAKE_REASON_CODES.some((reasonCode) => reasonCode === input.reasonCode)
  ) {
    errors.push('原因代码无效。')
  }

  const highRiskNotice = getHighRiskStopScreeningNotice(input.case)
  if (input.action === 'RECORD_HIGH_RISK_HANDOFF') {
    if (highRiskNotice === null) {
      errors.push('记录没有 HIGH_RISK_STOP_SCREENING 标记，不能登记高风险人工交接结果。')
    }
    if (!isHighRiskHandoffOutcome(input.handoffOutcome)) {
      errors.push('请选择本次演练人工交接结果（有人接手 / 暂无人接手）。')
    } else if (input.handoffOutcome === 'accepted' && !input.handoffOwner?.trim()) {
      errors.push('交接结果为“有人接手”时必须填写虚构接手人。')
    } else if (input.handoffOutcome === 'not-accepted' && input.handoffOwner?.trim()) {
      errors.push('交接结果为“暂无人接手”时不能填写接手人。')
    }
  } else {
    if (input.handoffOutcome != null || input.handoffOwner?.trim()) {
      errors.push('只有高风险人工交接动作可以填写交接结果或接手人。')
    }
    if (highRiskNotice !== null) errors.push(highRiskNotice)
  }

  const targetStatus = getIntakeActionTarget(input.action, input.case.status)
  if (isOpenIntakeStatus(targetStatus)) {
    const owner = input.owner !== undefined ? input.owner : input.case.owner
    const nextStep = input.nextStep !== undefined ? input.nextStep : input.case.nextStep
    const dueAt = input.dueAt !== undefined ? input.dueAt : input.case.dueAt
    errors.push(...validateOpenFields(owner, nextStep, dueAt))
  }

  return { ok: errors.length === 0, errors }
}

// Append-only: existing timeline entries are copied forward, never edited or removed.
export function appendIntakeEvent(intakeCase: IntakeCase, event: IntakeEvent): IntakeCase {
  const lastEvent = intakeCase.events[intakeCase.events.length - 1]
  if (intakeCase.events.some((existing) => existing.id === event.id)) {
    throw new Error(`事件 id 重复：${event.id}`)
  }
  if (!isTimestamp(event.at)) {
    throw new Error(`事件时间无效：${event.id}`)
  }
  if (lastEvent && Date.parse(event.at) < Date.parse(lastEvent.at)) {
    throw new Error(`事件必须按时间追加：${event.id}`)
  }

  return {
    ...intakeCase,
    events: [...intakeCase.events, event],
    updatedAt: event.at,
  }
}

export interface CheckpointUpdateInput {
  readonly case: IntakeCase
  readonly consentStatus: ConsentStatus
  readonly requiredInfoComplete: boolean
  readonly at: string
  readonly actorRole: DemoRole
  readonly note: string
}

export function applyCheckpointUpdate(input: CheckpointUpdateInput): IntakeTransitionResult {
  const errors = [...validateIntakeCase(input.case).errors]
  const atTime = Date.parse(input.at)
  if (Number.isNaN(atTime)) {
    errors.push('登记检查点更新时间无效。')
  } else if (atTime < Date.parse(input.case.updatedAt)) {
    errors.push('登记检查点更新时间不能早于记录更新时间。')
  }
  if (!isOpenIntakeStatus(input.case.status)) {
    errors.push('已结束的演练记录不能更新登记检查点。')
  }
  if (getHighRiskStopScreeningNotice(input.case)) {
    errors.push('高风险停止初筛后不能更新登记检查点；请按人工交接通道处理。')
  }
  if (!isConsentStatus(input.consentStatus)) errors.push('演练同意状态无效。')
  if (typeof input.requiredInfoComplete !== 'boolean') errors.push('必填信息完整性必须是布尔值。')
  if (!isDemoRole(input.actorRole)) errors.push('请使用有效的演练角色更新登记检查点。')
  if (!input.note.trim()) errors.push('请填写登记检查点更新说明。')
  if (errors.length) return { ok: false, errors, nextCase: null }

  const event: IntakeEvent = {
    id: nextEventId(input.case),
    at: input.at,
    kind: 'checkpoint-update',
    actorRole: input.actorRole,
    action: null,
    fromStatus: input.case.status,
    toStatus: input.case.status,
    reasonCode: null,
    note: `登记检查点更新（合成演练）：${input.note.trim()}`,
    consentStatus: input.consentStatus,
    requiredInfoComplete: input.requiredInfoComplete,
  }
  const nextCase = appendIntakeEvent({
    ...input.case,
    consentStatus: input.consentStatus,
    requiredInfoComplete: input.requiredInfoComplete,
  }, event)
  const validation = validateIntakeCase(nextCase)
  if (!validation.ok) return { ok: false, errors: [...validation.errors], nextCase: null }
  return { ok: true, errors: [], nextCase }
}

export interface ContactSimulationInput {
  readonly case: IntakeCase
  readonly outcome: ContactSimulationOutcome
  readonly at: string
  readonly actorRole: DemoRole
  readonly note: string
  readonly owner: string | null
  readonly nextStep: string | null
  readonly dueAt: string | null
}

export function applyContactSimulation(input: ContactSimulationInput): IntakeTransitionResult {
  const errors = [...validateIntakeCase(input.case).errors]
  const atTime = Date.parse(input.at)
  if (Number.isNaN(atTime)) {
    errors.push('模拟联系记录时间无效。')
  } else if (atTime < Date.parse(input.case.updatedAt)) {
    errors.push('模拟联系记录时间不能早于记录更新时间。')
  }
  if (!isOpenIntakeStatus(input.case.status)) errors.push('已结束的演练记录不能登记模拟联系结果。')
  const checkpointBlockedReason = getCaseCheckpointBlockedReason(input.case)
  if (checkpointBlockedReason) errors.push(checkpointBlockedReason)
  const highRiskNotice = getHighRiskStopScreeningNotice(input.case)
  if (highRiskNotice) errors.push(highRiskNotice)
  if (!CONTACT_SIMULATION_OUTCOMES.some((item) => item.value === input.outcome)) {
    errors.push('请选择有效的模拟联系结果。')
  }
  if (!isDemoRole(input.actorRole)) errors.push('请使用有效的演练角色记录本次模拟联系。')
  if (!input.note.trim()) errors.push('请填写本次模拟联系的简要说明。')
  errors.push(...validateOpenFields(input.owner, input.nextStep, input.dueAt))
  if (errors.length) return { ok: false, errors, nextCase: null }

  const changes: NonNullable<IntakeEvent['changes']> = [
    { field: 'owner' as const, label: '负责人', before: input.case.owner, after: input.owner },
    { field: 'nextStep' as const, label: '下一步', before: input.case.nextStep, after: input.nextStep },
    { field: 'dueAt' as const, label: '跟进截止', before: input.case.dueAt, after: input.dueAt },
  ].filter((change) => change.before !== change.after)
  const event: IntakeEvent = {
    id: nextEventId(input.case),
    at: input.at,
    kind: 'contact-simulation',
    actorRole: input.actorRole,
    action: null,
    fromStatus: input.case.status,
    toStatus: input.case.status,
    reasonCode: null,
    note: input.note.trim(),
    contactOutcome: input.outcome,
    changes,
  }
  const nextCase = appendIntakeEvent({
    ...input.case,
    owner: input.owner,
    nextStep: input.nextStep,
    dueAt: input.dueAt,
    riskFlags: input.case.riskFlags.filter((flag) => flag.code !== 'OVERDUE'
      || (input.dueAt !== null && Date.parse(input.dueAt) < atTime)),
  }, event)
  const validation = validateIntakeCase(nextCase)
  if (!validation.ok) return { ok: false, errors: [...validation.errors], nextCase: null }
  return { ok: true, errors: [], nextCase }
}

export function applyIntakeAction(input: IntakeActionInput): IntakeTransitionResult {
  const validation = validateIntakeAction(input)
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, nextCase: null }
  }

  const definition = ACTION_DEFINITIONS[input.action]
  const targetStatus = definition.to ?? input.case.status
  const nextIsOpen = isOpenIntakeStatus(targetStatus)
  const isHighRiskHandoff = input.action === 'RECORD_HIGH_RISK_HANDOFF'
  const owner = nextIsOpen
    ? (input.owner !== undefined ? input.owner : input.case.owner)
    : null
  const nextStep = nextIsOpen
    ? (input.nextStep !== undefined ? input.nextStep : input.case.nextStep)
    : null
  const dueAt = nextIsOpen
    ? (input.dueAt !== undefined ? input.dueAt : input.case.dueAt)
    : null
  const riskFlags = input.case.riskFlags.filter((flag) => {
    if (flag.code === 'MISSING_INFORMATION') return targetStatus === '待补充'
    if (flag.code === 'EXTERNAL_CONFIRMATION_PENDING') return targetStatus === '已转介待确认'
    if (flag.code === 'OVERDUE') {
      return nextIsOpen && dueAt !== null && Date.parse(dueAt) < Date.parse(input.at)
    }
    return true
  })
  if (targetStatus === '待补充' && !riskFlags.some((flag) => flag.code === 'MISSING_INFORMATION')) {
    riskFlags.push({
      code: 'MISSING_INFORMATION',
      label: '等待补充信息',
      severity: 'attention',
      note: '当前处于待补充演练状态；恢复初筛或结束记录后清除当前标记。',
      raisedAt: input.at,
    })
  }
  if (targetStatus === '已转介待确认' && !riskFlags.some((flag) => flag.code === 'EXTERNAL_CONFIRMATION_PENDING')) {
    riskFlags.push({
      code: 'EXTERNAL_CONFIRMATION_PENDING',
      label: '等待外部确认',
      severity: 'attention',
      note: '当前处于待确认转介演练状态；确认、失败或结束后清除当前标记。',
      raisedAt: input.at,
    })
  }
  const fieldChanges: NonNullable<IntakeEvent['changes']> = [
    { field: 'owner' as const, label: '负责人', before: input.case.owner, after: owner },
    { field: 'nextStep' as const, label: '下一步', before: input.case.nextStep, after: nextStep },
    { field: 'dueAt' as const, label: '跟进截止', before: input.case.dueAt, after: dueAt },
  ]
  const changes = isHighRiskHandoff
    ? fieldChanges
    : fieldChanges.filter((change) => change.before !== change.after)
  const event: IntakeEvent = {
    id: nextEventId(input.case),
    at: input.at,
    kind: isHighRiskHandoff ? 'risk-handoff' : 'status-change',
    actorRole: input.actorRole,
    action: input.action,
    fromStatus: input.case.status,
    toStatus: targetStatus,
    reasonCode: input.reasonCode ?? null,
    note: input.action === 'REFER'
      ? `虚构演练转介对象：${input.referralTarget!.trim()}；转介依据：${input.note!.trim()}`
      : input.note?.trim() || '状态更新。',
    changes,
    ...(isHighRiskHandoff && input.handoffOutcome != null
      ? {
          handoffOutcome: input.handoffOutcome,
          handoffOwner: input.handoffOutcome === 'accepted'
            ? (input.handoffOwner ?? '').trim()
            : null,
        }
      : {}),
  }

  const nextCase = appendIntakeEvent(
    {
      ...input.case,
      status: targetStatus,
      riskFlags,
      owner,
      nextStep,
      dueAt,
    },
    event,
  )

  return { ok: true, errors: [], nextCase }
}

function nextEventId(intakeCase: IntakeCase): string {
  const usedIds = new Set(intakeCase.events.map((event) => event.id))
  let sequence = intakeCase.events.length + 1
  while (usedIds.has(`${intakeCase.id}-EVT-${sequence}`)) sequence += 1
  return `${intakeCase.id}-EVT-${sequence}`
}

export function isIntakeOverdue(intakeCase: IntakeCase, at: string): boolean {
  if (!isOpenIntakeStatus(intakeCase.status) || intakeCase.dueAt === null) return false

  const atTime = Date.parse(at)
  const dueTime = Date.parse(intakeCase.dueAt)
  return !Number.isNaN(atTime) && !Number.isNaN(dueTime) && atTime > dueTime
}

// Timeout handling only adds an overdue flag/event for regular cases; it never contacts, changes status, or closes.
export function applyTimeoutFlag(intakeCase: IntakeCase, at: string): IntakeCase {
  // 高风险停止初筛后，时间线只允许记录人工交接结果。
  // 逾期状态由 isIntakeOverdue 根据 dueAt 派生，不需要写入普通超时事件。
  if (intakeCase.riskFlags.some((flag) => flag.code === 'HIGH_RISK_STOP_SCREENING')) return intakeCase
  if (!isIntakeOverdue(intakeCase, at)) return intakeCase
  if (intakeCase.riskFlags.some((flag) => flag.code === 'OVERDUE')) return intakeCase

  const updatedAt = Date.parse(intakeCase.updatedAt)
  if (!Number.isNaN(updatedAt) && Date.parse(at) < updatedAt) return intakeCase

  const flag: RiskFlag = {
    code: 'OVERDUE',
    label: '演练已逾期',
    severity: 'attention',
    note: '仅标记演练待办逾期；不自动联系、不自动关闭。',
    raisedAt: at,
  }
  const event: IntakeEvent = {
    id: nextEventId(intakeCase),
    at,
    kind: 'timeout',
    actorRole: null,
    action: null,
    fromStatus: intakeCase.status,
    toStatus: intakeCase.status,
    reasonCode: null,
    note: '演练超时检查仅添加逾期标记，状态未改变，也未自动联系或关闭。',
  }

  return appendIntakeEvent(
    {
      ...intakeCase,
      riskFlags: [...intakeCase.riskFlags, flag],
    },
    event,
  )
}
