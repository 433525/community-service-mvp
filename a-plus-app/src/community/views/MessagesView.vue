<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCommunityStore } from '../store'
import { useSectionSpy } from '../../shared/section-spy'
import { ORDER_EVENT_LABELS, ORDER_STATUS_LABELS, NOTICE_KINDS, NOTICE_KIND_LABELS, type NoticeKind, type OrderStatus } from '../types'
const store = useCommunityStore()
const activeSection = useSectionSpy(['messages-notices', 'messages-orders', 'messages-feedback', 'messages-reports'])
const emit = defineEmits<{ toast: [message: string]; browseOpenHelp: [] }>()
const selectedPostId = ref('')
const messageText = ref('')
const reportId = ref('')
const reportReason = ref('')
const feedbackSubject = ref('')
const feedbackContent = ref('')
const messageSearch = ref('')
const normalizedMessageSearch = computed(() => messageSearch.value.trim().toLocaleLowerCase())
function matchesMessageSearch(values: Array<string | undefined>) {
  if (!normalizedMessageSearch.value) return true
  return values.some((value) => (value ?? '').toLocaleLowerCase().includes(normalizedMessageSearch.value))
}

const demoUserId = 'SYNTH-DEMO-USER'
const visibleOrderStatuses: OrderStatus[] = [
  'accepted-local-demo',
  'completion-requested',
  'disputed-local-demo',
  'completed-local-demo',
  'cancelled-local-demo',
]
const myOrders = computed(() => store.posts
  .filter(post => post.mode === 'help'
    && post.moderation === 'approved'
    && post.publishedToFeed !== false
    && visibleOrderStatuses.includes(post.orderStatus ?? 'open')
    && (post.author.id === demoUserId || post.acceptedByMe))
  .slice()
  .sort((a, b) => (b.orderEvents?.at(-1)?.createdAt ?? b.createdAt).localeCompare(a.orderEvents?.at(-1)?.createdAt ?? a.createdAt)))
const selectedPost = computed(() => myOrders.value.find(post => post.id === selectedPostId.value))
const filteredMyOrders = computed(() => myOrders.value.filter((post) => {
  if (!normalizedMessageSearch.value) return true
  const thread = store.threads.find((item) => item.kind === 'order' && item.postId === post.id)
  return matchesMessageSearch([
    post.title,
    post.location,
    thread?.title,
    ...(thread?.messages.filter((message) => !message.hidden).map((message) => message.content) ?? []),
  ])
}))
watch([filteredMyOrders, messageSearch], () => {
  if (filteredMyOrders.value.some((post) => post.id === selectedPostId.value)) return
  selectedPostId.value = filteredMyOrders.value[0]?.id ?? ''
})
const selectedThread = computed(() => selectedPost.value ? store.threads.find(thread => thread.kind === 'order' && thread.postId === selectedPost.value?.id) : undefined)
const canComment = computed(() => {
  const status = selectedPost.value?.orderStatus
  return status === 'accepted-local-demo' || status === 'completion-requested' || status === 'disputed-local-demo'
})
const readOnlyReason = computed(() => {
  const status = selectedPost.value?.orderStatus
  if (status === 'completed-local-demo') return '该订单已完成（本机演练），订单留言只读；没有真实结算或评价。'
  if (status === 'cancelled-local-demo') return '该订单已关闭（本机演练），不能再新增留言。'
  return '当前状态下暂不能新增留言。'
})
const statusLabel = (status: OrderStatus | undefined) => ORDER_STATUS_LABELS[status ?? 'open']
const senderLabel = (sender: string) => {
  if (sender === 'system') return '系统提示'
  if (sender === 'demo-user') return '本机演练成员'
  return '合成演练对象'
}
const notifications = computed(() => store.threads
  .filter(thread => thread.kind === 'system')
  .flatMap(thread => thread.messages.map(message => ({ thread, message })))
  .slice()
  .sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt)))
const unreadCount = computed(() => store.unreadNoticeCount)
const noticeFilter = ref<'all' | 'unread'>('all')
const noticeKindFilter = ref<'all' | NoticeKind>('all')
function noticeKindOf(item: { message: { content: string; noticeKind?: NoticeKind } }): NoticeKind {
  if (item.message.noticeKind) return item.message.noticeKind
  const content = item.message.content
  if (content.includes('举报')) return 'report'
  if (content.includes('留言')) return 'message'
  if (content.includes('审核') || content.includes('下架')) return 'moderation'
  if (content.includes('订单') || content.includes('接单') || content.includes('完成')) return 'order'
  return 'system'
}
const noticeKindCounts = computed(() => {
  const counts: Record<NoticeKind, number> = { moderation: 0, order: 0, report: 0, message: 0, system: 0 }
  for (const item of notifications.value) counts[noticeKindOf(item)] += 1
  return counts
})
const filteredNotifications = computed(() => {
  const byUnread = noticeFilter.value === 'unread'
    ? notifications.value.filter((item) => isUnread(item.message.createdAt))
    : notifications.value
  const byKind = noticeKindFilter.value === 'all'
    ? byUnread
    : byUnread.filter((item) => noticeKindOf(item) === noticeKindFilter.value)
  return byKind.filter((item) => matchesMessageSearch([item.message.content, item.thread.title]))
})
const reportViewFilter = ref<'all' | 'pending' | 'resolved' | 'dismissed'>('all')
const reportViewFilters = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待处理' },
  { key: 'resolved', label: '已处理' },
  { key: 'dismissed', label: '不予支持' },
] as const
const filteredMyReports = computed(() => store.reports.filter((report) => (
  (reportViewFilter.value === 'all' || report.status === reportViewFilter.value)
  && matchesMessageSearch([report.targetId, report.reason, report.resolution, report.reporter?.name])
)))
const filteredComplaints = computed(() => store.complaints.filter((complaint) => (
  matchesMessageSearch([complaint.subject, complaint.content, complaint.statusNote])
)))
function reportViewCount(key: typeof reportViewFilter.value) {
  return key === 'all' ? store.reports.length : store.reports.filter((report) => report.status === key).length
}
function isUnread(createdAt: string) {
  const readAt = store.notificationsReadAt
  return !readAt || createdAt > readAt
}
function markRead() {
  const result = store.markNotificationsRead()
  emit('toast', result.ok ? (result.message ?? '已标记本机通知为已读。') : result.errors.join(' '))
}

function send() {
 const result = store.sendOrderMessage(selectedPostId.value, messageText.value)
 emit('toast', result.ok ? '已保存订单内留言；没有向外发送消息。' : result.errors.join(' '))
 if (result.ok) messageText.value = ''
}
function report() {
 const result = store.reportContent('message', reportId.value, reportReason.value)
 emit('toast', result.ok ? (result.message ?? '举报已进入本机审核队列。') : result.errors.join(' '))
 if(result.ok) { reportId.value = ''; reportReason.value = '' }
}
function submitFeedback() {
  const result = store.addComplaint({ subject: feedbackSubject.value, content: feedbackContent.value })
  emit('toast', result.ok ? (result.message ?? '反馈已保存在本机演练数据中。') : result.errors.join(' '))
  if (result.ok) { feedbackSubject.value = ''; feedbackContent.value = '' }
}
</script>
<template>
 <div class="page-stack messages-page">
  <section class="messages-intro"><div><span class="soft-label">MESSAGES &amp; NOTICES</span><h1>消息与通知</h1><p>通知与订单留言只保存在本机，不开放陌生人私聊。</p></div></section>
  <div class="message-warning"><p>全部为本机合成数据；没有自动回复、消息投递或真实订单。</p></div>
  <div class="message-search-row"><label class="moderation-search"><span aria-hidden="true">⌕</span><input v-model="messageSearch" type="search" placeholder="搜索订单留言、通知、反馈或举报" aria-label="搜索订单留言、通知、反馈或举报" /><button v-if="messageSearch" type="button" aria-label="清除消息搜索" @click="messageSearch = ''">×</button></label><small>过滤本页订单留言、通知、反馈与举报；不改变存档或已读状态。</small></div>
  <p class="result-status" role="status" aria-live="polite">通知 {{ filteredNotifications.length }} 条 · 订单留言 {{ filteredMyOrders.length }} 条 · 举报 {{ filteredMyReports.length }} 条</p>
  <nav class="section-jump" aria-label="消息页分区">
    <a href="#messages-notices" :class="{ active: activeSection === 'messages-notices' }" :aria-current="activeSection === 'messages-notices' ? 'true' : undefined">系统通知</a>
    <a href="#messages-orders" :class="{ active: activeSection === 'messages-orders' }" :aria-current="activeSection === 'messages-orders' ? 'true' : undefined">订单留言</a>
    <a href="#messages-feedback" :class="{ active: activeSection === 'messages-feedback' }" :aria-current="activeSection === 'messages-feedback' ? 'true' : undefined">反馈与投诉</a>
    <a href="#messages-reports" :class="{ active: activeSection === 'messages-reports' }" :aria-current="activeSection === 'messages-reports' ? 'true' : undefined">我的举报</a>
  </nav>
  <div id="messages-notices" class="notice-heading"><h2>系统通知（合成示例）</h2><div class="filter-row compact-filter notices-filter" v-tablist role="tablist" aria-label="筛选系统通知"><button v-for="filter in [{ key: 'all', label: '全部' }, { key: 'unread', label: '未读' }] as const" :key="filter.key" type="button" role="tab" :aria-selected="noticeFilter === filter.key" :class="{ active: noticeFilter === filter.key }" @click="noticeFilter = filter.key">{{ filter.label }} <small>{{ filter.key === 'all' ? notifications.length : unreadCount }}</small></button></div><span v-if="unreadCount" class="notice-unread">{{ unreadCount }} 条未读</span><button v-if="unreadCount" class="button-ghost notice-mark-read" type="button" @click="markRead">全部标为已读</button></div>
  <div class="filter-row compact-filter notice-kind-filter" v-tablist role="tablist" aria-label="按类型筛选系统通知"><button type="button" role="tab" :aria-selected="noticeKindFilter === 'all'" :class="{ active: noticeKindFilter === 'all' }" @click="noticeKindFilter = 'all'">全部类型 <small>{{ notifications.length }}</small></button><button v-for="kind in NOTICE_KINDS" :key="kind" type="button" role="tab" :aria-selected="noticeKindFilter === kind" :class="{ active: noticeKindFilter === kind }" @click="noticeKindFilter = kind">{{ NOTICE_KIND_LABELS[kind] }} <small>{{ noticeKindCounts[kind] }}</small></button></div>
  <p class="notification-caption">以下通知由本机审核与订单演练事件生成，按时间倒序；不会发送到任何外部渠道。</p>
  <article v-for="item in filteredNotifications" :key="item.message.id" class="feedback-card system-notice" :class="{ 'is-unread': isUnread(item.message.createdAt) }"><strong>{{ item.thread.title }}<span v-if="isUnread(item.message.createdAt)" class="unread-dot" aria-label="未读">●</span></strong><p>{{ item.message.content }}</p><small>{{ new Date(item.message.createdAt).toLocaleString('zh-CN') }}</small></article><p v-if="!filteredNotifications.length">当前筛选下没有通知。</p>

  <div id="messages-orders" class="section-heading"><div><span class="soft-label">ORDER THREADS</span><h2>订单内留言</h2></div><span class="demo-caption">仅本人参与的进行中订单</span></div>
  <div class="inbox-layout">
   <aside class="thread-list"><button v-for="post in filteredMyOrders" :key="post.id" :class="['thread-item', {active:selectedPostId === post.id}]" @click="selectedPostId = post.id"><span class="thread-copy"><strong>{{ post.title }}</strong><small>{{ statusLabel(post.orderStatus) }}</small></span></button><div v-if="!filteredMyOrders.length" class="empty-state compact-empty" :class="{ 'message-first-run': !myOrders.length && !normalizedMessageSearch }">
      <template v-if="!myOrders.length && !normalizedMessageSearch">
        <p class="message-first-run-label">首次使用指引</p>
        <h3 id="messages-first-run-title">订单留言会在你参与订单后出现</h3>
        <p>此页只列出你本人参与的演练订单。先到社区使用合成数据演练接单，再返回此页查看本机留言；也可发布虚构求助后由合成邻居代记录接单。不会向外发送消息。</p>
      </template>
      <p v-else-if="myOrders.length">没有匹配的订单留言。</p>
      <p v-else>当前搜索下暂无订单留言；清除搜索后可查看首次演示引导。</p>
      <button v-if="!myOrders.length" class="button-ghost" type="button" @click="emit('browseOpenHelp')">去看待接单求助</button>
    </div></aside>
   <section v-if="selectedPost" class="thread-detail">
    <header class="thread-header"><strong>{{ selectedPost.title }}</strong><span class="order-status-pill" :class="`order-status-${selectedPost.orderStatus ?? 'open'}`">{{ statusLabel(selectedPost.orderStatus) }}</span></header>
    <div class="order-thread-timeline" aria-label="订单履约演练记录">
      <p v-for="event in (selectedPost.orderEvents ?? []).slice(-4)" :key="event.id"><strong>{{ ORDER_EVENT_LABELS[event.type] }}</strong><span>{{ event.note }}</span></p>
    </div>
    <div class="chat-history">
      <article v-for="message in selectedThread?.messages.filter(m => !m.hidden) ?? []" :key="message.id" class="chat-message" :class="{ mine: message.sender === 'demo-user', automatic: message.sender === 'system' }"><div class="message-meta"><strong>{{ senderLabel(message.sender) }}</strong><time>{{ new Date(message.createdAt).toLocaleString('zh-CN') }}</time></div><p>{{ message.content }}</p><button v-if="message.sender === 'demo-user' && canComment" type="button" class="text-link" @click="reportId = message.id">举报留言</button></article>
      <p v-if="!selectedThread?.messages.some(m => !m.hidden)">还没有订单留言。</p>
    </div>
    <form v-if="canComment" class="chat-composer" @submit.prevent="send"><label class="sr-only" for="order-message">订单留言</label><textarea id="order-message" v-model="messageText" maxlength="1000" rows="2" required placeholder="只写与本订单有关的虚构信息"></textarea><button class="button-primary" :disabled="!messageText.trim()">保存订单留言</button><small>订单留言只保存在当前浏览器；审核员下架帖子后，该订单将停止留言。</small></form>
    <p v-else class="chat-readonly-note">{{ readOnlyReason }}</p>
   </section>
   <div v-else class="empty-state">选择一条本人参与的订单。</div>
  </div>
  <form v-if="reportId" class="feedback-form" @submit.prevent="report"><label class="field-label">举报订单留言 · {{ reportId }}<textarea v-model="reportReason" required maxlength="240" placeholder="请填写虚构的举报理由"></textarea></label><div class="moderation-actions"><button class="button-primary">提交本机举报</button><button type="button" class="button-ghost" @click="reportId = ''">取消</button></div></form>

  <h2 id="messages-feedback">反馈与投诉（仅本机）</h2><p class="notification-caption">反馈只保存为当前浏览器中的合成演练记录；不会提交给任何机构，也不代表已受理、已处理或会有回复。</p><form class="feedback-form" @submit.prevent="submitFeedback"><label class="field-label">反馈主题<input v-model="feedbackSubject" maxlength="120" required placeholder="例如：演练流程说明可以更清楚" /></label><label class="field-label">反馈内容<textarea v-model="feedbackContent" maxlength="2000" rows="3" required placeholder="只写虚构内容；不要填写真实姓名、电话、地址或健康信息"></textarea></label><div class="moderation-actions"><button class="button-primary" type="submit" :disabled="!feedbackSubject.trim() || !feedbackContent.trim()">保存本机反馈</button></div></form>
  <div class="my-complaints-list"><article v-for="complaint in filteredComplaints" :key="complaint.id" class="feedback-card"><strong>{{ complaint.subject }} · 仅本机</strong><p>{{ complaint.content }}</p><small>{{ new Date(complaint.createdAt).toLocaleString('zh-CN') }}</small><p>{{ complaint.statusNote }}</p></article><p v-if="!filteredComplaints.length">当前搜索下没有反馈记录。</p></div>
  <h2 id="messages-reports">我的举报</h2><div class="filter-row compact-filter my-reports-filter" v-tablist role="tablist" aria-label="筛选我的举报"><button v-for="filter in reportViewFilters" :key="filter.key" type="button" role="tab" :aria-selected="reportViewFilter === filter.key" :class="{ active: reportViewFilter === filter.key }" @click="reportViewFilter = filter.key">{{ filter.label }} <small>{{ reportViewCount(filter.key) }}</small></button></div><div class="my-reports-list"><article v-for="report in filteredMyReports" :key="report.id" class="feedback-card"><strong>{{ report.targetId }} · {{ report.status === 'pending' ? '待处理' : report.status === 'resolved' ? '已处理' : '不予支持' }}</strong><p>举报人：{{ report.reporter?.name ?? '历史举报人未记录（旧存档）' }}</p><p>{{ report.reason }}</p><p v-if="report.resolution">处理说明：{{ report.resolution }}</p></article><p v-if="!filteredMyReports.length">当前筛选下没有举报记录。</p></div>
 </div>
</template>
