import {
  COMPLAINT_REVIEWER_ROLES,
  COMPLAINT_STATUSES,
  CONSENT_STATUSES,
  CONTACT_SIMULATION_OUTCOMES,
  DEMO_ROLES,
  HIGH_RISK_HANDOFF_OUTCOMES,
  INTAKE_ACTIONS,
  INTAKE_REASON_CODES,
  INTAKE_STATUSES,
  RISK_FLAG_CODES,
  isSyntheticSourceChannel,
  validateComplaint,
  validateIntakeCase,
  type Complaint,
  type IntakeCase,
  type IntakeEvent,
} from './intake'

export const INTAKE_STORAGE_KEY = 'a-plus.synthetic-intake.v1'
export const INTAKE_SELECTION_KEY = 'a-plus.synthetic-intake.selected.v1'

export const MAX_BACKUP_BYTES = 5_000_000
const MAX_CASES = 1_000
const MAX_COMPLAINTS = 1_000
const EVENT_KINDS = [
  'created',
  'status-change',
  'follow-up-update',
  'contact-simulation',
  'risk-flag',
  'risk-handoff',
  'case-link',
  'duplicate-review',
  'checkpoint-update',
  'timeout',
] as const

const BACKUP_KEYS = [
  'app',
  'kind',
  'schemaVersion',
  'savedAt',
  'intakePaused',
  'selectedId',
  'cases',
  'complaints',
] as const

const CASE_KEYS = [
  'id',
  'label',
  'summary',
  'serviceType',
  'sourceChannel',
  'sourcePostId',
  'consentStatus',
  'requiredInfoComplete',
  'status',
  'riskFlags',
  'owner',
  'nextStep',
  'dueAt',
  'createdAt',
  'updatedAt',
  'events',
  'reopenedFromId',
  'relatedCaseIds',
] as const

const RISK_FLAG_KEYS = ['code', 'label', 'severity', 'note', 'raisedAt'] as const

const EVENT_KEYS = [
  'id',
  'at',
  'kind',
  'actorRole',
  'action',
  'fromStatus',
  'toStatus',
  'reasonCode',
  'note',
  'contactOutcome',
  'consentStatus',
  'requiredInfoComplete',
  'handoffOutcome',
  'handoffOwner',
  'duplicateCandidateIds',
  'changes',
] as const

const CHANGE_KEYS = ['field', 'label', 'before', 'after'] as const

const COMPLAINT_KEYS = [
  'id',
  'caseId',
  'targetRole',
  'submittedByRole',
  'description',
  'status',
  'submittedAt',
  'reviewedAt',
  'reviewerRole',
  'resolution',
] as const

export interface IntakeBackup {
  app: 'a-plus-intake'
  kind: 'synthetic-rehearsal'
  schemaVersion: 1
  savedAt: string
  /** Local-only rehearsal switch; missing on old v1 backups means not paused. */
  intakePaused: boolean
  selectedId: string | null
  cases: IntakeCase[]
  /** Independent complaint review records; missing on old v1 backups means empty. */
  complaints: Complaint[]
}

export type IntakeBackupResult =
  | { ok: true; backup: IntakeBackup; warnings: string[] }
  | { ok: false; errors: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.some((option) => option === value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isIntakeEvent(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!hasOnlyKeys(value, EVENT_KEYS)) return false
  if (
    typeof value.id !== 'string'
    || typeof value.at !== 'string'
    || !isOneOf(value.kind, EVENT_KINDS)
    || !(value.actorRole === null || isOneOf(value.actorRole, DEMO_ROLES))
    || !(value.action === null || isOneOf(value.action, INTAKE_ACTIONS))
    || !(value.fromStatus === null || isOneOf(value.fromStatus, INTAKE_STATUSES))
    || !(value.toStatus === null || isOneOf(value.toStatus, INTAKE_STATUSES))
    || !(value.reasonCode === null || isOneOf(value.reasonCode, INTAKE_REASON_CODES))
    || typeof value.note !== 'string'
  ) return false

  if (
    value.contactOutcome !== undefined
    && value.contactOutcome !== null
    && !CONTACT_SIMULATION_OUTCOMES.some((item) => item.value === value.contactOutcome)
  ) return false

  if (value.consentStatus !== undefined) {
    if (value.kind !== 'checkpoint-update'
      || !CONSENT_STATUSES.some((item) => item.value === value.consentStatus)) {
      return false
    }
  }
  if (value.requiredInfoComplete !== undefined) {
    if (value.kind !== 'checkpoint-update' || typeof value.requiredInfoComplete !== 'boolean') {
      return false
    }
  }
  if (value.kind === 'checkpoint-update'
    && (value.consentStatus === undefined || value.requiredInfoComplete === undefined)) {
    return false
  }

  if (value.handoffOutcome !== undefined) {
    if (value.kind !== 'risk-handoff'
      || !HIGH_RISK_HANDOFF_OUTCOMES.some((item) => item.value === value.handoffOutcome)) {
      return false
    }
    if (value.handoffOwner !== undefined && !isNullableString(value.handoffOwner)) return false
    if (value.handoffOutcome === 'accepted'
      && (typeof value.handoffOwner !== 'string' || value.handoffOwner.trim() === '')) {
      return false
    }
    if (value.handoffOutcome === 'not-accepted'
      && typeof value.handoffOwner === 'string'
      && value.handoffOwner.trim() !== '') {
      return false
    }
  } else if (value.handoffOwner !== undefined) {
    return false
  }

  if (value.kind === 'duplicate-review') {
    if (!Array.isArray(value.duplicateCandidateIds)
      || value.duplicateCandidateIds.length === 0
      || !value.duplicateCandidateIds.every((id: unknown) => typeof id === 'string' && id.trim() !== '')) {
      return false
    }
  } else if (value.duplicateCandidateIds !== undefined) {
    return false
  }

  if (value.changes !== undefined) {
    if (!Array.isArray(value.changes)) return false
    if (!value.changes.every((change: unknown) => isRecord(change)
      && hasOnlyKeys(change, CHANGE_KEYS)
      && isOneOf(change.field, ['owner', 'nextStep', 'dueAt'] as const)
      && typeof change.label === 'string'
      && isNullableString(change.before)
      && isNullableString(change.after))) return false
  }
  return true
}

function isIntakeCase(value: unknown): value is IntakeCase {
  if (!isRecord(value)) return false
  if (!hasOnlyKeys(value, CASE_KEYS)) return false
  if (
    typeof value.id !== 'string'
    || typeof value.label !== 'string'
    || typeof value.summary !== 'string'
    || typeof value.serviceType !== 'string'
    || (value.sourceChannel !== undefined && !isSyntheticSourceChannel(value.sourceChannel))
    || (value.sourcePostId !== undefined
      && (typeof value.sourcePostId !== 'string'
        || value.sourcePostId.trim() === ''
        || value.sourcePostId !== value.sourcePostId.trim()))
    || (value.consentStatus !== undefined
      && !CONSENT_STATUSES.some((item) => item.value === value.consentStatus))
    || (value.requiredInfoComplete !== undefined && typeof value.requiredInfoComplete !== 'boolean')
    || !isOneOf(value.status, INTAKE_STATUSES)
    || !Array.isArray(value.riskFlags)
    || !isNullableString(value.owner)
    || !isNullableString(value.nextStep)
    || !isNullableString(value.dueAt)
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || !Array.isArray(value.events)
  ) return false

  if (value.reopenedFromId !== undefined && typeof value.reopenedFromId !== 'string') return false
  if (value.relatedCaseIds !== undefined
    && (!Array.isArray(value.relatedCaseIds)
      || !value.relatedCaseIds.every((id: unknown) => typeof id === 'string'))) return false

  const validFlags = value.riskFlags.every((flag: unknown) => isRecord(flag)
    && hasOnlyKeys(flag, RISK_FLAG_KEYS)
    && isOneOf(flag.code, RISK_FLAG_CODES)
    && typeof flag.label === 'string'
    && isOneOf(flag.severity, ['high', 'attention', 'info'] as const)
    && typeof flag.note === 'string'
    && typeof flag.raisedAt === 'string')
  return validFlags && value.events.every(isIntakeEvent)
}

function isComplaint(value: unknown): value is Complaint {
  return isRecord(value)
    && hasOnlyKeys(value, COMPLAINT_KEYS)
    && typeof value.id === 'string'
    && typeof value.caseId === 'string'
    && isOneOf(value.targetRole, DEMO_ROLES)
    && isOneOf(value.submittedByRole, DEMO_ROLES)
    && typeof value.description === 'string'
    && isOneOf(value.status, COMPLAINT_STATUSES)
    && typeof value.submittedAt === 'string'
    && isNullableString(value.reviewedAt)
    && (value.reviewerRole === null || isOneOf(value.reviewerRole, DEMO_ROLES))
    && typeof value.resolution === 'string'
}

export function parseIntakeBackup(raw: string): IntakeBackupResult {
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) {
    return { ok: false, errors: ['备份超过 5 MB，无法导入。'] }
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, errors: ['文件不是有效的 JSON 备份。'] }
  }

  if (!isRecord(value)
    || !hasOnlyKeys(value, BACKUP_KEYS)
    || value.app !== 'a-plus-intake'
    || value.kind !== 'synthetic-rehearsal'
    || value.schemaVersion !== 1
    || typeof value.savedAt !== 'string'
    || Number.isNaN(Date.parse(value.savedAt))
    || (value.intakePaused !== undefined && typeof value.intakePaused !== 'boolean')
    || !(value.selectedId === null || typeof value.selectedId === 'string')
    || !Array.isArray(value.cases)
    || (value.complaints !== undefined && !Array.isArray(value.complaints))) {
    return { ok: false, errors: ['备份格式或版本不受支持。'] }
  }

  if (value.cases.length === 0 || value.cases.length > MAX_CASES) {
    return { ok: false, errors: [`备份需包含 1 至 ${MAX_CASES} 条演练记录。`] }
  }

  if (!value.cases.every(isIntakeCase)) {
    return { ok: false, errors: ['备份中包含字段缺失或类型错误的记录。'] }
  }

  const complaints: unknown[] = Array.isArray(value.complaints) ? value.complaints : []
  if (complaints.length > MAX_COMPLAINTS) {
    return { ok: false, errors: [`备份最多包含 ${MAX_COMPLAINTS} 条投诉记录。`] }
  }
  if (!complaints.every(isComplaint)) {
    return { ok: false, errors: ['备份中包含字段缺失或类型错误的投诉记录。'] }
  }
  const validComplaints = complaints as Complaint[]

  const cases = value.cases
  const errors: string[] = []
  const caseIds = new Set<string>()
  const eventIds = new Set<string>()
  const sourcePostIds = new Set<string>()
  const complaintIds = new Set<string>()
  for (const item of cases) {
    if (caseIds.has(item.id)) errors.push(`记录编号重复：${item.id}。`)
    caseIds.add(item.id)
    if (item.sourcePostId !== undefined) {
      if (sourcePostIds.has(item.sourcePostId)) {
        errors.push(`社区来源帖子 ID 重复：${item.sourcePostId}。`)
      }
      sourcePostIds.add(item.sourcePostId)
      if (item.sourceChannel !== undefined && item.sourceChannel !== 'community-entry-local') {
        errors.push(`${item.id}：社区来源帖子 ID 只适用于“社区入口演练（仅本机）”来源。`)
      }
    }
    try {
      const validation = validateIntakeCase(item)
      if (!validation.ok) errors.push(...validation.errors.map((error) => `${item.id}：${error}`))
      if (!item.summary.trim()) errors.push(`${item.id}：演练摘要不能为空。`)
    } catch {
      errors.push(`记录 ${item.id} 无法安全校验。`)
    }
    for (const event of item.events) {
      if (eventIds.has(event.id)) errors.push(`时间线事件编号重复：${event.id}。`)
      eventIds.add(event.id)
    }
  }

  for (const complaint of validComplaints) {
    if (complaintIds.has(complaint.id)) errors.push(`投诉编号重复：${complaint.id}。`)
    complaintIds.add(complaint.id)
    const validation = validateComplaint(complaint, [...caseIds])
    if (!validation.ok) {
      errors.push(...validation.errors.map((error) => `${complaint.id}：${error}`))
    }
    if (complaint.status === '待复核') {
      const availableReviewers = COMPLAINT_REVIEWER_ROLES.filter(
        (role) => role !== complaint.submittedByRole && role !== complaint.targetRole,
      )
      if (!availableReviewers.length) {
        errors.push(`${complaint.id}：该投诉组合没有可用复核角色，无法导入。`)
      }
    }
  }

  for (const item of cases) {
    for (const relatedId of item.relatedCaseIds ?? []) {
      if (!caseIds.has(relatedId)) errors.push(`记录 ${item.id} 关联了不存在的记录 ${relatedId}。`)
    }
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] }

  const warnings: string[] = []
  let selectedId = value.selectedId
  if (selectedId !== null && !caseIds.has(selectedId)) {
    selectedId = cases[0]?.id ?? null
    warnings.push('备份中选中的记录不存在，已改为首条记录。')
  }

  return {
    ok: true,
    backup: {
      app: 'a-plus-intake',
      kind: 'synthetic-rehearsal',
      schemaVersion: 1,
      savedAt: value.savedAt,
      intakePaused: value.intakePaused === true,
      selectedId,
      cases,
      complaints: validComplaints,
    },
    warnings,
  }
}

function toCanonicalEvent(event: IntakeEvent): IntakeEvent {
  return {
    id: event.id,
    at: event.at,
    kind: event.kind,
    actorRole: event.actorRole,
    action: event.action,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    reasonCode: event.reasonCode,
    note: event.note,
    ...(event.contactOutcome !== undefined ? { contactOutcome: event.contactOutcome } : {}),
    ...(event.consentStatus !== undefined && event.consentStatus !== null
      ? { consentStatus: event.consentStatus }
      : {}),
    ...(event.requiredInfoComplete !== undefined && event.requiredInfoComplete !== null
      ? { requiredInfoComplete: event.requiredInfoComplete }
      : {}),
    ...(event.handoffOutcome !== undefined && event.handoffOutcome !== null
      ? { handoffOutcome: event.handoffOutcome }
      : {}),
    ...(event.handoffOwner !== undefined && event.handoffOwner !== null
      ? { handoffOwner: event.handoffOwner }
      : {}),
    ...(event.duplicateCandidateIds !== undefined
      ? { duplicateCandidateIds: [...event.duplicateCandidateIds] }
      : {}),
    ...(event.changes !== undefined
      ? {
          changes: event.changes.map((change) => ({
            field: change.field,
            label: change.label,
            before: change.before,
            after: change.after,
          })),
        }
      : {}),
  }
}

function toCanonicalCase(intakeCase: IntakeCase): IntakeCase {
  return {
    id: intakeCase.id,
    label: intakeCase.label,
    summary: intakeCase.summary,
    serviceType: intakeCase.serviceType,
    ...(intakeCase.sourceChannel !== undefined
      ? { sourceChannel: intakeCase.sourceChannel }
      : {}),
    ...(intakeCase.sourcePostId !== undefined
      ? { sourcePostId: intakeCase.sourcePostId }
      : {}),
    ...(intakeCase.consentStatus !== undefined
      ? { consentStatus: intakeCase.consentStatus }
      : {}),
    ...(intakeCase.requiredInfoComplete !== undefined
      ? { requiredInfoComplete: intakeCase.requiredInfoComplete }
      : {}),
    status: intakeCase.status,
    riskFlags: intakeCase.riskFlags.map((flag) => ({
      code: flag.code,
      label: flag.label,
      severity: flag.severity,
      note: flag.note,
      raisedAt: flag.raisedAt,
    })),
    owner: intakeCase.owner,
    nextStep: intakeCase.nextStep,
    dueAt: intakeCase.dueAt,
    createdAt: intakeCase.createdAt,
    updatedAt: intakeCase.updatedAt,
    events: intakeCase.events.map(toCanonicalEvent),
    ...(intakeCase.reopenedFromId !== undefined
      ? { reopenedFromId: intakeCase.reopenedFromId }
      : {}),
    ...(intakeCase.relatedCaseIds !== undefined
      ? { relatedCaseIds: [...intakeCase.relatedCaseIds] }
      : {}),
  }
}

function toCanonicalComplaint(complaint: Complaint): Complaint {
  return {
    id: complaint.id,
    caseId: complaint.caseId,
    targetRole: complaint.targetRole,
    submittedByRole: complaint.submittedByRole,
    description: complaint.description,
    status: complaint.status,
    submittedAt: complaint.submittedAt,
    reviewedAt: complaint.reviewedAt,
    reviewerRole: complaint.reviewerRole,
    resolution: complaint.resolution,
  }
}

export function serializeIntakeBackup(
  cases: readonly IntakeCase[],
  selectedId: string | null,
  intakePaused = false,
  complaints: readonly Complaint[] = [],
): string {
  if (cases.length === 0 || cases.length > MAX_CASES) {
    throw new RangeError(`备份需包含 1 至 ${MAX_CASES} 条演练记录。`)
  }
  if (complaints.length > MAX_COMPLAINTS) {
    throw new RangeError(`备份最多包含 ${MAX_COMPLAINTS} 条投诉记录。`)
  }
  const backup: IntakeBackup = {
    app: 'a-plus-intake',
    kind: 'synthetic-rehearsal',
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    intakePaused,
    selectedId,
    cases: cases.map(toCanonicalCase),
    complaints: complaints.map(toCanonicalComplaint),
  }
  const serialized = JSON.stringify(backup, null, 2)
  if (new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_BYTES) {
    throw new RangeError('备份超过 5 MB，无法保存或导出。')
  }
  return serialized
}
