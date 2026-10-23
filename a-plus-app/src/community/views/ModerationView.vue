<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useCommunityStore } from '../store'
import { useSectionSpy } from '../../shared/section-spy'
import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS } from '../types'
import {
  DEFAULT_MODERATION_FILTERS,
  readModerationFilters,
  writeModerationFilters,
  type AuditFilter,
  type CommentFilter,
  type ContentFilter,
  type MessageFilter,
  type ReportFilter,
} from '../moderation-filters'
const store = useCommunityStore()
const activeSection = useSectionSpy(['moderation-posts', 'moderation-comments', 'moderation-reports', 'moderation-content', 'moderation-messages', 'moderation-audit'])
const emit = defineEmits<{ toast: [message: string] }>()
const reason = ref('')
const error = ref('')
const savedFilters = readModerationFilters()
const searchTerm = ref('')
const normalizedSearch = computed(() => searchTerm.value.trim().toLocaleLowerCase())
function matchesSearch(values: Array<string | undefined>) {
  if (!normalizedSearch.value) return true
  return values.some((value) => (value ?? '').toLocaleLowerCase().includes(normalizedSearch.value))
}
const queue = computed(() => store.posts.filter(p => (p.moderation ?? 'pending') === 'pending'))
const contentFilter = ref<ContentFilter>(savedFilters.content)
const contentFilters = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审' },
  { key: 'approved', label: '通过' },
  { key: 'hidden', label: '下架' },
  { key: 'rejected', label: '驳回' },
] as const
const managedPosts = computed(() => store.posts.filter((post) => (
  (contentFilter.value === 'all' || (post.moderation ?? 'pending') === contentFilter.value)
  && matchesSearch([post.title, post.content, post.id, post.author.name, post.location])
)))
function contentCount(key: typeof contentFilter.value) {
  return key === 'all' ? store.posts.length : store.posts.filter((post) => (post.moderation ?? 'pending') === key).length
}
const allComments = computed(() => store.posts.flatMap((post) => post.comments.map((comment) => ({ post, comment }))))
const commentFilter = ref<CommentFilter>(savedFilters.comment)
const commentFilters = [
  { key: 'pending', label: '待审' },
  { key: 'approved', label: '通过' },
  { key: 'rejected', label: '驳回' },
  { key: 'hidden', label: '下架' },
  { key: 'all', label: '全部' },
] as const
const filteredComments = computed(() => allComments.value.filter((item) => (
  (commentFilter.value === 'all' || (item.comment.moderation ?? 'pending') === commentFilter.value)
  && matchesSearch([item.comment.content, item.comment.author.name, item.post.title])
)))
function commentCount(key: typeof commentFilter.value) {
  return key === 'all'
    ? allComments.value.length
    : allComments.value.filter((item) => (item.comment.moderation ?? 'pending') === key).length
}
function targetPreview(type: string, id: string) {
  if (type === 'post') { const p = store.posts.find(p => p.id === id); return p ? `${p.title}：${p.content}` : '原内容不存在' }
  if (type === 'comment') { for (const p of store.posts) { const c = p.comments.find(c => c.id === id); if(c) return `${p.title} / ${c.author.name}：${c.content}` } }
  if (type === 'message') { for (const t of store.threads) { const m = t.messages.find(m => m.id === id); if(m) return `${t.title}：${m.content}${m.hidden ? '（已下架）' : ''}` } }
  return '原内容不存在'
}
const orderMessages = computed(() => store.threads.filter(t => t.kind === 'order').flatMap(t => t.messages.map(m => ({thread:t,message:m}))))
const reportFilter = ref<ReportFilter>(savedFilters.report)
const reportFilters = [
  { key: 'pending', label: '待处理' },
  { key: 'resolved', label: '已处理' },
  { key: 'dismissed', label: '不予支持' },
  { key: 'all', label: '全部' },
] as const
const filteredReports = computed(() => store.reports.filter((report) => (
  (reportFilter.value === 'all' || report.status === reportFilter.value)
  && matchesSearch([report.reason, report.id, report.targetId, report.reporter?.name, targetPreview(report.targetType, report.targetId)])
)))
function reportCount(key: typeof reportFilter.value) {
  return key === 'all' ? store.reports.length : store.reports.filter((report) => report.status === key).length
}
const messageFilter = ref<MessageFilter>(savedFilters.message)
const auditFilter = ref<AuditFilter>(savedFilters.audit)
const auditActionFilters: Array<{ key: AuditFilter; label: string }> = [
  { key: 'all', label: '全部' },
  ...AUDIT_ACTIONS.map((action) => ({ key: action as AuditFilter, label: AUDIT_ACTION_LABELS[action] })),
]
const messageFilters = [
  { key: 'all', label: '全部' },
  { key: 'visible', label: '未下架' },
  { key: 'hidden', label: '已下架' },
] as const
const filteredOrderMessages = computed(() => orderMessages.value.filter((item) => (
  (messageFilter.value === 'all'
    || (messageFilter.value === 'hidden' ? item.message.hidden === true : item.message.hidden !== true))
  && matchesSearch([item.message.content, item.message.id, item.thread.title])
)))
function messageCount(key: typeof messageFilter.value) {
  if (key === 'all') return orderMessages.value.length
  return orderMessages.value.filter((item) => (key === 'hidden' ? item.message.hidden === true : item.message.hidden !== true)).length
}
watch([contentFilter, commentFilter, reportFilter, messageFilter, auditFilter], () => {
  writeModerationFilters({
    content: contentFilter.value,
    comment: commentFilter.value,
    report: reportFilter.value,
    message: messageFilter.value,
    audit: auditFilter.value,
  })
}, { flush: 'post' })
function resetModerationFilters() {
  contentFilter.value = DEFAULT_MODERATION_FILTERS.content
  commentFilter.value = DEFAULT_MODERATION_FILTERS.comment
  reportFilter.value = DEFAULT_MODERATION_FILTERS.report
  messageFilter.value = DEFAULT_MODERATION_FILTERS.message
  auditFilter.value = DEFAULT_MODERATION_FILTERS.audit
  searchTerm.value = ''
  emit('toast', '已重置审核筛选（仅本机偏好）')
}
const workbenchTiles = computed(() => [
  { key: 'posts' as const, label: '待审发布', value: queue.value.length },
  { key: 'comments' as const, label: '待审评论', value: commentCount('pending') },
  { key: 'reports' as const, label: '待处理举报', value: reportCount('pending') },
  { key: 'messages' as const, label: '订单留言', value: orderMessages.value.length },
])
function focusWorkbench(key: 'posts' | 'comments' | 'reports' | 'messages') {
  if (key === 'comments') commentFilter.value = 'pending'
  if (key === 'reports') reportFilter.value = 'pending'
  if (key === 'messages') messageFilter.value = 'all'
  nextTick(() => {
    const target = document.getElementById(`moderation-${key}`)
    if (!target) return
    target.scrollIntoView({ block: 'start' })
    target.focus({ preventScroll: true })
  })
}
const labels = { pending: '待处理', resolved: '已处理', dismissed: '不予支持' }
const decisions = { pending: '待审', approved: '通过', rejected: '驳回', hidden: '下架', resolved: '已处理', dismissed: '不予支持' }
const filteredAuditLog = computed(() => store.auditLog.slice().reverse().filter((entry) => (
  (auditFilter.value === 'all' || entry.action === auditFilter.value)
  && matchesSearch([
    AUDIT_ACTION_LABELS[entry.action],
    entry.targetId,
    entry.reason,
    entry.decision ? decisions[entry.decision] : '历史记录',
  ])
)))
function auditCount(key: AuditFilter) {
  return key === 'all' ? store.auditLog.length : store.auditLog.filter((entry) => entry.action === key).length
}
function run(action: () => { ok: boolean; errors: string[] }) {
  const result = action()
  error.value = result.ok ? '' : result.errors.join(' ')
  emit('toast', result.ok ? '已保存本机审核记录。' : result.errors.join(' '))
  if (result.ok) reason.value = ''
}
</script>

<template>
  <section class="page-stack moderation-page">
    <div class="publish-heading"><span class="soft-label">CONTROLLED COMMUNITY · B</span><h1>内容与举报审核</h1><p>仅合成审核员可操作。处理结果只写入本浏览器，不代表真实机构受理。</p></div>
    <div v-if="store.membership !== 'reviewer'" class="empty-state"><h3>需要切换到演练审核员</h3><p>在上方演练身份中选择审核员。身份切换用于演示流程，不是真实账号权限。</p></div>
    <template v-else>
      <section class="moderation-workbench" aria-label="审核待办概览">
        <button v-for="tile in workbenchTiles" :key="tile.key" type="button" class="workbench-tile" @click="focusWorkbench(tile.key)">
          <strong>{{ String(tile.value).padStart(2, '0') }}</strong><span>{{ tile.label }}</span><small>查看 →</small>
        </button>
      </section>
      <div class="moderation-filter-bar"><span>筛选项只记住在本机浏览器，不写入审核存档。</span><button type="button" class="button-ghost" @click="resetModerationFilters">重置筛选</button></div>
      <div class="moderation-search-row"><label class="moderation-search"><span aria-hidden="true">⌕</span><input v-model="searchTerm" type="search" placeholder="搜索内容、评论、举报、留言或审核日志" aria-label="搜索审核内容" /><button v-if="searchTerm" type="button" aria-label="清除审核搜索" @click="searchTerm = ''">×</button></label><small>搜索与状态筛选叠加生效；不会写入存档。</small></div>
      <nav class="section-jump" aria-label="审核页分区">
        <a href="#moderation-posts" :class="{ active: activeSection === 'moderation-posts' }" :aria-current="activeSection === 'moderation-posts' ? 'true' : undefined">待审发布</a>
        <a href="#moderation-comments" :class="{ active: activeSection === 'moderation-comments' }" :aria-current="activeSection === 'moderation-comments' ? 'true' : undefined">评论管理</a>
        <a href="#moderation-reports" :class="{ active: activeSection === 'moderation-reports' }" :aria-current="activeSection === 'moderation-reports' ? 'true' : undefined">举报处理</a>
        <a href="#moderation-content" :class="{ active: activeSection === 'moderation-content' }" :aria-current="activeSection === 'moderation-content' ? 'true' : undefined">内容管理</a>
        <a href="#moderation-messages" :class="{ active: activeSection === 'moderation-messages' }" :aria-current="activeSection === 'moderation-messages' ? 'true' : undefined">订单留言</a>
        <a href="#moderation-audit" :class="{ active: activeSection === 'moderation-audit' }" :aria-current="activeSection === 'moderation-audit' ? 'true' : undefined">审核日志</a>
      </nav>
      <p class="result-status" role="status" aria-live="polite">内容 {{ managedPosts.length }} 条 · 评论 {{ filteredComments.length }} 条 · 举报 {{ filteredReports.length }} 条 · 留言 {{ filteredOrderMessages.length }} 条</p>
      <label class="field-label moderation-reason">本次审核或处理理由（必填）<textarea v-model="reason" maxlength="240" rows="2" aria-required="true" :aria-invalid="Boolean(error)" placeholder="说明通过、驳回、下架或举报处理的依据；仅填虚构内容。" @input="error = ''"></textarea></label>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <h2 id="moderation-posts" tabindex="-1">待审发布 · {{ queue.length }}</h2>
      <article v-for="post in queue" :key="post.id" class="feedback-card">
        <strong>{{ post.title }}</strong><p>{{ post.content }}</p><small>{{ post.author.name }} · {{ post.location }} · {{ post.id }}</small>
        <p v-if="post.specialNote">补充：{{ post.specialNote }}</p>
        <p v-if="post.mode === 'help'">{{ post.category }} · {{ post.timeWindow }} · {{ post.duration }}</p>
        <p v-if="post.eventStartsAt">活动：{{ post.eventStartsAt }} · 名额 {{ post.eventCapacity ?? '不限' }}</p>
        <div class="moderation-actions"><button class="button-primary" @click="run(() => store.moderatePost(post.id, 'approved', reason))">通过</button><button class="button-ghost" @click="run(() => store.moderatePost(post.id, 'rejected', reason))">驳回</button></div>
      </article>
      <p v-if="!queue.length">暂无待审发布。</p>
      <div class="moderation-section-head"><h2 id="moderation-comments" tabindex="-1">评论管理 · {{ allComments.length }}</h2><div class="filter-row compact-filter comments-filter" v-tablist role="tablist" aria-label="按审核状态筛选评论"><button v-for="filter in commentFilters" :key="filter.key" type="button" role="tab" :aria-selected="commentFilter === filter.key" :class="{ active: commentFilter === filter.key }" @click="commentFilter = filter.key">{{ filter.label }} <small>{{ commentCount(filter.key) }}</small></button></div></div>
      <div class="moderation-comment-list">
      <article v-for="item in filteredComments" :key="item.comment.id" class="feedback-card">
        <strong>{{ item.post.title }} · {{ decisions[item.comment.moderation ?? 'pending'] }}</strong><p>{{ item.comment.content }}</p><small>{{ item.comment.author.name }}</small>
        <div class="moderation-actions">
          <template v-if="(item.comment.moderation ?? 'pending') === 'pending'"><button class="button-primary" @click="run(() => store.moderateComment(item.post.id, item.comment.id, 'approved', reason))">通过评论</button><button class="button-ghost" @click="run(() => store.moderateComment(item.post.id, item.comment.id, 'rejected', reason))">驳回评论</button></template>
          <button v-else-if="item.comment.moderation === 'approved'" class="button-ghost" @click="run(() => store.moderateComment(item.post.id, item.comment.id, 'hidden', reason))">下架评论</button>
          <button v-else class="button-primary" @click="run(() => store.moderateComment(item.post.id, item.comment.id, 'approved', reason))">恢复评论为通过</button>
        </div>
      </article>
      <p v-if="!filteredComments.length" class="empty-state compact-empty">当前筛选下没有评论。</p>
      </div>
      <div class="moderation-section-head"><h2 id="moderation-reports" tabindex="-1">举报处理 · {{ store.reports.filter(r => r.status === 'pending').length }} 待处理</h2><div class="filter-row compact-filter reports-filter" v-tablist role="tablist" aria-label="按处理状态筛选举报"><button v-for="filter in reportFilters" :key="filter.key" type="button" role="tab" :aria-selected="reportFilter === filter.key" :class="{ active: reportFilter === filter.key }" @click="reportFilter = filter.key">{{ filter.label }} <small>{{ reportCount(filter.key) }}</small></button></div></div>
      <div class="moderation-report-list">
      <article v-for="report in filteredReports" :key="report.id" class="feedback-card">
        <strong>{{ labels[report.status] }} · {{ report.targetType }} / {{ report.targetId }}</strong><p>举报人：{{ report.reporter?.name ?? '历史举报人未记录（旧存档）' }}</p><p>举报理由：{{ report.reason }}</p><p>被举报内容：{{ targetPreview(report.targetType, report.targetId) }}</p><p v-if="report.resolution">处理说明：{{ report.resolution }}</p>
        <template v-if="report.status === 'pending'"><div class="moderation-actions"><button class="button-primary" @click="run(() => store.resolveReport(report.id, 'resolved', reason))">记录已处理</button><button class="button-ghost" @click="run(() => store.resolveReport(report.id, 'dismissed', reason))">不予支持</button></div><small>若需要下架内容，请在下方内容管理中单独操作；记录处理结果不会自动下架。</small></template>
      </article>
      <p v-if="!filteredReports.length" class="empty-state compact-empty">当前筛选下没有举报。</p>
      </div>
      <div class="moderation-section-head"><h2 id="moderation-content" tabindex="-1">内容管理</h2><div class="filter-row moderation-filter" v-tablist role="tablist" aria-label="按审核状态筛选内容"><button v-for="filter in contentFilters" :key="filter.key" type="button" role="tab" :aria-selected="contentFilter === filter.key" :class="{ active: contentFilter === filter.key }" @click="contentFilter = filter.key">{{ filter.label }} <small>{{ contentCount(filter.key) }}</small></button></div></div>
      <div class="moderation-content-list">
      <article v-for="post in managedPosts" :key="post.id" class="feedback-card">
        <strong>{{ post.title }}</strong><p>{{ post.id }} · {{ post.moderation ?? 'pending' }} · {{ post.reviewNote }}</p>
        <div class="moderation-actions"><button v-if="post.moderation === 'approved'" class="button-ghost" @click="run(() => store.moderatePost(post.id, 'hidden', reason))">下架帖子</button><button v-if="post.moderation === 'rejected' || post.moderation === 'hidden'" class="button-primary" @click="run(() => store.moderatePost(post.id, 'approved', reason))">恢复为通过</button></div>
        <div v-for="comment in post.comments.filter(c => c.moderation === 'approved' || c.moderation === 'rejected' || c.moderation === 'hidden')" :key="comment.id"><p>{{ comment.id }} · {{ comment.content }} · {{ comment.moderation ?? 'pending' }}</p><div class="moderation-actions"><button v-if="comment.moderation === 'approved'" class="button-ghost" @click="run(() => store.moderateComment(post.id, comment.id, 'hidden', reason))">下架评论</button><button v-if="comment.moderation === 'rejected' || comment.moderation === 'hidden'" class="button-primary" @click="run(() => store.moderateComment(post.id, comment.id, 'approved', reason))">恢复评论为通过</button></div></div>
      </article>
      <p v-if="!managedPosts.length" class="empty-state compact-empty">当前筛选下没有内容。</p>
      </div>
      <div class="moderation-section-head"><h2 id="moderation-messages" tabindex="-1">订单留言管理</h2><div class="filter-row compact-filter messages-filter" v-tablist role="tablist" aria-label="按下架状态筛选订单留言"><button v-for="filter in messageFilters" :key="filter.key" type="button" role="tab" :aria-selected="messageFilter === filter.key" :class="{ active: messageFilter === filter.key }" @click="messageFilter = filter.key">{{ filter.label }} <small>{{ messageCount(filter.key) }}</small></button></div></div>
      <div class="moderation-message-list">
      <article v-for="item in filteredOrderMessages" :key="item.message.id" class="feedback-card"><strong>{{ item.thread.title }} · {{ item.message.id }}</strong><p>{{ item.message.content }}</p><p v-if="item.message.hidden">已下架 · {{ item.message.reviewNote }}</p><button v-else class="button-ghost" @click="run(() => store.hideOrderMessage(item.message.id, reason))">下架留言</button></article>
      <p v-if="!filteredOrderMessages.length" class="empty-state compact-empty">当前筛选下没有订单留言。</p>
      </div>
      <div class="moderation-section-head"><h2 id="moderation-audit" tabindex="-1">审核日志 · {{ filteredAuditLog.length }} / {{ store.auditLog.length }}</h2><div class="filter-row compact-filter audit-filter" v-tablist role="tablist" aria-label="按动作筛选审核日志"><button v-for="filter in auditActionFilters" :key="filter.key" type="button" role="tab" :aria-selected="auditFilter === filter.key" :class="{ active: auditFilter === filter.key }" @click="auditFilter = filter.key">{{ filter.label }} <small>{{ auditCount(filter.key) }}</small></button></div></div>
      <div class="moderation-audit-list">
      <article v-for="entry in filteredAuditLog" :key="entry.id" class="feedback-card"><strong>{{ AUDIT_ACTION_LABELS[entry.action] }} · {{ entry.targetId }} · {{ entry.decision ? decisions[entry.decision] : '历史记录' }}</strong><p>{{ entry.reason }}</p><small>{{ new Date(entry.createdAt).toLocaleString('zh-CN') }}</small></article>
      <p v-if="!filteredAuditLog.length" class="empty-state compact-empty">当前搜索下没有审核日志。</p>
      </div>
    </template>
  </section>
</template>
