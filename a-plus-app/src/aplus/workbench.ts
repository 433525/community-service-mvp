/**
 * A+ 受控登记演练的工作台状态与动作。
 *
 * 该组合式函数是 A+ 端唯一的状态源：在 App.vue 调用一次，通过 provide 下发给
 * 布局与对话框组件。子组件只读取绑定、调用动作，不各自持有副本，
 * 避免多份 show* 开关或表单草稿产生不一致。
 *
 * 约定：
 * - 所有对外暴露的状态都是 ref / computed，解构后仍保持响应性；
 * - 动作函数保持幂等或可重复调用，失败时只写错误字段与提示，不抛异常；
 * - 不直接操作业务存储，全部经 Pinia store 完成，便于单测与后续替换后端。
 *
 * 结构：状态（筛选 / 对话框 / 表单 / 存档 / 社区桥）→ 派生（队列 / 详情 / 流转 / 投诉）
 * → 交互（焦点 / 滚动 / 深链 / 受理开关）→ 动作（备份 / 表单复位 / 提交 / 投诉 / 社区桥）
 * → 生命周期。代码内用 `// ── 分组名 ──` 分隔，可按注释直接定位。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  COMPLAINT_REVIEWER_ROLES,
  DEFAULT_SYNTHETIC_SOURCE_CHANNEL,
  getCaseCheckpointBlockedReason,
  getCaseConsentStatus,
  getHighRiskStopScreeningNotice,
  getIntakeActionBlockedReason,
  getIntakeActionTarget,
  getAllowedIntakeActions,
  getSyntheticSourceChannelLabel,
  isCaseCheckpointReady,
  isCaseRequiredInfoComplete,
  isComplaintReviewerRole,
  isIntakeOverdue,
  isOpenIntakeStatus,
  intakeActionRequiresReason,
  type ConsentStatus,
  type ContactSimulationOutcome,
  type DemoRole,
  type HighRiskHandoffOutcome,
  type IntakeAction,
  type IntakeCase,
  type IntakeReasonCode,
} from '../domain/intake'
import { INTAKE_PAUSED_NOTICE, useIntakeStore, type NewIntakeInput } from '../stores/intake'
import { MAX_BACKUP_BYTES } from '../domain/intake-backup'
import {
  INTAKE_FILTERS,
  readIntakeFilter,
  writeIntakeFilter,
  type IntakeFilter,
} from '../intake-filter-preference'
import {
  mapCommunityHelpPostToIntake,
  readCommunityHelpPosts,
  type CommunityHelpPost,
  type CommunityHelpReadResult,
} from '../domain/community-bridge'
import { resolveIntakeSourceLink } from '../community/intake-progress'
import { APP_ERROR_EVENT } from '../shared/error-reporting'
import { copyText } from '../shared/clipboard'
import { buildShareUrl, onRoutePop, readRouteParam, writeRoute } from '../shared/route-state'
import { useDialogFocus } from './dialog-focus'
import {
  ACTION_LABELS,
  DEMO_ROLES,
  REASON_LABELS,
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
} from './presentation'
import { useToast } from './toast'

export function useAplusWorkbench() {
  const store = useIntakeStore()
  const { toastMessage, toastIsError, notify } = useToast()

  // ── 队列筛选与详情选择 ────────────────────────────────────────────────
  const search = ref('')
  const activeFilter = ref<IntakeFilter>(readIntakeFilter())
  const filters = [...INTAKE_FILTERS]
  watch(activeFilter, (value) => writeIntakeFilter(value), { flush: 'post' })

  // ── 对话框可见性 ─────────────────────────────────────────────────────
  const showCreate = ref(false)
  const showTransition = ref(false)
  const showFollowUp = ref(false)
  const showContactSimulation = ref(false)
  const showReopen = ref(false)
  const showHighRiskStop = ref(false)
  const showCheckpoint = ref(false)
  const showHelp = ref(false)
  const showComplaint = ref(false)
  const showCommunityBridge = ref(false)

  const anyDialogOpen = computed(() => (
    showHelp.value
    || showCreate.value
    || showTransition.value
    || showFollowUp.value
    || showContactSimulation.value
    || showReopen.value
    || showHighRiskStop.value
    || showCheckpoint.value
    || showComplaint.value
    || showCommunityBridge.value
  ))

  // ── 表单与校验错误 ───────────────────────────────────────────────────
  const syntheticConfirmed = ref(false)
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
  const checkpointError = ref('')
  const complaintError = ref('')
  const complaintSyntheticConfirmed = ref(false)
  const complaintReviewResolution = ref('')
  const complaintReviewError = ref('')

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
  const checkpointForm = reactive({
    consentStatus: 'unknown' as ConsentStatus,
    requiredInfoComplete: false,
    note: '',
  })
  const complaintForm = reactive({
    targetRole: 'demo-review' as DemoRole,
    description: '',
  })

  // ── 备份与存档状态 ───────────────────────────────────────────────────
  const backupInput = ref<HTMLInputElement | null>(null)
  const backupText = ref('')
  const backupTextInput = ref<HTMLTextAreaElement | null>(null)
  const unreadableDownloaded = ref(false)

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

  // ── 社区桥（单向读取本机社区存档）────────────────────────────────────
  const communityReadResult = ref<CommunityHelpReadResult | null>(null)
  const communitySyntheticConfirmed = ref(false)
  const communityPendingPost = ref<CommunityHelpPost | null>(null)
  const communityPendingInput = ref<NewIntakeInput | null>(null)
  const communityDuplicateCandidates = ref<IntakeCase[]>([])
  const communityDuplicateConfirmed = ref(false)
  const communityDuplicateExplanation = ref('')
  const communityBridgeError = ref('')

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
    const base = result.posts.length === 0
      ? '存档已读取，但没有可登记的合成求助'
      : `已读取 ${result.posts.length} 条合成求助 · 存档保存于 ${formatDate(result.savedAt)}`
    return result.warnings.length
      ? `${base}；跳过 ${result.warnings.length} 条无法解析的记录`
      : base
  })
  const communityReadWarnings = computed(() => (
    communityReadResult.value?.status === 'ready' ? communityReadResult.value.warnings : []
  ))
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

  // ── 角色与文案 ──────────────────────────────────────────────────────
  const roles = [...DEMO_ROLES]
  const currentDemoRoleLabel = computed(() =>
    roles.find((role) => role.value === store.currentDemoRole)?.label ?? roles[0].label,
  )
  const reasonLabels = REASON_LABELS
  const actionLabels = ACTION_LABELS

  // ── 派生：队列 ──────────────────────────────────────────────────────
  const isCaseOverdue = (item: IntakeCase) => isIntakeOverdue(item, new Date(store.clockNow).toISOString())

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
      if (activeFilter.value === '待分诊') return store.triageCases.some((candidate) => candidate.id === item.id)
      if (activeFilter.value === '初筛中') return store.screeningCases.some((candidate) => candidate.id === item.id)
      if (activeFilter.value === '演练逾期') return isCaseOverdue(item)
      if (activeFilter.value === '高风险') return caseHasHighRisk(item)
      if (activeFilter.value === '已结束') return !isOpenIntakeStatus(item.status)
      return true
    })
  })

  // ── 派生：详情 ──────────────────────────────────────────────────────
  const selectedCase = computed(() => store.selectedCase)
  const selectedRiskNotice = computed(() => selectedCase.value ? getHighRiskStopScreeningNotice(selectedCase.value) : null)
  const selectedHighRiskHandoffCount = computed(() => selectedCase.value?.events.filter(
    (event) => event.kind === 'risk-handoff',
  ).length ?? 0)
  const linkedCases = computed(() => {
    const item = selectedCase.value
    if (!item) return []
    const ids = [...new Set([item.reopenedFromId, ...(item.relatedCaseIds ?? [])].filter((id): id is string => !!id))]
    return ids
      .map((id) => store.cases.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is IntakeCase => !!candidate)
  })
  const selectedCaseCheckpointReady = computed(() =>
    selectedCase.value ? isCaseCheckpointReady(selectedCase.value) : false,
  )
  const selectedCaseCheckpointBlockedReason = computed(() =>
    selectedCase.value ? getCaseCheckpointBlockedReason(selectedCase.value) : null,
  )
  const actionOptions = computed<IntakeAction[]>(() => {
    if (!selectedCase.value) return []
    const allowed = getAllowedIntakeActions(selectedCase.value.status)
    if (selectedRiskNotice.value) {
      return allowed.filter((action) => action === 'RECORD_HIGH_RISK_HANDOFF')
    }
    return allowed.filter((action) => action !== 'RECORD_HIGH_RISK_HANDOFF')
  })
  const lifecycleText = computed(() => {
    const item = selectedCase.value
    if (!item) return '选择左侧记录查看跟进时间线与可用动作。'
    if (caseHasHighRisk(item)) return selectedHighRiskHandoffCount.value > 0
      ? `已停止常规初筛；已记录 ${selectedHighRiskHandoffCount.value} 次演练人工交接，风险标记仍未解除。本原型不实际联系、通知或派单，也不代表风险已解除、服务已完成或外部人员已真实接手。`
      : '已停止常规初筛；仅可反复记录演练人工交接，不会实际联系或通知，风险标记不会解除。'
    if (item.status === '已结束（服务结果未核实）') return '人工跟进已结束；本记录没有核实服务是否提供或完成。'
    if (item.status === '已提供信息') return '已提供信息可直接进入待分诊；本机状态不表示真实服务已提供或完成。'
    if (!isOpenIntakeStatus(item.status)) return '该记录已结束登记跟进；如需再次受理，请按运营流程建立关联记录。'
    if (item.status === '待补充') return '仅等待模拟信息补充；超时只标记内部待办，不自动联系或关闭。'
    if (item.status.includes('转介')) return '转介状态只记录外部确认，不代表服务已完成。'
    return '每条未结记录都需有负责人、下一步和截止时间。'
  })

  // ── 派生：状态流转表单 ──────────────────────────────────────────────
  const transitionReasonOptionsList = computed<IntakeReasonCode[]>(() =>
    transitionReasonOptions(transitionForm.action),
  )
  watch(() => transitionForm.action, (action) => {
    if (action === 'CLOSE_FOLLOW_UP') transitionForm.reasonCode = 'FOLLOW_UP_CONCLUDED'
    else if (transitionForm.reasonCode === 'FOLLOW_UP_CONCLUDED') transitionForm.reasonCode = ''
  })

  const transitionActionBlockedReason = computed(() => {
    const action = transitionForm.action
    return action && selectedCase.value ? getIntakeActionBlockedReason(action, selectedCase.value) : null
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

  // ── 派生：投诉复核 ──────────────────────────────────────────────────
  const complaintFilter = ref<'待复核' | '全部投诉'>('待复核')
  const selectedComplaintId = ref<string | null>(null)
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
    const availableReviewers = COMPLAINT_REVIEWER_ROLES.filter(
      (role) => role !== complaint.submittedByRole && role !== complaint.targetRole,
    )
    if (!availableReviewers.length) return '该历史投诉组合没有可用复核角色，无法复核；请重建投诉或重置演练数据。'
    const role = store.currentDemoRole
    if (!isComplaintReviewerRole(role)) return '只有 demo-review 或 demo-referral 演示角色可以复核。'
    if (role === complaint.submittedByRole) return '投诉提交人不能复核自己的投诉。'
    if (role === complaint.targetRole) return '被投诉角色不能复核针对自己的投诉。'
    return ''
  })
  const canReviewSelectedComplaint = computed(() => selectedComplaintReviewBlockedReason.value === '')
  const complaintTargetRoles = computed(() => roles.filter((role) => role.value !== store.currentDemoRole))
  const currentRoleReviewLabel = computed(() => isComplaintReviewerRole(store.currentDemoRole)
    ? '当前演示角色可复核（仍受提交人 / 被投诉角色回避限制）'
    : '当前演示角色不可复核投诉')

  // ── 对话框焦点与 Esc ────────────────────────────────────────────────
  useDialogFocus({ isOpen: () => anyDialogOpen.value, onEscape: () => closeAllDialogs() })

  // ── 选择与滚动 ──────────────────────────────────────────────────────
  const compactLayout = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1020px)').matches

  watch([activeFilter, search, filteredCases], () => {
    if (!filteredCases.value.length) return
    const current = store.selectedId
    if (current && filteredCases.value.some((item) => item.id === current)) return
    store.select(filteredCases.value[0].id)
  }, { flush: 'post' })

  watch(() => selectedCase.value?.id, () => {
    if (selectedCase.value && !filteredCases.value.some((item) => item.id === selectedCase.value?.id)) {
      activeFilter.value = '全部记录'
      search.value = ''
    }
  })

  /** 队列筛选无结果时的一键恢复，不改变任何记录。 */
  function resetQueueFilters() {
    activeFilter.value = '全部记录'
    search.value = ''
  }

  /** 移动端：选中记录后把详情带入视口，避免用户手动滚过整条队列。 */
  async function selectCase(id: string) {
    store.select(id)
    if (store.selectedId === id) writeRoute({ case: id }, { replace: true })
    if (!compactLayout()) return
    await nextTick()
    const panel = document.querySelector<HTMLElement>('.detail-panel')
    if (!panel) return
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
    panel.focus({ preventScroll: true })
  }

  /** 移动端：从详情返回队列，并把焦点交还给当前选中项。 */
  async function backToQueue() {
    document.querySelector<HTMLElement>('.queue-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    await nextTick()
    document.querySelector<HTMLElement>('.queue-item.selected')?.focus({ preventScroll: true })
  }

  /** 投诉队列在页面底部，用页头入口直达并聚焦，避免长页滚动。 */
  async function jumpToComplaints() {
    complaintFilter.value = '待复核'
    await nextTick()
    const panel = document.querySelector<HTMLElement>('.complaint-panel')
    if (!panel) return
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
    panel.focus({ preventScroll: true })
  }

  function selectRelatedCase(id: string) {
    activeFilter.value = '全部记录'
    search.value = ''
    store.select(id)
    if (store.selectedId === id) writeRoute({ case: id }, { replace: true })
  }

  // ── 深链 ────────────────────────────────────────────────────────────
  /**
   * 读取 `?case=` 深链。记录不存在时清理参数并说明，避免分享链接停在空详情。
   * 记录选择本身已持久化在本机，这里主要服务于跨浏览器/跨设备的分享场景。
   */
  function applyCaseRouteFromLocation(options: { initial?: boolean } = {}) {
    const id = readRouteParam('case')
    if (!id) return
    if (!store.cases.some((item) => item.id === id)) {
      writeRoute({ case: null }, { replace: true })
      if (options.initial) notify('链接中的演练记录不存在，已显示队列首条。')
      return
    }
    if (store.selectedId !== id) store.select(id)
  }

  /** 复制当前记录的深链；不含搜索词、筛选或任何居民信息。 */
  async function copySelectedCaseLink() {
    const item = selectedCase.value
    if (!item) return
    const url = buildShareUrl({ case: item.id })
    const copied = url ? await copyText(url) : false
    notify(copied ? '已复制当前记录的演练链接。' : '复制失败：请从地址栏复制链接。')
  }

  // ── 受理开关 ────────────────────────────────────────────────────────
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

  // ── 备份 ────────────────────────────────────────────────────────────
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
    unreadableDownloaded.value = true
    notify('已下载无法读取的旧存档原文')
  }

  function chooseBackup() {
    backupInput.value?.click()
  }

  async function importBackupFile(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    if (store.storageStatus === 'recovery-required' && !unreadableDownloaded.value) {
      notify('当前有无法读取的旧存档；请先点“下载无法读取的旧存档”保存原文，再导入备份')
      return
    }
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
      backupText.value = ''
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

  // ── 表单复位 ────────────────────────────────────────────────────────
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

  function openCheckpoint() {
    if (!selectedCase.value || !isOpenIntakeStatus(selectedCase.value.status) || caseHasHighRisk(selectedCase.value)) return
    resetAllForms()
    checkpointForm.consentStatus = getCaseConsentStatus(selectedCase.value)
    checkpointForm.requiredInfoComplete = isCaseRequiredInfoComplete(selectedCase.value)
    checkpointForm.note = ''
    showCheckpoint.value = true
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

  function openHighRiskStop() {
    if (!selectedCase.value || !isOpenIntakeStatus(selectedCase.value.status) || caseHasHighRisk(selectedCase.value)) return
    resetAllForms()
    showHighRiskStop.value = true
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

  function openComplaint() {
    if (!selectedCase.value) return
    resetAllForms()
    complaintForm.targetRole = complaintTargetRoles.value[0]?.value ?? 'demo-review'
    showComplaint.value = true
  }

  // ── 提交动作 ────────────────────────────────────────────────────────
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

  // ── 投诉 ────────────────────────────────────────────────────────────
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

  // ── 社区桥 ──────────────────────────────────────────────────────────
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

  // ── 关闭与重置 ──────────────────────────────────────────────────────
  function closeAllDialogs() {
    showHelp.value = false
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
    const unreadableArchive = store.storageStatus === 'recovery-required'
    if (unreadableArchive && !unreadableDownloaded.value) {
      notify('当前有无法读取的旧存档；请先点“下载无法读取的旧存档”保存原文，再重置演练数据')
      return
    }
    const promptText = unreadableArchive
      ? '当前存在无法读取的旧存档。重置会覆盖这份原文且无法恢复；请确认已保存原文。确认仍要覆盖并恢复初始演练数据吗？'
      : '恢复初始合成演练记录？这会清除当前所有记录和修改，建议先导出备份。'
    if (!window.confirm(promptText)) return
    const result = store.reset()
    if (!result.ok) {
      notify(result.errors.join(' '))
      return
    }
    closeAllDialogs()
    activeFilter.value = '全部记录'
    search.value = ''
    backupText.value = ''
    notify(store.storageStatus === 'memory-only'
      ? '已恢复初始合成演练数据（仅保存在当前会话，刷新后不会保留）'
      : '已恢复初始合成演练数据')
  }

  // ── 生命周期 ────────────────────────────────────────────────────────
  let overdueClockTimer: number | undefined
  let stopCaseRoutePop: (() => void) | null = null

  function onAppError(event: Event) {
    const detail = (event as CustomEvent<{ message?: string }>).detail
    notify(detail?.message ?? '界面出现异常，请刷新后重试。')
  }

  onMounted(() => {
    store.refreshClock()
    overdueClockTimer = window.setInterval(store.refreshClock, 60_000)
    window.addEventListener(APP_ERROR_EVENT, onAppError)
    stopCaseRoutePop = onRoutePop(() => applyCaseRouteFromLocation())
    applyCaseRouteFromLocation({ initial: true })
  })
  onBeforeUnmount(() => {
    if (overdueClockTimer !== undefined) window.clearInterval(overdueClockTimer)
    window.removeEventListener(APP_ERROR_EVENT, onAppError)
    stopCaseRoutePop?.()
  })

  return {
    // 基础
    store,
    notify,
    toastMessage,
    toastIsError,
    // 常量与文案
    roles,
    reasonLabels,
    actionLabels,
    // 队列
    search,
    filters,
    activeFilter,
    filteredCases,
    resetQueueFilters,
    selectCase,
    backToQueue,
    jumpToComplaints,
    isCaseOverdue,
    caseHasHighRisk,
    caseStatusLabel,
    eventHeading,
    eventChangeValue,
    formatDate,
    roleLabel,
    communityOrderStatusLabel,
    // 详情
    selectedCase,
    selectedRiskNotice,
    selectedHighRiskHandoffCount,
    linkedCases,
    selectedCaseCheckpointReady,
    selectedCaseCheckpointBlockedReason,
    actionOptions,
    lifecycleText,
    selectRelatedCase,
    copySelectedCaseLink,
    // 角色
    currentDemoRoleLabel,
    // 开关与对话框
    anyDialogOpen,
    showHelp,
    showCreate,
    showTransition,
    showFollowUp,
    showContactSimulation,
    showReopen,
    showHighRiskStop,
    showCheckpoint,
    showComplaint,
    showCommunityBridge,
    closeAllDialogs,
    openCreate,
    openTransition,
    openCheckpoint,
    openFollowUp,
    openContactSimulation,
    openHighRiskStop,
    openReopen,
    openComplaint,
    toggleIntakePaused,
    // 表单
    syntheticConfirmed,
    createForm,
    createError,
    duplicateCandidates,
    duplicateReviewRequired,
    duplicateConfirmed,
    duplicateExplanation,
    duplicateError,
    transitionForm,
    transitionErrors,
    transitionReasonOptions: transitionReasonOptionsList,
    needsReason,
    transitionNoteRequired,
    transitionSubmitDisabled,
    transitionTargetIsOpen,
    transitionActionBlockedReason,
    followUpForm,
    followUpError,
    contactSimulationForm,
    contactSimulationError,
    reopenForm,
    reopenError,
    highRiskNote,
    highRiskError,
    checkpointForm,
    checkpointError,
    complaintForm,
    complaintError,
    complaintSyntheticConfirmed,
    // 提交
    createRecord,
    cancelDuplicateReview,
    openDuplicateCandidate,
    applyTransition,
    saveCheckpoint,
    saveFollowUp,
    saveContactSimulation,
    saveHighRiskStop,
    createReopenedRecord,
    submitComplaint,
    // 投诉
    complaintFilter,
    filteredComplaints,
    selectedComplaintId,
    selectedComplaint,
    selectedComplaintCase,
    selectedComplaintReviewBlockedReason,
    canReviewSelectedComplaint,
    complaintTargetRoles,
    currentRoleReviewLabel,
    complaintReviewResolution,
    complaintReviewError,
    reviewSelectedComplaint,
    selectComplaint,
    openComplaintCase,
    // 社区桥
    communityReadResult,
    communitySyntheticConfirmed,
    communityPendingMapping,
    communityDuplicateCandidates,
    communityDuplicateConfirmed,
    communityDuplicateExplanation,
    communityBridgeError,
    communityReviewRequired,
    communityReadStatus,
    communityReadWarnings,
    communityReadMessage,
    communityPostsWithStatus,
    openCommunityBridge,
    closeCommunityBridge,
    readCommunityArchive,
    startCommunityRegistration,
    cancelCommunityReview,
    confirmCommunityRegistration,
    // 备份与重置
    backupInput,
    backupText,
    backupTextInput,
    unreadableDownloaded,
    storageStatusLabel,
    lastSavedLabel,
    exportBackup,
    viewBackupText,
    chooseBackup,
    importBackupFile,
    reloadLatestSnapshot,
    exportUnreadableBackup,
    resetDemo,
  }
}

export type AplusWorkbench = ReturnType<typeof useAplusWorkbench>
