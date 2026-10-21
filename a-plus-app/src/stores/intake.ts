import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  DEFAULT_SERVICE_TYPE,
  HIGH_RISK_STOP_NEXT_STEP,
  appendIntakeEvent,
  applyCheckpointUpdate,
  applyContactSimulation,
  applyIntakeAction,
  applyTimeoutFlag,
  createComplaintRecord,
  findIntakeDuplicateCandidates,
  getCaseCheckpointBlockedReason,
  getIntakeActionBlockedReason,
  getHighRiskStopScreeningNotice,
  isOpenIntakeStatus,
  isSyntheticSourceChannel,
  reviewComplaintRecord,
  validateIntakeCase,
  type Complaint,
  type ConsentStatus,
  type DemoRole,
  type HighRiskHandoffOutcome,
  type IntakeAction,
  type IntakeCase,
  type IntakeEvent,
  type IntakeReasonCode,
  type RiskFlag,
  type ContactSimulationOutcome,
  type SyntheticSourceChannel,
} from '../domain/intake'
import { syntheticIntakeCases } from '../domain/fixtures'
import {
  INTAKE_SELECTION_KEY,
  INTAKE_STORAGE_KEY,
  parseIntakeBackup,
  serializeIntakeBackup,
} from '../domain/intake-backup'

export type IntakeStorageStatus = 'ready' | 'saved' | 'memory-only' | 'save-error' | 'recovery-required' | 'conflict'

/** Local synthetic-rehearsal control only; never a production intake or service authority. */
export const INTAKE_PAUSED_NOTICE =
  '本机合成演练已暂停新登记：不会新建或登记受理记录。此开关只影响当前浏览器的演练数据，不是生产受理权限，也不代表真实服务已停开、停服或已通知任何人。'

export type NewIntakeInput = {
  label: string
  summary: string
  sourceChannel: SyntheticSourceChannel
  /** 仅社区本机求助桥使用；可选，旧调用保持不传。 */
  sourcePostId?: string
  owner: string
  nextStep: string
  dueAt: string
  highRisk: boolean
  highRiskNote: string
}

export type DuplicateReviewInput = {
  candidateIds: string[]
  explanation: string
}

export type CreateIntakeResult = {
  ok: boolean
  errors: string[]
  id?: string
  already?: boolean
  duplicateCandidates?: IntakeCase[]
}

export type TransitionInput = {
  id: string
  action: IntakeAction
  actorRole: DemoRole
  reasonCode?: IntakeReasonCode
  referralTarget?: string
  note: string
  owner: string
  nextStep: string
  dueAt: string
  handoffOutcome?: HighRiskHandoffOutcome
  handoffOwner?: string
}

export type ReopenInput = {
  owner: string
  nextStep: string
  dueAt: string
  note: string
}

export type CheckpointInput = {
  id: string
  consentStatus: ConsentStatus
  requiredInfoComplete: boolean
  note: string
}

export type ComplaintSubmitInput = {
  caseId: string
  targetRole: DemoRole
  description: string
}

export type ComplaintReviewInput = {
  id: string
  resolution: string
}

function copyFixtures(): IntakeCase[] {
  return JSON.parse(JSON.stringify(syntheticIntakeCases)) as IntakeCase[]
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function loadInitialState(): {
  cases: IntakeCase[]
  complaints: Complaint[]
  selectedId: string | null
  intakePaused: boolean
  status: IntakeStorageStatus
  savedAt: string | null
  unreadableBackup: string | null
  storedRaw: string | null
} {
  const fixtures = copyFixtures()
  const storage = getLocalStorage()
  if (!storage) return {
    cases: fixtures,
    complaints: [],
    selectedId: fixtures[0]?.id ?? null,
    intakePaused: false,
    status: 'memory-only',
    savedAt: null,
    unreadableBackup: null,
    storedRaw: null,
  }

  let raw: string | null
  try {
    raw = storage.getItem(INTAKE_STORAGE_KEY)
  } catch {
    return {
      cases: fixtures,
      complaints: [],
      selectedId: fixtures[0]?.id ?? null,
      intakePaused: false,
      status: 'memory-only',
      savedAt: null,
      unreadableBackup: null,
      storedRaw: null,
    }
  }
  const fixtureSelection = readStoredSelection(storage, fixtures, fixtures[0]?.id ?? null)
  if (raw === null) return {
    cases: fixtures,
    complaints: [],
    selectedId: fixtureSelection,
    intakePaused: false,
    status: 'ready',
    savedAt: null,
    unreadableBackup: null,
    storedRaw: null,
  }

  const result = parseIntakeBackup(raw)
  if (!result.ok) {
    return {
      cases: fixtures,
      complaints: [],
      selectedId: fixtures[0]?.id ?? null,
      intakePaused: false,
      status: 'recovery-required',
      savedAt: null,
      unreadableBackup: raw,
      storedRaw: raw,
    }
  }
  return {
    cases: result.backup.cases,
    complaints: result.backup.complaints,
    selectedId: readStoredSelection(storage, result.backup.cases, result.backup.selectedId),
    intakePaused: result.backup.intakePaused,
    status: 'saved',
    savedAt: result.backup.savedAt,
    unreadableBackup: null,
    storedRaw: raw,
  }
}

function readStoredSelection(storage: Storage, items: readonly IntakeCase[], fallback: string | null): string | null {
  try {
    const storedSelection = storage.getItem(INTAKE_SELECTION_KEY)
    return storedSelection && items.some((item) => item.id === storedSelection) ? storedSelection : fallback
  } catch {
    return fallback
  }
}

function localDateTimeToIso(value: string): string | null {
  if (!value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function hasInvalidLocalDateTime(value: string): boolean {
  return value.trim() !== '' && localDateTimeToIso(value) === null
}

function hasHighRiskStopFlag(intakeCase: IntakeCase): boolean {
  return intakeCase.riskFlags.some((flag) => flag.code === 'HIGH_RISK_STOP_SCREENING')
}

function nextSyntheticSequence(items: readonly IntakeCase[]): number {
  return items.reduce((highest, item) => {
    const match = /^SYNTH-(\d+)$/.exec(item.id)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0) + 1
}

function eventId(intakeCase: IntakeCase): string {
  let index = intakeCase.events.length + 1
  while (intakeCase.events.some((event) => event.id === `${intakeCase.id}-EVT-${index}`)) index += 1
  return `${intakeCase.id}-EVT-${index}`
}

function nextEventAt(intakeCase: IntakeCase): string | null {
  const updatedAt = Date.parse(intakeCase.updatedAt)
  const lastEventAt = Date.parse(intakeCase.events[intakeCase.events.length - 1]?.at ?? intakeCase.updatedAt)
  if (Number.isNaN(updatedAt) || Number.isNaN(lastEventAt)) return null
  const date = new Date(Math.max(Date.now(), updatedAt, lastEventAt) + 1)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export const useIntakeStore = defineStore('intake', () => {
  const initialState = loadInitialState()
  const cases = ref<IntakeCase[]>(initialState.cases)
  const complaints = ref<Complaint[]>(initialState.complaints)
  const selectedId = ref<string | null>(initialState.selectedId)
  const intakePaused = ref(initialState.intakePaused)
  const currentDemoRole = ref<DemoRole>('demo-intake')
  const storageStatus = ref<IntakeStorageStatus>(initialState.status)
  const lastSavedAt = ref<string | null>(initialState.savedAt)
  const unreadableBackup = ref<string | null>(initialState.unreadableBackup)
  const clockNow = ref(Date.now())
  let lastKnownSnapshot = initialState.storedRaw

  const selectedCase = computed(() => cases.value.find((item) => item.id === selectedId.value) ?? null)
  const activeCases = computed(() => cases.value.filter((item) => isOpenIntakeStatus(item.status)))
  const overdueCases = computed(() => activeCases.value.filter((item) => {
    const due = item.dueAt ? Date.parse(item.dueAt) : Number.NaN
    return !Number.isNaN(due) && due < clockNow.value
  }))
  const highRiskCases = computed(() => cases.value.filter(hasHighRiskStopFlag))
  const triageCases = computed(() => cases.value.filter((item) =>
    !hasHighRiskStopFlag(item) && (item.status === '已收件' || item.status === '已受理待分诊'),
  ))
  const screeningCases = computed(() => cases.value.filter((item) =>
    item.status === '初筛中' && !hasHighRiskStopFlag(item),
  ))
  const completedCases = computed(() => cases.value.filter((item) => !isOpenIntakeStatus(item.status)))
  const pendingComplaints = computed(() => complaints.value.filter((item) => item.status === '待复核'))

  function writeSnapshot(
    nextCases: readonly IntakeCase[],
    nextSelectedId: string | null,
    nextPaused = intakePaused.value,
    nextComplaints: readonly Complaint[] = complaints.value,
  ): boolean {
    const savedAt = new Date().toISOString()
    let backup: string
    try {
      backup = serializeIntakeBackup(nextCases, nextSelectedId, nextPaused, nextComplaints)
    } catch {
      storageStatus.value = 'save-error'
      return false
    }

    // 写入边界再次校验完整快照，避免单条非法记录或跨记录关系破坏旧存档。
    const validation = parseIntakeBackup(backup)
    if (!validation.ok) {
      storageStatus.value = 'save-error'
      return false
    }

    const storage = getLocalStorage()
    if (!storage) {
      storageStatus.value = 'memory-only'
      return false
    }
    try {
      if (storage.getItem(INTAKE_STORAGE_KEY) !== lastKnownSnapshot) {
        storageStatus.value = 'conflict'
        return false
      }
      storage.setItem(INTAKE_STORAGE_KEY, backup)
      lastKnownSnapshot = backup
      storageStatus.value = 'saved'
      lastSavedAt.value = savedAt
      unreadableBackup.value = null
      return true
    } catch {
      storageStatus.value = 'save-error'
      return false
    }
  }

  function applySnapshotToState(
    nextCases: IntakeCase[],
    nextSelectedId: string | null,
    nextPaused = intakePaused.value,
    nextComplaints: readonly Complaint[] = complaints.value,
  ) {
    cases.value = JSON.parse(JSON.stringify(nextCases)) as IntakeCase[]
    complaints.value = JSON.parse(JSON.stringify(nextComplaints)) as Complaint[]
    selectedId.value = nextSelectedId
    intakePaused.value = nextPaused
    const storage = getLocalStorage()
    if (storage) {
      try {
        if (nextSelectedId === null) storage.removeItem(INTAKE_SELECTION_KEY)
        else storage.setItem(INTAKE_SELECTION_KEY, nextSelectedId)
      } catch {
        // Selection is a convenience; the canonical case backup remains authoritative.
      }
    }
  }

  function commitSnapshot(
    nextCases: IntakeCase[],
    nextSelectedId = selectedId.value,
    nextPaused = intakePaused.value,
    nextComplaints: readonly Complaint[] = complaints.value,
  ): string | null {
    if (storageStatus.value === 'recovery-required') {
      return '旧存档无法读取，请先导出旧存档或恢复备份后再修改。'
    }
    writeSnapshot(nextCases, nextSelectedId, nextPaused, nextComplaints)
    if (storageStatus.value === 'conflict') {
      return '另一个窗口已更新存档，请先重新载入最新存档再继续。'
    }
    if (storageStatus.value === 'save-error') {
      return '本次操作未应用：存档校验失败或浏览器写入失败。请检查演练记录并确认浏览器存储空间可用。'
    }
    applySnapshotToState(nextCases, nextSelectedId, nextPaused, nextComplaints)
    return null
  }

  function replaceSnapshot(
    nextCases: IntakeCase[],
    nextSelectedId: string | null,
    nextPaused = intakePaused.value,
    nextComplaints: readonly Complaint[] = [],
  ): boolean {
    if (!writeSnapshot(nextCases, nextSelectedId, nextPaused, nextComplaints) && storageStatus.value !== 'memory-only') return false
    applySnapshotToState(nextCases, nextSelectedId, nextPaused, nextComplaints)
    return true
  }

  function reloadFromStorage(): { ok: boolean; errors: string[] } {
    const storage = getLocalStorage()
    if (!storage) {
      storageStatus.value = 'memory-only'
      return { ok: false, errors: ['当前浏览器不可用本机存档。'] }
    }
    let raw: string | null
    try {
      raw = storage.getItem(INTAKE_STORAGE_KEY)
    } catch {
      storageStatus.value = 'save-error'
      return { ok: false, errors: ['读取本机存档失败，请检查浏览器存储权限。'] }
    }
    if (raw === null) {
      const fixtures = copyFixtures()
      lastKnownSnapshot = null
      storageStatus.value = 'ready'
      lastSavedAt.value = null
      unreadableBackup.value = null
      applySnapshotToState(fixtures, fixtures[0]?.id ?? null, false, [])
      return { ok: true, errors: [] }
    }
    const result = parseIntakeBackup(raw)
    if (!result.ok) {
      storageStatus.value = 'recovery-required'
      unreadableBackup.value = raw
      return { ok: false, errors: result.errors }
    }
    lastKnownSnapshot = raw
    storageStatus.value = 'saved'
    lastSavedAt.value = result.backup.savedAt
    unreadableBackup.value = null
    applySnapshotToState(
      result.backup.cases,
      result.backup.selectedId,
      result.backup.intakePaused,
      result.backup.complaints,
    )
    return { ok: true, errors: result.warnings }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== INTAKE_STORAGE_KEY || event.newValue === lastKnownSnapshot) return
      if (storageStatus.value !== 'recovery-required') storageStatus.value = 'conflict'
    })
  }

  function exportBackup(): string {
    return serializeIntakeBackup(cases.value, selectedId.value, intakePaused.value, complaints.value)
  }

  function exportUnreadableBackup(): string | null {
    return unreadableBackup.value
  }

  function importBackup(raw: string): { ok: boolean; errors: string[]; warnings: string[] } {
    const result = parseIntakeBackup(raw)
    if (!result.ok) return { ok: false, errors: result.errors, warnings: [] }
    if (!replaceSnapshot(
      result.backup.cases,
      result.backup.selectedId,
      result.backup.intakePaused,
      result.backup.complaints,
    )) {
      return { ok: false, errors: ['无法写入本机存档，当前演练数据未变更。'], warnings: [] }
    }
    return { ok: true, errors: [], warnings: result.warnings }
  }

  function setIntakePaused(paused: boolean): { ok: boolean; errors: string[] } {
    if (intakePaused.value === paused) return { ok: true, errors: [] }
    const saveError = commitSnapshot(cases.value, selectedId.value, paused)
    if (saveError) return { ok: false, errors: [saveError] }
    return { ok: true, errors: [] }
  }

  function select(id: string) {
    if (!cases.value.some((item) => item.id === id)) return
    selectedId.value = id
    const storage = getLocalStorage()
    if (storage) {
      try {
        storage.setItem(INTAKE_SELECTION_KEY, id)
      } catch {
        // The selected record is still available for this session.
      }
    }
  }

  function reset(): { ok: boolean; errors: string[] } {
    const fixtures = copyFixtures()
    if (!replaceSnapshot(fixtures, fixtures[0]?.id ?? null, intakePaused.value, [])) {
      return { ok: false, errors: ['无法写入本机存档，当前演练数据未变更。'] }
    }
    return { ok: true, errors: [] }
  }

  function createCase(
    input: NewIntakeInput,
    duplicateReview?: DuplicateReviewInput,
  ): CreateIntakeResult {
    if (intakePaused.value) return { ok: false, errors: [INTAKE_PAUSED_NOTICE] }
    const sourcePostId = input.sourcePostId?.trim()
    if (input.sourcePostId !== undefined && !sourcePostId) {
      return { ok: false, errors: ['社区来源帖子 ID 无效。'] }
    }
    if (sourcePostId) {
      const existing = cases.value.find((item) => item.sourcePostId === sourcePostId)
      if (existing) {
        return { ok: true, errors: [], id: existing.id, already: true }
      }
    }
    const now = new Date().toISOString()
    const sequence = String(nextSyntheticSequence(cases.value)).padStart(3, '0')
    const id = `SYNTH-${sequence}`
    if (cases.value.some((item) => item.id === id)) {
      return { ok: false, errors: ['演练编号冲突，请重试。'] }
    }
    const label = input.label.trim() || `演练-${sequence}`
    const summary = input.summary.trim()
    if (!isSyntheticSourceChannel(input.sourceChannel)) {
      return { ok: false, errors: ['请选择来源渠道演练标记。'] }
    }
    const dueAt = localDateTimeToIso(input.dueAt)
    if (hasInvalidLocalDateTime(input.dueAt)) {
      return { ok: false, errors: ['请填写有效的跟进截止时间。'] }
    }
    if (input.highRisk && !input.highRiskNote.trim()) {
      return { ok: false, errors: ['请填写高风险停止初筛的虚构演练依据。'] }
    }

    const duplicateCandidates = findIntakeDuplicateCandidates(cases.value, { label, summary })
    let duplicateCandidateIds: string[] = []
    if (duplicateCandidates.length) {
      if (!duplicateReview) {
        return { ok: false, errors: [], duplicateCandidates }
      }
      duplicateCandidateIds = [...new Set(duplicateReview.candidateIds)]
      if (!duplicateReview.explanation.trim()) {
        return { ok: false, errors: ['请填写人工重复复核说明。'] }
      }
      if (
        duplicateCandidateIds.length !== duplicateCandidates.length
        || !duplicateCandidates.every((candidate) => duplicateCandidateIds.includes(candidate.id))
      ) {
        return { ok: false, errors: ['候选记录已变化，请返回并重新核对重复登记。'] }
      }
    } else if (duplicateReview) {
      return { ok: false, errors: ['重复候选已变化，请返回并重新核对重复登记。'] }
    }

    const duplicateReviewAt = duplicateReview
      ? new Date(Date.parse(now) + 1).toISOString()
      : null
    const riskFlagAt = input.highRisk
      ? new Date(Date.parse(now) + (duplicateReview ? 2 : 1)).toISOString()
      : null
    const flags: RiskFlag[] = input.highRisk ? [{
      code: 'HIGH_RISK_STOP_SCREENING',
      label: '高风险：停止常规初筛',
      severity: 'high',
      note: input.highRiskNote.trim(),
      raisedAt: riskFlagAt!,
    }] : []

    const createdEvent: IntakeEvent = {
      id: `${id}-EVT-1`,
      at: now,
      kind: 'created',
      actorRole: currentDemoRole.value,
      action: null,
      fromStatus: null,
      toStatus: '已收件',
      reasonCode: null,
      note: '演练记录创建（合成数据）。',
    }
    const events: IntakeEvent[] = [createdEvent]
    if (duplicateReview) {
      events.push({
        id: `${id}-EVT-2`,
        at: duplicateReviewAt!,
        kind: 'duplicate-review',
        actorRole: currentDemoRole.value,
        action: null,
        fromStatus: '已收件',
        toStatus: '已收件',
        reasonCode: null,
        note: `人工重复登记复核：已核对候选记录 ${duplicateCandidateIds.join('、')}；经人工确认仍创建独立记录。说明：${duplicateReview.explanation.trim()}`,
        duplicateCandidateIds,
      })
    }
    if (input.highRisk) {
      const requestedNextStep = input.nextStep.trim() || null
      events.push({
        id: `${id}-EVT-${events.length + 1}`,
        at: riskFlagAt!,
        kind: 'risk-flag',
        actorRole: currentDemoRole.value,
        action: null,
        fromStatus: '已收件',
        toStatus: '已收件',
        reasonCode: null,
        note: `已标记高风险并停止常规初筛；演练依据：${input.highRiskNote.trim()} 未执行任何通知、联系或派发。`,
        changes: requestedNextStep === HIGH_RISK_STOP_NEXT_STEP ? [] : [{
          field: 'nextStep',
          label: '下一步',
          before: requestedNextStep,
          after: HIGH_RISK_STOP_NEXT_STEP,
        }],
      })
    }
    const intakeCase: IntakeCase = {
      id,
      label,
      summary,
      serviceType: DEFAULT_SERVICE_TYPE,
      sourceChannel: input.sourceChannel,
      ...(sourcePostId ? { sourcePostId } : {}),
      consentStatus: 'unknown',
      requiredInfoComplete: false,
      status: '已收件',
      riskFlags: flags,
      owner: input.owner.trim(),
      nextStep: input.highRisk ? HIGH_RISK_STOP_NEXT_STEP : input.nextStep.trim(),
      dueAt,
      createdAt: now,
      updatedAt: events[events.length - 1]!.at,
      events,
      ...(duplicateCandidateIds.length ? { relatedCaseIds: duplicateCandidateIds } : {}),
    }
    const validation = validateIntakeCase(intakeCase)
    if (!validation.ok) return { ok: false, errors: [...validation.errors] }

    const saveError = commitSnapshot([intakeCase, ...cases.value], id)
    if (saveError) return { ok: false, errors: [saveError] }
    return { ok: true, errors: [], id }
  }

  function reopenCase(
    sourceId: string,
    input: ReopenInput,
  ): { ok: boolean; errors: string[]; id?: string } {
    if (intakePaused.value) return { ok: false, errors: [INTAKE_PAUSED_NOTICE] }
    const source = cases.value.find((item) => item.id === sourceId)
    if (!source) return { ok: false, errors: ['找不到要关联重开的演练记录。'] }
    if (isOpenIntakeStatus(source.status)) {
      return { ok: false, errors: ['开放中的记录不能通过重开流程重复登记。'] }
    }
    if (hasHighRiskStopFlag(source)) {
      return { ok: false, errors: ['带有高风险停止标记的记录不能通过普通重开流程创建未标记记录。'] }
    }
    if (!input.note.trim()) return { ok: false, errors: ['请填写建立关联重开的演练原因。'] }
    if (hasInvalidLocalDateTime(input.dueAt)) {
      return { ok: false, errors: ['请填写有效的跟进截止时间。'] }
    }

    const owner = input.owner.trim()
    const nextStep = input.nextStep.trim()
    const dueAt = localDateTimeToIso(input.dueAt)
    if (!owner || !nextStep || !dueAt) {
      return { ok: false, errors: ['重开的开放记录必须指定负责人、下一步和截止时间。'] }
    }

    const sequence = String(nextSyntheticSequence(cases.value)).padStart(3, '0')
    const id = `SYNTH-${sequence}`
    if (cases.value.some((item) => item.id === id)) {
      return { ok: false, errors: ['演练编号冲突，请重试。'] }
    }
    const now = new Date().toISOString()
    const linkedIds = [...new Set([...(source.relatedCaseIds ?? []), id])]
    const linkAt = nextEventAt(source)
    if (!linkAt) return { ok: false, errors: ['来源记录时间线无效，无法建立关联。'] }
    const createdEvent: IntakeEvent = {
      id: `${id}-EVT-1`,
      at: now,
      kind: 'created',
      actorRole: currentDemoRole.value,
      action: null,
      fromStatus: null,
      toStatus: '已收件',
      reasonCode: null,
      note: `关联重开演练记录，来源：${source.id}。原因：${input.note.trim()}`,
    }
    const linkEvent: IntakeEvent = {
      id: `${id}-EVT-2`,
      at: linkAt,
      kind: 'case-link',
      actorRole: currentDemoRole.value,
      action: null,
      fromStatus: '已收件',
      toStatus: '已收件',
      reasonCode: null,
      note: `已与来源演练记录 ${source.id} 建立关联；未覆盖原记录。`,
    }
    const reopened: IntakeCase = {
      id,
      label: `${source.label.slice(0, 27)}-重开`,
      summary: source.summary,
      serviceType: source.serviceType,
      ...(source.sourceChannel !== undefined ? { sourceChannel: source.sourceChannel } : {}),
      consentStatus: 'unknown',
      requiredInfoComplete: false,
      status: '已收件',
      riskFlags: [],
      owner,
      nextStep,
      dueAt,
      createdAt: now,
      updatedAt: linkAt,
      events: [createdEvent, linkEvent],
      reopenedFromId: source.id,
      relatedCaseIds: [source.id],
    }
    const sourceEvent: IntakeEvent = {
      id: eventId(source),
      at: linkAt,
      kind: 'case-link',
      actorRole: currentDemoRole.value,
      action: null,
      fromStatus: source.status,
      toStatus: source.status,
      reasonCode: null,
      note: `已关联新建的重开演练记录 ${id}；原记录保留。原因：${input.note.trim()}`,
    }
    const updatedSource = appendIntakeEvent({
      ...source,
      relatedCaseIds: linkedIds,
    }, sourceEvent)
    const sourceValidation = validateIntakeCase(updatedSource)
    const reopenedValidation = validateIntakeCase(reopened)
    if (!sourceValidation.ok || !reopenedValidation.ok) {
      return { ok: false, errors: [...sourceValidation.errors, ...reopenedValidation.errors] }
    }

    const nextCases = [reopened, ...cases.value.map((item) => item.id === sourceId ? updatedSource : item)]
    const saveError = commitSnapshot(nextCases, id)
    if (saveError) return { ok: false, errors: [saveError] }
    return { ok: true, errors: [], id }
  }

  function transition(input: TransitionInput): { ok: boolean; errors: string[] } {
    const intakeCase = cases.value.find((item) => item.id === input.id)
    if (!intakeCase) return { ok: false, errors: ['找不到这条演练记录。'] }
    const blockedReason = getIntakeActionBlockedReason(input.action, intakeCase)
    if (blockedReason) return { ok: false, errors: [blockedReason] }
    if (hasInvalidLocalDateTime(input.dueAt)) {
      return { ok: false, errors: ['请填写有效的跟进截止时间。'] }
    }
    const at = nextEventAt(intakeCase)
    if (!at) return { ok: false, errors: ['记录时间线无效，无法追加状态更新。'] }

    const result = applyIntakeAction({
      case: intakeCase,
      action: input.action,
      at,
      actorRole: input.actorRole,
      reasonCode: input.reasonCode,
      note: input.note,
      referralTarget: input.referralTarget,
      owner: input.owner.trim() || null,
      nextStep: input.nextStep.trim() || null,
      dueAt: localDateTimeToIso(input.dueAt),
      handoffOutcome: input.handoffOutcome,
      handoffOwner: input.handoffOwner,
    })
    if (!result.ok || !result.nextCase) return { ok: false, errors: [...result.errors] }
    const saveError = commitSnapshot(cases.value.map((item) => item.id === input.id ? result.nextCase! : item))
    if (saveError) return { ok: false, errors: [saveError] }
    return { ok: true, errors: [] }
  }

  function updateCheckpoint(input: CheckpointInput): { ok: boolean; errors: string[] } {
    const intakeCase = cases.value.find((item) => item.id === input.id)
    if (!intakeCase) return { ok: false, errors: ['找不到这条演练记录。'] }
    if (!isOpenIntakeStatus(intakeCase.status)) {
      return { ok: false, errors: ['已结束的演练记录不能更新登记检查点。'] }
    }
    if (hasHighRiskStopFlag(intakeCase)) {
      return { ok: false, errors: ['高风险停止初筛后不能更新登记检查点；请使用人工交接通道。'] }
    }
    if (!input.note.trim()) return { ok: false, errors: ['请填写登记检查点更新说明。'] }
    const at = nextEventAt(intakeCase)
    if (!at) return { ok: false, errors: ['记录时间线无效，无法追加检查点更新。'] }

    const result = applyCheckpointUpdate({
      case: intakeCase,
      consentStatus: input.consentStatus,
      requiredInfoComplete: input.requiredInfoComplete,
      at,
      actorRole: currentDemoRole.value,
      note: input.note,
    })
    if (!result.ok || !result.nextCase) return { ok: false, errors: [...result.errors] }
    const saveError = commitSnapshot(cases.value.map((item) => item.id === input.id ? result.nextCase! : item))
    if (saveError) return { ok: false, errors: [saveError] }
    return { ok: true, errors: [] }
  }

  function submitComplaint(input: ComplaintSubmitInput): { ok: boolean; errors: string[]; id?: string } {
    const intakeCase = cases.value.find((item) => item.id === input.caseId)
    if (!intakeCase) return { ok: false, errors: ['找不到要关联投诉的演练记录。'] }
    if (input.targetRole === currentDemoRole.value) {
      return { ok: false, errors: ['不能针对提交人自己的演示角色提交投诉。'] }
    }
    const id = nextComplaintId(complaints.value)
    const result = createComplaintRecord({
      id,
      caseId: input.caseId,
      targetRole: input.targetRole,
      submittedByRole: currentDemoRole.value,
      description: input.description,
      submittedAt: new Date().toISOString(),
    })
    if (!result.ok || !result.complaint) return { ok: false, errors: [...result.errors] }
    const saveError = commitSnapshot(cases.value, selectedId.value, intakePaused.value, [
      result.complaint,
      ...complaints.value,
    ])
    if (saveError) return { ok: false, errors: [saveError] }
    return { ok: true, errors: [], id: result.complaint.id }
  }

  function reviewComplaint(input: ComplaintReviewInput): { ok: boolean; errors: string[] } {
    const complaint = complaints.value.find((item) => item.id === input.id)
    if (!complaint) return { ok: false, errors: ['找不到这条投诉记录。'] }
    const reviewedAt = new Date(Math.max(Date.now(), Date.parse(complaint.submittedAt) + 1)).toISOString()
    const result = reviewComplaintRecord({
      complaint,
      reviewerRole: currentDemoRole.value,
      reviewedAt,
      resolution: input.resolution,
    })
    if (!result.ok || !result.complaint) return { ok: false, errors: [...result.errors] }
    const saveError = commitSnapshot(cases.value, selectedId.value, intakePaused.value,
      complaints.value.map((item) => item.id === input.id ? result.complaint! : item))
    if (saveError) return { ok: false, errors: [saveError] }
    return { ok: true, errors: [] }
  }

  function nextComplaintId(items: readonly Complaint[]): string {
    let sequence = items.length + 1
    while (items.some((item) => item.id === `CMP-${String(sequence).padStart(3, '0')}`)) sequence += 1
    return `CMP-${String(sequence).padStart(3, '0')}`
  }

  function raiseHighRiskStop(input: { id: string; note: string }): { ok: boolean; errors: string[] } {
    const intakeCase = cases.value.find((item) => item.id === input.id)
    if (!intakeCase) return { ok: false, errors: ['找不到这条演练记录。'] }
    if (!isOpenIntakeStatus(intakeCase.status)) {
      return { ok: false, errors: ['已结束的演练记录不能追加高风险停止标记。'] }
    }
    if (hasHighRiskStopFlag(intakeCase)) {
      return { ok: false, errors: ['这条记录已经标记为高风险停止初筛。'] }
    }
    const note = input.note.trim()
    if (!note) return { ok: false, errors: ['请填写高风险停止初筛的虚构演练依据。'] }

    const at = nextEventAt(intakeCase)
    if (!at) return { ok: false, errors: ['记录时间线无效，无法追加高风险标记。'] }
    const flag: RiskFlag = {
      code: 'HIGH_RISK_STOP_SCREENING',
      label: '高风险：停止常规初筛',
      severity: 'high',
      note,
      raisedAt: at,
    }
    const event: IntakeEvent = {
      id: eventId(intakeCase),
      at,
      kind: 'risk-flag',
      actorRole: currentDemoRole.value,
      action: null,
      fromStatus: intakeCase.status,
      toStatus: intakeCase.status,
      reasonCode: null,
      note: `已标记高风险并停止常规初筛；演练依据：${note} 未执行任何通知、联系或派发。`,
      changes: intakeCase.nextStep === HIGH_RISK_STOP_NEXT_STEP ? [] : [{
        field: 'nextStep',
        label: '下一步',
        before: intakeCase.nextStep,
        after: HIGH_RISK_STOP_NEXT_STEP,
      }],
    }
    const updated = appendIntakeEvent({
      ...intakeCase,
      riskFlags: [...intakeCase.riskFlags, flag],
      nextStep: HIGH_RISK_STOP_NEXT_STEP,
    }, event)
    const validation = validateIntakeCase(updated)
    if (!validation.ok) return { ok: false, errors: [...validation.errors] }
    const saveError = commitSnapshot(cases.value.map((item) => item.id === input.id ? updated : item))
    if (saveError) return { ok: false, errors: [saveError] }
    return { ok: true, errors: [] }
  }

  function updateFollowUp(input: { id: string; owner: string; nextStep: string; dueAt: string; note: string }) {
    const intakeCase = cases.value.find((item) => item.id === input.id)
    if (!intakeCase) return { ok: false, errors: ['找不到这条演练记录。'] }
    const highRiskNotice = getHighRiskStopScreeningNotice(intakeCase)
    if (highRiskNotice) return { ok: false, errors: [highRiskNotice] }
    const checkpointBlockedReason = getCaseCheckpointBlockedReason(intakeCase)
    if (checkpointBlockedReason) return { ok: false, errors: [checkpointBlockedReason] }
    if (!isOpenIntakeStatus(intakeCase.status)) {
      return { ok: false, errors: ['已结束的演练记录不能调整开放跟进。'] }
    }
    if (!input.note.trim()) return { ok: false, errors: ['请填写调整原因。'] }
    if (hasInvalidLocalDateTime(input.dueAt)) {
      return { ok: false, errors: ['请填写有效的跟进截止时间。'] }
    }
    const at = nextEventAt(intakeCase)
    if (!at) return { ok: false, errors: ['记录时间线无效，无法调整跟进信息。'] }
    const owner = input.owner.trim() || null
    const nextStep = input.nextStep.trim() || null
    const dueAt = localDateTimeToIso(input.dueAt)
    const changes: NonNullable<IntakeEvent['changes']> = [
      { field: 'owner' as const, label: '负责人', before: intakeCase.owner, after: owner },
      { field: 'nextStep' as const, label: '下一步', before: intakeCase.nextStep, after: nextStep },
      { field: 'dueAt' as const, label: '跟进截止', before: intakeCase.dueAt, after: dueAt },
    ].filter((change) => change.before !== change.after)
    const event: IntakeEvent = {
      id: eventId(intakeCase),
      at,
      kind: 'follow-up-update',
      actorRole: currentDemoRole.value,
      action: null,
      fromStatus: intakeCase.status,
      toStatus: intakeCase.status,
      reasonCode: null,
      note: `跟进信息调整：${input.note.trim() || '未填写说明。'}`,
      changes,
    }
    const updated = appendIntakeEvent({
      ...intakeCase,
      riskFlags: intakeCase.riskFlags.filter((flag) => flag.code !== 'OVERDUE'
        || (dueAt !== null && Date.parse(dueAt) < Date.parse(at))),
      owner,
      nextStep,
      dueAt,
    }, event)
    const validation = validateIntakeCase(updated)
    if (!validation.ok) return { ok: false, errors: [...validation.errors] }
    const saveError = commitSnapshot(cases.value.map((item) => item.id === input.id ? updated : item))
    if (saveError) return { ok: false, errors: [saveError] }
    return { ok: true, errors: [] }
  }

  function recordContactSimulation(input: {
    id: string
    outcome: ContactSimulationOutcome
    owner: string
    nextStep: string
    dueAt: string
    note: string
  }) {
    const intakeCase = cases.value.find((item) => item.id === input.id)
    if (!intakeCase) return { ok: false, errors: ['找不到这条演练记录。'] }
    const highRiskNotice = getHighRiskStopScreeningNotice(intakeCase)
    if (highRiskNotice) return { ok: false, errors: [highRiskNotice] }
    const checkpointBlockedReason = getCaseCheckpointBlockedReason(intakeCase)
    if (checkpointBlockedReason) return { ok: false, errors: [checkpointBlockedReason] }
    if (hasInvalidLocalDateTime(input.dueAt)) {
      return { ok: false, errors: ['请填写有效的跟进截止时间。'] }
    }

    const at = nextEventAt(intakeCase)
    if (!at) return { ok: false, errors: ['记录时间线无效，无法追加模拟联系记录。'] }
    const result = applyContactSimulation({
      case: intakeCase,
      outcome: input.outcome,
      at,
      actorRole: currentDemoRole.value,
      note: input.note,
      owner: input.owner.trim() || null,
      nextStep: input.nextStep.trim() || null,
      dueAt: localDateTimeToIso(input.dueAt),
    })
    if (!result.ok || !result.nextCase) return { ok: false, errors: [...result.errors] }
    const saveError = commitSnapshot(cases.value.map((item) => item.id === input.id ? result.nextCase! : item))
    if (saveError) return { ok: false, errors: [saveError] }
    return { ok: true, errors: [] }
  }

  function refreshClock() {
    const now = new Date().toISOString()
    clockNow.value = Date.parse(now)

    const nextCases = cases.value.map((intakeCase) => applyTimeoutFlag(intakeCase, now))
    if (nextCases.every((intakeCase, index) => intakeCase === cases.value[index])) return
    if (['conflict', 'recovery-required', 'save-error'].includes(storageStatus.value)) return

    commitSnapshot(nextCases)
  }

  return {
    cases,
    complaints,
    selectedId,
    intakePaused,
    currentDemoRole,
    selectedCase,
    activeCases,
    overdueCases,
    clockNow,
    highRiskCases,
    triageCases,
    screeningCases,
    completedCases,
    pendingComplaints,
    storageStatus,
    lastSavedAt,
    select,
    setIntakePaused,
    refreshClock,
    reset,
    exportBackup,
    exportUnreadableBackup,
    importBackup,
    reloadFromStorage,
    createCase,
    raiseHighRiskStop,
    transition,
    updateCheckpoint,
    submitComplaint,
    reviewComplaint,
    updateFollowUp,
    recordContactSimulation,
    reopenCase,
  }
})
