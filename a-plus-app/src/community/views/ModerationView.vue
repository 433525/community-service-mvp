<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCommunityStore } from '../store'
const store = useCommunityStore()
const emit = defineEmits<{ toast: [message: string] }>()
const reason = ref('')
const queue = computed(() => store.posts.filter(p => (p.moderation ?? 'pending') === 'pending'))
const comments = computed(() => store.posts.flatMap(p => p.comments.filter(c => (c.moderation ?? 'pending') === 'pending').map(c => ({ post: p, comment: c }))))
function targetPreview(type: string, id: string) {
  if (type === 'post') { const p = store.posts.find(p => p.id === id); return p ? `${p.title}：${p.content}` : '原内容不存在' }
  if (type === 'comment') { for (const p of store.posts) { const c = p.comments.find(c => c.id === id); if(c) return `${p.title} / ${c.author.name}：${c.content}` } }
  if (type === 'message') { for (const t of store.threads) { const m = t.messages.find(m => m.id === id); if(m) return `${t.title}：${m.content}${m.hidden ? '（已下架）' : ''}` } }
  return '原内容不存在'
}
const orderMessages = computed(() => store.threads.filter(t => t.kind === 'order').flatMap(t => t.messages.map(m => ({thread:t,message:m}))))
const labels = { pending: '待处理', resolved: '已处理', dismissed: '不予支持' }
const decisions = { pending: '待审', approved: '通过', rejected: '驳回', hidden: '下架', resolved: '已处理', dismissed: '不予支持' }
function run(action: () => { ok: boolean; errors: string[] }) {
  const result = action()
  emit('toast', result.ok ? '已保存本机审核记录。' : result.errors.join(' '))
  if (result.ok) reason.value = ''
}
</script>

<template>
  <section class="page-stack moderation-page">
    <div class="publish-heading"><span class="soft-label">CONTROLLED COMMUNITY · B</span><h2>内容与举报审核</h2><p>仅合成审核员可操作。处理结果只写入本浏览器，不代表真实机构受理。</p></div>
    <div v-if="store.membership !== 'reviewer'" class="empty-state"><h3>需要切换到演练审核员</h3><p>在上方演练身份中选择审核员。身份切换用于演示流程，不是真实账号权限。</p></div>
    <template v-else>
      <label class="field-label moderation-reason">本次审核或处理理由（必填）<textarea v-model="reason" maxlength="240" rows="2" placeholder="说明通过、驳回、下架或举报处理的依据；仅填虚构内容。"></textarea></label>
      <h2>待审发布 · {{ queue.length }}</h2>
      <article v-for="post in queue" :key="post.id" class="feedback-card">
        <strong>{{ post.title }}</strong><p>{{ post.content }}</p><small>{{ post.author.name }} · {{ post.location }} · {{ post.id }}</small>
        <p v-if="post.specialNote">补充：{{ post.specialNote }}</p>
        <p v-if="post.mode === 'help'">{{ post.category }} · {{ post.timeWindow }} · {{ post.duration }}</p>
        <p v-if="post.eventStartsAt">活动：{{ post.eventStartsAt }} · 名额 {{ post.eventCapacity ?? '不限' }}</p>
        <div class="moderation-actions"><button class="button-primary" @click="run(() => store.moderatePost(post.id, 'approved', reason))">通过</button><button class="button-ghost" @click="run(() => store.moderatePost(post.id, 'rejected', reason))">驳回</button></div>
      </article>
      <p v-if="!queue.length">暂无待审发布。</p>
      <h2>待审评论 · {{ comments.length }}</h2>
      <article v-for="item in comments" :key="item.comment.id" class="feedback-card">
        <strong>{{ item.post.title }}</strong><p>{{ item.comment.content }}</p><small>{{ item.comment.author.name }}</small>
        <div class="moderation-actions"><button class="button-primary" @click="run(() => store.moderateComment(item.post.id, item.comment.id, 'approved', reason))">通过评论</button><button class="button-ghost" @click="run(() => store.moderateComment(item.post.id, item.comment.id, 'rejected', reason))">驳回评论</button></div>
      </article>
      <h2>举报处理 · {{ store.reports.filter(r => r.status === 'pending').length }} 待处理</h2>
      <article v-for="report in store.reports" :key="report.id" class="feedback-card">
        <strong>{{ labels[report.status] }} · {{ report.targetType }} / {{ report.targetId }}</strong><p>举报理由：{{ report.reason }}</p><p>被举报内容：{{ targetPreview(report.targetType, report.targetId) }}</p><p v-if="report.resolution">处理说明：{{ report.resolution }}</p>
        <template v-if="report.status === 'pending'"><div class="moderation-actions"><button class="button-primary" @click="run(() => store.resolveReport(report.id, 'resolved', reason))">记录已处理</button><button class="button-ghost" @click="run(() => store.resolveReport(report.id, 'dismissed', reason))">不予支持</button></div><small>若需要下架内容，请在下方内容管理中单独操作；记录处理结果不会自动下架。</small></template>
      </article>
      <h2>内容管理</h2>
      <article v-for="post in store.posts" :key="post.id" class="feedback-card">
        <strong>{{ post.title }}</strong><p>{{ post.id }} · {{ post.moderation ?? 'pending' }} · {{ post.reviewNote }}</p>
        <button v-if="post.moderation === 'approved'" class="button-ghost" @click="run(() => store.moderatePost(post.id, 'hidden', reason))">下架帖子</button>
        <div v-for="comment in post.comments.filter(c => c.moderation === 'approved')" :key="comment.id"><p>{{ comment.id }} · {{ comment.content }}</p><button class="button-ghost" @click="run(() => store.moderateComment(post.id, comment.id, 'hidden', reason))">下架评论</button></div>
      </article>
      <h2>订单留言管理</h2><article v-for="item in orderMessages" :key="item.message.id" class="feedback-card"><strong>{{ item.thread.title }} · {{ item.message.id }}</strong><p>{{ item.message.content }}</p><p v-if="item.message.hidden">已下架 · {{ item.message.reviewNote }}</p><button v-else class="button-ghost" @click="run(() => store.hideOrderMessage(item.message.id, reason))">下架留言</button></article>
      <h2>审核日志 · {{ store.auditLog.length }}</h2>
      <article v-for="entry in store.auditLog.slice().reverse()" :key="entry.id" class="feedback-card"><strong>{{ entry.action }} · {{ entry.targetId }} · {{ entry.decision ? decisions[entry.decision] : '历史记录' }}</strong><p>{{ entry.reason }}</p><small>{{ new Date(entry.createdAt).toLocaleString('zh-CN') }}</small></article>
    </template>
  </section>
</template>
