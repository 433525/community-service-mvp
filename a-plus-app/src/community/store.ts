import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  AUDIT_ACTIONS,
  COMPLAINT_LOCAL_ONLY_NOTICE,
  COMPLAINT_STATUS,
  DEMO_MESSAGE_SENDERS,
  DEMO_THREAD_KINDS,
  EVENT_LOCAL_DEMO_NOTICE,
  LEDGER_ENTRY_STATUS,
  MEMBERSHIP_ROLES,
  MODERATION_STATUSES,
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
      || (value.acceptedByMe && value.orderStatus !== 'accepted-local-demo')
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
  return {
    ...post,
    moderation: post.moderation ?? 'pending',
    comments: post.comments.map(normalizeComment),
  }
}

/**
 * Legacy archives have no moderation fields and must not become public by
 * accident. Legacy chat archives are retained but never rendered or writable.
 */
function normalizeCommunityState(state: CommunityState): CommunityState {
  return {
    posts: state.posts.map(normalizePost),
    threads: state.threads,
    complaints: state.complaints,
    ledgerEntries: state.ledgerEntries,
    reports: state.reports ?? [],
    auditLog: state.auditLog ?? [],
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
  for (const post of value.posts) {
    if (!isPost(post) || postIds.has(post.id)) return false
    postIds.add(post.id)
    for (const comment of post.comments) {
      if (commentIds.has(comment.id)) return false
      commentIds.add(comment.id)
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
  const state = computed<CommunityState>(() => ({
    posts: posts.value,
    threads: threads.value,
    complaints: complaints.value,
    ledgerEntries: ledgerEntries.value,
    reports: reports.value,
    auditLog: auditLog.value,
  }))

  function applyState(next: CommunityState) {
    posts.value = next.posts
    threads.value = next.threads
    complaints.value = next.complaints
    ledgerEntries.value = next.ledgerEntries
    reports.value = next.reports ?? []
    auditLog.value = next.auditLog ?? []
  }

  function persistState(
    next: CommunityState,
    options: { allowRecovery?: boolean } = {},
  ): CommunityActionResult {
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
      applyState(next)
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

    const serialized = serializeState(next, savedAt)
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

    applyState(next)
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
      return failure('不能接自己发布的求助演练单。')
    }
    if (post.orderStatus === 'accepted-local-demo') {
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

    const result = persistState(withPost({
      ...post,
      orderStatus: 'accepted-local-demo',
      acceptedByMe: true,
    }))
    return result.ok
      ? { ...result, id: post.id, message: ORDER_LOCAL_DEMO_NOTICE }
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
    if (post.orderStatus !== 'accepted-local-demo') {
      return failure('该求助订单尚未在本机演练中接单，暂不能留言。')
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
    }
    const result = persistState({
      ...withPost(nextPost),
      auditLog: [...auditLog.value, nextAuditEntry('moderate-post', post.id, reasonText, status)],
    })
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
    const result = persistState({
      ...withPost(nextPost),
      auditLog: [...auditLog.value, nextAuditEntry('moderate-comment', comment.id, reasonText, status)],
    })
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
    if (reports.value.length >= MAX_REPORTS) {
      return failure('本机举报数量已达上限，请先处理已有举报。')
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
      if (post.mode !== 'help' || post.orderStatus !== 'accepted-local-demo' || !participatesInOrder(post)) {
        return failure('只能举报本人参与且已接单求助订单的留言。')
      }
    }

    const report: Report = {
      id: nextId('SYNTH-REPORT', reports.value.map((item) => item.id)),
      targetType,
      targetId: normalizedTargetId,
      reason: reasonText,
      status: 'pending',
      createdAt: nowIso(),
      synthetic: true,
    }
    const result = persistState({
      posts: posts.value,
      threads: threads.value,
      complaints: complaints.value,
      ledgerEntries: ledgerEntries.value,
      reports: [report, ...reports.value],
      auditLog: auditLog.value,
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
    const result = persistState({
      posts: posts.value,
      threads: threads.value,
      complaints: complaints.value,
      ledgerEntries: ledgerEntries.value,
      reports: reports.value.map((item) => item.id === report.id ? nextReport : item),
      auditLog: [...auditLog.value, nextAuditEntry('resolve-report', report.id, reasonText, status)],
    })
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
    const nextThread: DemoThread = {
      ...thread,
      messages: thread.messages.map((item) =>
        item.id === hiddenMessageId ? { ...item, hidden: true, reviewNote: reasonText } : item,
      ),
    }
    const result = persistState({
      ...withThread(nextThread),
      auditLog: [...auditLog.value, nextAuditEntry('hide-message', hiddenMessageId, reasonText, 'hidden')],
    })
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
    state,
    storageStatus,
    storageError,
    lastSavedAt,
    unreadableStoredData,
    syntheticDataNotice: SYNTHETIC_DATA_NOTICE,
    setMembership,
    toggleLike,
    toggleFavorite,
    addComment,
    publishPost,
    acceptOrder,
    signUpForEvent,
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
  }
})
