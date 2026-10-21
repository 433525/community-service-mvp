import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  COMPLAINT_LOCAL_ONLY_NOTICE,
  COMPLAINT_STATUS,
  DEMO_CHAT_AUTO_REPLY_NOTICE,
  DEMO_MESSAGE_SENDERS,
  DEMO_THREAD_KINDS,
  EVENT_LOCAL_DEMO_NOTICE,
  LEDGER_ENTRY_STATUS,
  ORDER_LOCAL_DEMO_NOTICE,
  ORDER_STATUSES,
  POST_MODES,
  VOLUNTEER_POST_KINDS,
  SYNTHETIC_DATA_NOTICE,
  type Comment,
  type CommunityActionResult,
  type CommunityState,
  type CommunityStorageStatus,
  type Complaint,
  type DemoMessage,
  type DemoThread,
  type FictionalAuthor,
  type LedgerEntry,
  type NewComplaintInput,
  type Post,
  type PostMode,
  type PublishPostInput,
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
const MAX_TITLE_CHARS = 120
const MAX_LOCATION_CHARS = 120
const MAX_CONTENT_CHARS = 2_000
const MAX_COMMENT_CHARS = 1_000
const MAX_CHAT_CHARS = 1_000
const MAX_DETAIL_CHARS = 240

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

function isComment(value: unknown): value is Comment {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.postId)
    && isFictionalAuthor(value.author)
    && isNonEmptyString(value.content)
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

  return { ok: true, savedAt: value.savedAt, state: value.state }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function loadInitialState(): LoadedCommunity {
  const fixtures = createCommunityFixtures()
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
    messages: thread.messages.map((message) => {
      let content = message.content
      for (const [oldId, newId] of postIdMap) content = content.split(oldId).join(newId)
      return { ...message, content }
    }),
  }))
  return fixtures
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
  const ledger = computed(() => ledgerEntries.value)
  const state = computed<CommunityState>(() => ({
    posts: posts.value,
    threads: threads.value,
    complaints: complaints.value,
    ledgerEntries: ledgerEntries.value,
  }))

  function applyState(next: CommunityState) {
    posts.value = next.posts
    threads.value = next.threads
    complaints.value = next.complaints
    ledgerEntries.value = next.ledgerEntries
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
      applyState(createCommunityFixtures())
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
    }
  }

  function toggleLike(postId: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')

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

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')
    return persistState(withPost({ ...post, favorited: !post.favorited }))
  }

  function addComment(postId: string, content: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')

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
    })
    return result.ok ? { ...result, id } : result
  }

  function acceptOrder(postId: string): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')
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

    const post = posts.value.find((item) => item.id === postId)
    if (!post) return failure('找不到这条演练动态。')
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

  function sendDemoChatMessage(
    threadIdOrContent: string,
    maybeContent?: string,
  ): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked

    const hasThreadId = maybeContent !== undefined
    const thread = hasThreadId
      ? threads.value.find((item) => item.id === threadIdOrContent)
      : threads.value.find((item) => item.kind === 'chat')
    if (!thread) return failure('找不到演练聊天。')
    if (thread.kind !== 'chat') return failure('只能在演练聊天中发送本地消息。')

    const rawContent = hasThreadId ? maybeContent : threadIdOrContent
    const content = typeof rawContent === 'string' ? rawContent.trim() : ''
    if (!content) return failure('请填写演练消息。')
    if (content.length > MAX_CHAT_CHARS) {
      return failure(`演练消息不能超过 ${MAX_CHAT_CHARS} 个字符。`)
    }
    if (thread.messages.length + 2 > MAX_MESSAGES_PER_THREAD) {
      return failure('这个演练聊天已达到消息数量上限。')
    }

    const usedMessageIds = messages.value.map((message) => message.id)
    const createdAt = nowIso()
    const userMessage: DemoMessage = {
      id: nextId('SYNTH-MESSAGE', usedMessageIds),
      threadId: thread.id,
      sender: 'demo-user',
      content,
      createdAt,
      automaticReply: false,
      synthetic: true,
    }
    const automaticReply: DemoMessage = {
      id: nextId('SYNTH-MESSAGE', [...usedMessageIds, userMessage.id]),
      threadId: thread.id,
      sender: 'synthetic-auto-reply',
      content: DEMO_CHAT_AUTO_REPLY_NOTICE,
      createdAt,
      automaticReply: true,
      synthetic: true,
    }
    const nextThread: DemoThread = {
      ...thread,
      updatedAt: createdAt,
      messages: [...thread.messages, userMessage, automaticReply],
    }

    const result = persistState(withThread(nextThread))
    return result.ok
      ? { ...result, id: userMessage.id, message: DEMO_CHAT_AUTO_REPLY_NOTICE }
      : result
  }

  function addComplaint(
    input: NewComplaintInput | string,
    content = '',
  ): CommunityActionResult {
    const blocked = blockedByRecovery()
    if (blocked) return blocked

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
    comments,
    messages,
    ledger,
    state,
    storageStatus,
    storageError,
    lastSavedAt,
    unreadableStoredData,
    syntheticDataNotice: SYNTHETIC_DATA_NOTICE,
    toggleLike,
    toggleFavorite,
    addComment,
    publishPost,
    acceptOrder,
    signUpForEvent,
    sendDemoChatMessage,
    addComplaint,
    resetDemoData,
    reloadFromStorage,
  }
})
