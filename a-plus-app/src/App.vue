<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  CHECKPOINT_SYNTHETIC_NOTICE,
  COMPLAINT_SYNTHETIC_NOTICE,
  CONSENT_STATUSES,
  CONTACT_SIMULATION_OUTCOMES,
  DEFAULT_SYNTHETIC_SOURCE_CHANNEL,
  HIGH_RISK_HANDOFF_OUTCOMES,
  HIGH_RISK_STOP_NEXT_STEP,
  INTAKE_REASON_CODES,
  SYNTHETIC_SOURCE_CHANNELS,
  getCaseConsentStatus,
  getCaseCheckpointBlockedReason,
  getContactSimulationOutcomeLabel,
  getConsentStatusLabel,
  getHighRiskHandoffOutcomeLabel,
  getHighRiskStopScreeningNotice,
  getIntakeActionBlockedReason,
  getSyntheticSourceChannelLabel,
  getAllowedIntakeActions,
  getIntakeActionTarget,
  isCaseCheckpointReady,
  isCaseRequiredInfoComplete,
  isComplaintReviewerRole,
  isIntakeOverdue,
  isOpenIntakeStatus,
  intakeActionRequiresReason,
  type ConsentStatus,
  type DemoRole,
  type HighRiskHandoffOutcome,
  type IntakeAction,
  type IntakeCase,
  type IntakeEvent,
  type IntakeReasonCode,
  type ContactSimulationOutcome,
} from './domain/intake'
import { useIntakeStore, INTAKE_PAUSED_NOTICE, type NewIntakeInput } from './stores/intake'
import { MAX_BACKUP_BYTES } from './domain/intake-backup'
import {
  mapCommunityHelpPostToIntake,
  readCommunityHelpPosts,
  type CommunityHelpPost,
  type CommunityHelpReadResult,
} from './domain/community-bridge'
import { resolveIntakeSourceLink } from './community/intake-progress'

const store = useIntakeStore()
const backupInput = ref<HTMLInputElement | null>(null)
const backupText = ref('')
const backupTextInput = ref<HTMLTextAreaElement | null>(null)
const search = ref('')
const activeFilter = ref('全部记录')
const showCreate = ref(false)
const showTransition = ref(false)
const showFollowUp = ref(false)
const showContactSimulation = ref(false)
const showReopen = ref(false)
const showHighRiskStop = ref(false)
const toastMessage = ref('')
const createError = ref('')
const duplicateCandidates = ref<IntakeCase[]>([])
const duplicateReviewRequired = ref(false)
const duplicateConfirmed = ref(false)
const duplicateExplanation = ref('')
const duplicateError = ref('')
const transitionErrors = ref<string[]>([])
const followUpError = ref('')
const contactSimulationError = ref('')
const reopenError = ref('')
const highRiskError = ref('')
const highRiskNote = ref('')
const showCheckpoint = ref(false)
const checkpointError = ref('')
const checkpointForm = reactive({
  consentStatus: 'unknown' as ConsentStatus,
  requiredInfoComplete: false,
  note: '',
})
const showComplaint = ref(false)
const complaintError = ref('')
const complaintSyntheticConfirmed = ref(false)
const complaintForm = reactive({
  targetRole: 'demo-review' as DemoRole,
  description: '',
})
const complaintFilter = ref<'待复核' | '全部投诉'>('待复核')
const selectedComplaintId = ref<string | null>(null)
const complaintReviewResolution = ref('')
const complaintReviewError = ref('')
const syntheticConfirmed = ref(false)
const showCommunityBridge = ref(false)
const communityReadResult = ref<CommunityHelpReadResult | null>(null)
const communitySyntheticConfirmed = ref(false)
const communityPendingPost = ref<CommunityHelpPost | null>(null)
const communityPendingInput = ref<NewIntakeInput | null>(null)
const communityDuplicateCandidates = ref<IntakeCase[]>([])
const communityDuplicateConfirmed = ref(false)
const communityDuplicateExplanation = ref('')
const communityBridgeError = ref('')
const storageStatusLabel = computed(() => ({
  ready: '本机存档将在首次修改时创建',
  saved: '已保存在当前浏览器',
  'memory-only': '当前不可用本机存档',
  'save-error': '本机存档写入失败',
  'recovery-required': '发现无法读取的旧存档，尚未覆盖',
  conflict: '其他窗口已更新存档，请重新载入',
}[store.storageStatus]))
const lastSavedLabel = computed(() => store.lastSavedAt
  ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(store.lastSavedAt))
  : '')

const communityRegisteredCases = computed(() => {
  const candidates = new Map<string, { intakeCase: IntakeCase; reopenedDepth: number }>()
  for (const item of store.cases) {
    const sourceLink = resolveIntakeSourceLink(item, store.cases)
    if (!sourceLink) continue
    const previous = candidates.get(sourceLink.sourcePostId)
    if (
      !previous
      || sourceLink.reopenedDepth > previous.reopenedDepth
      || (sourceLink.reopenedDepth === previous.reopenedDepth
        && Date.parse(item.updatedAt) >= Date.parse(previous.intakeCase.updatedAt))
    ) {
      candidates.set(sourceLink.sourcePostId, { intakeCase: item, reopenedDepth: sourceLink.reopenedDepth })
    }
  }
  return new Map([...candidates].map(([sourcePostId, candidate]) => [sourcePostId, candidate.intakeCase]))
})
const communityReviewRequired = computed(() =>
  communityPendingInput.value !== null && communityDuplicateCandidates.value.length > 0,
)
const communityPendingMapping = computed(() =>
  communityPendingPost.value ? mapCommunityHelpPostToIntake(communityPendingPost.value) : null,
)
const communityReadStatus = computed(() => {
  const result = communityReadResult.value
  if (!result) return '尚未读取社区存档'
  if (result.status === 'missing') return '未找到社区演练存档'
  if (result.status === 'error') return '社区演练存档读取失败'
  if (result.posts.length === 0) return '存档已读取，但没有可登记的合成求助'
  return `已读取 ${result.posts.length} 条合成求助 · 存档保存于 ${formatDate(result.savedAt)}`
})
const communityReadMessage = computed(() => {
  const result = communityReadResult.value
  return result && result.status !== 'ready' ? result.message : ''
})
const communityPostsWithStatus = computed(() => {
  const result = communityReadResult.value
  if (!result || result.status !== 'ready') return []
  return result.posts.map((post) => ({
    post,
    mapping: mapCommunityHelpPostToIntake(post),
    registered: communityRegisteredCases.value.get(post.id) ?? null,
  }))
})

const filters = ['全部记录', '待处理', '演练逾期', '高风险', '已结束']
const roles: { value: DemoRole; label: string }[] = [
  { value: 'demo-intake', label: '演示 · 受理席' },
  { value: 'demo-review', label: '演示 · 复核席' },
  { value: 'demo-referral', label: '演示 · 转介席' },
]
const currentDemoRoleLabel = computed(() =>
  roles.find((role) => role.value === store.currentDemoRole)?.label ?? roles[0].label,
)
function roleLabel(role: DemoRole | null | undefined) {
  return roles.find((item) => item.value === role)?.label ?? '未记录'
}
const reasonLabels: Record<IntakeReasonCode, string> = {
  INFO_INSUFFICIENT: '信息不足',
  OUT_OF_SCOPE: '超出登记范围',
  DUPLICATE: '重复登记',
  REQUESTER_WITHDREW: '请求方撤回',
  NO_SERVICE_PATH: '暂无可行服务路径',
  INFORMATION_PROVIDED: '已提供信息',
  REFERRAL_DECLINED: '转介未获接收',
  FOLLOW_UP_CONCLUDED: '人工跟进结束（结果未核实）',
  OTHER: '其他（需写明）',
}
const actionLabels: Record<IntakeAction, string> = {
  BEGIN_SCREENING: '开始初筛',
  REQUEST_INFORMATION: '标记待补充',
  RESUME_SCREENING: '恢复初筛',
  ACCEPT_FOR_TRIAGE: '进入待分诊',
  REFER: '登记转介',
  CONFIRM_REFERRAL: '录入演练接收确认',
  REFERRAL_FAILED: '记录转介失败，返回待分诊',
  RECORD_HIGH_RISK_HANDOFF: '记录演练人工交接结果',
  REJECT: '记录拒绝',
  WITHDRAW: '记录撤回',
  CLOSE_WITHOUT_SERVICE: '关闭（未提供服务）',
  CLOSE_FOLLOW_UP: '结束人工跟进（服务结果未核实）',
  PROVIDE_INFORMATION: '记录已提供信息',
}
const createForm = reactive({
  label: '',
  summary: '',
  sourceChannel: DEFAULT_SYNTHETIC_SOURCE_CHANNEL,
  owner: '演练-受理席-01',
  nextStep: '完成常规初筛并记录分流依据',
  dueAt: defaultDueDate(),
  highRisk: false,
  highRiskNote: '',
})
const transitionForm = reactive({
  action: null as IntakeAction | null,
  reasonCode: '' as IntakeReasonCode | '',
  referralTarget: '',
  note: '',
  owner: '',
  nextStep: '',
  dueAt: '',
  handoffOutcome: '' as HighRiskHandoffOutcome | '',
  handoffOwner: '',
})
const followUpForm = reactive({ owner: '', nextStep: '', dueAt: '', note: '' })
const contactSimulationForm = reactive({
  outcome: 'not-reached' as ContactSimulationOutcome,
  owner: '',
  nextStep: '',
  dueAt: '',
  note: '',
})
const reopenForm = reactive({ owner: '', nextStep: '', dueAt: '', note: '' })
const transitionReasonOptions = computed<IntakeReasonCode[]>(() =>
  transitionForm.action === 'CLOSE_FOLLOW_UP'
    ? ['FOLLOW_UP_CONCLUDED']
    : [...INTAKE_REASON_CODES],
)

watch(() => transitionForm.action, (action) => {
  if (action === 'CLOSE_FOLLOW_UP') transitionForm.reasonCode = 'FOLLOW_UP_CONCLUDED'
  else if (transitionForm.reasonCode === 'FOLLOW_UP_CONCLUDED') transitionForm.reasonCode = ''
})

function defaultDueDate() {
  const value = new Date()
  value.setDate(value.getDate() + 2)
  value.setHours(17, 0, 0, 0)
  return toLocalInput(value.toISOString())
}

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return ''
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return ''
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '未设置'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间无效'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function isCaseOverdue(item: IntakeCase) {
  return isIntakeOverdue(item, new Date(store.clockNow).toISOString())
}

function caseHasHighRisk(item: IntakeCase) {
  return item.riskFlags.some((flag) => flag.code === 'HIGH_RISK_STOP_SCREENING')
}

function caseStatusLabel(item: IntakeCase) {
  if (caseHasHighRisk(item)) return `${item.status} · 已停止常规初筛 · 风险未解除`
  if (item.status === '已转介已接收') return '已转介 · 演练确认已录入'
  return item.status
}

function eventHeading(event: IntakeEvent) {
  if (event.action) return actionLabels[event.action]
  if (event.kind === 'created') return '创建演练记录'
  if (event.kind === 'follow-up-update') return '调整人工跟进'
  if (event.kind === 'contact-simulation') return '模拟联系结果'
  if (event.kind === 'case-link') return '关联重开演练记录'
  if (event.kind === 'duplicate-review') return '人工重复登记复核'
  if (event.kind === 'checkpoint-update') return '更新登记检查点'
  if (event.kind === 'risk-flag') return '添加风险演练标记'
  if (event.kind === 'timeout') return '标记内部演练待办超时'
  return '登记状态更新'
}

function eventChangeValue(field: 'owner' | 'nextStep' | 'dueAt', value: string | null) {
  if (field === 'dueAt') return formatDate(value)
  return value || '未设置'
}

const filteredCases = computed(() => {
  const normalizedSearch = search.value.trim().toLocaleLowerCase()
  return store.cases.filter((item) => {
    const matchesSearch = !normalizedSearch || [
      item.id,
      item.label,
      item.summary,
      item.status,
      item.owner ?? '',
      getSyntheticSourceChannelLabel(item.sourceChannel),
      item.sourcePostId ?? '',
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch))
    if (!matchesSearch) return false
    if (activeFilter.value === '待处理') return isOpenIntakeStatus(item.status)
    if (activeFilter.value === '演练逾期') return isCaseOverdue(item)
    if (activeFilter.value === '高风险') return caseHasHighRisk(item)
    if (activeFilter.value === '已结束') return !isOpenIntakeStatus(item.status)
    return true
  })
})

const selectedCase = computed(() => store.selectedCase)
const selectedRiskNotice = computed(() => selectedCase.value ? getHighRiskStopScreeningNotice(selectedCase.value) : null)
const selectedHighRiskHandoffCount = computed(() => selectedCase.value?.events.filter(
  (event) => event.kind === 'risk-handoff',
).length ?? 0)
const linkedCases = computed(() => {
  const item = selectedCase.value
  if (!item) return []
  const ids = [...new Set([item.reopenedFromId, ...(item.relatedCaseIds ?? [])].filter((id): id is string => !!id))]
  return ids.map((id) => store.cases.find((candidate) => candidate.id === id)).filter((candidate): candidate is IntakeCase => !!candidate)
})
const selectedCaseCheckpointReady = computed(() =>
  selectedCase.value ? isCaseCheckpointReady(selectedCase.value) : false,
)
const selectedCaseCheckpointBlockedReason = computed(() =>
  selectedCase.value ? getCaseCheckpointBlockedReason(selectedCase.value) : null,
)
const filteredComplaints = computed(() => store.complaints.filter((item) =>
  complaintFilter.value === '待复核' ? item.status === '待复核' : true,
))
const selectedComplaint = computed(() =>
  filteredComplaints.value.find((item) => item.id === selectedComplaintId.value) ?? null,
)
const selectedComplaintCase = computed(() => {
  const complaint = selectedComplaint.value
  return complaint ? store.cases.find((item) => item.id === complaint.caseId) ?? null : null
})
const selectedComplaintReviewBlockedReason = computed(() => {
  const complaint = selectedComplaint.value
  if (!complaint) return '请选择一条投诉记录。'
  if (complaint.status !== '待复核') return '该投诉已完成复核。'
  const role = store.currentDemoRole
  if (!isComplaintReviewerRole(role)) return '只有 demo-review 或 demo-referral 演示角色可以复核。'
  if (role === complaint.submittedByRole) return '投诉提交人不能复核自己的投诉。'
  if (role === complaint.targetRole) return '被投诉角色不能复核针对自己的投诉。'
  return ''
})
const canReviewSelectedComplaint = computed(() => selectedComplaintReviewBlockedReason.value === '')
const transitionActionBlockedReason = computed(() => {
  const action = transitionForm.action
  return action && selectedCase.value ? getIntakeActionBlockedReason(action, selectedCase.value) : null
})
const complaintTargetRoles = computed(() => roles.filter((role) => role.value !== store.currentDemoRole))
const currentRoleReviewLabel = computed(() => isComplaintReviewerRole(store.currentDemoRole)
  ? '当前演示角色可复核（仍受提交人 / 被投诉角色回避限制）'
  : '当前演示角色不可复核投诉')

const actionOptions = computed<IntakeAction[]>(() => {
  if (!selectedCase.value) return []
  const allowed = getAllowedIntakeActions(selectedCase.value.status)
  if (selectedRiskNotice.value) {
    return allowed.filter((action) => action === 'RECORD_HIGH_RISK_HANDOFF')
  }
  return allowed.filter((action) => action !== 'RECORD_HIGH_RISK_HANDOFF')
})

const needsReason = computed(() => !!transitionForm.action && intakeActionRequiresReason(transitionForm.action))
const transitionNoteRequired = computed(() => transitionForm.action === 'CONFIRM_REFERRAL'
  || transitionForm.action === 'REFER'
  || transitionForm.action === 'REFERRAL_FAILED'
  || transitionForm.action === 'CLOSE_FOLLOW_UP'
  || transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF'
  || (needsReason.value && transitionForm.reasonCode === 'OTHER'))
const transitionSubmitDisabled = computed(() => !transitionForm.action
  || !syntheticConfirmed.value
  || !!transitionActionBlockedReason.value
  || (needsReason.value && !transitionForm.reasonCode)
  || (transitionNoteRequired.value && !transitionForm.note.trim())
  || (transitionForm.action === 'REFER' && !transitionForm.referralTarget.trim())
  || (transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF' && !transitionForm.handoffOutcome)
  || (transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF'
    && transitionForm.handoffOutcome === 'accepted'
    && !transitionForm.handoffOwner.trim()))
const transitionTargetIsOpen = computed(() => transitionForm.action && selectedCase.value
  ? isOpenIntakeStatus(getIntakeActionTarget(transitionForm.action, selectedCase.value.status))
  : false)
const lifecycleText = computed(() => {
  const item = selectedCase.value
  if (!item) return '选择左侧记录查看跟进时间线与可用动作。'
  if (caseHasHighRisk(item)) return selectedHighRiskHandoffCount.value > 0
    ? `已停止常规初筛；已记录 ${selectedHighRiskHandoffCount.value} 次演练人工交接，风险标记仍未解除。本原型不实际联系、通知或派单，也不代表风险已解除、服务已完成或外部人员已真实接手。`
    : '已停止常规初筛；仅可反复记录演练人工交接，不会实际联系或通知，风险标记不会解除。'
  if (item.status === '已结束（服务结果未核实）') return '人工跟进已结束；本记录没有核实服务是否提供或完成。'
  if (!isOpenIntakeStatus(item.status)) return '该记录已结束登记跟进；如需再次受理，请按运营流程建立关联记录。'
  if (item.status === '待补充') return '仅等待模拟信息补充；超时只标记内部待办，不自动联系或关闭。'
  if (item.status.includes('转介')) return '转介状态只记录外部确认，不代表服务已完成。'
  return '每条未结记录都需有负责人、下一步和截止时间。'
})

watch(() => selectedCase.value?.id, () => {
  if (selectedCase.value && !filteredCases.value.some((item) => item.id === selectedCase.value?.id)) {
    activeFilter.value = '全部记录'
    search.value = ''
  }
})

let overdueClockTimer: number | undefined
onMounted(() => {
  store.refreshClock()
  overdueClockTimer = window.setInterval(store.refreshClock, 60_000)
})
onBeforeUnmount(() => {
  if (overdueClockTimer !== undefined) window.clearInterval(overdueClockTimer)
})

function notify(message: string) {
  toastMessage.value = message
  window.setTimeout(() => { if (toastMessage.value === message) toastMessage.value = '' }, 2600)
}

function notifyAfterMutation(message: string) {
  notify(store.storageStatus === 'memory-only'
    ? `${message}（仅保存在当前会话，刷新后不会保留）`
    : message)
}

function toggleIntakePaused() {
  const nextPaused = !store.intakePaused
  const result = store.setIntakePaused(nextPaused)
  if (!result.ok) {
    notify(result.errors.join(' '))
    return
  }
  notifyAfterMutation(nextPaused
    ? '已暂停本机合成演练的新登记；已有记录仍可继续跟进'
    : '已恢复本机合成演练的新登记')
}

function downloadTextFile(filename: string, content: string, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function exportBackup() {
  try {
    downloadTextFile(`a-plus-synthetic-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportBackup())
    notify('已请求下载；请确认文件已保存，未下载时可查看备份文本')
  } catch {
    notify('当前演练数据超过备份容量上限；请先减少记录或时间线内容')
  }
}

function viewBackupText() {
  try {
    backupText.value = store.exportBackup()
  } catch {
    backupText.value = ''
    notify('当前演练数据超过备份容量上限；请先减少记录或时间线内容')
  }
}

function reloadLatestSnapshot() {
  const result = store.reloadFromStorage()
  if (!result.ok) {
    notify(result.errors.join(' '))
    return
  }
  closeAllDialogs()
  activeFilter.value = '全部记录'
  search.value = ''
  notify(result.errors.length ? result.errors.join(' ') : '已载入最新演练存档')
}

function exportUnreadableBackup() {
  const backup = store.exportUnreadableBackup()
  if (backup === null) {
    notify('没有可导出的旧存档')
    return
  }
  downloadTextFile('a-plus-unreadable-local-save.txt', backup, 'text/plain;charset=utf-8')
  notify('已下载无法读取的旧存档原文')
}

function chooseBackup() {
  backupInput.value?.click()
}

async function importBackupFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > MAX_BACKUP_BYTES) {
      notify('备份超过 5 MB，无法导入')
      return
    }
    if (!window.confirm('导入会完整替换当前所有演练记录。请确认文件只含虚构数据，并已备份当前记录。继续导入？')) return
    const result = store.importBackup(await file.text())
    if (!result.ok) {
      notify(result.errors.join(' '))
      return
    }
    closeAllDialogs()
    activeFilter.value = '全部记录'
    search.value = ''
    const notice = store.storageStatus === 'memory-only'
      ? '已载入演练备份（仅保存在当前会话，刷新后不会保留）'
      : '已导入并保存演练备份'
    notify(result.warnings.length ? `${result.warnings.join(' ')} ${notice}` : notice)
  } catch {
    notify('读取备份文件失败；当前演练数据未变更')
  } finally {
    input.value = ''
  }
}

function resetAllForms() {
  syntheticConfirmed.value = false
  Object.assign(createForm, {
    label: '', summary: '', sourceChannel: DEFAULT_SYNTHETIC_SOURCE_CHANNEL, owner: '演练-受理席-01',
    nextStep: '完成常规初筛并记录分流依据', dueAt: defaultDueDate(), highRisk: false, highRiskNote: '',
  })
  Object.assign(transitionForm, {
    action: null, reasonCode: '', referralTarget: '', note: '', owner: '', nextStep: '', dueAt: '',
    handoffOutcome: '', handoffOwner: '',
  })
  Object.assign(followUpForm, { owner: '', nextStep: '', dueAt: '', note: '' })
  Object.assign(contactSimulationForm, {
    outcome: 'not-reached', owner: '', nextStep: '', dueAt: '', note: '',
  })
  Object.assign(reopenForm, {
    owner: '演练-受理席-01', nextStep: '重新核对演练记录并安排分诊', dueAt: defaultDueDate(), note: '',
  })
  createError.value = ''
  duplicateCandidates.value = []
  duplicateReviewRequired.value = false
  duplicateConfirmed.value = false
  duplicateExplanation.value = ''
  duplicateError.value = ''
  transitionErrors.value = []
  followUpError.value = ''
  contactSimulationError.value = ''
  reopenError.value = ''
  highRiskNote.value = ''
  highRiskError.value = ''
  checkpointError.value = ''
  Object.assign(checkpointForm, { consentStatus: 'unknown', requiredInfoComplete: false, note: '' })
  complaintError.value = ''
  complaintSyntheticConfirmed.value = false
  complaintReviewResolution.value = ''
  complaintReviewError.value = ''
  Object.assign(complaintForm, {
    targetRole: complaintTargetRoles.value[0]?.value ?? 'demo-review',
    description: '',
  })
}

function openCreate() {
  if (store.intakePaused) {
    notify(INTAKE_PAUSED_NOTICE)
    return
  }
  resetAllForms()
  showCreate.value = true
}

function resetCommunityReview() {
  communityPendingPost.value = null
  communityPendingInput.value = null
  communityDuplicateCandidates.value = []
  communityDuplicateConfirmed.value = false
  communityDuplicateExplanation.value = ''
  communityBridgeError.value = ''
}

function resetCommunityBridge() {
  resetCommunityReview()
  communityReadResult.value = null
  communitySyntheticConfirmed.value = false
}

function readCommunityArchive() {
  resetCommunityReview()
  communitySyntheticConfirmed.value = false
  communityReadResult.value = readCommunityHelpPosts()
}

function openCommunityBridge() {
  resetCommunityBridge()
  readCommunityArchive()
  showCommunityBridge.value = true
}

function closeCommunityBridge() {
  showCommunityBridge.value = false
  resetCommunityBridge()
}

function startCommunityRegistration(post: CommunityHelpPost) {
  if (store.intakePaused) {
    communityBridgeError.value = INTAKE_PAUSED_NOTICE
    return
  }
  if (!communitySyntheticConfirmed.value) {
    communityBridgeError.value = '请先确认只登记本机合成演练数据。'
    return
  }
  const registered = communityRegisteredCases.value.get(post.id)
  if (registered) {
    notify(`该社区求助已登记为 ${registered.id}，不会重复创建`)
    return
  }

  resetCommunityReview()
  const mapping = mapCommunityHelpPostToIntake(post)
  const input: NewIntakeInput = {
    label: mapping.label,
    summary: mapping.summary,
    sourceChannel: 'community-entry-local',
    sourcePostId: mapping.sourcePostId,
    owner: '演练-受理席-01',
    nextStep: '核对社区求助演练内容并完成常规初筛',
    dueAt: defaultDueDate(),
    highRisk: false,
    highRiskNote: '',
  }
  const result = store.createCase(input)
  if (result.already) {
    notify(`该社区求助已登记为 ${result.id}，不会重复创建`)
    return
  }
  if (result.duplicateCandidates?.length) {
    communityPendingPost.value = post
    communityPendingInput.value = input
    communityDuplicateCandidates.value = result.duplicateCandidates
    communityDuplicateConfirmed.value = false
    communityDuplicateExplanation.value = ''
    return
  }
  if (!result.ok) {
    communityBridgeError.value = result.errors.join(' ') || '登记到 A+ 队列失败。'
    return
  }
  notifyAfterMutation(`已登记 ${result.id} 到 A+ 队列；未写回社区帖状态`)
}

function cancelCommunityReview() {
  resetCommunityReview()
}

function confirmCommunityRegistration() {
  if (store.intakePaused) {
    communityBridgeError.value = INTAKE_PAUSED_NOTICE
    return
  }
  const input = communityPendingInput.value
  if (!input) return
  if (!communitySyntheticConfirmed.value) {
    communityBridgeError.value = '请先确认只登记本机合成演练数据。'
    return
  }
  if (!communityDuplicateConfirmed.value || !communityDuplicateExplanation.value.trim()) {
    communityBridgeError.value = '请确认已人工核对候选记录，并填写重复复核说明。'
    return
  }

  const result = store.createCase(input, {
    candidateIds: communityDuplicateCandidates.value.map((candidate) => candidate.id),
    explanation: communityDuplicateExplanation.value,
  })
  if (result.duplicateCandidates?.length) {
    communityDuplicateCandidates.value = result.duplicateCandidates
    communityDuplicateConfirmed.value = false
    communityDuplicateExplanation.value = ''
    communityBridgeError.value = '候选记录已变化，请重新核对后填写说明。'
    return
  }
  if (result.already) {
    resetCommunityReview()
    notify(`该社区求助已登记为 ${result.id}，不会重复创建`)
    return
  }
  if (!result.ok) {
    communityBridgeError.value = result.errors.join(' ') || '创建演练记录失败。'
    return
  }
  resetCommunityReview()
  notifyAfterMutation(`已创建独立演练记录 ${result.id}，并追加人工重复复核记录；未写回社区帖状态`)
}

function createRecord() {
  createError.value = ''
  duplicateError.value = ''
  if (store.intakePaused) {
    const message = INTAKE_PAUSED_NOTICE
    if (duplicateReviewRequired.value) duplicateError.value = message
    else createError.value = message
    return
  }
  if (!syntheticConfirmed.value) {
    const message = '请先确认本次填写内容均为虚构演练数据。'
    if (duplicateReviewRequired.value) duplicateError.value = message
    else createError.value = message
    return
  }
  if (!createForm.summary.trim()) {
    const message = '请填写不含身份信息的演练摘要。'
    if (duplicateReviewRequired.value) duplicateError.value = message
    else createError.value = message
    return
  }
  const isDuplicateReview = duplicateReviewRequired.value
  if (isDuplicateReview && (!duplicateConfirmed.value || !duplicateExplanation.value.trim())) {
    duplicateError.value = '请确认已人工核对候选记录，并填写重复复核说明。'
    return
  }
  const result = store.createCase(
    { ...createForm },
    isDuplicateReview
      ? {
          candidateIds: duplicateCandidates.value.map((candidate) => candidate.id),
          explanation: duplicateExplanation.value,
        }
      : undefined,
  )
  if (result.duplicateCandidates?.length) {
    duplicateCandidates.value = result.duplicateCandidates
    duplicateReviewRequired.value = true
    duplicateConfirmed.value = false
    duplicateExplanation.value = ''
    return
  }
  if (!result.ok) {
    const message = result.errors.join(' ') || '创建演练记录失败。'
    if (isDuplicateReview) duplicateError.value = message
    else createError.value = message
    return
  }
  closeAllDialogs()
  notifyAfterMutation(isDuplicateReview
    ? '已创建独立演练记录，并追加人工重复复核记录'
    : '演练记录已加入队列')
}

function cancelDuplicateReview() {
  duplicateCandidates.value = []
  duplicateReviewRequired.value = false
  duplicateConfirmed.value = false
  duplicateExplanation.value = ''
  duplicateError.value = ''
}

function openDuplicateCandidate(id: string) {
  closeAllDialogs()
  selectRelatedCase(id)
  notify('已打开候选演练记录；未创建新记录')
}

function openTransition() {
  if (!selectedCase.value || !actionOptions.value.length) return
  resetAllForms()
  const item = selectedCase.value
  transitionForm.action = null
  transitionForm.reasonCode = ''
  transitionForm.note = ''
  transitionForm.owner = item.owner ?? ''
  transitionForm.nextStep = item.nextStep ?? ''
  transitionForm.dueAt = toLocalInput(item.dueAt) || defaultDueDate()
  showTransition.value = true
}

function applyTransition() {
  if (!selectedCase.value || !transitionForm.action) return
  if (!syntheticConfirmed.value) {
    transitionErrors.value = ['请先确认本次填写内容均为虚构演练数据。']
    return
  }
  const result = store.transition({
    id: selectedCase.value.id,
    action: transitionForm.action,
    actorRole: store.currentDemoRole,
    reasonCode: transitionForm.reasonCode || undefined,
    referralTarget: transitionForm.referralTarget,
    note: transitionForm.note,
    owner: transitionForm.owner,
    nextStep: transitionForm.nextStep,
    dueAt: transitionForm.dueAt,
    handoffOutcome: transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF'
      ? transitionForm.handoffOutcome || undefined
      : undefined,
    handoffOwner: transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF'
      ? (transitionForm.handoffOutcome === 'accepted' ? transitionForm.handoffOwner : '')
      : undefined,
  })
  if (!result.ok) {
    transitionErrors.value = result.errors
    return
  }
  const isHandoff = transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF'
  closeAllDialogs()
  notifyAfterMutation(isHandoff
    ? '人工交接记录已追加到时间线；风险仍未解除'
    : '状态和跟进时间线已更新')
}

function openCheckpoint() {
  if (!selectedCase.value || !isOpenIntakeStatus(selectedCase.value.status) || caseHasHighRisk(selectedCase.value)) return
  resetAllForms()
  checkpointForm.consentStatus = getCaseConsentStatus(selectedCase.value)
  checkpointForm.requiredInfoComplete = isCaseRequiredInfoComplete(selectedCase.value)
  checkpointForm.note = ''
  showCheckpoint.value = true
}

function saveCheckpoint() {
  if (!selectedCase.value) return
  if (!checkpointForm.note.trim()) {
    checkpointError.value = '请填写登记检查点更新说明。'
    return
  }
  const result = store.updateCheckpoint({
    id: selectedCase.value.id,
    consentStatus: checkpointForm.consentStatus,
    requiredInfoComplete: checkpointForm.requiredInfoComplete,
    note: checkpointForm.note,
  })
  if (!result.ok) {
    checkpointError.value = result.errors.join(' ')
    return
  }
  closeAllDialogs()
  notifyAfterMutation('登记检查点已更新并追加到时间线')
}

function openComplaint() {
  if (!selectedCase.value) return
  resetAllForms()
  complaintForm.targetRole = complaintTargetRoles.value[0]?.value ?? 'demo-review'
  showComplaint.value = true
}

function submitComplaint() {
  if (!selectedCase.value) return
  if (!complaintSyntheticConfirmed.value) {
    complaintError.value = '请先确认本次投诉只使用演示角色和虚构内容。'
    return
  }
  if (!complaintForm.description.trim()) {
    complaintError.value = '请填写投诉说明。'
    return
  }
  const result = store.submitComplaint({
    caseId: selectedCase.value.id,
    targetRole: complaintForm.targetRole,
    description: complaintForm.description,
  })
  if (!result.ok) {
    complaintError.value = result.errors.join(' ')
    return
  }
  complaintFilter.value = '待复核'
  selectedComplaintId.value = result.id ?? null
  closeAllDialogs()
  notifyAfterMutation(`投诉 ${result.id} 已提交到独立复核队列；未改动 case 风险时间线`)
}

function reviewSelectedComplaint() {
  const complaint = selectedComplaint.value
  if (!complaint) return
  if (!canReviewSelectedComplaint.value) {
    complaintReviewError.value = selectedComplaintReviewBlockedReason.value
    return
  }
  if (!complaintReviewResolution.value.trim()) {
    complaintReviewError.value = '完成复核必须填写处理说明。'
    return
  }
  const result = store.reviewComplaint({
    id: complaint.id,
    resolution: complaintReviewResolution.value,
  })
  if (!result.ok) {
    complaintReviewError.value = result.errors.join(' ')
    return
  }
  complaintReviewResolution.value = ''
  complaintReviewError.value = ''
  complaintFilter.value = '全部投诉'
  notifyAfterMutation('投诉已完成复核；未改动 case 风险时间线')
}

function selectComplaint(id: string) {
  selectedComplaintId.value = id
  complaintReviewResolution.value = ''
  complaintReviewError.value = ''
}

function openComplaintCase(caseId: string) {
  selectRelatedCase(caseId)
}

function openFollowUp() {
  if (!selectedCase.value || caseHasHighRisk(selectedCase.value)) return
  if (selectedCaseCheckpointBlockedReason.value) {
    notify(selectedCaseCheckpointBlockedReason.value)
    return
  }
  resetAllForms()
  followUpForm.owner = selectedCase.value.owner ?? ''
  followUpForm.nextStep = selectedCase.value.nextStep ?? ''
  followUpForm.dueAt = toLocalInput(selectedCase.value.dueAt)
  followUpForm.note = ''
  showFollowUp.value = true
}

function openHighRiskStop() {
  if (!selectedCase.value || !isOpenIntakeStatus(selectedCase.value.status) || caseHasHighRisk(selectedCase.value)) return
  resetAllForms()
  showHighRiskStop.value = true
}

function saveHighRiskStop() {
  if (!selectedCase.value) return
  if (!syntheticConfirmed.value) {
    highRiskError.value = '请先确认本次填写内容均为虚构演练数据。'
    return
  }
  if (!highRiskNote.value.trim()) {
    highRiskError.value = '请填写高风险停止初筛的虚构演练依据。'
    return
  }
  const result = store.raiseHighRiskStop({ id: selectedCase.value.id, note: highRiskNote.value })
  if (!result.ok) {
    highRiskError.value = result.errors.join(' ')
    return
  }
  closeAllDialogs()
  notifyAfterMutation('已停止普通初筛并记录演练标记')
}

function openContactSimulation() {
  if (!selectedCase.value || !isOpenIntakeStatus(selectedCase.value.status) || caseHasHighRisk(selectedCase.value)) return
  if (selectedCaseCheckpointBlockedReason.value) {
    notify(selectedCaseCheckpointBlockedReason.value)
    return
  }
  resetAllForms()
  contactSimulationForm.owner = selectedCase.value.owner ?? ''
  contactSimulationForm.nextStep = selectedCase.value.nextStep ?? ''
  contactSimulationForm.dueAt = toLocalInput(selectedCase.value.dueAt)
  showContactSimulation.value = true
}

function openReopen() {
  if (store.intakePaused) {
    notify(INTAKE_PAUSED_NOTICE)
    return
  }
  if (!selectedCase.value || isOpenIntakeStatus(selectedCase.value.status) || caseHasHighRisk(selectedCase.value)) return
  resetAllForms()
  Object.assign(reopenForm, {
    owner: '演练-受理席-01',
    nextStep: '重新核对演练记录并安排分诊',
    dueAt: defaultDueDate(),
    note: '',
  })
  showReopen.value = true
}

function createReopenedRecord() {
  if (!selectedCase.value) return
  if (store.intakePaused) {
    reopenError.value = INTAKE_PAUSED_NOTICE
    return
  }
  if (!syntheticConfirmed.value) {
    reopenError.value = '请先确认本次填写内容均为虚构演练数据。'
    return
  }
  const result = store.reopenCase(selectedCase.value.id, { ...reopenForm })
  if (!result.ok) {
    reopenError.value = result.errors.join(' ')
    return
  }
  closeAllDialogs()
  notifyAfterMutation('已建立关联重开演练记录，原记录保留')
}

function selectRelatedCase(id: string) {
  activeFilter.value = '全部记录'
  search.value = ''
  store.select(id)
}

function saveFollowUp() {
  if (!selectedCase.value) return
  if (!syntheticConfirmed.value) {
    followUpError.value = '请先确认本次填写内容均为虚构演练数据。'
    return
  }
  const result = store.updateFollowUp({ id: selectedCase.value.id, ...followUpForm })
  if (!result.ok) {
    followUpError.value = result.errors.join(' ')
    return
  }
  closeAllDialogs()
  notifyAfterMutation('跟进信息已追加到时间线')
}

function saveContactSimulation() {
  if (!selectedCase.value) return
  if (!syntheticConfirmed.value) {
    contactSimulationError.value = '请先确认本次填写内容均为虚构演练数据。'
    return
  }
  const result = store.recordContactSimulation({ id: selectedCase.value.id, ...contactSimulationForm })
  if (!result.ok) {
    contactSimulationError.value = result.errors.join(' ')
    return
  }
  closeAllDialogs()
  notifyAfterMutation('模拟联系结果已追加到时间线，并更新负责人、下一步和截止时间')
}

function closeAllDialogs() {
  showCreate.value = false
  showTransition.value = false
  showFollowUp.value = false
  showContactSimulation.value = false
  showReopen.value = false
  showHighRiskStop.value = false
  showCheckpoint.value = false
  showComplaint.value = false
  showCommunityBridge.value = false
  resetAllForms()
  resetCommunityBridge()
}

function resetDemo() {
  if (!window.confirm('恢复初始合成演练记录？这会清除当前所有记录和修改，建议先导出备份。')) return
  const result = store.reset()
  if (!result.ok) {
    notify(result.errors.join(' '))
    return
  }
  closeAllDialogs()
  activeFilter.value = '全部记录'
  search.value = ''
  notify(store.storageStatus === 'memory-only'
    ? '已恢复初始合成演练数据（仅保存在当前会话，刷新后不会保留）'
    : '已恢复初始合成演练数据')
}
</script>

<template>
  <div class="app-shell">
    <aside class="side-rail" aria-label="主导航">
      <div class="brand">
        <div class="brand-mark">邻</div>
        <div class="brand-name">邻里服务台<small>COMMUNITY OPERATIONS</small></div>
      </div>
      <div class="nav-label">A+ 内部演练原型</div>
      <nav class="nav-list">
        <button class="nav-item active" type="button" aria-current="page"><span class="nav-icon">▦</span><span>登记队列</span></button>
      </nav>
      <div class="rail-spacer"></div>
      <div class="pilot-card">
        <strong>受控演练空间</strong>
        <p>所有记录均为虚构场景。此页面不接收居民申请，也不发送联系或服务通知。</p>
      </div>
      <div class="user-chip">
        <div class="avatar">演</div>
        <div><strong>{{ currentDemoRoleLabel }}</strong><small>仅供流程演练</small></div>
      </div>
    </aside>

    <main class="main-area">
      <input ref="backupInput" class="visually-hidden" type="file" accept="application/json,.json" @change="importBackupFile" />
      <header class="topbar">
        <div class="crumb">社区服务 <span aria-hidden="true">/</span> A+ 登记队列</div>
        <div class="top-actions">
          <span class="demo-pill"><i class="demo-dot"></i>合成数据演练</span>
          <label class="role-select"><span>角色</span>
            <select v-model="store.currentDemoRole" aria-label="切换演示角色">
              <option v-for="role in roles" :key="role.value" :value="role.value">{{ role.label }}</option>
            </select>
          </label>
          <button class="icon-button" type="button" title="提示" aria-label="演示提示" @click="notify('数据保存在当前浏览器的本机存储中，不接真实渠道、不发送通知')">i</button>
        </div>
      </header>

      <div class="content">
        <section class="page-heading">
          <div>
            <div class="eyebrow">A+ · INTERNAL INTAKE</div>
            <h1>受控登记队列</h1>
            <p class="page-subtitle">登记、分诊与人工跟进演练。服务类型暂记为「待判定 / 未分类」。</p>
          </div>
          <div class="heading-actions">
            <button class="button" type="button" @click="openCommunityBridge">社区求助（本机演练）</button>
            <button class="button primary" type="button" :disabled="store.intakePaused" :title="store.intakePaused ? '本机合成演练已暂停新登记' : ''" @click="openCreate"><span>＋</span> 新建演练记录</button>
          </div>
        </section>

        <section class="intake-gate" :class="{ paused: store.intakePaused }" aria-label="本机合成演练受理开关">
          <div class="intake-gate-mark" aria-hidden="true">{{ store.intakePaused ? 'Ⅱ' : '▶' }}</div>
          <div class="intake-gate-copy">
            <strong role="status" aria-live="polite">{{ store.intakePaused ? '新登记已暂停 · 仅限本机合成演练' : '新登记开放 · 仅限本机合成演练' }}</strong>
            <p>{{ store.intakePaused ? '手动新建演练记录和社区桥登记已停止；已有记录仍可继续跟进。' : '可手动新建演练记录，或从社区桥登记合成求助。' }} 此开关只影响当前浏览器的演练数据，不是生产受理权限，也不代表真实服务已停开、停服或已通知任何人。</p>
          </div>
          <button class="button" :class="store.intakePaused ? 'primary' : 'danger'" type="button" :aria-pressed="store.intakePaused" @click="toggleIntakePaused">{{ store.intakePaused ? '恢复新登记' : '暂停新登记' }}</button>
        </section>

        <div class="synthetic-banner" role="note">
          <div class="synthetic-icon">✳</div>
          <div class="synthetic-copy">
            <strong>合成数据演练 · 不得录入真实居民信息</strong>
            表单是自由文本，本原型无法识别或阻止真实个人信息。数据以明文保存在当前浏览器，不是加密存储；清理浏览器数据可能导致丢失，请定期导出备份。
            <div class="storage-status" :data-state="store.storageStatus" role="status" aria-live="polite">
              {{ storageStatusLabel }}<span v-if="lastSavedLabel"> · 最近保存 {{ lastSavedLabel }}</span>
            </div>
          </div>
          <div class="banner-actions">
            <button class="button small" type="button" @click="exportBackup">导出备份</button>
            <button class="button small" type="button" @click="viewBackupText">查看备份文本</button>
            <button class="button small" type="button" @click="chooseBackup">导入备份</button>
            <button v-if="store.storageStatus === 'conflict'" class="button small" type="button" @click="reloadLatestSnapshot">重新载入最新存档</button>
            <button v-if="store.storageStatus === 'recovery-required'" class="button small" type="button" @click="exportUnreadableBackup">下载无法读取的旧存档</button>
            <button class="button small danger" type="button" @click="resetDemo">重置演练</button>
          </div>
        </div>

        <section v-if="backupText" class="panel" aria-label="合成备份文本">
          <div class="panel-head">
            <h2 class="panel-title">合成备份文本</h2>
            <button class="button small" type="button" @click="backupText = ''">关闭备份文本</button>
          </div>
          <div class="field">
            <label for="backup-text">打开时生成的完整 JSON 快照（只读）</label>
            <textarea id="backup-text" ref="backupTextInput" :value="backupText" readonly :spellcheck="false" rows="8" @focus="backupTextInput?.select()" />
            <p class="notice-inline">点击文本框全选后复制，粘贴到记事本，以 UTF-8 保存为 .json 文件。请保留完整内容，之后可使用“导入备份”恢复；保存后关闭此区域。若记录有更新，请重新点击“查看备份文本”。</p>
          </div>
        </section>

        <section class="metric-grid" aria-label="演练统计">
          <article class="metric-card">
            <div class="metric-label">待分诊记录</div>
            <div class="metric-value">{{ store.triageCases.length }}<small>条</small></div>
            <div class="metric-foot">收件或初筛后待分流</div>
          </article>
          <article class="metric-card">
            <div class="metric-label">常规初筛中</div>
            <div class="metric-value">{{ store.screeningCases.length }}<small>条</small></div>
            <div class="metric-foot">高风险记录停止普通初筛</div>
          </article>
          <article class="metric-card" :class="{ alert: store.overdueCases.length > 0 }">
            <div class="metric-label">逾期演练待办</div>
            <div class="metric-value">{{ store.overdueCases.length }}<small>条</small></div>
            <div class="metric-foot">仅提醒人工跟进，不自动外联</div>
          </article>
          <article class="metric-card" :class="{ alert: store.highRiskCases.length > 0 }">
            <div class="metric-label">高风险停止标记</div>
            <div class="metric-value">{{ store.highRiskCases.length }}<small>条</small></div>
            <div class="metric-foot">按机构已批准的外部流程人工处理</div>
          </article>
        </section>

        <section class="work-grid">
          <section class="panel queue-panel" aria-label="登记记录列表">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">登记队列 <small>{{ filteredCases.length }} 条演练记录</small></h2>
                <p class="panel-subtitle">只用于演练内部收件和跟进路径</p>
              </div>
              <label class="search-wrap">
                <span class="search-icon">⌕</span>
                <input v-model="search" type="search" aria-label="搜索演练记录" placeholder="搜索演练内容" />
              </label>
            </div>
            <div class="filters" role="tablist" aria-label="筛选记录">
              <button v-for="filter in filters" :key="filter" class="filter" :class="{ active: activeFilter === filter }" type="button" role="tab" :aria-selected="activeFilter === filter" @click="activeFilter = filter">{{ filter }}</button>
            </div>
            <div v-if="filteredCases.length" class="queue-list">
              <button v-for="item in filteredCases" :key="item.id" class="queue-item" :class="{ selected: store.selectedId === item.id }" type="button" @click="store.select(item.id)">
                <span class="queue-marker" :class="{ risk: caseHasHighRisk(item), warning: isCaseOverdue(item) }"></span>
                <span class="queue-body">
                  <span class="queue-top"><span class="queue-id">{{ item.label }} <small>· {{ item.id }}</small></span><span class="queue-time">{{ formatDate(item.updatedAt) }}</span></span>
                  <span class="queue-summary">{{ item.summary }}</span>
                  <span class="queue-meta">
                    <span class="tag" :class="caseHasHighRisk(item) ? 'risk' : (isCaseOverdue(item) ? 'warning' : 'status')">{{ caseHasHighRisk(item) ? '停止初筛' : item.status }}</span>
                    <span class="tag">{{ item.serviceType }}</span>
                    <span class="tag">来源：{{ getSyntheticSourceChannelLabel(item.sourceChannel) }}</span>
                    <span v-if="isOpenIntakeStatus(item.status) && !isCaseCheckpointReady(item)" class="tag warning">登记检查点未完成</span>
                    <span v-if="isCaseOverdue(item) && !caseHasHighRisk(item)" class="tag warning">演练已逾期</span>
                    <span class="queue-owner"><span class="mini-avatar">{{ item.owner?.slice(-1) || '—' }}</span>{{ item.owner || '未指派' }}</span>
                  </span>
                </span>
              </button>
            </div>
            <div v-else class="empty-state">没有匹配的演练记录。<br />更换筛选条件或新建合成案例。</div>
          </section>

          <section class="panel detail-panel" aria-label="登记记录详情">
            <template v-if="selectedCase">
              <div class="detail-head">
                <div class="detail-title-row">
                  <div>
                    <div class="detail-id">{{ selectedCase.id }} <span>·</span> {{ selectedCase.label }}</div>
                    <h2 class="detail-title">{{ selectedCase.summary }}</h2>
                  </div>
                  <span class="tag" :class="caseHasHighRisk(selectedCase) ? 'risk' : (isCaseOverdue(selectedCase) ? 'warning' : 'status')">{{ caseHasHighRisk(selectedCase) ? '停止普通初筛 · 风险未解除' : selectedCase.status }}</span>
                </div>
                <div class="detail-date">登记 {{ formatDate(selectedCase.createdAt) }} <span>·</span> 更新 {{ formatDate(selectedCase.updatedAt) }}</div>
              </div>
              <div class="detail-content">
                <div class="checkpoint-callout" :class="{ ready: selectedCaseCheckpointReady }" role="note">
                  <strong>登记检查点：{{ selectedCaseCheckpointReady ? '已完成' : '未完成' }} · 合成演练字段</strong>
                  <p>{{ CHECKPOINT_SYNTHETIC_NOTICE }}</p>
                    <p v-if="!selectedCaseCheckpointReady">{{ selectedCaseCheckpointBlockedReason }} 高风险停止与人工交接通道始终可用。</p>
                </div>
                <div v-if="selectedRiskNotice" class="risk-callout" role="alert">
                  <span class="risk-symbol">⚠</span>
                  <div><strong>高风险停止标记：请停止普通初筛（风险未解除）</strong><p>{{ selectedRiskNotice }}</p></div>
                </div>
                <div v-if="selectedCase.riskFlags.length" class="risk-flag-list" aria-label="演练风险标记">
                  <article v-for="flag in selectedCase.riskFlags" :key="flag.code" class="risk-flag-item">
                    <strong>{{ flag.label }} <small>· 演练标记</small></strong>
                    <p>{{ flag.note }}</p>
                  </article>
                </div>
                <div v-if="selectedCase.status.includes('转介')" class="notice-inline" role="note">
                  本原型没有向外部机构发送转介，也没有收到真实回执。此状态仅记录虚构演练，不代表外部机构已接收或已提供服务。
                </div>

                <div class="detail-section">
                  <div class="section-label">记录概况</div>
                  <div class="info-grid">
                    <div class="info-item"><span>服务类型</span><strong>{{ selectedCase.serviceType }}</strong></div>
                    <div class="info-item"><span>来源渠道演练标记</span><strong>{{ getSyntheticSourceChannelLabel(selectedCase.sourceChannel) }}</strong></div>
                    <div v-if="selectedCase.sourcePostId" class="info-item"><span>社区来源帖子 ID</span><strong>{{ selectedCase.sourcePostId }}</strong></div>
                    <div class="info-item"><span>演练同意检查点</span><strong>{{ getConsentStatusLabel(getCaseConsentStatus(selectedCase)) }}</strong></div>
                    <div class="info-item"><span>必填信息检查点</span><strong>{{ isCaseRequiredInfoComplete(selectedCase) ? '已完整（演练）' : '未完整 / 未登记（演练）' }}</strong></div>
                    <div class="info-item"><span>登记检查点</span><strong>{{ selectedCaseCheckpointReady ? '已完成（可进行普通流程）' : '未完成（普通流程已锁定）' }}</strong></div>
                    <div class="info-item"><span>当前状态</span><strong>{{ caseStatusLabel(selectedCase) }}</strong></div>
                    <div class="info-item"><span>负责人</span><strong>{{ selectedCase.owner || '—' }}</strong></div>
                    <div class="info-item"><span>演练跟进截止</span><strong>{{ formatDate(selectedCase.dueAt) }}<template v-if="isCaseOverdue(selectedCase)"> · 演练已逾期</template></strong></div>
                  </div>
                </div>

                <div class="detail-section">
                  <div class="section-label">下一步</div>
                  <div class="next-step-card"><strong>{{ lifecycleText }}</strong><p>{{ selectedCase.nextStep || '当前没有开放跟进动作。' }}</p></div>
                </div>

                <div v-if="linkedCases.length" class="detail-section">
                  <div class="section-label">关联演练记录</div>
                  <div class="related-case-list">
                    <button v-for="item in linkedCases" :key="item.id" class="related-case" type="button" @click="selectRelatedCase(item.id)">
                      <span><strong>{{ item.id }} · {{ item.label }}</strong><small>{{ item.summary }}</small></span>
                      <span class="tag">{{ caseStatusLabel(item) }}</span>
                    </button>
                  </div>
                </div>

                <div class="detail-section">
                  <div class="section-label">跟进时间线 <span class="tag">追加记录</span></div>
                  <div class="timeline">
                    <div v-for="event in [...selectedCase.events].reverse()" :key="event.id" class="timeline-item">
                      <span class="timeline-dot"></span>
                      <div class="timeline-text">
                        <strong>{{ eventHeading(event) }}</strong>
                        <small v-if="event.fromStatus && event.toStatus && event.fromStatus !== event.toStatus">{{ event.fromStatus }} → {{ event.toStatus }}</small>
                        <small v-if="event.reasonCode">原因：{{ reasonLabels[event.reasonCode] }}</small>
                        <small v-if="event.contactOutcome">结果：{{ getContactSimulationOutcomeLabel(event.contactOutcome) }}</small>
                        <small v-if="event.handoffOutcome">人工交接结果：{{ getHighRiskHandoffOutcomeLabel(event.handoffOutcome) }}</small>
                        <small v-if="event.handoffOutcome === 'accepted' && event.handoffOwner">虚构接手人：{{ event.handoffOwner }}</small>
                        <small v-if="event.kind === 'checkpoint-update'">检查点：同意 {{ getConsentStatusLabel(event.consentStatus) }} · 必填信息 {{ event.requiredInfoComplete ? '已完整' : '未完整' }}</small>
                        <small v-if="event.duplicateCandidateIds?.length">候选记录：{{ event.duplicateCandidateIds?.join('、') }}</small>
                        <small v-for="change in event.changes ?? []" :key="change.field">
                          {{ change.label }}：{{ eventChangeValue(change.field, change.before) }} → {{ eventChangeValue(change.field, change.after) }}
                        </small>
                        <span>{{ event.note }}</span>
                        <small>{{ formatDate(event.at) }} · {{ event.actorRole ? roles.find((role) => role.value === event.actorRole)?.label : '系统标记' }}</small>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="detail-actions">
                  <button v-if="isOpenIntakeStatus(selectedCase.status) && !caseHasHighRisk(selectedCase)" class="button" type="button" @click="openCheckpoint">更新登记检查点</button>
                  <button v-if="isOpenIntakeStatus(selectedCase.status) && !caseHasHighRisk(selectedCase)" class="button" type="button" :disabled="!selectedCaseCheckpointReady" :title="selectedCaseCheckpointBlockedReason ?? ''" @click="openFollowUp">调整负责人 / 下一步</button>
                  <button v-if="isOpenIntakeStatus(selectedCase.status) && !caseHasHighRisk(selectedCase)" class="button" type="button" :disabled="!selectedCaseCheckpointReady" :title="selectedCaseCheckpointBlockedReason ?? ''" @click="openContactSimulation">记录模拟联系结果</button>
                  <button v-if="isOpenIntakeStatus(selectedCase.status) && !caseHasHighRisk(selectedCase)" class="button danger" type="button" @click="openHighRiskStop">标记高风险 · 停止初筛</button>
                  <button v-if="actionOptions.length" class="button primary" type="button" @click="openTransition">{{ caseHasHighRisk(selectedCase) ? '记录演练人工交接 →' : '更新登记状态 →' }}</button>
                  <button class="button" type="button" @click="openComplaint">提交投诉（演示角色）</button>
                  <span v-if="caseHasHighRisk(selectedCase)" class="tag risk">已停止普通初筛；风险未解除；可反复记录演练人工交接{{ selectedHighRiskHandoffCount ? '（已记录 ' + selectedHighRiskHandoffCount + ' 次）' : '' }}</span>
                  <button v-if="!isOpenIntakeStatus(selectedCase.status) && !caseHasHighRisk(selectedCase)" class="button" type="button" :disabled="store.intakePaused" :title="store.intakePaused ? '本机合成演练已暂停新登记' : ''" @click="openReopen">建立关联重开演练记录</button>
                  <span v-if="!actionOptions.length && !isOpenIntakeStatus(selectedCase.status)" class="tag">当前原记录已结束并保留</span>
                </div>
              </div>
            </template>
            <div v-else class="detail-placeholder">
              <div><div class="detail-placeholder-icon">⌁</div><strong>选择一条演练记录</strong><p>查看记录状态、人工下一步和追加式跟进时间线。</p></div>
            </div>
          </section>
        </section>

        <section class="panel complaint-panel" aria-label="独立投诉复核队列">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">投诉复核队列 <small>{{ store.pendingComplaints.length }} 条待复核 · 独立存档</small></h2>
              <p class="panel-subtitle">{{ COMPLAINT_SYNTHETIC_NOTICE }} 投诉不会改写 case 风险标记或跟进时间线。</p>
            </div>
            <div class="filters" role="tablist" aria-label="筛选投诉">
              <button class="filter" :class="{ active: complaintFilter === '待复核' }" type="button" role="tab" :aria-selected="complaintFilter === '待复核'" @click="complaintFilter = '待复核'">投诉待复核</button>
              <button class="filter" :class="{ active: complaintFilter === '全部投诉' }" type="button" role="tab" :aria-selected="complaintFilter === '全部投诉'" @click="complaintFilter = '全部投诉'">全部投诉</button>
            </div>
          </div>
          <div class="complaint-grid">
            <div v-if="filteredComplaints.length" class="queue-list" aria-label="投诉列表">
              <button v-for="complaint in filteredComplaints" :key="complaint.id" class="queue-item" :class="{ selected: selectedComplaintId === complaint.id }" type="button" @click="selectComplaint(complaint.id)">
                <span class="queue-marker" :class="{ warning: complaint.status === '待复核' }"></span>
                <span class="queue-body">
                  <span class="queue-top"><span class="queue-id">{{ complaint.id }} <small>· {{ complaint.caseId }}</small></span><span class="queue-time">{{ formatDate(complaint.submittedAt) }}</span></span>
                  <span class="queue-summary">{{ complaint.description }}</span>
                  <span class="queue-meta">
                    <span class="tag" :class="complaint.status === '待复核' ? 'warning' : 'status'">{{ complaint.status }}</span>
                    <span class="tag">提交：{{ roleLabel(complaint.submittedByRole) }}</span>
                    <span class="tag">被投诉：{{ roleLabel(complaint.targetRole) }}</span>
                  </span>
                </span>
              </button>
            </div>
            <div v-else class="empty-state">当前没有{{ complaintFilter === '待复核' ? '待复核' : '' }}投诉记录。<br />可在上方登记详情中提交演示投诉。</div>
            <div class="complaint-detail">
              <template v-if="selectedComplaint">
                <div class="detail-head">
                  <div class="detail-title-row">
                    <div>
                      <div class="detail-id">{{ selectedComplaint.id }} <span>·</span> {{ selectedComplaint.caseId }}</div>
                      <h3 class="detail-title">演示投诉复核详情</h3>
                    </div>
                    <span class="tag" :class="selectedComplaint.status === '待复核' ? 'warning' : 'status'">{{ selectedComplaint.status }}</span>
                  </div>
                </div>
                <div class="detail-content">
                  <div class="notice-inline">{{ COMPLAINT_SYNTHETIC_NOTICE }} 当前演示角色：{{ currentDemoRoleLabel }}。</div>
                  <div class="info-grid">
                    <div class="info-item"><span>针对的演示角色</span><strong>{{ roleLabel(selectedComplaint.targetRole) }}</strong></div>
                    <div class="info-item"><span>提交人演示角色</span><strong>{{ roleLabel(selectedComplaint.submittedByRole) }}</strong></div>
                    <div class="info-item"><span>提交时间</span><strong>{{ formatDate(selectedComplaint.submittedAt) }}</strong></div>
                    <div class="info-item"><span>复核时间</span><strong>{{ selectedComplaint.reviewedAt ? formatDate(selectedComplaint.reviewedAt) : '—' }}</strong></div>
                    <div class="info-item"><span>复核人演示角色</span><strong>{{ selectedComplaint.reviewerRole ? roleLabel(selectedComplaint.reviewerRole) : '—' }}</strong></div>
                    <div class="info-item"><span>关联 case</span><strong>{{ selectedComplaint.caseId }}</strong></div>
                  </div>
                  <div class="detail-section">
                    <div class="section-label">投诉说明</div>
                    <div class="next-step-card"><p>{{ selectedComplaint.description }}</p></div>
                  </div>
                  <div class="detail-section">
                    <div class="section-label">处理说明</div>
                    <div class="next-step-card"><p>{{ selectedComplaint.resolution || '尚未填写。' }}</p></div>
                  </div>
                  <div class="detail-actions">
                    <button v-if="selectedComplaintCase" class="button" type="button" @click="openComplaintCase(selectedComplaint.caseId)">打开关联 case（不改时间线）</button>
                  </div>
                  <div v-if="selectedComplaint.status === '待复核'" class="detail-section">
                    <div class="section-label">完成复核</div>
                    <div class="hint">{{ currentRoleReviewLabel }}</div>
                    <div v-if="selectedComplaintReviewBlockedReason" class="notice-inline" role="alert">{{ selectedComplaintReviewBlockedReason }}</div>
                    <div class="field"><label :for="`complaint-resolution-${selectedComplaint.id}`">处理说明 <span aria-hidden="true">*</span></label><textarea :id="`complaint-resolution-${selectedComplaint.id}`" v-model="complaintReviewResolution" maxlength="240" placeholder="填写演练复核处理说明；不会改动 case 风险时间线"></textarea></div>
                    <div v-if="complaintReviewError" class="form-error" role="alert">{{ complaintReviewError }}</div>
                    <button class="button primary" type="button" :disabled="!canReviewSelectedComplaint || !complaintReviewResolution.trim()" @click="reviewSelectedComplaint">确认复核</button>
                  </div>
                </div>
              </template>
              <div v-else class="detail-placeholder"><div><strong>选择一条投诉</strong><p>查看独立投诉详情并完成演示复核。</p></div></div>
            </div>
          </div>
        </section>

        <nav class="mobile-nav" aria-label="移动导航">
          <button class="active" type="button"><span>▦</span><span>登记</span></button>
          <button type="button" :disabled="store.intakePaused" @click="openCreate"><span>＋</span><span>新建</span></button>
          <button type="button" @click="openCommunityBridge"><span>◎</span><span>社区求助</span></button>
          <button type="button" @click="notify('当前为合成数据演练')"><span>◇</span><span>演练</span></button>
        </nav>
      </div>
    </main>

    <div v-if="showCommunityBridge" class="modal-backdrop" @click.self="closeCommunityBridge">
      <section class="modal bridge-modal" role="dialog" aria-modal="true" aria-labelledby="community-bridge-title">
        <header class="modal-header">
          <div>
            <h2 id="community-bridge-title">{{ communityReviewRequired ? '人工重复复核' : '社区求助（本机演练）' }}</h2>
            <p>{{ communityReviewRequired ? '创建已暂停；请先查看候选记录并完成人工复核。' : '手动、单向读取本机社区存档；只登记“求助 / 开放”的合成帖子。' }}</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="closeCommunityBridge">×</button>
        </header>

        <div class="modal-body">
          <div v-if="store.intakePaused" class="notice-inline" role="alert">{{ INTAKE_PAUSED_NOTICE }} 已有记录仍可继续跟进；请先恢复新登记再提交社区桥登记。</div>
          <template v-if="communityReviewRequired">
            <div class="notice-inline" role="alert">发现标签或摘要完全相同的已有记录。创建已暂停；不会合并、覆盖或删除候选，也不会写回社区帖。请先核对候选，再填写复核说明并确认。</div>
            <div class="hint">
              拟登记标签：{{ communityPendingMapping?.label }}<br />
              拟登记摘要：{{ communityPendingMapping?.summary }}
              <template v-if="communityPendingMapping?.summaryTruncated"><br />A+ 摘要超过显示上限时会截断；完整原文仍保留在原社区帖子中。</template>
            </div>
            <div class="related-case-list">
              <article v-for="candidate in communityDuplicateCandidates" :key="candidate.id" class="related-case bridge-candidate">
                <span>
                  <strong>{{ candidate.id }} · {{ candidate.label }}</strong>
                  <small>{{ candidate.summary }}</small>
                  <small>来源渠道：{{ getSyntheticSourceChannelLabel(candidate.sourceChannel) }}<template v-if="candidate.sourcePostId"> · 社区帖子 ID：{{ candidate.sourcePostId }}</template></small>
                </span>
                <span class="tag">{{ caseStatusLabel(candidate) }}</span>
              </article>
            </div>
            <div class="hint">以上候选已在本页完整展示；不会打开候选而丢失本次填写。若仍需要登记，请填写复核说明并再次确认。</div>
            <label class="synthetic-confirm"><input v-model="communityDuplicateConfirmed" type="checkbox" /><span><strong>我已人工核对以上候选记录，确认需要另建一条独立记录</strong><small>不会合并、覆盖或删除候选记录；新记录会保留来源帖子 ID、关联候选并追加复核时间线。</small></span></label>
            <div class="field"><label for="community-duplicate-explanation">人工重复复核说明 <span aria-hidden="true">*</span></label><textarea id="community-duplicate-explanation" v-model="communityDuplicateExplanation" maxlength="160" placeholder="简要说明为何仍需登记为独立记录"></textarea></div>
            <label class="synthetic-confirm"><input v-model="communitySyntheticConfirmed" type="checkbox" /><span><strong>我确认本次登记只使用本机合成演练数据</strong><small>不写回社区帖状态，不生成公开订单或服务承诺；本原型无法识别或拦截真实个人信息。</small></span></label>
            <div v-if="communityBridgeError" class="form-error" role="alert">{{ communityBridgeError }}</div>
          </template>

          <template v-else>
            <div class="notice-inline">这里只读取社区演练存档中的合成求助，包括待接单和已演练接单的帖子。发布社区求助不会自动进入 A+；读取和登记都不会写回或改变社区帖状态，也不会生成公开订单、服务承诺或外发消息。</div>
            <div class="bridge-toolbar">
              <span class="bridge-status" role="status" aria-live="polite">{{ communityReadStatus }}</span>
              <button class="button small" type="button" @click="readCommunityArchive">重新读取</button>
            </div>
            <div v-if="store.storageStatus === 'recovery-required'" class="notice-inline" role="alert">当前 A+ 存档无法读取，登记会被阻止。请先处理 A+ 存档；本入口不会覆盖、重置或补写任何一端存档。</div>
            <div v-if="communityReadMessage" class="empty-state" role="status">{{ communityReadMessage }}</div>
            <div v-else-if="communityReadResult?.status === 'ready' && communityPostsWithStatus.length === 0" class="empty-state" role="status">当前没有可登记的合成求助。社区存档保持原样，A+ 也未创建记录。</div>
            <template v-else-if="communityPostsWithStatus.length">
              <label class="synthetic-confirm"><input v-model="communitySyntheticConfirmed" type="checkbox" /><span><strong>我确认本次登记只使用本机合成演练数据</strong><small>只登记下列合成求助；不会写回社区帖状态，也不会产生公开订单、服务承诺或真实外发。</small></span></label>
              <div class="bridge-post-list">
                <article v-for="item in communityPostsWithStatus" :key="item.post.id" class="bridge-post">
                  <div class="bridge-post-head">
                    <strong>{{ item.post.title }}</strong>
                    <span class="tag">{{ item.post.orderStatus === 'open' ? '社区待接单' : '社区已演练接单' }}</span>
                    <span class="tag" :class="item.registered ? 'status' : (store.intakePaused ? 'warning' : '')">{{ item.registered ? '已登记' : (store.intakePaused ? '登记已暂停' : '可登记') }}</span>
                  </div>
                  <p class="bridge-post-content">{{ item.post.content }}</p>
                  <p v-if="item.mapping.summaryTruncated" class="hint">登记到 A+ 的摘要限制为 240 字，超出部分仍保留在原社区帖子中。</p>
                  <div class="queue-meta">
                    <span class="tag">{{ item.post.category || '待分类' }}</span>
                    <span v-if="item.post.timeWindow" class="tag">时段：{{ item.post.timeWindow }}</span>
                    <span v-if="item.post.duration" class="tag">时长：{{ item.post.duration }}</span>
                    <span v-if="item.post.location" class="tag">{{ item.post.location }}</span>
                  </div>
                  <p v-if="item.post.specialNote" class="hint">{{ item.post.specialNote }}</p>
                  <div class="bridge-post-foot">
                    <small>帖子 ID：{{ item.post.id }}</small>
                    <span v-if="item.registered" class="tag status">已登记 · {{ item.registered.id }} · {{ caseStatusLabel(item.registered) }}</span>
                    <button v-else class="button small primary" type="button" :disabled="!communitySyntheticConfirmed || store.storageStatus === 'recovery-required' || store.intakePaused" @click="startCommunityRegistration(item.post)">登记到 A+ 队列</button>
                  </div>
                </article>
              </div>
            </template>
            <div v-if="communityBridgeError" class="form-error" role="alert">{{ communityBridgeError }}</div>
          </template>
        </div>

        <footer v-if="communityReviewRequired" class="modal-footer">
          <button class="button" type="button" @click="cancelCommunityReview">返回帖子列表</button>
          <button class="button primary" type="button" :disabled="!communitySyntheticConfirmed || !communityDuplicateConfirmed || !communityDuplicateExplanation.trim() || store.intakePaused" @click="confirmCommunityRegistration">确认仍创建独立记录</button>
        </footer>
        <footer v-else class="modal-footer">
          <button class="button" type="button" @click="closeCommunityBridge">关闭</button>
        </footer>
      </section>
    </div>

    <div v-if="showCreate" class="modal-backdrop" @click.self="closeAllDialogs">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <header class="modal-header"><div><h2 id="create-title">{{ duplicateReviewRequired ? '发现完全重复的登记内容' : '新建演练记录' }}</h2><p>{{ duplicateReviewRequired ? '创建已暂停；请人工核对候选记录。' : '只建立虚构案例，不连接居民入口或外部服务。' }}</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
        <div class="modal-body">
          <div v-if="store.intakePaused" class="notice-inline" role="alert">{{ INTAKE_PAUSED_NOTICE }} 请先恢复新登记再创建；已有记录仍可继续跟进。</div>
          <template v-if="duplicateReviewRequired">
            <div class="notice-inline" role="alert">发现标签或摘要完全相同的已有记录（仅比较去除首尾空白、折叠连续空白并忽略大小写后的文本，不做模糊匹配）。创建已暂停；不会合并、覆盖或删除任何记录。</div>
            <div class="hint">本次拟建记录的来源渠道演练标记：{{ getSyntheticSourceChannelLabel(createForm.sourceChannel) }}。请对照下方候选记录的来源，判断是否为跨合成来源的重复登记。</div>
            <div class="related-case-list">
              <button v-for="candidate in duplicateCandidates" :key="candidate.id" class="related-case" type="button" @click="openDuplicateCandidate(candidate.id)">
                <span><strong>{{ candidate.id }} · {{ candidate.label }}</strong><small>{{ candidate.summary }}</small><small>来源渠道：{{ getSyntheticSourceChannelLabel(candidate.sourceChannel) }}</small></span>
                <span class="tag">{{ caseStatusLabel(candidate) }}</span>
              </button>
            </div>
            <div class="hint">打开候选记录会离开本次创建，当前填写内容不会保存。若仍需新建独立记录，请填写复核说明并再次确认。</div>
            <label class="synthetic-confirm"><input v-model="duplicateConfirmed" type="checkbox" /><span><strong>我已人工核对以上候选记录，确认需要另建一条独立记录</strong><small>不会合并、覆盖或删除候选记录；新记录会保留当前表单内容，关联候选记录并追加复核时间线。</small></span></label>
            <div class="field"><label for="duplicate-explanation">人工重复复核说明 <span aria-hidden="true">*</span></label><textarea id="duplicate-explanation" v-model="duplicateExplanation" maxlength="160" placeholder="简要说明为何仍需另建独立记录"></textarea></div>
            <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
            <div v-if="duplicateError" class="form-error" role="alert">{{ duplicateError }}</div>
          </template>
          <template v-else>
            <div class="notice-inline">本表单是自由文本，无法技术性识别或阻止真实信息。这里只能填写虚构案例；不得输入姓名、电话、精确地址、健康或儿童信息。高风险选项只演练“停止普通初筛”，不会触发通知。</div>
            <div class="field"><label for="record-label">演练标签</label><input id="record-label" v-model="createForm.label" maxlength="30" placeholder="例如：演练-006" /><div class="hint">创建前会检查标签或摘要是否完全重复；发现候选时会暂停创建。</div></div>
            <div class="field"><label for="record-summary">模拟登记摘要 <span aria-hidden="true">*</span></label><textarea id="record-summary" v-model="createForm.summary" maxlength="240" placeholder="只写一般性虚构演练描述"></textarea><div class="hint">自由文本字段没有真实信息检测或拦截功能。只能填写虚构内容。</div></div>
            <div class="field">
              <label for="record-source">来源渠道演练标记 <span aria-hidden="true">*</span></label>
              <select id="record-source" v-model="createForm.sourceChannel">
                <option v-for="channel in SYNTHETIC_SOURCE_CHANNELS" :key="channel.value" :value="channel.value">{{ channel.label }}</option>
              </select>
              <div class="hint">仅标记本条合成演练记录的虚构来源，不会创建或连接真实居民入口、社区渠道、外部机构或受理系统。默认“人工录入演练”。</div>
            </div>
            <div class="form-row">
              <div class="field"><label for="record-owner">负责人 <span aria-hidden="true">*</span></label><input id="record-owner" v-model="createForm.owner" maxlength="40" placeholder="演练-受理席-01" /></div>
              <div class="field"><label for="record-due">演练跟进截止 <span aria-hidden="true">*</span></label><input id="record-due" v-model="createForm.dueAt" type="datetime-local" /><div class="hint">默认值仅用于演练，不构成运营 SLA。</div></div>
            </div>
            <label class="risk-choice"><input v-model="createForm.highRisk" type="checkbox" /><span><strong>高风险停止初筛演练</strong><small>只添加模拟停止标记；不联系、不通知、不派单。</small></span></label>
            <div v-if="createForm.highRisk" class="notice-inline" role="alert">{{ HIGH_RISK_STOP_NEXT_STEP }}。本原型只记录演练标记，不会启动真实升级流程。</div>
            <div v-if="createForm.highRisk" class="field"><label for="record-high-risk-note">停止初筛的演练依据 <span aria-hidden="true">*</span></label><textarea id="record-high-risk-note" v-model="createForm.highRiskNote" maxlength="240" placeholder="只写虚构演练依据，不要填写真实个人信息"></textarea></div>
            <div v-if="!createForm.highRisk" class="field"><label for="record-next">下一步 <span aria-hidden="true">*</span></label><input id="record-next" v-model="createForm.nextStep" maxlength="120" /></div>
            <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
            <div v-if="createError" class="form-error" role="alert">{{ createError }}</div>
          </template>
        </div>
        <footer v-if="duplicateReviewRequired" class="modal-footer"><button class="button" type="button" @click="cancelDuplicateReview">返回修改</button><button class="button primary" type="button" :disabled="!syntheticConfirmed || !duplicateConfirmed || !duplicateExplanation.trim() || store.intakePaused" @click="createRecord">确认仍创建独立记录</button></footer>
        <footer v-else class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!syntheticConfirmed || store.intakePaused" @click="createRecord">创建演练记录</button></footer>
      </section>
    </div>

    <div v-if="showHighRiskStop" class="modal-backdrop" @click.self="closeAllDialogs">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="high-risk-title">
        <header class="modal-header"><div><h2 id="high-risk-title">停止常规初筛</h2><p>{{ selectedCase?.id }} · 追加高风险演练标记。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
        <div class="modal-body">
          <div class="notice-inline" role="alert">{{ HIGH_RISK_STOP_NEXT_STEP }}。保存后将锁定常规初筛、模拟联系和普通状态更新，仅允许反复记录演练人工交接结果。不会实际联系、通知或调度；风险标记不会解除，也不代表真实升级已完成。</div>
          <div class="hint">自由文本无法技术性识别或阻止真实个人信息，只能填写虚构演练内容。</div>
          <div class="field"><label for="high-risk-note">停止初筛的演练依据 <span aria-hidden="true">*</span></label><textarea id="high-risk-note" v-model="highRiskNote" maxlength="240" placeholder="记录虚构演练中的标记依据"></textarea></div>
          <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
          <div v-if="highRiskError" class="form-error" role="alert">{{ highRiskError }}</div>
        </div>
        <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button danger" type="button" :disabled="!syntheticConfirmed || !highRiskNote.trim()" @click="saveHighRiskStop">停止初筛并记录</button></footer>
      </section>
    </div>

    <div v-if="showTransition" class="modal-backdrop" @click.self="closeAllDialogs">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="transition-title">
        <header class="modal-header"><div><h2 id="transition-title">{{ transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF' ? '记录演练人工交接' : '更新登记状态' }}</h2><p>{{ selectedCase?.id }} · 所有变化将加入时间线。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
        <div class="modal-body">
          <div class="field"><label for="action-select">登记动作 <span aria-hidden="true">*</span></label><select id="action-select" v-model="transitionForm.action"><option :value="null">请选择登记动作</option><option v-for="action in actionOptions" :key="action" :value="action">{{ actionLabels[action] }}</option></select></div>
          <div v-if="transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF'" class="field"><label for="handoff-outcome">交接结果 <span aria-hidden="true">*</span></label><select id="handoff-outcome" v-model="transitionForm.handoffOutcome"><option value="">请选择交接结果</option><option v-for="outcome in HIGH_RISK_HANDOFF_OUTCOMES" :key="outcome.value" :value="outcome.value">{{ outcome.label }}</option></select></div>
          <div v-if="transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF' && transitionForm.handoffOutcome === 'accepted'" class="field"><label for="handoff-owner">虚构接手人 <span aria-hidden="true">*</span></label><input id="handoff-owner" v-model="transitionForm.handoffOwner" maxlength="40" placeholder="例如：演练-复核席-02" /></div>
          <div v-if="needsReason" class="field"><label for="reason-select">原因 <span aria-hidden="true">*</span></label><select id="reason-select" v-model="transitionForm.reasonCode"><option value="">请选择原因</option><option v-for="reason in transitionReasonOptions" :key="reason" :value="reason">{{ reasonLabels[reason] }}</option></select></div>
          <div v-if="transitionActionBlockedReason" class="notice-inline" role="alert">{{ transitionActionBlockedReason }} 请先在详情面板更新登记检查点。</div>
          <div v-if="transitionForm.action === 'REFER'" class="notice-inline">转介对象只填虚构演练名称；本原型不会发送转介，也不代表外部机构已收到。</div>
          <div v-if="transitionForm.action === 'CONFIRM_REFERRAL'" class="notice-inline">此项只录入虚构演练确认依据，不会发送转介，也不代表外部机构真实接收。</div>
          <div v-if="transitionForm.action === 'REFERRAL_FAILED'" class="notice-inline">只把记录退回待分诊并保留人工跟进；不会联系外部机构或发送通知。请填写虚构的责任人、下一步和截止时间。</div>
          <div v-if="transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF'" class="notice-inline" role="alert">每次保存只追加本地演练交接记录，可反复登记，状态保持开放；保存后会更新负责人、下一步和演练截止时间。选择“有人接手”时必须填写虚构接手人；选择“暂无人接手”时不得填写接手人。不会实际联系、通知或派单，风险标记不会解除，也不代表真实升级完成、风险已解除或服务已完成。真实高风险情形必须按运营方批准的流程处理。</div>
          <div v-if="transitionForm.action === 'CLOSE_FOLLOW_UP'" class="notice-inline">结束的是本原型中的人工跟进记录，不代表服务已提供、完成或核实；请在说明中记录虚构的结束依据。</div>
          <div v-if="transitionForm.action === 'REFER'" class="field"><label for="referral-target">虚构演练转介对象 <span aria-hidden="true">*</span></label><input id="referral-target" v-model="transitionForm.referralTarget" maxlength="80" placeholder="例如：演练-社区支持点 A" /></div>
          <div class="hint">自由文本无法技术性识别或阻止真实个人信息。这里只能填写虚构演练内容。</div>
          <div class="field"><label for="transition-note">{{ transitionForm.action === 'CONFIRM_REFERRAL' ? '虚构演练确认依据' : transitionForm.action === 'REFER' ? '虚构转介依据' : transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF' ? '交接说明' : '处理说明' }}<span v-if="transitionNoteRequired" aria-hidden="true"> *</span></label><textarea id="transition-note" v-model="transitionForm.note" maxlength="240" :placeholder="transitionNoteRequired ? '请填写虚构演练说明，不要输入真实个人信息' : '只记录演练过程；不要输入真实个人信息'"></textarea></div>
          <div v-if="transitionTargetIsOpen" class="form-row">
            <div class="field"><label for="transition-owner">负责人 <span aria-hidden="true">*</span></label><input id="transition-owner" v-model="transitionForm.owner" maxlength="40" /></div>
            <div class="field"><label for="transition-due">演练跟进截止 <span aria-hidden="true">*</span></label><input id="transition-due" v-model="transitionForm.dueAt" type="datetime-local" /></div>
          </div>
          <div v-if="transitionTargetIsOpen" class="field"><label for="transition-next">下一步 <span aria-hidden="true">*</span></label><input id="transition-next" v-model="transitionForm.nextStep" maxlength="120" /></div>
          <div v-if="transitionTargetIsOpen" class="hint">{{ transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF' ? '两种交接结果都必须填写负责人、下一步和演练截止时间；截止时间仅用于演练，不构成运营 SLA。' : '默认截止时间仅为演练值，不构成运营 SLA。' }}</div>
          <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
          <div v-if="transitionErrors.length" class="form-error" role="alert"><span v-for="error in transitionErrors" :key="error">{{ error }}</span></div>
        </div>
        <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="transitionSubmitDisabled" @click="applyTransition">{{ transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF' ? '保存交接记录' : '确认更新' }}</button></footer>
      </section>
    </div>

    <div v-if="showFollowUp" class="modal-backdrop" @click.self="closeAllDialogs">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="followup-title">
        <header class="modal-header"><div><h2 id="followup-title">调整人工跟进</h2><p>变更记录会追加到时间线，不会自动联系任何人。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
        <div class="modal-body">
          <div v-if="selectedRiskNotice" class="notice-inline">{{ selectedRiskNotice }}</div>
          <div class="notice-inline">自由文本无法技术性识别或阻止真实个人信息。这里只能填写虚构演练内容。</div>
          <div class="form-row">
            <div class="field"><label for="followup-owner">负责人 <span aria-hidden="true">*</span></label><input id="followup-owner" v-model="followUpForm.owner" maxlength="40" /></div>
            <div class="field"><label for="followup-due">演练跟进截止 <span aria-hidden="true">*</span></label><input id="followup-due" v-model="followUpForm.dueAt" type="datetime-local" /><div class="hint">截止时间仅用于演练，不构成运营 SLA。</div></div>
          </div>
          <div class="field"><label for="followup-next">下一步 <span aria-hidden="true">*</span></label><input id="followup-next" v-model="followUpForm.nextStep" maxlength="120" /></div>
          <div class="field"><label for="followup-note">调整原因 <span aria-hidden="true">*</span></label><textarea id="followup-note" v-model="followUpForm.note" maxlength="160" placeholder="说明为什么调整负责人或下一步"></textarea></div>
          <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
          <div v-if="followUpError" class="form-error" role="alert">{{ followUpError }}</div>
        </div>
        <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!syntheticConfirmed" @click="saveFollowUp">保存跟进</button></footer>
      </section>
    </div>

    <div v-if="showContactSimulation" class="modal-backdrop" @click.self="closeAllDialogs">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="contact-simulation-title">
        <header class="modal-header"><div><h2 id="contact-simulation-title">记录模拟联系结果</h2><p>{{ selectedCase?.id }} · 保存结果会更新负责人、下一步和截止时间，并追加到时间线。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
        <div class="modal-body">
          <div class="notice-inline" role="note">仅录入合成演练中的模拟结果，不代表真实联系。保存时还会用下方内容更新负责人、下一步和演练跟进截止时间，但不会改变登记状态。不要填写真实姓名、电话或其他个人信息；本操作不会联系任何人或发送通知。</div>
          <div class="field"><label for="contact-simulation-outcome">模拟结果 <span aria-hidden="true">*</span></label><select id="contact-simulation-outcome" v-model="contactSimulationForm.outcome"><option v-for="outcome in CONTACT_SIMULATION_OUTCOMES" :key="outcome.value" :value="outcome.value">{{ outcome.label }}</option></select></div>
          <div class="hint">自由文本无法技术性识别或阻止真实个人信息，只能填写虚构演练内容。</div>
          <div class="field"><label for="contact-simulation-note">演练说明 <span aria-hidden="true">*</span></label><textarea id="contact-simulation-note" v-model="contactSimulationForm.note" maxlength="160" placeholder="记录虚构的模拟结果和后续安排"></textarea></div>
          <div class="form-row">
            <div class="field"><label for="contact-simulation-owner">负责人 <span aria-hidden="true">*</span></label><input id="contact-simulation-owner" v-model="contactSimulationForm.owner" maxlength="40" /></div>
            <div class="field"><label for="contact-simulation-due">演练跟进截止 <span aria-hidden="true">*</span></label><input id="contact-simulation-due" v-model="contactSimulationForm.dueAt" type="datetime-local" /><div class="hint">截止时间仅用于演练，不构成运营 SLA。</div></div>
          </div>
          <div class="field"><label for="contact-simulation-next">下一步 <span aria-hidden="true">*</span></label><input id="contact-simulation-next" v-model="contactSimulationForm.nextStep" maxlength="120" /></div>
          <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
          <div v-if="contactSimulationError" class="form-error" role="alert">{{ contactSimulationError }}</div>
        </div>
        <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!syntheticConfirmed" @click="saveContactSimulation">保存模拟记录</button></footer>
      </section>
    </div>

    <div v-if="showReopen" class="modal-backdrop" @click.self="closeAllDialogs">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="reopen-title">
        <header class="modal-header"><div><h2 id="reopen-title">建立关联重开演练记录</h2><p>{{ selectedCase?.id }} · 新建开放记录并关联原记录。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
        <div class="modal-body">
          <div v-if="store.intakePaused" class="notice-inline" role="alert">{{ INTAKE_PAUSED_NOTICE }} 请先恢复新登记再建立关联记录。</div>
          <div class="notice-inline">重开会创建一条新的合成演练记录，原记录及时间线保留不变。自由文本无法技术性识别或拦截真实个人信息，只能填写虚构内容。</div>
          <div class="form-row">
            <div class="field"><label for="reopen-owner">负责人 <span aria-hidden="true">*</span></label><input id="reopen-owner" v-model="reopenForm.owner" maxlength="40" /></div>
            <div class="field"><label for="reopen-due">演练跟进截止 <span aria-hidden="true">*</span></label><input id="reopen-due" v-model="reopenForm.dueAt" type="datetime-local" /><div class="hint">默认值仅用于演练，不构成运营 SLA。</div></div>
          </div>
          <div class="field"><label for="reopen-next">下一步 <span aria-hidden="true">*</span></label><input id="reopen-next" v-model="reopenForm.nextStep" maxlength="120" /></div>
          <div class="field"><label for="reopen-note">重开原因 <span aria-hidden="true">*</span></label><textarea id="reopen-note" v-model="reopenForm.note" maxlength="160" placeholder="填写虚构演练原因"></textarea></div>
          <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
          <div v-if="reopenError" class="form-error" role="alert">{{ reopenError }}</div>
        </div>
        <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!syntheticConfirmed || store.intakePaused" @click="createReopenedRecord">创建关联记录</button></footer>
      </section>
    </div>

    <div v-if="showCheckpoint" class="modal-backdrop" @click.self="closeAllDialogs">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="checkpoint-title">
        <header class="modal-header"><div><h2 id="checkpoint-title">更新登记检查点</h2><p>{{ selectedCase?.id }} · 每次更新都会追加时间线记录。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
        <div class="modal-body">
          <div class="notice-inline" role="note">{{ CHECKPOINT_SYNTHETIC_NOTICE }} 只有同意状态为“已确认”且必填信息已完整时，才会开放普通接单、转介、跟进和模拟联系；高风险停止与人工交接通道不受限制。</div>
          <div class="field"><label for="checkpoint-consent">演练同意状态 <span aria-hidden="true">*</span></label><select id="checkpoint-consent" v-model="checkpointForm.consentStatus"><option v-for="status in CONSENT_STATUSES" :key="status.value" :value="status.value">{{ status.label }}</option></select></div>
          <label class="synthetic-confirm"><input v-model="checkpointForm.requiredInfoComplete" type="checkbox" /><span><strong>演练必填信息已完整</strong><small>仅表示虚构案例的必填字段齐备，不代表真实身份核验、法律同意或服务资格。</small></span></label>
          <div class="field"><label for="checkpoint-note">检查点更新说明 <span aria-hidden="true">*</span></label><textarea id="checkpoint-note" v-model="checkpointForm.note" maxlength="160" placeholder="只写虚构演练说明，不要输入真实个人信息"></textarea></div>
          <div class="hint">旧记录缺少检查点字段时按“未知 / 未完整”解释。重开记录会重置为“未知 / 未完整”。</div>
          <div v-if="checkpointError" class="form-error" role="alert">{{ checkpointError }}</div>
        </div>
        <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!checkpointForm.note.trim()" @click="saveCheckpoint">保存检查点</button></footer>
      </section>
    </div>

    <div v-if="showComplaint" class="modal-backdrop" @click.self="closeAllDialogs">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="complaint-title">
        <header class="modal-header"><div><h2 id="complaint-title">提交演示投诉</h2><p>{{ selectedCase?.id }} · 独立投诉队列，不改写 case 风险时间线。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
        <div class="modal-body">
          <div class="notice-inline" role="note">{{ COMPLAINT_SYNTHETIC_NOTICE }} 任一演示角色可以针对其他角色提交；投诉不会改动风险标记、跟进时间线或 case 状态。</div>
          <div class="field"><label for="complaint-target">针对的演示角色 <span aria-hidden="true">*</span></label><select id="complaint-target" v-model="complaintForm.targetRole"><option v-for="role in complaintTargetRoles" :key="role.value" :value="role.value">{{ role.label }}</option></select><div class="hint">提交人演示角色：{{ currentDemoRoleLabel }}。不能针对提交人自己的演示角色提交。</div></div>
          <div class="field"><label for="complaint-description">投诉说明 <span aria-hidden="true">*</span></label><textarea id="complaint-description" v-model="complaintForm.description" maxlength="240" placeholder="只填写虚构演练内容，不要输入真实个人信息"></textarea></div>
          <label class="synthetic-confirm"><input v-model="complaintSyntheticConfirmed" type="checkbox" /><span><strong>我确认本次投诉只使用演示角色和虚构内容</strong><small>这是演示角色校验，不是真实账号权限、实名举报或正式申诉流程。</small></span></label>
          <div v-if="complaintError" class="form-error" role="alert">{{ complaintError }}</div>
        </div>
        <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!complaintSyntheticConfirmed || !complaintForm.description.trim()" @click="submitComplaint">提交到复核队列</button></footer>
      </section>
    </div>

    <div v-if="toastMessage" class="toast" role="status">{{ toastMessage }}</div>
  </div>
</template>

<style scoped>
.button:disabled, .mobile-nav button:disabled { cursor: not-allowed; opacity: .55; }
.button:disabled:hover { transform: none; }
.intake-gate { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; padding: 12px 15px; border: 1px solid #cfe3df; border-radius: 10px; color: #3f5d61; background: #f4faf8; }
.intake-gate.paused { border-color: #ecd8b6; color: #755326; background: #fff8eb; }
.intake-gate-mark { display: grid; place-items: center; width: 27px; height: 27px; flex: none; border-radius: 8px; color: #176c69; background: #e1f0eb; font-size: 12px; font-weight: 700; }
.intake-gate.paused .intake-gate-mark { color: #9a6517; background: #f8ebd0; }
.intake-gate-copy { flex: 1; min-width: 0; font-size: 11px; line-height: 1.55; }
.intake-gate-copy strong { display: block; font-size: 11px; }
.intake-gate-copy p { margin: 4px 0 0; }
.intake-gate .button { flex: none; }
@media (max-width: 640px) {
  .intake-gate { align-items: flex-start; flex-wrap: wrap; }
  .intake-gate .button { width: 100%; }
}
.risk-flag-list { display: grid; gap: 7px; margin: -6px 0 14px; }
.risk-flag-item { padding: 9px 11px; border: 1px solid #e6ecea; border-radius: 8px; background: #f8faf9; }
.risk-flag-item strong { color: #52696d; font-size: 10px; }
.risk-flag-item strong small { color: #91a0a2; font-size: 9px; font-weight: 500; }
.risk-flag-item p { margin: 4px 0 0; color: #718487; font-size: 10px; line-height: 1.5; }
.related-case-list { display: grid; gap: 7px; }
.related-case { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 10px 12px; border: 1px solid #e6ecea; border-radius: 8px; color: #3f5d61; background: #fbfcfc; text-align: left; cursor: pointer; }
.related-case:hover { border-color: #9bb9b2; background: #f5faf8; }
.related-case strong, .related-case small { display: block; }
.related-case strong { font-size: 11px; }
.related-case small { margin-top: 4px; color: #718487; font-size: 10px; }
.risk-choice { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid #ecd9d4; border-radius: 8px; color: #8d4a43; background: #fff7f5; cursor: pointer; }
.risk-choice input { width: 15px; height: 15px; margin: 2px 0 0; accent-color: #ae5148; }
.risk-choice strong, .risk-choice small { display: block; }
.risk-choice strong { font-size: 11px; }
.risk-choice small { margin-top: 4px; color: #a16e68; font-size: 9px; }
.synthetic-confirm { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px; border: 1px solid #d9e8e4; border-radius: 8px; color: #3f5d61; background: #f7fbfa; cursor: pointer; }
.synthetic-confirm input { width: 15px; height: 15px; margin: 2px 0 0; accent-color: #176c69; }
.synthetic-confirm strong, .synthetic-confirm small { display: block; }
.synthetic-confirm strong { font-size: 11px; }
.synthetic-confirm small { margin-top: 4px; color: #6f8588; font-size: 9px; line-height: 1.5; }
.modal-footer .button:disabled { cursor: not-allowed; opacity: .55; }
.form-error { display: grid; gap: 4px; padding: 10px 11px; border-radius: 7px; color: #9c4841; background: #fbece9; font-size: 10px; line-height: 1.5; }
.bridge-modal { width: min(100%, 640px); }
.bridge-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.bridge-status { color: #718487; font-size: 10px; line-height: 1.5; }
.bridge-post-list { display: grid; gap: 9px; }
.bridge-post { padding: 12px; border: 1px solid #e6ecea; border-radius: 9px; background: #fbfcfc; }
.bridge-post-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.bridge-post-head strong { color: #344d53; font-size: 11px; line-height: 1.5; }
.bridge-post-content { margin: 6px 0 8px; color: #5b7074; font-size: 10px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.bridge-post .queue-meta { gap: 5px; }
.bridge-post-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 9px; padding-top: 9px; border-top: 1px solid #edf1f0; }
.bridge-post-foot small { color: #879598; font-size: 9px; overflow-wrap: anywhere; }
.bridge-candidate { cursor: default; align-items: flex-start; }
.bridge-candidate:hover { border-color: #e6ecea; background: #fbfcfc; }
.bridge-candidate > .tag { flex: none; }
.bridge-modal .empty-state { padding: 24px 16px; border: 1px dashed #dfe8e6; border-radius: 9px; background: #fbfdfc; line-height: 1.7; }
.checkpoint-callout { margin-bottom: 12px; padding: 10px 12px; border: 1px solid #ecd8b6; border-radius: 8px; color: #755326; background: #fff8eb; font-size: 10px; line-height: 1.55; }
.checkpoint-callout.ready { border-color: #cfe3df; color: #3f5d61; background: #f4faf8; }
.checkpoint-callout strong { font-size: 11px; }
.checkpoint-callout p { margin: 4px 0 0; }
.complaint-panel { margin-top: 16px; }
.complaint-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.complaint-detail { min-width: 0; padding: 12px; border: 1px solid #e6ecea; border-radius: 9px; background: #fbfcfc; }
.complaint-detail .detail-title { font-size: 13px; }
@media (max-width: 900px) {
  .complaint-grid { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .bridge-post-foot { align-items: flex-start; flex-direction: column; }
  .bridge-post-foot .button { width: 100%; }
}
</style>
