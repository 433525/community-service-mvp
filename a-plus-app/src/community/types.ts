// Synthetic community-demo domain types.
// Everything in this module is local-only: no network, auth, geolocation,
// notifications, phone links, uploads, or external messaging.

export const POST_MODES = ['help', 'volunteer', 'neighbor'] as const

export type PostMode = (typeof POST_MODES)[number]

export const VOLUNTEER_POST_KINDS = ['update', 'activity'] as const

export type VolunteerPostKind = (typeof VOLUNTEER_POST_KINDS)[number]

export const POST_MODE_LABELS: Record<PostMode, string> = {
  help: '求助',
  volunteer: '志愿',
  neighbor: '邻里',
}

export const MODERATION_STATUSES = ['pending', 'approved', 'rejected', 'hidden'] as const

export type ModerationStatus = (typeof MODERATION_STATUSES)[number]

/** Reviewers may only publish these three decisions. */
export const REVIEW_STATUSES = ['approved', 'rejected', 'hidden'] as const

export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const MEMBERSHIP_ROLES = ['visitor', 'member', 'reviewer'] as const

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

export const REPORT_TARGET_TYPES = ['post', 'comment', 'message'] as const

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number]

export const REPORT_STATUSES = ['pending', 'resolved', 'dismissed'] as const

export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const AUDIT_ACTIONS = [
  'moderate-post',
  'moderate-comment',
  'resolve-report',
  'hide-message',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const DEMO_THREAD_KINDS = ['system', 'order', 'chat'] as const

export type DemoThreadKind = (typeof DEMO_THREAD_KINDS)[number]

export const DEMO_THREAD_KIND_LABELS: Record<DemoThreadKind, string> = {
  system: '系统消息',
  order: '订单消息',
  chat: '演练聊天',
}

export const DEMO_MESSAGE_SENDERS = [
  'system',
  'demo-user',
  'synthetic-contact',
  'synthetic-auto-reply',
] as const

export type DemoMessageSender = (typeof DEMO_MESSAGE_SENDERS)[number]

export const ORDER_STATUSES = ['open', 'accepted-local-demo'] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const COMPLAINT_STATUS = 'local-only' as const

export type ComplaintStatus = typeof COMPLAINT_STATUS

export const LEDGER_ENTRY_STATUS = 'unsettled' as const

export type LedgerEntryStatus = typeof LEDGER_ENTRY_STATUS

export const COMMUNITY_STORAGE_STATUSES = [
  'ready',
  'saved',
  'memory-only',
  'recovery-required',
  'save-error',
  'conflict',
] as const

export type CommunityStorageStatus = (typeof COMMUNITY_STORAGE_STATUSES)[number]

/** A named demo person or team. The synthetic flag is required by the store's parser. */
export interface FictionalAuthor {
  readonly id: string
  readonly name: string
  readonly synthetic: true
}

export interface Comment {
  readonly id: string
  readonly postId: string
  readonly author: FictionalAuthor
  readonly content: string
  /** Legacy comments without a value are normalized to pending by the store. */
  readonly moderation?: ModerationStatus
  /** Reviewer-only note; review never rewrites comment content. */
  readonly reviewNote?: string
  readonly createdAt: string
  readonly synthetic: true
}

export interface Post {
  readonly id: string
  readonly mode: PostMode
  readonly title: string
  readonly content: string
  /** Generic help intake stays uncategorized until operators decide service types. */
  readonly category?: string
  readonly timeWindow?: string
  readonly duration?: string
  readonly specialNote?: string
  readonly volunteerKind?: VolunteerPostKind
  readonly anonymous?: boolean
  readonly publishedToFeed?: boolean
  /** Legacy posts without a value are normalized to pending by the store. */
  readonly moderation?: ModerationStatus
  /** Reviewer-only note; review never rewrites post body fields. */
  readonly reviewNote?: string
  readonly author: FictionalAuthor
  /** Coarse, fictional demo location only. */
  readonly location: string
  readonly createdAt: string
  readonly likeCount: number
  readonly likedByMe: boolean
  readonly favorited: boolean
  readonly comments: Comment[]
  /** Volunteer activities may be open-ended (no capacity) or capped. */
  readonly eventCapacity?: number
  readonly eventSignupCount?: number
  readonly eventStartsAt?: string
  readonly signedUpByMe?: boolean
  /** Help posts are local demo orders. This never means a real order was placed. */
  readonly orderStatus?: OrderStatus
  /** Identifies that the current synthetic demo user accepted this help post. */
  readonly acceptedByMe?: boolean
  readonly synthetic: true
}

export interface DemoMessage {
  readonly id: string
  readonly threadId: string
  readonly sender: DemoMessageSender
  readonly content: string
  readonly createdAt: string
  /** Automatic replies are generated locally and must stay visibly synthetic. */
  readonly automaticReply: boolean
  /** Reviewer-only removal from order threads; legacy messages simply omit it. */
  readonly hidden?: boolean
  /** Reviewer-only note; review never rewrites message content. */
  readonly reviewNote?: string
  readonly synthetic: true
}

export interface DemoThread {
  readonly id: string
  readonly kind: DemoThreadKind
  readonly title: string
  /** Order threads are tied to the local demo help post they discuss. */
  readonly postId?: string
  readonly updatedAt: string
  readonly messages: DemoMessage[]
}

export interface Report {
  readonly id: string
  readonly targetType: ReportTargetType
  readonly targetId: string
  readonly reason: string
  readonly status: ReportStatus
  readonly resolution?: string
  readonly createdAt: string
  readonly synthetic: true
}

export interface AuditLogEntry {
  readonly id: string
  readonly action: AuditAction
  readonly targetId: string
  readonly reason: string
  readonly decision?: ModerationStatus | ReportStatus
  readonly createdAt: string
  readonly synthetic: true
}

export interface Complaint {
  readonly id: string
  readonly subject: string
  readonly content: string
  readonly status: ComplaintStatus
  readonly statusNote: string
  readonly createdAt: string
  readonly synthetic: true
}

/** Demo time records are intentionally read-only; no action in the store settles them. */
export interface LedgerEntry {
  readonly id: string
  readonly title: string
  readonly minutes: number
  readonly status: LedgerEntryStatus
  readonly note: string
  readonly createdAt: string
  readonly synthetic: true
}

export interface CommunityState {
  posts: Post[]
  threads: DemoThread[]
  complaints: Complaint[]
  ledgerEntries: LedgerEntry[]
  /** Optional so archives created before controlled-community support still load. */
  reports?: Report[]
  /** Optional so archives created before controlled-community support still load. */
  auditLog?: AuditLogEntry[]
}

export interface PublishPostInput {
  mode: PostMode
  title: string
  content: string
  category?: string
  timeWindow?: string
  duration?: string
  specialNote?: string
  /** Defaults to a clearly fictional demo location. */
  location?: string
  eventCapacity?: number
  eventStartsAt?: string
  volunteerKind?: VolunteerPostKind
  anonymous?: boolean
  publishedToFeed?: boolean
}

export interface NewComplaintInput {
  subject: string
  content: string
}

export interface CommunityActionResult {
  readonly ok: boolean
  readonly errors: string[]
  readonly id?: string
  readonly already?: boolean
  readonly message?: string
}

export const SYNTHETIC_DATA_NOTICE =
  '本页面只使用虚构演练数据；不会连接真实社区、真实居民、外部机构或支付/配送服务。'

export const COMPLAINT_LOCAL_ONLY_NOTICE =
  '仅保存在本机演示数据中：未提交给任何机构，也不代表已收到、已受理、已处理或会有回复。'

export const DEMO_CHAT_AUTO_REPLY_NOTICE =
  '【合成自动回复】你的消息只记录在本机演练中；这条回复由本地演示规则生成，不会发送给真实的人。'

export const ORDER_LOCAL_DEMO_NOTICE =
  '已在本地演练中标记接单；不会产生真实接单、派单、通知或履约。'

export const EVENT_LOCAL_DEMO_NOTICE =
  '报名只记录在当前浏览器演练数据中；不会产生真实报名、通知或活动安排。'
