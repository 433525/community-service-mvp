// Read-only bridge from the synthetic community archive to A+ intake.
// It only reads the existing localStorage key. It never writes back, never
// changes a community post/order, and never contacts any external service.

import {
  COMMUNITY_STORAGE_KEY,
  COMMUNITY_STORAGE_SCHEMA_VERSION,
} from '../community/storage'

const MAX_STORED_CHARS = 1_000_000
const MAX_INTAKE_SUMMARY_CHARS = 240
const POST_MODES = ['help', 'volunteer', 'neighbor'] as const
const HELP_ORDER_STATUSES = ['open', 'accepted-local-demo'] as const

export interface CommunityHelpPost {
  readonly id: string
  readonly orderStatus: (typeof HELP_ORDER_STATUSES)[number]
  readonly title: string
  readonly content: string
  readonly category: string
  readonly timeWindow: string
  readonly duration: string
  readonly specialNote: string
  readonly location: string
  readonly createdAt: string
}

export interface CommunityHelpMapping {
  readonly label: string
  readonly summary: string
  readonly summaryTruncated: boolean
  readonly sourcePostId: string
}

export type CommunityHelpReadResult =
  | {
      readonly status: 'ready'
      readonly posts: readonly CommunityHelpPost[]
      readonly savedAt: string
    }
  | { readonly status: 'missing'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim() !== ''
    && !Number.isNaN(Date.parse(value))
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.some((option) => option === value)
}

function optionalText(value: Record<string, unknown>, key: string): string | null {
  if (value[key] === undefined) return ''
  return typeof value[key] === 'string' ? value[key] : null
}

/** Parse one synthetic post without touching or repairing the stored data. */
function parseHelpPost(
  value: unknown,
  index: number,
): { post: CommunityHelpPost | null; error: string | null } {
  if (!isRecord(value)) {
    return { post: null, error: `社区演练存档第 ${index + 1} 条动态结构无效。` }
  }
  if (!isOneOf(value.mode, POST_MODES)) {
    return { post: null, error: `社区演练存档第 ${index + 1} 条动态缺少有效类型。` }
  }
  // Non-help posts are irrelevant to the intake bridge. Skip them before
  // validating help-only content so one unrelated malformed post cannot block
  // the operator from reading otherwise valid synthetic help requests.
  if (value.mode !== 'help') return { post: null, error: null }
  if (!isNonEmptyString(value.id)) {
    return { post: null, error: `社区演练存档第 ${index + 1} 条求助缺少有效 id。` }
  }
  if (!isNonEmptyString(value.title) || !isNonEmptyString(value.content)) {
    return { post: null, error: `社区演练存档第 ${index + 1} 条动态缺少标题或正文。` }
  }
  if (!isTimestamp(value.createdAt)) {
    return { post: null, error: `社区演练存档第 ${index + 1} 条动态的创建时间无效。` }
  }

  if (value.synthetic !== true) {
    return { post: null, error: `社区演练存档第 ${index + 1} 条求助缺少合成数据标记。` }
  }
  if (!isOneOf(value.orderStatus, HELP_ORDER_STATUSES)) {
    return { post: null, error: `社区演练存档第 ${index + 1} 条求助的登记状态无效。` }
  }

  const category = optionalText(value, 'category')
  const timeWindow = optionalText(value, 'timeWindow')
  const duration = optionalText(value, 'duration')
  const specialNote = optionalText(value, 'specialNote')
  const location = optionalText(value, 'location')
  if (
    category === null
    || timeWindow === null
    || duration === null
    || specialNote === null
    || location === null
  ) {
    return { post: null, error: `社区演练存档第 ${index + 1} 条求助的补充字段无效。` }
  }

  return {
    post: {
      id: value.id.trim(),
      orderStatus: value.orderStatus,
      title: value.title,
      content: value.content,
      category,
      timeWindow,
      duration,
      specialNote,
      location,
      createdAt: value.createdAt,
    },
    error: null,
  }
}

export function readCommunityHelpPosts(): CommunityHelpReadResult {
  let storage: Storage | null
  try {
    storage = typeof window === 'undefined' ? null : window.localStorage
  } catch {
    storage = null
  }
  if (!storage) {
    return {
      status: 'error',
      message: '当前浏览器不可用本机存储，无法读取社区演练存档。未创建任何记录，也未修改社区存档。',
    }
  }

  let raw: string | null
  try {
    raw = storage.getItem(COMMUNITY_STORAGE_KEY)
  } catch {
    return {
      status: 'error',
      message: '读取社区演练存档失败。未创建任何记录，也未修改社区存档。',
    }
  }
  if (raw === null) {
    return {
      status: 'missing',
      message: '本机尚未创建社区演练存档。请先在社区页发布一条合成求助，再回到此处手动读取。未创建任何记录，也未修改社区存档。',
    }
  }
  if (raw.length > MAX_STORED_CHARS) {
    return {
      status: 'error',
      message: '社区演练存档超过读取上限，已停止读取。未创建任何记录，也未修改社区存档；请在社区页减少演练数据后再读取。',
    }
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return {
      status: 'error',
      message: '社区演练存档不是有效的 JSON，无法读取。未创建任何记录，也未修改社区存档。',
    }
  }

  if (
    !isRecord(value)
    || value.app !== 'community-mvp'
    || value.kind !== 'synthetic-community-demo'
    || value.schemaVersion !== COMMUNITY_STORAGE_SCHEMA_VERSION
    || !isTimestamp(value.savedAt)
    || !isRecord(value.state)
    || !Array.isArray(value.state.posts)
  ) {
    return {
      status: 'error',
      message: '社区演练存档版本或结构与当前 A+ 读取器不兼容，已停止读取。未创建任何记录，也未修改社区存档。',
    }
  }

  const posts: CommunityHelpPost[] = []
  const seenIds = new Set<string>()
  for (const [index, item] of value.state.posts.entries()) {
    const parsed = parseHelpPost(item, index)
    if (parsed.error) {
      return {
        status: 'error',
        message: `${parsed.error}已停止读取。未创建任何记录，也未修改社区存档。`,
      }
    }
    if (!parsed.post) continue
    if (seenIds.has(parsed.post.id)) {
      return {
        status: 'error',
        message: `社区演练存档中的帖子 ID 重复：${parsed.post.id}。已停止读取，未创建任何记录，也未修改社区存档。`,
      }
    }
    seenIds.add(parsed.post.id)
    posts.push(parsed.post)
  }

  return { status: 'ready', posts, savedAt: value.savedAt }
}

/** Stable, side-effect-free mapping: the post ID is the source of truth. */
export function mapCommunityHelpPostToIntake(post: CommunityHelpPost): CommunityHelpMapping {
  const fullSummary = `${post.title.trim()}｜${post.content.trim()}`
  // Match the A+ intake form's 240 UTF-16 code-unit limit without splitting
  // surrogate pairs. The original post remains untouched in the community archive.
  const summaryTruncated = fullSummary.length > MAX_INTAKE_SUMMARY_CHARS
  let summary = fullSummary
  if (summaryTruncated) {
    summary = ''
    for (const character of fullSummary) {
      if (summary.length + character.length > MAX_INTAKE_SUMMARY_CHARS - 1) break
      summary += character
    }
    summary += '…'
  }

  return {
    sourcePostId: post.id,
    label: `社区求助 · ${post.id}`,
    summary,
    summaryTruncated,
  }
}
