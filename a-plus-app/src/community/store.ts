import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  ACTIVE_ORDER_STATUSES,
  AUDIT_ACTIONS,
  COMPLAINT_LOCAL_ONLY_NOTICE,
  COMPLAINT_STATUS,
  DEMO_MESSAGE_SENDERS,
  DEMO_THREAD_KINDS,
  EVENT_LOCAL_DEMO_NOTICE,
  LEDGER_ENTRY_STATUS,
  MEMBERSHIP_ROLES,
  MODERATION_STATUSES,
  NOTICE_KINDS,
  ORDER_COUNTERPART_NOTICE,
  ORDER_EVENT_ACTORS,
  ORDER_EVENT_LIMIT,
  ORDER_EVENT_TYPES,
  ORDER_FULFILLMENT_LOCAL_NOTICE,
  ORDER_LOCAL_DEMO_NOTICE,
  ORDER_STATUSES,
  POST_MODES,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  REVIEW_STATUSES,
  VOLUNTEER_POST_KINDS,
  SYNTHETIC_DATA_NOTICE,
  type AuditAction,
  type AuditLogEntry,
  type Comment,
  type CommunityActionResult,
  type CommunityState,
  type CommunityStorageStatus,
  type Complaint,
  type DemoMessage,
  type DemoThread,
  type FictionalAuthor,
  type LedgerEntry,
  type MembershipRole,
  type NewComplaintInput,
  type NoticeKind,
  type OrderEvent,
  type OrderEventActor,
  type OrderEventType,
  type Post,
  type PostMode,
  type PublishPostInput,
  type Report,
  type ReportStatus,
  type ReportTargetType,
  type ReviewStatus,
} from './types'
import { createCommunityFixtures, SYNTHETIC_DEMO_AUTHOR } from './fixtures'
import {
  COMMUNITY_STORAGE_KEY,
  COMMUNITY_STORAGE_SCHEMA_VERSION,
} from './storage'

export { COMMUNITY_STORAGE_KEY, COMMUNITY_STORAGE_SCHEMA_VERSION } from './storage'

const STORAGE_APP = 'community-mvp'
const STORAGE_KIND = 'synthetic-community-demo'

const RECOVERY_REQUIRED_MESSAGE =
  '本机有一份无法读取或版本不受支持的社区演练存档。为避免覆盖原文，已停止所有写入；请先备份原文，或明确使用“重置演示数据”。'
const MEMORY_ONLY_MESSAGE =
  '当前浏览器本机存储不可用，更改只保留在本次会话，刷新后会丢失。'
const SAVE_ERROR_MESSAGE =
  '本机存档写入失败，本次操作未应用；界面仍显示上一次成功保存的状态。'
const CONFLICT_MESSAGE =
  '检测到其他标签页更新了本机存档。为避免覆盖较新的状态，已停止写入；请先重新载入最新存档。'

const MAX_STORED_CHARS = 1_000_000
const MAX_POSTS = 200
const MAX_COMMENTS_PER_POST = 200
const MAX_THREADS = 50
const MAX_MESSAGES_PER_THREAD = 300
const MAX_COMPLAINTS = 200
const MAX_LEDGER_ENTRIES = 200
const MAX_REPORTS = 200
const MAX_AUDIT_LOG = 500
const MAX_ORDER_EVENTS = ORDER_EVENT_LIMIT
const MAX_TITLE_CHARS = 120
const MAX_LOCATION_CHARS = 120
const MAX_CONTENT_CHARS = 2_000
const MAX_COMMENT_CHARS = 1_000
const MAX_MESSAGE_CHARS = 1_000
const MAX_DETAIL_CHARS = 240
const MAX_REASON_CHARS = 240

const MEMBERSHIP_LABELS: Record<MembershipRole, string> = {
  visitor: '访客',
  member: '演练成员',
  reviewer: '审核员',
}

interface StoredCommunityEnvelope {
  app: typeof STORAGE_APP
  kind: typeof STORAGE_KIND
  schemaVersion: typeof COMMUNITY_STORAGE_SCHEMA_VERSION
  savedAt: string
  state: CommunityState
}

interface LoadedCommunity {
  state: CommunityState
  status: CommunityStorageStatus
  savedAt: string | null
  unreadableData: string | null
  error: string | null
  storedRaw: string | null
}

type ParseResult =
  | { ok: true; savedAt: string; state: CommunityState }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && !Number.isNaN(Date.parse(value))
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.some((option) => option === value)
}

function isFictionalAuthor(value: unknown): value is FictionalAuthor {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && value.synthetic === true
}

function isOptionalReviewNote(value: unknown): value is string | undefined {
  return value === undefined
    || (isNonEmptyString(value) && value.length <= MAX_REASON_CHARS)
}

function isComment(value: unknown): value is Comment {
  if (!isRecord(value)) return false
  if (
    !isNonEmptyString(value.id)
    || !isNonEmptyString(value.postId)
    || !isFictionalAuthor(value.author)
    || !isNonEmptyString(value.content)
    || (!isOneOf(value.moderation, MODERATION_STATUSES) && value.moderation !== undefined)
    || !isOptionalReviewNote(value.reviewNote)
    || !isTimestamp(value.createdAt)
    || value.synthetic !== true
  ) return false
  return true
}

function isOrderEvent(value: unknown): value is OrderEvent {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isOneOf(value.type, ORDER_EVENT_TYPES)
    && isOneOf(value.actor, ORDER_EVENT_ACTORS)
    && isNonEmptyString(value.note)
    && value.note.length <= MAX_DETAIL_CHARS
    && isTimestamp(value.createdAt)
    && value.synthetic === true
}

function isPost(value: unknown): value is Post {
  if (!isRecord(value)) return false
  if (
    !isNonEmptyString(value.id)
    || !isOneOf(value.mode, POST_MODES)
    || !isNonEmptyString(value.title)
    || !isNonEmptyString(value.content)
    || !isFictionalAuthor(value.author)
    || !isNonEmptyString(value.location)
    || !isTimestamp(value.createdAt)
    || !isNonNegativeInteger(value.likeCount)
    || typeof value.likedByMe !== 'boolean'
    || typeof value.favorited !== 'boolean'
    || (!isOneOf(value.moderation, MODERATION_STATUSES) && value.moderation !== undefined)
    || !isOptionalReviewNote(value.reviewNote)
    || !Array.isArray(value.comments)
    || value.comments.length > MAX_COMMENTS_PER_POST
    || value.synthetic !== true
  ) return false

  const mode: PostMode = value.mode
  const comments = value.comments
  if (!comments.every(isComment)) return false
  if (comments.some((comment) => comment.postId !== value.id)) return false

  for (const field of ['category', 'timeWindow', 'duration', 'specialNote'] as const) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].length > MAX_DETAIL_CHARS)) {
      return false
    }
  }
  if (value.volunteerKind !== undefined) {
    if (mode !== 'volunteer' || !isOneOf(value.volunteerKind, VOLUNTEER_POST_KINDS)) return false
  }
  if (value.anonymous !== undefined && (mode !== 'volunteer' || typeof value.anonymous !== 'boolean')) return false
  if (value.publishedToFeed !== undefined && (mode !== 'volunteer' || typeof value.publishedToFeed !== 'boolean')) return false

  if (value.orderStatus !== undefined) {
    if (mode !== 'help' || !isOneOf(value.orderStatus, ORDER_STATUSES)) return false
  } else if (mode === 'help') {
    return false
  }
  if (value.acceptedByMe !== undefined) {
    if (
      mode !== 'help'
      || typeof value.acceptedByMe !== 'boolean'
      || (value.acceptedByMe && value.orderStatus === 'open')
    ) return false
  }
  if (value.orderEvents !== undefined) {
    if (
      mode !== 'help'
      || !Array.isArray(value.orderEvents)
      || value.orderEvents.length > MAX_ORDER_EVENTS
    ) return false
    const eventIds = new Set<string>()
    for (const event of value.orderEvents) {
      if (!isOrderEvent(event) || eventIds.has(event.id)) return false
      eventIds.add(event.id)
    }
  }

  if (value.orderFeedback !== undefined) {
    const feedback = value.orderFeedback
    if (
      mode !== 'help'
      || value.orderStatus !== 'completed-local-demo'
      || !isRecord(feedback)
      || typeof feedback.rating !== 'number'
      || !Number.isInteger(feedback.rating)
      || feedback.rating < 1
      || feedback.rating > 5
      || typeof feedback.note !== 'string'
      || feedback.note.length > MAX_REASON_CHARS
      || !isTimestamp(feedback.createdAt)
      || feedback.synthetic !== true
    ) return false
  }

  if (value.eventCapacity !== undefined) {
    if (mode !== 'volunteer' || !isPositiveInteger(value.eventCapacity)) return false
  }
  if (value.eventSignupCount !== undefined) {
    if (mode !== 'volunteer' || !isNonNegativeInteger(value.eventSignupCount)) return false
    if (
      value.eventCapacity !== undefined
      && isPositiveInteger(value.eventCapacity)
      && value.eventSignupCount > value.eventCapacity
    ) return false
  }
  if (value.eventStartsAt !== undefined) {
    if (mode !== 'volunteer' || !isTimestamp(value.eventStartsAt)) return false
  }
  if (value.signedUpByMe !== undefined) {
    if (mode !== 'volunteer' || typeof value.signedUpByMe !== 'boolean') return false
  }

  return true
}

function isDemoMessage(value: unknown): value is DemoMessage {
  if (!isRecord(value)) return false
  if (
    !isNonEmptyString(value.id)
    || !isNonEmptyString(value.threadId)
    || !isOneOf(value.sender, DEMO_MESSAGE_SENDERS)
    || !isNonEmptyString(value.content)
    || !isTimestamp(value.createdAt)
    || typeof value.automaticReply !== 'boolean'
    || (value.hidden !== undefined && typeof value.hidden !== 'boolean')
    || !isOptionalReviewNote(value.reviewNote)
    || (value.noticeKind !== undefined && !isOneOf(value.noticeKind, NOTICE_KINDS))
    || value.synthetic !== true
  ) return false
  if (value.sender === 'synthetic-auto-reply' && value.automaticReply !== true) return false
  return true
}

function isDemoThread(value: unknown): value is DemoThread {
  if (!isRecord(value)) return false
  if (
    !isNonEmptyString(value.id)
    || !isOneOf(value.kind, DEMO_THREAD_KINDS)
    || !isNonEmptyString(value.title)
    || (value.postId !== undefined && (
      value.kind !== 'order'
      || !isNonEmptyString(value.postId)
      || value.postId.length > MAX_TITLE_CHARS
    ))
    || !isTimestamp(value.updatedAt)
    || !Array.isArray(value.messages)
    || value.messages.length > MAX_MESSAGES_PER_THREAD
  ) return false
  return value.messages.every((message) =>
    isDemoMessage(message) && message.threadId === value.id,
  )
}

function isComplaint(value: unknown): value is Complaint {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.subject)
    && isNonEmptyString(value.content)
    && value.status === COMPLAINT_STATUS
    && isNonEmptyString(value.statusNote)
    && isTimestamp(value.createdAt)
    && value.synthetic === true
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.title)
    && isPositiveInteger(value.minutes)
    && value.status === LEDGER_ENTRY_STATUS
    && isNonEmptyString(value.note)
    && isTimestamp(value.createdAt)
    && value.synthetic === true
}

function isReport(value: unknown): value is Report {
  if (!isRecord(value)) return false
  if (
    !isNonEmptyString(value.id)
    || !isOneOf(value.targetType, REPORT_TARGET_TYPES)
    || !isNonEmptyString(value.targetId)
    || !isNonEmptyString(value.reason)
    || value.reason.length > MAX_REASON_CHARS
    || !isOneOf(value.status, REPORT_STATUSES)
    || (value.reporter !== undefined && !isFictionalAuthor(value.reporter))
    || !isTimestamp(value.createdAt)
    || value.synthetic !== true
  ) return false
  if (value.status === 'pending') return value.resolution === undefined
  return isNonEmptyString(value.resolution) && value.resolution.length <= MAX_REASON_CHARS
}

function isAuditLogEntry(value: unknown): value is AuditLogEntry {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isOneOf(value.action, AUDIT_ACTIONS)
    && isNonEmptyString(value.targetId)
    && isNonEmptyString(value.reason)
    && value.reason.length <= MAX_REASON_CHARS
    && (value.decision === undefined || isOneOf(value.decision, ['pending', 'approved', 'rejected', 'hidden', 'resolved', 'dismissed'] as const))
    && isTimestamp(value.createdAt)
    && value.synthetic === true
}

function normalizeComment(comment: Comment): Comment {
  return comment.moderation === undefined
    ? { ...comment, moderation: 'pending' }
    : comment
}

function normalizePost(post: Post): Post {
  let orderStatus = post.orderStatus
  let orderEvents = post.orderEvents
  // Legacy archives could contain a hidden help post whose order was still
  // active. New moderation closes such orders; migrate the same way on load so
  // the service record is not stranded without an action.
  if (post.moderation === 'hidden' && orderStatus && isOneOf(orderStatus, ACTIVE_ORDER_STATUSES)) {
    orderStatus = 'cancelled-local-demo'
    if ((orderEvents?.length ?? 0) < MAX_ORDER_EVENTS) {
      orderEvents = [
        ...(orderEvents ?? []),
        {
          id: `EVT-LEGACY-CANCEL-${post.id}`,
          type: 'cancel',
          actor: 'reviewer',
          note: '旧存档下架订单自动关闭（载入迁移）',
          createdAt: new Date().toISOString(),
          synthetic: true,
        },
      ]
    }
  }
  return {
    ...post,
    moderation: post.moderation ?? 'pending',
    orderStatus,
    orderEvents,
    comments: post.comments.map(normalizeComment),
  }
}

/**
 * Legacy archives have no moderation fields and must not become public by
 * accident. Legacy chat archives are retained but never rendered or writable.
 * Archives written before unread-notice tracking adopt the latest existing
 * notice as their read cursor so old history is not shown as unread.
 */
function normalizeCommunityState(state: CommunityState): CommunityState {
  const systemNoticeTimes = state.threads
    .filter((thread) => thread.kind === 'system')
    .flatMap((thread) => thread.messages.map((message) => message.createdAt))
    .sort()
  const latestNoticeAt = systemNoticeTimes[systemNoticeTimes.length - 1]
  return {
    posts: state.posts.map(normalizePost),
    threads: state.threads,
    complaints: state.complaints,
    ledgerEntries: state.ledgerEntries,
    reports: state.reports ?? [],
    auditLog: state.auditLog ?? [],
    ...(state.notificationsReadAt !== undefined
      ? { notificationsReadAt: state.notificationsReadAt }
      : latestNoticeAt ? { notificationsReadAt: latestNoticeAt } : {}),
  }
}

function isCommunityState(value: unknown): value is CommunityState {
  if (!isRecord(value)) return false
  if (
    !Array.isArray(value.posts)
    || value.posts.length > MAX_POSTS
    || !Array.isArray(value.threads)
    || value.threads.length > MAX_THREADS
    || !Array.isArray(value.complaints)
    || value.complaints.length > MAX_COMPLAINTS
    || !Array.isArray(value.ledgerEntries)
    || value.ledgerEntries.length > MAX_LEDGER_ENTRIES
  ) return false

  const postIds = new Set<string>()
  const commentIds = new Set<string>()
  const orderEventIds = new Set<string>()
  for (const post of value.posts) {
    if (!isPost(post) || postIds.has(post.id)) return false
    postIds.add(post.id)
    for (const comment of post.comments) {
      if (commentIds.has(comment.id)) return false
      commentIds.add(comment.id)
    }
    for (const event of post.orderEvents ?? []) {
      if (orderEventIds.has(event.id)) return false
      orderEventIds.add(event.id)
    }
  }

  const threadIds = new Set<string>()
  const messageIds = new Set<string>()
  for (const thread of value.threads) {
    if (!isDemoThread(thread) || threadIds.has(thread.id)) return false
    threadIds.add(thread.id)
    for (const message of thread.messages) {
      if (messageIds.has(message.id)) return false
      messageIds.add(message.id)
    }
  }

  const complaintIds = new Set<string>()
  for (const complaint of value.complaints) {
    if (!isComplaint(complaint) || complaintIds.has(complaint.id)) return false
    complaintIds.add(complaint.id)
  }

  const ledgerIds = new Set<string>()
  for (const entry of value.ledgerEntries) {
    if (!isLedgerEntry(entry) || ledgerIds.has(entry.id)) return false
    ledgerIds.add(entry.id)
  }

  const reports = value.reports
  if (reports !== undefined) {
    if (!Array.isArray(reports) || reports.length > MAX_REPORTS) return false
    const reportIds = new Set<string>()
    for (const report of reports) {
      if (!isReport(report) || reportIds.has(report.id)) return false
      reportIds.add(report.id)
    }
  }

  const auditLog = value.auditLog
  if (auditLog !== undefined) {
    if (!Array.isArray(auditLog) || auditLog.length > MAX_AUDIT_LOG) return false
    const auditIds = new Set<string>()
    for (const entry of auditLog) {
      if (!isAuditLogEntry(entry) || auditIds.has(entry.id)) return false
      auditIds.add(entry.id)
    }
  }

  const notificationsReadAt = value.notificationsReadAt
  if (notificationsReadAt !== undefined && !isTimestamp(notificationsReadAt)) return false

  return true
}

function parseStoredCommunity(raw: string): ParseResult {
  if (raw.length > MAX_STORED_CHARS) {
    return { ok: false, error: '社区演练存档超过大小上限，已保留原文且不会自动覆盖。' }
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: '社区演练存档不是有效的 JSON，已保留原文且不会自动覆盖。' }
  }

  if (!isRecord(value)) {
    return { ok: false, error: '社区演练存档格式无效，已保留原文且不会自动覆盖。' }
  }
  if (
    value.app !== STORAGE_APP
    || value.kind !== STORAGE_KIND
    || value.schemaVersion !== COMMUNITY_STORAGE_SCHEMA_VERSION
  ) {
    return { ok: false, error: '社区演练存档版本不受支持，已保留原文且不会自动覆盖。' }
  }
  if (!isTimestamp(value.savedAt) || !isCommunityState(value.state)) {
    return { ok: false, error: '社区演练存档字段无效，已保留原文且不会自动覆盖。' }
  }

  return {
    ok: true,
    savedAt: value.savedAt,
    state: normalizeCommunityState(value.state),
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function loadInitialState(): LoadedCommunity {
  const fixtures = normalizeCommunityState(createCommunityFixtures())
  const storage = getLocalStorage()
  if (!storage) {
    return {
      state: fixtures,
      status: 'memory-only',
      savedAt: null,
      unreadableData: null,
      error: MEMORY_ONLY_MESSAGE,
      storedRaw: null,
    }
  }

  let raw: string | null
  try {
    raw = storage.getItem(COMMUNITY_STORAGE_KEY)
  } catch {
    return {
      state: fixtures,
      status: 'memory-only',
      savedAt: null,
      unreadableData: null,
      error: MEMORY_ONLY_MESSAGE,
      storedRaw: null,
    }
  }

  if (raw === null) {
    return {
      state: fixtures,
      status: 'ready',
      savedAt: null,
      unreadableData: null,
      error: null,
      storedRaw: null,
    }
  }

  const parsed = parseStoredCommunity(raw)
  if (!parsed.ok) {
    return {
      state: fixtures,
      status: 'recovery-required',
      savedAt: null,
      unreadableData: raw,
      error: parsed.error,
      storedRaw: raw,
    }
  }

  return {
    state: parsed.state,
    status: 'saved',
    savedAt: parsed.savedAt,
    unreadableData: null,
    error: null,
    storedRaw: raw,
  }
}

function failure(...errors: string[]): CommunityActionResult {
  return { ok: false, errors }
}

function nextId(prefix: string, usedIds: Iterable<string>): string {
  const used = new Set(usedIds)
  let sequence = 1
  let id = `${prefix}-${String(sequence).padStart(3, '0')}`
  while (used.has(id)) {
    sequence += 1
    id = `${prefix}-${String(sequence).padStart(3, '0')}`
  }
  return id
}

function nextSyntheticPostId(usedIds: Iterable<string>): string {
  const used = new Set(usedIds)
  let id = ''
  do {
    id = `SYNTH-POST-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  } while (used.has(id))
  return id
}

function resetFixturesWithFreshPostIds(): CommunityState {
  const fixtures = createCommunityFixtures()
  const usedIds = new Set<string>()
  const postIdMap = new Map<string, string>()
  fixtures.posts = fixtures.posts.map((post) => {
    const id = nextSyntheticPostId(usedIds)
    usedIds.add(id)
    postIdMap.set(post.id, id)
    return {
      ...post,
      id,
      comments: post.comments.map((comment) => ({ ...comment, postId: id })),
    }
  })
  fixtures.threads = fixtures.threads.map((thread) => ({
    ...thread,
    ...(thread.postId
      ? { postId: postIdMap.get(thread.postId) ?? thread.postId }
      : {}),
    messages: thread.messages.map((message) => {
      let content = message.content
      for (const [oldId, newId] of postIdMap) content = content.split(oldId).join(newId)
      return { ...message, content }
    }),
  }))
  return normalizeCommunityState(fixtures)
}

function nowIso(): string {
  return new Date().toISOString()
}

function serializeState(state: CommunityState, savedAt: string): string {
  const envelope: StoredCommunityEnvelope = {
    app: STORAGE_APP,
    kind: STORAGE_KIND,
    schemaVersion: COMMUNITY_STORAGE_SCHEMA_VERSION,
    savedAt,
    state,
  }
  return JSON.stringify(envelope)
}

export const useCommunityStore = defineStore('community', () => {
  const initialState = loadInitialState()
  const posts = ref<Post[]>(initialState.state.posts)
  const threads = ref<DemoThread[]>(initialState.state.threads)
  const complaints = ref<Complaint[]>(initialState.state.complaints)
  const ledgerEntries = ref<LedgerEntry[]>(initialState.state.ledgerEntries)
  const reports = ref<Report[]>(initialState.state.reports ?? [])
  const auditLog = ref<AuditLogEntry[]>(initialState.state.auditLog ?? [])
  const notificationsReadAt = ref<string | undefined>(initialState.state.notificationsReadAt)
  /** Synthetic demo identity only; never persisted and never a real auth state. */
  const membership = ref<MembershipRole>('visitor')

  const storageStatus = ref<CommunityStorageStatus>(initialState.status)
  const storageError = ref<string | null>(initialState.error)
  const lastSavedAt = ref<string | null>(initialState.savedAt)
  const unreadableStoredData = ref<string | null>(initialState.unreadableData)
  let lastKnownRaw = initialState.storedRaw

  const comments = computed<Comment[]>(() =>
    posts.value.flatMap((post) => post.comments),
  )
  const messages = computed<DemoMessage[]>(() =>
    threads.value.flatMap((thread) => thread.messages),
  )
  const visiblePosts = computed<Post[]>(() =>
    posts.value.filter((post) =>
      post.moderation === 'approved' && post.publishedToFeed !== false,
    ),
  )
  const ledger = computed(() => ledgerEntries.value)
  const systemNotices = computed<DemoMessage[]>(() => threads.value
    .filter((thread) => thread.kind === 'system')
    .flatMap((thread) => thread.messages)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
  /** Unread local notices; string comparison is safe for ISO timestamps. */
  const unreadNoticeCount = computed(() => {
    const readAt = notificationsReadAt.value
    if (!readAt) return systemNotices.value.length
    return systemNotices.value.filter((message) => message.createdAt > readAt).length
  })
  const state = computed<CommunityState>(() => ({
    posts: posts.value,
    threads: threads.value,
    complaints: complaints.value,
    ledgerEntries: ledgerEntries.value,
    reports: reports.value,
    auditLog: auditLog.value,
    ...(notificationsReadAt.value !== undefined
      ? { notificationsReadAt: notificationsReadAt.value }
      : {}),
  }))

  function applyState(next: CommunityState) {
    posts.value = next.posts
    threads.value = next.threads
    complaints.value = next.complaints
    ledgerEntries.value = next.ledgerEntries
    reports.value = next.reports ?? []
    auditLog.value = next.auditLog ?? []
    notificationsReadAt.value = next.notificationsReadAt
  }

  function persistState(
    next: CommunityState,
    options: { allowRecovery?: boolean } = {},
  ): CommunityActionResult {
    // Callers build partial state snapshots for one mutation; keep the current
    // read cursor instead of silently clearing unread tracking on every write.
    const hydrated: CommunityState = next.notificationsReadAt === undefined && notificationsReadAt.value !== undefined
      ? { ...next, notificationsReadAt: notificationsReadAt.value }
      : next
    if (
      !options.allowRecovery
      && (
        storageStatus.value === 'recovery-required'
        || unreadableStoredData.value !== null
      )
    ) {
      return failure(RECOVERY_REQUIRED_MESSAGE)
    }

    const storage = getLocalStorage()
    if (!storage) {
      if (options.allowRecovery && unreadableStoredData.value !== null) {
        storageStatus.value = 'recovery-required'
        storageError.value = '本机存储不可用，无法安全重置损坏存档；原文仍保留在浏览器中。'
        return failure(storageError.value)
      }
      applyState(hydrated)
      storageStatus.value = 'memory-only'
      storageError.value = MEMORY_ONLY_MESSAGE
      return { ok: true, errors: [], message: MEMORY_ONLY_MESSAGE }
    }

    const savedAt = nowIso()
    let currentRaw: string | null
    try {
      currentRaw = storage.getItem(COMMUNITY_STORAGE_KEY)
    } catch {
      storageStatus.value = 'save-error'
      storageError.value = SAVE_ERROR_MESSAGE
      return failure(SAVE_ERROR_MESSAGE)
    }
    if (currentRaw !== lastKnownRaw) {
      storageStatus.value = 'conflict'
      storageError.value = CONFLICT_MESSAGE
      return failure(CONFLICT_MESSAGE)
    }

    const overLimitPost = hydrated.posts.find((post) => (post.orderEvents?.length ?? 0) > MAX_ORDER_EVENTS)
    if (overLimitPost) {
      return failure(
        `订单《${overLimitPost.title}》的演练事件已达 ${MAX_ORDER_EVENTS} 条上限，本次操作未保存；请重置演练数据后再试。`,
      )
    }

    const serialized = serializeState(hydrated, savedAt)
    if (serialized.length > MAX_STORED_CHARS) {
      return failure(
        `本次操作会生成超过 ${MAX_STORED_CHARS} 字符的本机存档，已拒绝写入且旧存档保持不变；请清理部分演练数据后再试。`,
      )
    }
    try {
      storage.setItem(COMMUNITY_STORAGE_KEY, serialized)
    } catch {
      storageStatus.value = 'save-error'
      storageError.value = SAVE_ERROR_MESSAGE
      return failure(SAVE_ERROR_MESSAGE)
    }

    applyState(hydrated)
    storageStatus.value = 'saved'
    storageError.value = null
    lastSavedAt.value = savedAt
    unreadableStoredData.value = null
    lastKnownRaw = serialized
    return { ok: true, errors: [] }
  }

  function reloadFromStorage(): CommunityActionResult {
    const storage = getLocalStorage()
    if (!storage) {
      storageStatus.value = 'memory-only'
      storageError.value = MEMORY_ONLY_MESSAGE
      return failure(MEMORY_ONLY_MESSAGE)
    }

    let raw: string | null
    try {
      raw = storage.getItem(COMMUNITY_STORAGE_KEY)
    } catch {
      storageStatus.value = 'save-error'
      storageError.value = SAVE_ERROR_MESSAGE
      return failure(SAVE_ERROR_MESSAGE)
    }

    // This read is the new baseline; a corrupt result still blocks writes via recovery state.
    lastKnownRaw = raw
    if (raw === null) {
      applyState(normalizeCommunityState(createCommunityFixtures()))
      storageStatus.value = 'ready'
      storageError.value = null
      lastSavedAt.value = null
      unreadableStoredData.value = null
      return { ok: true, errors: [], message: '未找到本机存档，已显示初始虚构演练数据。' }
    }

    const parsed = parseStoredCommunity(raw)
    if (!parsed.ok) {
      storageStatus.value = 'recovery-required'
      storageError.value = parsed.error
      lastSavedAt.value = null
      unreadableStoredData.value = raw
      return failure(parsed.error)
    }

    applyState(parsed.state)
    storageStatus.value = 'saved'
    storageError.value = null
    lastSavedAt.value = parsed.savedAt
    unreadableStoredData.value = null
    return { ok: true, errors: [], message: '已重新载入最新本机存档。' }
  }

  /** Mark every current local system notice as read. */
  function markNotificationsRead(): CommunityActionResult {
    if (unreadNoticeCount.value === 0) {
      return { ok: true, errors: [], already: true, message: '本机系统通知都已标记为已读。' }
    }
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const result = persistState({ ...state.value, notificationsReadAt: nowIso() })
    return result.ok
      ? { ...result, message: '已把本机系统通知标为已读（仅当前浏览器）。' }
      : result
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== COMMUNITY_STORAGE_KEY && event.key !== null) return
      if (event.newValue === lastKnownRaw) return
      storageStatus.value = 'conflict'
      storageError.value = CONFLICT_MESSAGE
    })
  }

  function blockedByRecovery(): CommunityActionResult | null {
    return storageStatus.value === 'recovery-required' || unreadableStoredData.value !== null
      ? failure(RECOVERY_REQUIRED_MESSAGE)
      : null
  }

  function withPost(nextPost: Post): CommunityState {
    return {
      posts: posts.value.map((post) => post.id === nextPost.id ? nextPost : post),
      threads: threads.value,
      complaints: complaints.value,
      ledgerEntries: ledgerEntries.value,
      reports: reports.value,
      auditLog: auditLog.value,
    }
  }

  function withThread(nextThread: DemoThread): CommunityState {
    return {
      posts: posts.value,
      threads: threads.value.map((thread) =>
        thread.id === nextThread.id ? nextThread : thread,
      ),
      complaints: complaints.value,
      ledgerEntries: ledgerEntries.value,
      reports: reports.value,
      auditLog: auditLog.value,
    }
  }

  /**
   * Append one synthetic system notice to the demo inbox. Notification
   * generation is local-only and never leaves the browser.
   */
  function appendSystemNotice(next: CommunityState, content: string, kind: NoticeKind = 'system'): CommunityState {
    const text = typeof content === 'string' ? content.trim() : ''
    if (!text) return next

    const thread = next.threads.find((item) => item.kind === 'system')
    const allMessageIds = next.threads.flatMap((item) => item.messages.map((message) => message.id))
    // When a legacy archive has no system thread, create a fresh id instead of a
    // fixed one so an existing thread can never collide with it.
    const threadId = thread?.id ?? nextId('SYNTH-THREAD', next.threads.map((item) => item.id))
    const createdAt = nowIso()
    const notice: DemoMessage = {
      id: nextId('SYNTH-MESSAGE', allMessageIds),
      threadId,
      sender: 'system',
      content: text.length > MAX_CONTENT_CHARS ? `${text.slice(0, MAX_CONTENT_CHARS - 1)}…` : text,
      createdAt,
      automaticReply: false,
      noticeKind: kind,
      synthetic: true,
    }

    if (!thread) {
      if (next.threads.length >= MAX_THREADS) return next
      return {
        ...next,
        threads: [...next.threads, {
          id: notice.threadId,
          kind: 'system',
          title: '系统通知（演练）',
          updatedAt: createdAt,
          messages: [notice],
        }],
      }
    }
    if (thread.messages.length >= MAX_MESSAGES_PER_THREAD) return next
    return {
      ...next,
      threads: next.threads.map((item) => item.id === thread.id
        ? { ...item, updatedAt: createdAt, messages: [...item.messages, notice] }
        : item),
    }
  }

  function demoOrderRole(post: Post): 'author' | 'acceptor' | null {
    if (post.mode !== 'help') return null
    if (post.author.id === SYNTHETIC_DEMO_AUTHOR.id) return 'author'
    if (post.acceptedByMe === true) return 'acceptor'
    return null
  }

  function orderEventNote(prefix: string, note: unknown): string {
    const trimmed = typeof note === 'string' ? note.trim() : ''
    const base = trimmed ? `${prefix}：${trimmed}` : prefix
    return base.length > MAX_DETAIL_CHARS ? `${base.slice(0, MAX_DETAIL_CHARS - 1)}…` : base
  }

  function makeOrderEvent(
    type: OrderEventType,
    actor: OrderEventActor,
    note: string,
  ): OrderEvent {
    return {
      id: nextId(
        'SYNTH-ORDER-EVENT',
        posts.value.flatMap((post) => (post.orderEvents ?? []).map((event) => event.id)),
      ),
      type,
      actor,
      note,
      createdAt: nowIso(),
      synthetic: true,
    }
  }

  function estimateMinutesFromDuration(duration: string | undefined): number {
    if (typeof duration !== 'string' || !duration.trim()) return 30
    const hours = /(\d+(?:\.\d+)?)\s*(小时|時|h|hr|hours?)/i.exec(duration)
    if (hours) return Math.max(1, Math.round(Number(hours[1]) * 60))
    const minutes = /(\d+)\s*(分钟|分|min|minutes?)/i.exec(duration)
    if (minutes) return Math.max(1, Number(minutes[1]))
    return 30
  }

  /**
   * Completion produces one explicitly unsettled demo ledger entry. It is not a
   * settlement, a balance or a redeemable amount.
   */
  function withCompletionLedger(next: CommunityState, post: Post): CommunityState {
    if (next.ledgerEntries.length >= MAX_LEDGER_ENTRIES) return next
    const entry: LedgerEntry = {
      id: nextId('SYNTH-LEDGER', next.ledgerEntries.map((item) => item.id)),
      title: `演练完成：${post.title}`,
      minutes: estimateMinutesFromDuration(post.duration),
      status: LEDGER_ENTRY_STATUS,
      note: '由本机演练订单完成事件生成；未经真实双方确认，不可结算、兑换或提现。',
      createdAt: nowIso(),
      synthetic: true,
    }
    return { ...next, ledgerEntries: [entry, ...next.ledgerEntries] }
  }

  function setMembership(value: MembershipRole): CommunityActionResult {
    if (!isOneOf(value, MEMBERSHIP_ROLES)) return failure('演练身份无效。')
    membership.value = value
    return {
      ok: true,
      errors: [],
      message: `已切换为${MEMBERSHIP_LABELS[value]}（仅用于本机合成演示）。`,
    }
  }

  function requireMember(): CommunityActionResult | null {
    if (membership.value === 'member') return null
    return failure(
      membership.value === 'reviewer'
        ? '审核身份不能代替演练成员完成发布或互动，请先切换为演练成员。'
        : '请先切换为演练成员，再使用发布或互动功能。',
    )
  }

  function requireReviewer(): CommunityActionResult | null {
    return membership.value === 'reviewer'
      ? null
      : failure('只有审核员可以执行审核或处理举报。')
  }

  function nextAuditEntry(
    action: AuditAction,
    targetId: string,
    reason: string,
    decision?: AuditLogEntry['decision'],
  ): AuditLogEntry {
    return {
      id: nextId('SYNTH-AUDIT', auditLog.value.map((entry) => entry.id)),
      action,
      targetId,
      reason,
      ...(decision ? { decision } : {}),
      createdAt: nowIso(),
      synthetic: true,
    }
  }

  function normalizeReason(reason: unknown): string {
    return typeof reason === 'string' ? reason.trim() : ''
  }

  function isVisiblePost(post: Post): boolean {
    return post.moderation === 'approved' && post.publishedToFeed !== false
  }

  function participatesInOrder(post: Post): boolean {
    return post.author.id === SYNTHETIC_DEMO_AUTHOR.id || post.acceptedByMe === true
  }

  function auditLimitBlocked(): CommunityActionResult | null {
    return auditLog.value.length >= MAX_AUDIT_LOG
      ? failure(`本机审核日志已达 ${MAX_AUDIT_LOG} 条上限，请先重置演练数据。`)
      : null
  }

  function toggleLike(postId: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')
    if (!isVisiblePost(post)) return failure('只能互动审核通过且公开的帖子。')

    const likedByMe = !post.likedByMe
    const nextPost: Post = {
      ...post,
      likedByMe,
      likeCount: Math.max(0, post.likeCount + (likedByMe ? 1 : -1)),
    }
    return persistState(withPost(nextPost))
  }

  function toggleFavorite(postId: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')
    if (!isVisiblePost(post)) return failure('只能互动审核通过且公开的帖子。')
    return persistState(withPost({ ...post, favorited: !post.favorited }))
  }

  function addComment(postId: string, content: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')
    if (!isVisiblePost(post)) return failure('只能评论审核通过且公开的帖子。')

    const text = typeof content === 'string' ? content.trim() : ''
    if (!text) return failure('请填写评论内容。')
    if (text.length > MAX_COMMENT_CHARS) {
      return failure(`评论不能超过 ${MAX_COMMENT_CHARS} 个字符。`)
    }
    if (post.comments.length >= MAX_COMMENTS_PER_POST) {
      return failure('这条演练动态的评论数量已达上限。')
    }

    const comment: Comment = {
      id: nextId('SYNTH-COMMENT', comments.value.map((item) => item.id)),
      postId,
      author: { ...SYNTHETIC_DEMO_AUTHOR },
      content: text,
      moderation: 'pending',
      createdAt: nowIso(),
      synthetic: true,
    }
    const nextPost: Post = {
      ...post,
      comments: [...post.comments, comment],
    }
    const result = persistState(withPost(nextPost))
    return result.ok ? { ...result, id: comment.id } : result
  }

  function publishPost(input: PublishPostInput): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate
    if (!input || typeof input !== 'object') return failure('发布内容无效。')

    if (!isOneOf(input.mode, POST_MODES)) return failure('请选择有效的发布模式。')
    const mode: PostMode = input.mode
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    const content = typeof input.content === 'string' ? input.content.trim() : ''
    const location = typeof input.location === 'string' && input.location.trim()
      ? input.location.trim()
      : '演练社区（虚构）'
    const category = typeof input.category === 'string' ? input.category.trim() : ''
    const timeWindow = typeof input.timeWindow === 'string' ? input.timeWindow.trim() : ''
    const duration = typeof input.duration === 'string' ? input.duration.trim() : ''
    const specialNote = typeof input.specialNote === 'string' ? input.specialNote.trim() : ''

    if (!title) return failure('请填写标题。')
    if (title.length > MAX_TITLE_CHARS) {
      return failure(`标题不能超过 ${MAX_TITLE_CHARS} 个字符。`)
    }
    if (!content) return failure('请填写正文。')
    if (content.length > MAX_CONTENT_CHARS) {
      return failure(`正文不能超过 ${MAX_CONTENT_CHARS} 个字符。`)
    }
    if (location.length > MAX_LOCATION_CHARS) {
      return failure(`地点不能超过 ${MAX_LOCATION_CHARS} 个字符。`)
    }
    if ([category, timeWindow, duration, specialNote].some((field) => field.length > MAX_DETAIL_CHARS)) {
      return failure(`分类、时段、时长和补充说明均不能超过 ${MAX_DETAIL_CHARS} 个字符。`)
    }
    if (posts.value.length >= MAX_POSTS) return failure('演练动态数量已达上限。')

    if (mode === 'help' && (!category || !timeWindow || !duration)) {
      return failure('求助登记请补充服务分类、希望时段和预计时长；分类可先选“待分类”。')
    }
    if (mode !== 'help' && (input.category !== undefined || input.timeWindow !== undefined || input.duration !== undefined || input.specialNote !== undefined)) {
      return failure('服务分类、希望时段、预计时长和补充说明仅用于通用求助登记。')
    }

    const volunteerKind = mode === 'volunteer' ? input.volunteerKind ?? 'update' : undefined
    if (mode === 'volunteer' && !isOneOf(volunteerKind, VOLUNTEER_POST_KINDS)) {
      return failure('请选择志愿记录或活动招募。')
    }
    if (mode !== 'volunteer' && (
      input.volunteerKind !== undefined
      || input.eventCapacity !== undefined
      || input.eventStartsAt !== undefined
      || input.anonymous !== undefined
      || input.publishedToFeed !== undefined
    )) return failure('志愿记录选项仅适用于志愿发布。')
    if (input.anonymous !== undefined && typeof input.anonymous !== 'boolean') {
      return failure('匿名开关无效。')
    }
    if (input.publishedToFeed !== undefined && typeof input.publishedToFeed !== 'boolean') {
      return failure('公开到社区动态的开关无效。')
    }
    if (input.eventCapacity !== undefined) {
      if (mode !== 'volunteer' || volunteerKind !== 'activity') return failure('只有志愿活动可以设置名额。')
      if (!isPositiveInteger(input.eventCapacity)) {
        return failure('活动名额必须是大于 0 的整数。')
      }
    }
    if (input.eventStartsAt !== undefined) {
      if (mode !== 'volunteer' || volunteerKind !== 'activity') return failure('只有志愿活动可以设置开始时间。')
      if (!isTimestamp(input.eventStartsAt)) return failure('活动开始时间无效。')
    }
    if (mode === 'volunteer' && volunteerKind === 'activity' && input.eventStartsAt === undefined) {
      return failure('活动招募请填写开始时间。')
    }
    if (mode === 'volunteer' && volunteerKind === 'update' && (input.eventCapacity !== undefined || input.eventStartsAt !== undefined)) {
      return failure('志愿记录不能填写活动名额或活动开始时间。')
    }

    const id = nextSyntheticPostId(posts.value.map((post) => post.id))
    const post: Post = {
      id,
      mode,
      title,
      content,
      ...(mode === 'help' ? { category, timeWindow, duration, ...(specialNote ? { specialNote } : {}) } : {}),
      author: { ...SYNTHETIC_DEMO_AUTHOR },
      location,
      createdAt: nowIso(),
      likeCount: 0,
      likedByMe: false,
      favorited: false,
      moderation: 'pending',
      comments: [],
      ...(mode === 'help' ? { orderStatus: 'open' as const } : {}),
      ...(mode === 'volunteer'
        ? {
            volunteerKind,
            anonymous: input.anonymous ?? false,
            publishedToFeed: input.publishedToFeed ?? true,
            eventSignupCount: 0,
            signedUpByMe: false,
            ...(input.eventCapacity !== undefined
              ? { eventCapacity: input.eventCapacity }
              : {}),
            ...(input.eventStartsAt !== undefined
              ? { eventStartsAt: input.eventStartsAt }
              : {}),
          }
        : {}),
      synthetic: true,
    }

    const result = persistState({
      posts: [post, ...posts.value],
      threads: threads.value,
      complaints: complaints.value,
      ledgerEntries: ledgerEntries.value,
      reports: reports.value,
      auditLog: auditLog.value,
    })
    return result.ok ? { ...result, id } : result
  }

  function acceptOrder(postId: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')
    if (!isVisiblePost(post)) return failure('只能对审核通过且公开的求助演练单接单。')
    if (post.mode !== 'help') return failure('只有求助演练单可以标记接单。')
    if (post.author.id === SYNTHETIC_DEMO_AUTHOR.id) {
      return failure('不能接自己发布的求助演练单；如需演示求助方视角，请使用“代合成邻居接单（演练）”。')
    }
    if (post.acceptedByMe === true || post.orderStatus === 'accepted-local-demo') {
      return {
        ok: true,
        errors: [],
        id: post.id,
        already: true,
        message: ORDER_LOCAL_DEMO_NOTICE,
      }
    }
    if (post.orderStatus !== 'open') {
      return failure('这条求助演练单当前不可标记接单。')
    }

    const nextPost: Post = {
      ...post,
      orderStatus: 'accepted-local-demo',
      acceptedByMe: true,
      orderEvents: [
        ...(post.orderEvents ?? []),
        makeOrderEvent('accept', 'demo-side', orderEventNote('本机参与者演练接单', null)),
      ],
    }
    const result = persistState(withPost(nextPost))
    return result.ok
      ? { ...result, id: post.id, message: ORDER_LOCAL_DEMO_NOTICE }
      : result
  }

  /**
   * Demo-only counterpart acceptance: lets a published help post show the
   * requester-side flow without a second real person. The event is explicitly
   * labelled as a synthetic counterpart action.
   */
  function counterpartAcceptOrder(postId: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练求助。')
    if (!isVisiblePost(post)) return failure('只能对审核通过且公开的本人求助模拟对方接单。')
    if (post.mode !== 'help') return failure('只有求助演练单可以模拟接单。')
    if (demoOrderRole(post) !== 'author') {
      return failure('只有本人发布的求助可以代合成邻居接单；他人求助请使用“演练接单”。')
    }
    if (post.orderStatus !== 'open') return failure('这条求助演练单当前不是待接单状态。')

    const nextPost: Post = {
      ...post,
      orderStatus: 'accepted-local-demo',
      orderEvents: [
        ...(post.orderEvents ?? []),
        makeOrderEvent('accept', 'synthetic-counterpart', orderEventNote('合成邻居演练接单', null)),
      ],
    }
    const next = appendSystemNotice(
      withPost(nextPost),
      `你的求助《${post.title}》在本地演练中已被合成邻居标记接单；不会联系或通知真实志愿者。`,
      'order',
    )
    const result = persistState(next)
    return result.ok ? { ...result, id: post.id, message: ORDER_COUNTERPART_NOTICE } : result
  }

  function requestOrderCompletion(postId: string, note = ''): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练订单。')
    if (!isVisiblePost(post)) return failure('只能对本机演练中审核通过且公开的订单操作。')
    if (post.mode !== 'help') return failure('只有求助演练单有完成流程。')
    if (demoOrderRole(post) !== 'acceptor') {
      return failure('只有本机接单的成员可以发起完成申请。')
    }
    if (post.orderStatus !== 'accepted-local-demo') {
      return failure('只有已接单的演练订单可以发起完成申请。')
    }

    const nextPost: Post = {
      ...post,
      orderStatus: 'completion-requested',
      orderEvents: [
        ...(post.orderEvents ?? []),
        makeOrderEvent('request-completion', 'demo-side', orderEventNote('本机接单成员发起完成申请', note)),
      ],
    }
    const result = persistState(withPost(nextPost))
    return result.ok
      ? { ...result, id: post.id, message: ORDER_FULFILLMENT_LOCAL_NOTICE }
      : result
  }

  function counterpartRequestOrderCompletion(postId: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练订单。')
    if (!isVisiblePost(post)) return failure('只能对本机演练中审核通过且公开的订单操作。')
    if (post.mode !== 'help') return failure('只有求助演练单有完成流程。')
    if (demoOrderRole(post) !== 'author') {
      return failure('只有本人发布的求助可以代合成接单方发起完成申请。')
    }
    if (post.orderStatus !== 'accepted-local-demo') {
      return failure('只有已接单的演练订单可以发起完成申请。')
    }

    const nextPost: Post = {
      ...post,
      orderStatus: 'completion-requested',
      orderEvents: [
        ...(post.orderEvents ?? []),
        makeOrderEvent(
          'request-completion',
          'synthetic-counterpart',
          orderEventNote('合成接单方发起完成申请', null),
        ),
      ],
    }
    const next = appendSystemNotice(
      withPost(nextPost),
      `你的求助《${post.title}》的合成接单方已发起完成申请；请在社区动态中打开该求助卡片确认完成（本机演练）。`,
      'order',
    )
    const result = persistState(next)
    return result.ok ? { ...result, id: post.id, message: ORDER_COUNTERPART_NOTICE } : result
  }

  function confirmOrderCompletion(postId: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练订单。')
    if (!isVisiblePost(post)) return failure('只能对本机演练中审核通过且公开的订单操作。')
    if (post.mode !== 'help') return failure('只有求助演练单有完成流程。')
    if (demoOrderRole(post) !== 'author') {
      return failure('只有求助发布者可以确认完成。')
    }
    if (post.orderStatus !== 'completion-requested') {
      return failure('当前没有等待确认的完成申请。')
    }
    // Legacy archives may have no events or a partial acceptance timeline. The
    // status itself is the source of truth for an author-side confirmation.
    const nextPost: Post = {
      ...post,
      orderStatus: 'completed-local-demo',
      orderEvents: [
        ...(post.orderEvents ?? []),
        makeOrderEvent('confirm-completion', 'demo-side', orderEventNote('本机发布者确认完成', null)),
      ],
    }
    const withLedger = withCompletionLedger(withPost(nextPost), post)
    const ledgerAdded = withLedger.ledgerEntries.length > ledgerEntries.value.length
    const result = persistState(withLedger)
    if (!result.ok) return result
    return {
      ...result,
      id: post.id,
      message: ledgerAdded
        ? '已在本机演练中记录完成，并生成一条“未结算”的演示时长记录；不可结算、兑换或提现。'
        : '已在本机演练中记录完成；演示时长账本已达上限，本次未新增时长记录。',
    }
  }

  function counterpartConfirmOrderCompletion(postId: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练订单。')
    if (!isVisiblePost(post)) return failure('只能对本机演练中审核通过且公开的订单操作。')
    if (post.mode !== 'help') return failure('只有求助演练单有完成流程。')
    if (demoOrderRole(post) !== 'acceptor') {
      return failure('只有本机接单成员可以代合成求助方确认完成。')
    }
    if (post.orderStatus !== 'completion-requested') {
      return failure('当前没有等待确认的完成申请。')
    }
    // Same legacy tolerance as author-side confirmation.
    const nextPost: Post = {
      ...post,
      orderStatus: 'completed-local-demo',
      orderEvents: [
        ...(post.orderEvents ?? []),
        makeOrderEvent(
          'confirm-completion',
          'synthetic-counterpart',
          orderEventNote('合成求助方确认完成', null),
        ),
      ],
    }
    const withLedger = withCompletionLedger(withPost(nextPost), post)
    const ledgerAdded = withLedger.ledgerEntries.length > ledgerEntries.value.length
    const next = appendSystemNotice(
      withLedger,
      `你申请完成的订单《${post.title}》已被合成求助方确认（本机演练）；形成未结算演示时长记录。`,
      'order',
    )
    const result = persistState(next)
    if (!result.ok) return result
    return {
      ...result,
      id: post.id,
      message: ledgerAdded
        ? '已在本机演练中记录完成，并生成一条“未结算”的演示时长记录；不可结算、兑换或提现。'
        : '已在本机演练中记录完成；演示时长账本已达上限，本次未新增时长记录。',
    }
  }

  function submitOrderFeedback(postId: string, rating: number, note: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练订单。')
    if (!isVisiblePost(post)) return failure('只能对审核通过且公开的演练订单记录体验。')
    if (post.mode !== 'help') return failure('只有求助演练单有完成体验记录。')
    if (post.orderStatus !== 'completed-local-demo') {
      return failure('只有已完成的演练订单可以记录体验。')
    }
    if (demoOrderRole(post) === null) {
      return failure('只有本机演练的求助发布者或接单成员可以记录体验。')
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return failure('请选择 1–5 星的演练体验。')
    }
    const noteText = typeof note === 'string' ? note.trim() : ''
    if (noteText.length > MAX_REASON_CHARS) {
      return failure(`体验说明不能超过 ${MAX_REASON_CHARS} 个字符。`)
    }
    if (post.orderFeedback) return failure('这单已经有一条本机体验记录，不能重复提交。')

    const result = persistState(withPost({
      ...post,
      orderFeedback: {
        rating,
        note: noteText,
        createdAt: nowIso(),
        synthetic: true,
      },
    }))
    return result.ok
      ? { ...result, id: post.id, message: '已保存本机演练体验记录；不会发送评价、影响真实信誉或结算。' }
      : result
  }

  function cancelOrder(postId: string, reason = ''): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练订单。')
    if (!isVisiblePost(post)) return failure('只能对本机演练中审核通过且公开的订单操作。')
    if (post.mode !== 'help') return failure('只有求助演练单有取消/关闭流程。')
    if (!demoOrderRole(post)) return failure('只有本人发布或本机接单的演练订单可以取消/关闭。')
    if (!isOneOf(post.orderStatus, ['open', 'accepted-local-demo', 'completion-requested', 'disputed-local-demo'] as const)) {
      return failure('这条演练订单当前不能取消或关闭。')
    }

    const reasonText = normalizeReason(reason)
    if (!reasonText) return failure('请填写取消/关闭原因（仅演练用途）。')
    if (reasonText.length > MAX_REASON_CHARS) {
      return failure(`取消/关闭原因不能超过 ${MAX_REASON_CHARS} 个字符。`)
    }

    const nextPost: Post = {
      ...post,
      orderStatus: 'cancelled-local-demo',
      orderEvents: [
        ...(post.orderEvents ?? []),
        makeOrderEvent('cancel', 'demo-side', orderEventNote('取消/关闭订单', reasonText)),
      ],
    }
    const result = persistState(withPost(nextPost))
    return result.ok
      ? { ...result, id: post.id, message: '已在本机演练中关闭该订单；不会产生真实取消、退款、评价或通知。' }
      : result
  }

  function raiseOrderDispute(postId: string, reason = ''): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练订单。')
    if (!isVisiblePost(post)) return failure('只能对本机演练中审核通过且公开的订单操作。')
    if (post.mode !== 'help') return failure('只有求助演练单有争议流程。')
    if (!demoOrderRole(post)) return failure('只有本人参与的本机演练订单可以发起争议。')
    if (!isOneOf(post.orderStatus, ['accepted-local-demo', 'completion-requested'] as const)) {
      return failure('只有进行中的演练订单可以发起争议。')
    }

    const reasonText = normalizeReason(reason)
    if (!reasonText) return failure('请填写争议原因（仅演练用途）。')
    if (reasonText.length > MAX_REASON_CHARS) {
      return failure(`争议原因不能超过 ${MAX_REASON_CHARS} 个字符。`)
    }

    const nextPost: Post = {
      ...post,
      orderStatus: 'disputed-local-demo',
      orderEvents: [
        ...(post.orderEvents ?? []),
        makeOrderEvent('dispute', 'demo-side', orderEventNote('发起争议', reasonText)),
      ],
    }
    const result = persistState(withPost(nextPost))
    return result.ok
      ? { ...result, id: post.id, message: '已在本机演练中标记争议；没有真实仲裁、投诉渠道或通知。' }
      : result
  }

  function resolveOrderDispute(
    postId: string,
    resolution: 'resume' | 'close',
    reason = '',
  ): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate
    if (resolution !== 'resume' && resolution !== 'close') {
      return failure('争议处理结果无效。')
    }

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练订单。')
    if (!isVisiblePost(post)) return failure('只能对本机演练中审核通过且公开的订单操作。')
    if (post.mode !== 'help') return failure('只有求助演练单有争议流程。')
    if (!demoOrderRole(post)) return failure('只有本人参与的本机演练订单可以记录争议处理。')
    if (post.orderStatus !== 'disputed-local-demo') {
      return failure('这条演练订单当前不在争议状态。')
    }

    const reasonText = normalizeReason(reason)
    if (!reasonText) return failure('请填写争议处理说明（仅演练用途）。')
    if (reasonText.length > MAX_REASON_CHARS) {
      return failure(`争议处理说明不能超过 ${MAX_REASON_CHARS} 个字符。`)
    }

    const nextPost: Post = {
      ...post,
      orderStatus: resolution === 'resume' ? 'accepted-local-demo' : 'cancelled-local-demo',
      orderEvents: [
        ...(post.orderEvents ?? []),
        makeOrderEvent(
          resolution === 'resume' ? 'resume-after-dispute' : 'close-after-dispute',
          'demo-side',
          orderEventNote(resolution === 'resume' ? '撤销争议并继续履约' : '因争议关闭订单', reasonText),
        ),
      ],
    }
    const result = persistState(withPost(nextPost))
    return result.ok
      ? {
          ...result,
          id: post.id,
          message: resolution === 'resume'
            ? '已在本机演练中撤销争议并恢复为履约中；没有真实仲裁或通知。'
            : '已在本机演练中因争议关闭订单；没有真实仲裁、退款或通知。',
        }
      : result
  }

  function signUpForEvent(postId: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')
    if (!isVisiblePost(post)) return failure('只能报名审核通过且公开的志愿活动。')
    if (post.mode !== 'volunteer') return failure('只有志愿动态可以报名。')
    if (post.volunteerKind !== 'activity') {
      return failure('只有“活动招募”可以报名；志愿记录是分享动态，不提供报名。旧存档缺少活动类型标识的记录请重新发布活动。')
    }
    if (post.signedUpByMe) {
      return {
        ok: true,
        errors: [],
        id: post.id,
        already: true,
        message: EVENT_LOCAL_DEMO_NOTICE,
      }
    }

    const signupCount = post.eventSignupCount ?? 0
    if (post.eventCapacity !== undefined && signupCount >= post.eventCapacity) {
      return failure('这场演练活动的名额已满。')
    }

    const result = persistState(withPost({
      ...post,
      eventSignupCount: signupCount + 1,
      signedUpByMe: true,
    }))
    return result.ok
      ? { ...result, id: post.id, message: EVENT_LOCAL_DEMO_NOTICE }
      : result
  }

  function cancelEventSignup(postId: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')
    if (!isVisiblePost(post)) return failure('只能操作审核通过且公开的志愿活动。')
    if (post.mode !== 'volunteer') return failure('只有志愿动态有报名记录。')
    if (post.volunteerKind !== 'activity') return failure('只有“活动招募”才有报名记录。')
    if (post.signedUpByMe !== true) {
      return failure('当前没有可取消的本机演练报名。')
    }

    const result = persistState(withPost({
      ...post,
      eventSignupCount: Math.max(0, (post.eventSignupCount ?? 1) - 1),
      signedUpByMe: false,
    }))
    return result.ok
      ? { ...result, id: post.id, message: '已取消本机演练报名；不会产生真实取消或通知。' }
      : result
  }

  /**
   * Free chat stays permanently closed in scheme B. Order messages are the
   * only member-to-participant channel and they never generate a reply.
   */
  function sendDemoChatMessage(
    _threadIdOrContent?: string,
    _maybeContent?: string,
  ): CommunityActionResult {
    return failure(
      '自由私聊已关闭；仅可在审核通过、已接单且本人参与的求助订单中留言，且不会产生自动回复或真实投递。',
    )
  }

  function sendOrderMessage(postId: string, content: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练订单。')
    if (post.mode !== 'help') return failure('只有求助演练单可以留言。')
    if (!isVisiblePost(post)) return failure('只能给审核通过且公开的求助订单留言。')
    if (!isOneOf(post.orderStatus, ACTIVE_ORDER_STATUSES)) {
      return failure(
        post.orderStatus === 'completed-local-demo' || post.orderStatus === 'cancelled-local-demo'
          ? '该订单已完成或关闭，留言只读，不能再新增。'
          : '该求助订单尚未在本机演练中接单，暂不能留言。',
      )
    }
    if (!participatesInOrder(post)) {
      return failure('只有订单作者或本机接单成员可以留言。')
    }

    const text = typeof content === 'string' ? content.trim() : ''
    if (!text) return failure('请填写订单留言。')
    if (text.length > MAX_MESSAGE_CHARS) {
      return failure(`订单留言不能超过 ${MAX_MESSAGE_CHARS} 个字符。`)
    }

    const existingThread = threads.value.find(
      (item) => item.kind === 'order' && item.postId === post.id,
    )
    if (!existingThread && threads.value.length >= MAX_THREADS) return failure('本机订单线程数量已达上限。')
    const thread: DemoThread = existingThread ?? {
      id: nextId('SYNTH-THREAD', threads.value.map((item) => item.id)),
      kind: 'order',
      postId: post.id,
      title: post.title,
      updatedAt: nowIso(),
      messages: [],
    }
    if (thread.messages.length >= MAX_MESSAGES_PER_THREAD) {
      return failure('这条订单的留言数量已达上限。')
    }

    const createdAt = nowIso()
    const message: DemoMessage = {
      id: nextId('SYNTH-MESSAGE', messages.value.map((item) => item.id)),
      threadId: thread.id,
      sender: 'demo-user',
      content: text,
      createdAt,
      automaticReply: false,
      synthetic: true,
    }
    const nextThread: DemoThread = {
      ...thread,
      updatedAt: createdAt,
      messages: [...thread.messages, message],
    }
    const result = persistState({
      ...withThread(nextThread),
      threads: existingThread
        ? threads.value.map((item) => item.id === nextThread.id ? nextThread : item)
        : [...threads.value, nextThread],
    })
    return result.ok ? { ...result, id: message.id } : result
  }

  function moderatePost(
    id: string,
    status: ReviewStatus,
    reason: string,
  ): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const reviewerGate = requireReviewer()
    if (reviewerGate) return reviewerGate
    if (!isOneOf(status, REVIEW_STATUSES)) return failure('审核结果无效。')

    const reasonText = normalizeReason(reason)
    if (!reasonText) return failure('请填写审核理由。')
    if (reasonText.length > MAX_REASON_CHARS) {
      return failure(`审核理由不能超过 ${MAX_REASON_CHARS} 个字符。`)
    }

    const post = posts.value.find((item) => item.id === id)
    if (!post) return failure('找不到这条演练动态。')
    if ((post.moderation ?? 'pending') === status) {
      return {
        ok: true,
        errors: [],
        id: post.id,
        already: true,
        message: '该动态已是此审核状态，未重复写入审核日志。',
      }
    }

    const auditLimit = auditLimitBlocked()
    if (auditLimit) return auditLimit

    const nextPost: Post = {
      ...post,
      moderation: status,
      reviewNote: reasonText,
      ...(status === 'hidden'
        && post.mode === 'help'
        && isOneOf(post.orderStatus, ACTIVE_ORDER_STATUSES)
        ? {
            orderStatus: 'cancelled-local-demo' as const,
            orderEvents: [
              ...(post.orderEvents ?? []),
              ...((post.orderEvents?.length ?? 0) < MAX_ORDER_EVENTS
                ? [makeOrderEvent(
                    'cancel',
                    'reviewer',
                    orderEventNote('内容被审核员下架，订单演练自动关闭', reasonText),
                  )]
                : []),
            ],
          }
        : {}),
    }
    const base = {
      ...withPost(nextPost),
      auditLog: [...auditLog.value, nextAuditEntry('moderate-post', post.id, reasonText, status)],
    }
    const moderationLabel = status === 'approved' ? '审核通过' : status === 'rejected' ? '被驳回' : '已下架'
    const noticeBase = post.author.id === SYNTHETIC_DEMO_AUTHOR.id
      ? appendSystemNotice(base, `你的发布《${post.title}》${moderationLabel}。审核说明：${reasonText}`, 'moderation')
      : base
    const next = status === 'hidden'
      && post.mode === 'help'
      && isOneOf(post.orderStatus, ACTIVE_ORDER_STATUSES)
      && (post.author.id === SYNTHETIC_DEMO_AUTHOR.id || post.acceptedByMe === true)
      ? appendSystemNotice(
          noticeBase,
          `你参与的求助《${post.title}》因内容下架，本机订单演练已自动关闭；未发生真实服务或结算。`,
          'moderation',
        )
      : noticeBase
    const result = persistState(next)
    return result.ok ? { ...result, id: post.id } : result
  }

  function moderateComment(
    postId: string,
    commentId: string,
    status: ReviewStatus,
    reason: string,
  ): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const reviewerGate = requireReviewer()
    if (reviewerGate) return reviewerGate
    if (!isOneOf(status, REVIEW_STATUSES)) return failure('审核结果无效。')

    const reasonText = normalizeReason(reason)
    if (!reasonText) return failure('请填写审核理由。')
    if (reasonText.length > MAX_REASON_CHARS) {
      return failure(`审核理由不能超过 ${MAX_REASON_CHARS} 个字符。`)
    }

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')
    const comment = post.comments.find((item) => item.id === commentId)
    if (!comment || comment.postId !== post.id) return failure('找不到这条演练评论。')
    if ((comment.moderation ?? 'pending') === status) {
      return {
        ok: true,
        errors: [],
        id: comment.id,
        already: true,
        message: '该评论已是此审核状态，未重复写入审核日志。',
      }
    }

    const auditLimit = auditLimitBlocked()
    if (auditLimit) return auditLimit

    const nextComment: Comment = {
      ...comment,
      moderation: status,
      reviewNote: reasonText,
    }
    const nextPost: Post = {
      ...post,
      comments: post.comments.map((item) =>
        item.id === comment.id ? nextComment : item,
      ),
    }
    const base = {
      ...withPost(nextPost),
      auditLog: [...auditLog.value, nextAuditEntry('moderate-comment', comment.id, reasonText, status)],
    }
    const moderationLabel = status === 'approved' ? '审核通过' : status === 'rejected' ? '被驳回' : '已下架'
    const next = comment.author.id === SYNTHETIC_DEMO_AUTHOR.id
      ? appendSystemNotice(base, `你在《${post.title}》下的评论${moderationLabel}。审核说明：${reasonText}`, 'moderation')
      : base
    const result = persistState(next)
    return result.ok ? { ...result, id: comment.id } : result
  }

  function reportContent(
    targetType: ReportTargetType,
    targetId: string,
    reason: string,
  ): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate
    if (!isOneOf(targetType, REPORT_TARGET_TYPES)) return failure('举报目标类型无效。')

    const normalizedTargetId = typeof targetId === 'string' ? targetId.trim() : ''
    if (!normalizedTargetId) return failure('请选择要举报的内容。')
    const reasonText = normalizeReason(reason)
    if (!reasonText) return failure('请填写举报理由。')
    if (reasonText.length > MAX_REASON_CHARS) {
      return failure(`举报理由不能超过 ${MAX_REASON_CHARS} 个字符。`)
    }

    if (targetType === 'post') {
      const post = posts.value.find((item) => item.id === normalizedTargetId)
      if (!post) return failure('找不到要举报的演练动态。')
      if (!isVisiblePost(post)) return failure('只能举报审核通过且公开的帖子。')
    } else if (targetType === 'comment') {
      let post: Post | undefined
      let comment: Comment | undefined
      for (const item of posts.value) {
        const found = item.comments.find((entry) => entry.id === normalizedTargetId)
        if (!found) continue
        post = item
        comment = found
        break
      }
      if (!post || !comment) return failure('找不到要举报的演练评论。')
      if (!isVisiblePost(post)) return failure('只能举报审核通过且公开帖子下的评论。')
      if (comment.moderation !== 'approved') {
        return failure('只能举报审核通过的评论。')
      }
    } else {
      let thread: DemoThread | undefined
      let message: DemoMessage | undefined
      for (const item of threads.value) {
        const found = item.messages.find((entry) => entry.id === normalizedTargetId)
        if (!found) continue
        thread = item
        message = found
        break
      }
      if (!thread || !message) return failure('找不到要举报的演练留言。')
      if (message.hidden === true) {
        return failure('这条订单留言已下架，不能重复举报。')
      }
      if (thread.kind !== 'order' || !thread.postId) {
        return failure('只能举报与审核通过求助订单关联的订单留言。')
      }
      const post = posts.value.find((item) => item.id === thread.postId)
      if (!post || !isVisiblePost(post)) {
        return failure('只能举报审核通过且公开帖子下的订单留言。')
      }
      if (post.mode !== 'help' || !isOneOf(post.orderStatus, ACTIVE_ORDER_STATUSES) || !participatesInOrder(post)) {
        return failure('只能举报本人参与且进行中求助订单的留言。')
      }
    }

    // New reports carry the local demo reporter; legacy reports without a
    // reporter are treated as the same single demo user for deduplication.
    const duplicate = reports.value.find((item) =>
      item.status === 'pending'
      && item.targetType === targetType
      && item.targetId === normalizedTargetId
      && (item.reporter === undefined || item.reporter.id === SYNTHETIC_DEMO_AUTHOR.id),
    )
    if (duplicate) {
      return {
        ok: true,
        errors: [],
        id: duplicate.id,
        already: true,
        message: `已有一条待处理的本机举报（${duplicate.id}），未重复提交。`,
      }
    }

    // Check capacity after deduplication so a duplicate still receives the
    // actionable "already pending" result at the boundary.
    if (reports.value.length >= MAX_REPORTS) {
      return failure('本机举报数量已达上限，请先处理已有举报。')
    }

    const auditLimit = auditLimitBlocked()
    if (auditLimit) return auditLimit

    const reporter: FictionalAuthor = { ...SYNTHETIC_DEMO_AUTHOR }
    const report: Report = {
      id: nextId('SYNTH-REPORT', reports.value.map((item) => item.id)),
      targetType,
      targetId: normalizedTargetId,
      reason: reasonText,
      status: 'pending',
      reporter,
      createdAt: nowIso(),
      synthetic: true,
    }
    const result = persistState({
      posts: posts.value,
      threads: threads.value,
      complaints: complaints.value,
      ledgerEntries: ledgerEntries.value,
      reports: [report, ...reports.value],
      auditLog: [...auditLog.value, nextAuditEntry('create-report', normalizedTargetId, reasonText, 'pending')],
    })
    return result.ok ? { ...result, id: report.id } : result
  }

  function resolveReport(
    id: string,
    status: ReportStatus,
    reason: string,
  ): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const reviewerGate = requireReviewer()
    if (reviewerGate) return reviewerGate
    if (!isOneOf(status, ['resolved', 'dismissed'] as const)) {
      return failure('举报处理结果无效。')
    }

    const reasonText = normalizeReason(reason)
    if (!reasonText) return failure('请填写举报处理理由。')
    if (reasonText.length > MAX_REASON_CHARS) {
      return failure(`处理理由不能超过 ${MAX_REASON_CHARS} 个字符。`)
    }

    const report = reports.value.find((item) => item.id === id)
    if (!report) return failure('找不到这条举报记录。')
    if (report.status !== 'pending') return failure('这条举报已经处理过，不能重复记录。')

    const auditLimit = auditLimitBlocked()
    if (auditLimit) return auditLimit

    const nextReport: Report = {
      ...report,
      status,
      resolution: reasonText,
    }
    const nextState: CommunityState = {
      posts: posts.value,
      threads: threads.value,
      complaints: complaints.value,
      ledgerEntries: ledgerEntries.value,
      reports: reports.value.map((item) => item.id === report.id ? nextReport : item),
      auditLog: [...auditLog.value, nextAuditEntry('resolve-report', report.id, reasonText, status)],
    }
    const withNotice = report.reporter === undefined || report.reporter.id === SYNTHETIC_DEMO_AUTHOR.id
      ? appendSystemNotice(
          nextState,
          `你提交的举报（${report.id}）${status === 'resolved' ? '已处理' : '被判定不予支持'}：${reasonText}。仅为本机演练记录，不代表真实机构结论。`,
          'report',
        )
      : nextState
    const result = persistState(withNotice)
    return result.ok ? { ...result, id: report.id } : result
  }

  function hideOrderMessage(messageId: string, reason: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const reviewerGate = requireReviewer()
    if (reviewerGate) return reviewerGate

    const reasonText = normalizeReason(reason)
    if (!reasonText) return failure('请填写下架理由。')
    if (reasonText.length > MAX_REASON_CHARS) {
      return failure(`下架理由不能超过 ${MAX_REASON_CHARS} 个字符。`)
    }

    let thread: DemoThread | undefined
    let message: DemoMessage | undefined
    for (const item of threads.value) {
      const found = item.messages.find((entry) => entry.id === messageId)
      if (!found) continue
      thread = item
      message = found
      break
    }
    if (!thread || !message) return failure('找不到这条订单留言。')
    if (thread.kind !== 'order') return failure('只能下架订单留言。')
    if (message.hidden === true) {
      return {
        ok: true,
        errors: [],
        id: message.id,
        already: true,
        message: '这条订单留言已下架，未重复写入审核日志。',
      }
    }

    const auditLimit = auditLimitBlocked()
    if (auditLimit) return auditLimit

    const hiddenMessageId = message.id
    const senderWasDemoUser = message.sender === 'demo-user'
    const nextThread: DemoThread = {
      ...thread,
      messages: thread.messages.map((item) =>
        item.id === hiddenMessageId ? { ...item, hidden: true, reviewNote: reasonText } : item,
      ),
    }
    const base = {
      ...withThread(nextThread),
      auditLog: [...auditLog.value, nextAuditEntry('hide-message', hiddenMessageId, reasonText, 'hidden')],
    }
    const next = senderWasDemoUser
      ? appendSystemNotice(base, `你在订单《${thread.title}》中的一条留言已被审核员下架。下架理由：${reasonText}`, 'message')
      : base
    const result = persistState(next)
    return result.ok ? { ...result, id: hiddenMessageId } : result
  }

  function addComplaint(
    input: NewComplaintInput | string,
    content = '',
  ): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked
    const memberGate = requireMember()
    if (memberGate) return memberGate

    const complaintInput: NewComplaintInput = typeof input === 'string'
      ? { subject: input, content }
      : input
    if (!complaintInput || typeof complaintInput !== 'object') {
      return failure('投诉内容无效。')
    }

    const subject = typeof complaintInput.subject === 'string'
      ? complaintInput.subject.trim()
      : ''
    const text = typeof complaintInput.content === 'string'
      ? complaintInput.content.trim()
      : ''
    if (!subject) return failure('请填写反馈主题。')
    if (subject.length > MAX_TITLE_CHARS) {
      return failure(`反馈主题不能超过 ${MAX_TITLE_CHARS} 个字符。`)
    }
    if (!text) return failure('请填写反馈内容。')
    if (text.length > MAX_CONTENT_CHARS) {
      return failure(`反馈内容不能超过 ${MAX_CONTENT_CHARS} 个字符。`)
    }
    if (complaints.value.length >= MAX_COMPLAINTS) {
      return failure('本机演练投诉数量已达上限。')
    }

    const complaint: Complaint = {
      id: nextId('SYNTH-COMPLAINT', complaints.value.map((item) => item.id)),
      subject,
      content: text,
      status: COMPLAINT_STATUS,
      statusNote: COMPLAINT_LOCAL_ONLY_NOTICE,
      createdAt: nowIso(),
      synthetic: true,
    }
    const result = persistState({
      posts: posts.value,
      threads: threads.value,
      complaints: [complaint, ...complaints.value],
      ledgerEntries: ledgerEntries.value,
      reports: reports.value,
      auditLog: auditLog.value,
    })
    return result.ok
      ? {
          ...result,
          id: complaint.id,
          message: COMPLAINT_LOCAL_ONLY_NOTICE,
        }
      : result
  }

  function resetDemoData(): CommunityActionResult {
    const fixtures = resetFixturesWithFreshPostIds()
    const result = persistState(fixtures, { allowRecovery: true })
    return result.ok
      ? { ...result, message: '已恢复为虚构演示数据。' }
      : result
  }

  /**
   * Read-only backup text for the current in-memory demo state. This is the
   * same envelope that would be stored locally; it never uploads anything.
   */
  function readBackupJson(): string {
    return serializeState(state.value, lastSavedAt.value ?? nowIso())
  }

  return {
    posts,
    threads,
    complaints,
    ledgerEntries,
    reports,
    auditLog,
    membership,
    comments,
    messages,
    visiblePosts,
    ledger,
    systemNotices,
    unreadNoticeCount,
    notificationsReadAt,
    state,
    storageStatus,
    storageError,
    lastSavedAt,
    unreadableStoredData,
    syntheticDataNotice: SYNTHETIC_DATA_NOTICE,
    setMembership,
    markNotificationsRead,
    toggleLike,
    toggleFavorite,
    addComment,
    publishPost,
    acceptOrder,
    counterpartAcceptOrder,
    requestOrderCompletion,
    counterpartRequestOrderCompletion,
    confirmOrderCompletion,
    counterpartConfirmOrderCompletion,
    submitOrderFeedback,
    cancelOrder,
    raiseOrderDispute,
    resolveOrderDispute,
    signUpForEvent,
    cancelEventSignup,
    sendDemoChatMessage,
    sendOrderMessage,
    moderatePost,
    moderateComment,
    reportContent,
    resolveReport,
    hideOrderMessage,
    addComplaint,
    resetDemoData,
    reloadFromStorage,
    readBackupJson,
  }
})
