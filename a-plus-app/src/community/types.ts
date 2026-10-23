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
  'create-report',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'moderate-post': '审核发布',
  'moderate-comment': '审核评论',
  'resolve-report': '处理举报',
  'hide-message': '下架订单留言',
  'create-report': '提交举报',
}

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

/** Local notice classification used only by the messages view. */
export const NOTICE_KINDS = ['moderation', 'order', 'report', 'message', 'system'] as const

export type NoticeKind = (typeof NOTICE_KINDS)[number]

export const NOTICE_KIND_LABELS: Record<NoticeKind, string> = {
  moderation: '审核',
  order: '订单',
  report: '举报',
  message: '留言',
  system: '其他',
}

export type DemoMessageSender = (typeof DEMO_MESSAGE_SENDERS)[number]

export const ORDER_STATUSES = [
  'open',
  'accepted-local-demo',
  'completion-requested',
  'completed-local-demo',
  'cancelled-local-demo',
  'disputed-local-demo',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: '待接单（本机演练）',
  'accepted-local-demo': '已接单（本机演练）',
  'completion-requested': '待确认完成（本机演练）',
  'completed-local-demo': '已完成（本机演练，未结算）',
  'cancelled-local-demo': '已取消/关闭（本机演练）',
  'disputed-local-demo': '争议处理中（本机演练）',
}

/** Statuses in which the local demo still treats the order as active. */
export const ACTIVE_ORDER_STATUSES = [
  'accepted-local-demo',
  'completion-requested',
  'disputed-local-demo',
] as const

/** Hard cap for a single order timeline; the store refuses writes above it. */
export const ORDER_EVENT_LIMIT = 100

export const ORDER_EVENT_TYPES = [
  'accept',
  'request-completion',
  'confirm-completion',
  'cancel',
  'dispute',
  'resume-after-dispute',
  'close-after-dispute',
] as const

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number]

export const ORDER_EVENT_ACTORS = ['demo-side', 'synthetic-counterpart', 'reviewer'] as const

export type OrderEventActor = (typeof ORDER_EVENT_ACTORS)[number]

export const ORDER_EVENT_LABELS: Record<OrderEventType, string> = {
  accept: '标记接单',
  'request-completion': '发起完成申请',
  'confirm-completion': '确认完成',
  cancel: '取消/关闭订单',
  dispute: '发起争议',
  'resume-after-dispute': '撤销争议并继续履约',
  'close-after-dispute': '因争议关闭订单',
}

export const ORDER_EVENT_ACTOR_LABELS: Record<OrderEventActor, string> = {
  'demo-side': '本机参与者',
  'synthetic-counterpart': '合成对方（代记录）',
  reviewer: '审核员（内容下架）',
}

/**
 * One local demo step in a help-order lifecycle. These events are the
 * traceable substitute for real fulfillment records; they never mean a real
 * order, dispatch, completion or settlement happened.
 */
export interface OrderEvent {
  readonly id: string
  readonly type: OrderEventType
  readonly actor: OrderEventActor
  readonly note: string
  readonly createdAt: string
  readonly synthetic: true
}

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

export interface OrderFeedback {
  readonly rating: number
  readonly note: string
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
  /** Local demo fulfilment trace. Legacy archives may omit it entirely. */
  readonly orderEvents?: OrderEvent[]
  /** Local-only experience note for a completed demo order. */
  readonly orderFeedback?: OrderFeedback
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
  /** System notice category; legacy notices omit it and are classified by text. */
  readonly noticeKind?: NoticeKind
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
  /** Legacy reports may omit the reporter; the UI must not invent one. */
  readonly reporter?: FictionalAuthor
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
  /** Latest time the local demo user marked system notices as read. */
  notificationsReadAt?: string
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

export const ORDER_FULFILLMENT_LOCAL_NOTICE =
  '订单状态只在当前浏览器演练数据中保存；申请完成、确认完成、取消或争议都不代表真实履约、真实双方确认或任何结算。'

export const ORDER_COUNTERPART_NOTICE =
  '合成对方动作仅用于补齐本机双人流程演示；没有任何真实居民参与，也不会发送通知。'

export const EVENT_LOCAL_DEMO_NOTICE =
  '报名只记录在当前浏览器演练数据中；不会产生真实报名、通知或活动安排。'
