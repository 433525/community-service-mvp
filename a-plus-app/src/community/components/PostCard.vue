<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCommunityStore } from '../store'
import {
  ORDER_EVENT_ACTOR_LABELS,
  ORDER_EVENT_LABELS,
  ORDER_EVENT_LIMIT,
  ORDER_STATUS_LABELS,
  type Post,
} from '../types'
import { SYNTHETIC_DEMO_AUTHOR } from '../fixtures'
import { buildShareUrl } from '../../shared/route-state'
import { copyText } from '../../shared/clipboard'

const props = withDefaults(defineProps<{ post: Post; compact?: boolean }>(), { compact: false })
const emit = defineEmits<{ toast: [message: string] }>()
const store = useCommunityStore()
const showComment = ref(false)
const commentText = ref('')
const reportReason = ref('')
const reportTarget = ref<{type: 'post' | 'comment'; id: string} | null>(null)
const approvedComments = computed(() => props.post.comments.filter(c => c.moderation === 'approved'))
const moderationLabel = computed(() => ({pending:'待审核', approved:'审核通过', rejected:'已驳回', hidden:'已下架'})[props.post.moderation ?? 'pending'])
const modeLabel = (mode: Post['mode']) => ({ help: '互助求助', volunteer: '志愿动态', neighbor: '邻里分享' })[mode]
const dateLabel = (value: string) => new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
const isMyHelpPost = props.post.mode === 'help' && props.post.author.id === SYNTHETIC_DEMO_AUTHOR.id

const orderRole = computed<'author' | 'acceptor' | null>(() => {
  const post = props.post
  if (post.mode !== 'help') return null
  if (post.author.id === SYNTHETIC_DEMO_AUTHOR.id) return 'author'
  if (post.acceptedByMe === true) return 'acceptor'
  return null
})
const orderEvents = computed(() => props.post.orderEvents ?? [])
const orderActionsLocked = computed(() => orderEvents.value.length >= ORDER_EVENT_LIMIT
  && ['open', 'accepted-local-demo', 'completion-requested', 'disputed-local-demo'].includes(props.post.orderStatus ?? ''))
const orderStatusLabel = computed(() => (
  props.post.orderStatus ? ORDER_STATUS_LABELS[props.post.orderStatus] : ORDER_STATUS_LABELS.open
))
const orderStatusHint = computed(() => {
  switch (props.post.orderStatus) {
    case 'open': return '等待演练接单。'
    case 'accepted-local-demo': return '已接单，等待发起完成申请。'
    case 'completion-requested': return '完成申请待确认。'
    case 'completed-local-demo': return '本机演练已完成；没有真实结算或评价。'
    case 'cancelled-local-demo': return '本机演练订单已关闭。'
    case 'disputed-local-demo': return '本机演练争议处理中。'
    default: return '本机演练订单。'
  }
})

type OrderActionKey =
  | 'accept'
  | 'counterpart-accept'
  | 'request-completion'
  | 'counterpart-request-completion'
  | 'confirm-completion'
  | 'counterpart-confirm-completion'
  | 'cancel'
  | 'dispute'
  | 'resume-dispute'
  | 'close-dispute'

const orderAction = ref<OrderActionKey | ''>('')
const orderNote = ref('')

const showAccept = computed(() => props.post.orderStatus === 'open' && !isMyHelpPost)
const showCounterpartAccept = computed(() => props.post.orderStatus === 'open' && orderRole.value === 'author')
const showRequestCompletion = computed(() => props.post.orderStatus === 'accepted-local-demo' && orderRole.value === 'acceptor')
const showCounterpartRequest = computed(() => props.post.orderStatus === 'accepted-local-demo' && orderRole.value === 'author')
const showConfirmCompletion = computed(() => (
  props.post.orderStatus === 'completion-requested'
  && orderRole.value === 'author'
))
const showCounterpartConfirm = computed(() => (
  props.post.orderStatus === 'completion-requested'
  && orderRole.value === 'acceptor'
))
const showCancelOrder = computed(() => (
  orderRole.value !== null
  && ['open', 'accepted-local-demo', 'completion-requested', 'disputed-local-demo'].includes(props.post.orderStatus ?? '')
))
const showRaiseDispute = computed(() => (
  orderRole.value !== null
  && ['accepted-local-demo', 'completion-requested'].includes(props.post.orderStatus ?? '')
))
const showResolveDispute = computed(() => orderRole.value !== null && props.post.orderStatus === 'disputed-local-demo')
const orderActionRequiresNote = computed(() => (
  orderAction.value === 'cancel'
  || orderAction.value === 'dispute'
  || orderAction.value === 'resume-dispute'
  || orderAction.value === 'close-dispute'
))
const orderActionLabel = computed(() => {
  switch (orderAction.value) {
    case 'request-completion': return '发起完成申请（本机接单成员）'
    case 'cancel': return '取消/关闭订单原因（必填，仅演练）'
    case 'dispute': return '争议原因（必填，仅演练）'
    case 'resume-dispute': return '撤销争议并继续履约的说明（必填，仅演练）'
    case 'close-dispute': return '因争议关闭订单的说明（必填，仅演练）'
    default: return '本机演练说明'
  }
})

function formatOrderTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function report() {
 if (!reportTarget.value) return
 const result = store.reportContent(reportTarget.value.type, reportTarget.value.id, reportReason.value)
 emit('toast', result.ok ? (result.message ?? '举报已进入本机审核队列。') : result.errors.join(' '))
  if(result.ok) { reportTarget.value = null; reportReason.value = '' }
}

function run(action: () => { ok: boolean; errors: string[]; message?: string }, success: string) {
  const result = action()
  emit('toast', result.ok ? (result.message ?? success) : result.errors.join(' '))
}

/** 复制动态深链：只含页签与帖子 id，不包含搜索、身份或存档内容。 */
async function copyPostLink() {
  const url = buildShareUrl({ tab: 'community', post: props.post.id })
  const copied = url ? await copyText(url) : false
  emit('toast', copied ? '已复制该动态的演练链接。' : '复制失败：请从地址栏复制链接。')
}

function startOrderAction(action: OrderActionKey) {
  if (
    action === 'accept'
    || action === 'counterpart-accept'
    || action === 'confirm-completion'
    || action === 'counterpart-confirm-completion'
    || action === 'counterpart-request-completion'
  ) {
    runOrder(action)
    return
  }
  orderAction.value = action
  orderNote.value = ''
}

function runOrder(action: OrderActionKey) {
  const postId = props.post.id
  const note = orderNote.value
  let result: { ok: boolean; errors: string[]; message?: string }
  switch (action) {
    case 'accept': result = store.acceptOrder(postId); break
    case 'counterpart-accept': result = store.counterpartAcceptOrder(postId); break
    case 'request-completion': result = store.requestOrderCompletion(postId, note); break
    case 'counterpart-request-completion': result = store.counterpartRequestOrderCompletion(postId); break
    case 'confirm-completion': result = store.confirmOrderCompletion(postId); break
    case 'counterpart-confirm-completion': result = store.counterpartConfirmOrderCompletion(postId); break
    case 'cancel': result = store.cancelOrder(postId, note); break
    case 'dispute': result = store.raiseOrderDispute(postId, note); break
    case 'resume-dispute': result = store.resolveOrderDispute(postId, 'resume', note); break
    case 'close-dispute': result = store.resolveOrderDispute(postId, 'close', note); break
    default: return
  }
  emit('toast', result.ok ? (result.message ?? '已更新本机演练状态。') : result.errors.join(' '))
  if (result.ok) {
    orderAction.value = ''
    orderNote.value = ''
  }
}

function submitOrderAction() {
  if (!orderAction.value) return
  runOrder(orderAction.value)
}

const feedbackRating = ref(5)
const feedbackNote = ref('')
const canLeaveOrderFeedback = computed(() => props.post.orderStatus === 'completed-local-demo'
  && orderRole.value !== null
  && !props.post.orderFeedback)
function submitOrderFeedback() {
  const result = store.submitOrderFeedback(props.post.id, feedbackRating.value, feedbackNote.value)
  if (!result.ok) return emit('toast', result.errors.join(' '))
  feedbackNote.value = ''
  emit('toast', result.message ?? '已保存本机演练体验记录。')
}

function addComment() {
  const result = store.addComment(props.post.id, commentText.value)
  if (!result.ok) return emit('toast', result.errors.join(' '))
  commentText.value = ''
  emit('toast', '评论已提交审核；通过前不会公开显示。')
}
</script>

<template>
  <article class="post-card" :class="{ compact }" :data-post-id="post.id" tabindex="-1">
    <div class="post-topline">
      <span class="post-kind" :class="`kind-${post.mode}`"><i></i>{{ modeLabel(post.mode) }}</span>
      <span class="post-date">{{ dateLabel(post.createdAt) }} · 演练</span>
    </div>
    <div class="post-author-row">
      <span class="post-avatar" :class="`avatar-${post.mode}`">{{ post.anonymous ? '匿' : post.author.name.slice(-2, -1) }}</span>
      <div><strong>{{ post.anonymous ? '匿名志愿者（虚构）' : post.author.name }}</strong><small>{{ post.location }}</small></div>
      <button v-if="post.moderation === 'approved' && post.publishedToFeed !== false" class="icon-button post-save" type="button" :aria-label="post.favorited ? '取消收藏' : '收藏'" @click="run(() => store.toggleFavorite(post.id), post.favorited ? '已取消收藏。' : '已收藏。')">{{ post.favorited ? '★' : '☆' }}</button>
    </div>
    <p class="moderation-badge">{{ moderationLabel }}</p>
    <h3 class="post-title">{{ post.title }}</h3>
    <p class="post-content">{{ post.content }}</p>
    <div v-if="post.mode === 'help' && (post.category || post.timeWindow || post.duration || post.orderStatus)" class="help-detail-row">
      <span v-if="post.category">分类：{{ post.category }}</span>
      <span v-if="post.timeWindow">时段：{{ post.timeWindow }}</span>
      <span v-if="post.duration">预计：{{ post.duration }}</span>
      <span v-if="post.orderStatus" class="order-status-inline">{{ orderStatusLabel }}</span>
    </div>
    <div v-if="post.specialNote" class="post-note">补充说明：{{ post.specialNote }}</div>
    <div v-if="post.mode === 'volunteer' && post.volunteerKind === 'activity'" class="event-detail">
      <span>◷ {{ post.eventStartsAt ? new Date(post.eventStartsAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间待定' }}</span>
      <span>报名 {{ post.eventSignupCount ?? 0 }}<template v-if="post.eventCapacity"> / {{ post.eventCapacity }} 人</template></span>
      <span v-if="post.signedUpByMe" class="event-signup-state">我已演练报名</span>
    </div>
    <div v-if="!compact && post.moderation === 'approved' && post.publishedToFeed !== false" class="post-actions">
      <button type="button" :class="{ chosen: post.likedByMe }" @click="run(() => store.toggleLike(post.id), '已更新点赞。')"><span>♡</span>{{ post.likeCount }}</button>
      <button type="button" @click="showComment = !showComment"><span>▱</span>{{ approvedComments.length }} 条评论</button>
      <button v-if="post.mode === 'volunteer' && post.volunteerKind === 'activity' && !post.signedUpByMe" class="post-action-cta" type="button" :disabled="!!post.eventCapacity && (post.eventSignupCount ?? 0) >= post.eventCapacity" @click="run(() => store.signUpForEvent(post.id), '已在本机演练中记录报名。')">{{ post.eventCapacity && (post.eventSignupCount ?? 0) >= post.eventCapacity ? '名额已满' : '演练报名' }}</button>
      <button v-else-if="post.mode === 'volunteer' && post.volunteerKind === 'activity'" class="post-action-cta ghost" type="button" @click="run(() => store.cancelEventSignup(post.id), '已取消本机演练报名。')">取消演练报名</button>
      <span v-else-if="post.mode === 'volunteer'" class="local-action-label">志愿记录不提供报名</span>
      <button type="button" @click="copyPostLink">复制链接</button>
      <button type="button" @click="reportTarget = {type: 'post', id: post.id}">举报</button>
    </div>
    <section v-if="!compact && post.mode === 'help' && post.moderation === 'approved' && post.publishedToFeed !== false" class="order-block" aria-label="求助订单履约演练">
      <div class="order-status-row">
        <span class="order-status-pill" :class="`order-status-${post.orderStatus ?? 'open'}`">{{ orderStatusLabel }}</span>
        <small>本机演练 · 不代表真实接单、履约或结算</small>
      </div>
      <p v-if="orderRole" class="order-role-hint">你是本单的{{ orderRole === 'author' ? '求助发布者' : '本机接单成员' }}；对方是合成演练对象，不会收到任何通知。</p>
      <p v-if="orderEvents.length" class="order-timeline-label">履约演练记录</p>
      <ol v-if="orderEvents.length" class="order-timeline">
        <li v-for="event in orderEvents.slice(-4)" :key="event.id">
          <div class="order-event-head"><strong>{{ ORDER_EVENT_LABELS[event.type] }}</strong><span>{{ ORDER_EVENT_ACTOR_LABELS[event.actor] }} · {{ formatOrderTime(event.createdAt) }}</span></div>
          <p v-if="event.note">{{ event.note }}</p>
        </li>
      </ol>
      <p v-else-if="post.orderStatus !== 'open'" class="order-legacy-note">旧存档缺少本单演练事件记录，无法还原历史步骤；后续操作会从当前状态继续记录。</p>
      <div class="order-actions">
        <template v-if="!orderActionsLocked">
        <button v-if="showAccept" type="button" class="order-action-primary" @click="startOrderAction('accept')">演练接单</button>
        <button v-if="showCounterpartAccept" type="button" class="order-action-ghost" @click="startOrderAction('counterpart-accept')">代合成邻居接单（演练）</button>
        <button v-if="showRequestCompletion" type="button" class="order-action-primary" @click="startOrderAction('request-completion')">发起完成申请</button>
        <button v-if="showCounterpartRequest" type="button" class="order-action-ghost" @click="startOrderAction('counterpart-request-completion')">代合成接单方申请完成（演练）</button>
        <button v-if="showConfirmCompletion" type="button" class="order-action-primary" @click="startOrderAction('confirm-completion')">确认完成</button>
        <button v-if="showCounterpartConfirm" type="button" class="order-action-ghost" @click="startOrderAction('counterpart-confirm-completion')">代合成求助方确认完成（演练）</button>
        <button v-if="showRaiseDispute" type="button" class="order-action-ghost" @click="startOrderAction('dispute')">发起争议（演练）</button>
        <button v-if="showResolveDispute" type="button" class="order-action-ghost" @click="startOrderAction('resume-dispute')">撤销争议继续履约（演练）</button>
        <button v-if="showResolveDispute" type="button" class="order-action-ghost" @click="startOrderAction('close-dispute')">因争议关闭订单（演练）</button>
        <button v-if="showCancelOrder" type="button" class="order-action-ghost" @click="startOrderAction('cancel')">取消/关闭订单（演练）</button>
        <span v-if="!showAccept && !showCounterpartAccept && !showRequestCompletion && !showCounterpartRequest && !showConfirmCompletion && !showCounterpartConfirm && !showRaiseDispute && !showResolveDispute && !showCancelOrder" class="order-inactive-note">{{ orderStatusHint }}</span>
        </template>
        <p v-else class="order-locked-note" role="status">演练事件已达 {{ ORDER_EVENT_LIMIT }} 条上限，本单后续订单操作已停用；可先重置演练数据后继续。</p>
      </div>
      <form v-if="orderAction && !orderActionsLocked" class="order-action-form" @submit.prevent="submitOrderAction">
        <label class="field-label">{{ orderActionLabel }}<textarea v-model="orderNote" :required="orderActionRequiresNote" maxlength="240" rows="2" :placeholder="orderActionRequiresNote ? '请填写虚构的演练原因或说明' : '可选：填写演练说明'"></textarea></label>
        <div class="order-action-form-buttons"><button class="button-primary" type="submit" :disabled="orderActionRequiresNote && !orderNote.trim()">{{ orderActionRequiresNote ? '提交本机记录' : '发起本机申请' }}</button><button class="button-ghost" type="button" @click="orderAction = ''">取消</button></div>
      </form>
      <div v-if="canLeaveOrderFeedback" class="order-feedback-form">
        <strong>为这次本机演练留一条体验记录</strong>
        <label class="field-label">评分<select v-model.number="feedbackRating"><option :value="5">5 星</option><option :value="4">4 星</option><option :value="3">3 星</option><option :value="2">2 星</option><option :value="1">1 星</option></select></label>
        <label class="field-label">体验说明（可选）<textarea v-model="feedbackNote" maxlength="240" rows="2" placeholder="只写虚构感受；不要填写真实个人信息"></textarea></label>
        <button type="button" class="button-primary" @click="submitOrderFeedback">保存体验记录</button>
        <small>只保存在本机；不发送评价、不影响真实信誉或结算。</small>
      </div>
      <div v-else-if="post.orderFeedback && orderRole !== null" class="order-feedback-summary">
        <strong>本机体验记录 · {{ '★'.repeat(post.orderFeedback.rating) }}</strong>
        <p v-if="post.orderFeedback.note">{{ post.orderFeedback.note }}</p>
        <small>仅本机合成记录；不发送评价、不影响真实信誉或结算。</small>
      </div>
    </section>
    <div v-if="showComment && !compact && post.moderation === 'approved' && post.publishedToFeed !== false" class="comment-panel">
      <div v-if="approvedComments.length" class="comment-list">
        <p v-for="comment in approvedComments" :key="comment.id"><strong>{{ comment.author.name }}：</strong>{{ comment.content }} <button type="button" @click="reportTarget = {type: 'comment', id: comment.id}">举报评论</button></p>
      </div>
      <form class="comment-form" @submit.prevent="addComment">
        <label class="sr-only" :for="`comment-${post.id}`">写一条演练评论</label>
        <input :id="`comment-${post.id}`" v-model="commentText" placeholder="写一条演练评论…" maxlength="1000" />
        <button type="submit" :disabled="!commentText.trim()">发送</button>
      </form>
      <small>评论先审后发，仅保存在当前浏览器。</small>
    </div>
    <form v-if="reportTarget" class="field-label" @submit.prevent="report"><label>举报理由（{{ reportTarget.type === 'post' ? '帖子' : '评论' }}）<textarea v-model="reportReason" maxlength="240" required placeholder="填写虚构的举报依据"></textarea></label><div class="moderation-actions"><button type="submit" class="button-primary">提交本机举报</button><button type="button" class="button-ghost" @click="reportTarget = null">取消</button></div></form>
  </article>
</template>
