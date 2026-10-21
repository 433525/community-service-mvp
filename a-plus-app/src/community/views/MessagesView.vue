<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCommunityStore } from '../store'
const store = useCommunityStore()
const emit = defineEmits<{ toast: [message: string] }>()
const selectedPostId = ref('')
const messageText = ref('')
const reportId = ref('')
const reportReason = ref('')
const myOrders = computed(() => store.posts.filter(p => p.mode === 'help' && p.moderation === 'approved' && p.publishedToFeed !== false && p.orderStatus === 'accepted-local-demo' && (p.author.id === 'SYNTH-DEMO-USER' || p.acceptedByMe)))
const selectedPost = computed(() => myOrders.value.find(p => p.id === selectedPostId.value))
const selectedThread = computed(() => selectedPost.value ? store.threads.find(t => t.kind === 'order' && t.postId === selectedPost.value?.id) : undefined)
const notifications = computed(() => store.threads.filter(t => t.kind === 'system'))
function send() {
 const result = store.sendOrderMessage(selectedPostId.value, messageText.value)
 emit('toast', result.ok ? '已保存订单内留言；没有向外发送消息。' : result.errors.join(' '))
 if (result.ok) messageText.value = ''
}
function report() {
 const result = store.reportContent('message', reportId.value, reportReason.value)
 emit('toast', result.ok ? '举报已进入本机审核队列。' : result.errors.join(' '))
 if(result.ok) { reportId.value = ''; reportReason.value = '' }
}
</script>
<template>
 <div class="page-stack messages-page">
  <section class="messages-intro"><div><span class="soft-label">ORDER MESSAGES</span><h2>订单内留言</h2><p>仅审核通过且已接单的本人订单可留言。双方演练参与者围绕服务沟通，不开放陌生人私聊。</p></div></section>
  <div class="message-warning"><p>全部为本机合成数据，没有自动回复、消息投递或真实订单。受理跟进详情可在“我的 → 服务记录”查看。</p></div>
  <div class="inbox-layout">
   <aside class="thread-list"><button v-for="post in myOrders" :key="post.id" :class="['thread-item', {active:selectedPostId === post.id}]" @click="selectedPostId = post.id"><span class="thread-copy"><strong>{{ post.title }}</strong><small>{{ post.id }}</small></span></button><div v-if="!myOrders.length" class="empty-state compact-empty">暂无可留言订单。先在社区接单一条审核通过的求助。</div></aside>
   <section v-if="selectedPost" class="thread-detail"><header class="thread-header"><strong>{{ selectedPost.title }}</strong><span>已接单 · 本机演练</span></header><div class="chat-history"><article v-for="message in selectedThread?.messages.filter(m => !m.hidden) ?? []" :key="message.id" class="chat-message mine"><div class="message-meta"><strong>演练成员</strong><time>{{ new Date(message.createdAt).toLocaleString('zh-CN') }}</time></div><p>{{ message.content }}</p><button type="button" class="text-link" @click="reportId = message.id">举报留言</button></article><p v-if="!selectedThread?.messages.some(m => !m.hidden)">还没有订单留言。</p></div><form class="chat-composer" @submit.prevent="send"><label class="sr-only" for="order-message">订单留言</label><textarea id="order-message" v-model="messageText" maxlength="1000" rows="2" required placeholder="只写与本订单有关的虚构信息"></textarea><button class="button-primary" :disabled="!messageText.trim()">保存订单留言</button><small>审核员下架帖子后，该订单将停止留言。</small></form></section>
   <div v-else class="empty-state">选择一条本人参与的订单。</div>
  </div>
  <form v-if="reportId" class="feedback-form" @submit.prevent="report"><label class="field-label">举报订单留言 · {{ reportId }}<textarea v-model="reportReason" required maxlength="240" placeholder="请填写虚构的举报理由"></textarea></label><div class="moderation-actions"><button class="button-primary">提交举报</button><button type="button" class="button-ghost" @click="reportId = ''">取消</button></div></form>
  <h2>系统通知（合成示例）</h2><article v-for="thread in notifications" :key="thread.id" class="feedback-card"><strong>{{ thread.title }}</strong><p v-for="message in thread.messages" :key="message.id">{{ message.content }}</p></article>
  <h2>我的举报</h2><article v-for="report in store.reports" :key="report.id" class="feedback-card"><strong>{{ report.targetId }} · {{ report.status === 'pending' ? '待处理' : report.status === 'resolved' ? '已处理' : '不予支持' }}</strong><p>{{ report.reason }}</p><p v-if="report.resolution">处理说明：{{ report.resolution }}</p></article><p v-if="!store.reports.length">暂无本机举报记录。</p>
 </div>
</template>
