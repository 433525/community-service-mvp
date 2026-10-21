<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { INTAKE_STORAGE_KEY } from '../../domain/intake-backup'
import { describeLatestIntakeActivity, readLocalIntakeProgress, type IntakeProgressSnapshot, type LocalIntakeProgress } from '../intake-progress'
import { useCommunityStore } from '../store'
import type { DemoThreadKind, Post } from '../types'

const emit = defineEmits<{ toast: [message: string] }>()
const store = useCommunityStore()
const activeKind = ref<'all' | DemoThreadKind | 'feedback'>('all')
const activeThreadId = ref(store.threads
  .filter((thread) => thread.kind !== 'order')
  .slice()
  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? '')
const messageText = ref('')
const complaintSubject = ref('')
const complaintContent = ref('')
const intakeProgress = ref<IntakeProgressSnapshot>({ state: 'missing', records: [] })
const demoUserId = 'SYNTH-DEMO-USER'

const filters: { key: 'all' | DemoThreadKind | 'feedback'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'system', label: '系统' },
  { key: 'order', label: '服务进度' },
  { key: 'chat', label: '演练聊天' },
  { key: 'feedback', label: '我的反馈' },
]

const visibleThreads = computed(() => store.threads
  .filter((thread) => thread.kind !== 'order')
  .filter((thread) => activeKind.value === 'all' || thread.kind === activeKind.value)
  .slice()
  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
const activeThread = computed(() => store.threads.find((thread) => thread.id === activeThreadId.value && thread.kind !== 'order') ?? null)
const visibleComplaints = computed(() => store.complaints.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const myHelpOrders = computed(() => store.posts
  .filter((post) => post.mode === 'help' && (post.author.id === demoUserId || post.acceptedByMe === true))
  .slice()
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const intakeProgressByPostId = computed(() => new Map(
  intakeProgress.value.state === 'ready'
    ? intakeProgress.value.records.map((record) => [record.sourcePostId, record] as const)
    : [],
))

function progressForPost(post: Post): LocalIntakeProgress | undefined {
  return post.author.id === demoUserId ? intakeProgressByPostId.value.get(post.id) : undefined
}

function latestProgressActivity(post: Post) {
  const progress = progressForPost(post)
  return progress ? describeLatestIntakeActivity(progress) : ''
}

function progressUpdatedAt(post: Post) {
  const progress = progressForPost(post)
  return progress ? formatProgressDate(progress.updatedAt) : ''
}

function formatProgressDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function refreshIntakeProgress() {
  intakeProgress.value = readLocalIntakeProgress()
}

function onIntakeStorageChange(event: StorageEvent) {
  if (event.key === INTAKE_STORAGE_KEY || event.key === null) refreshIntakeProgress()
}

function onWindowFocus() {
  refreshIntakeProgress()
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') refreshIntakeProgress()
}

function selectFilter(kind: 'all' | DemoThreadKind | 'feedback') {
  activeKind.value = kind
  if (kind !== 'feedback' && kind !== 'order' && !visibleThreads.value.some((thread) => thread.id === activeThreadId.value)) {
    activeThreadId.value = visibleThreads.value[0]?.id ?? ''
  }
}

onMounted(() => {
  refreshIntakeProgress()
  window.addEventListener('storage', onIntakeStorageChange)
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('storage', onIntakeStorageChange)
  window.removeEventListener('focus', onWindowFocus)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

function sendMessage() {
  if (!activeThread.value || !messageText.value.trim()) return
  const result = store.sendDemoChatMessage(activeThread.value.id, messageText.value)
  if (!result.ok) {
    emit('toast', result.errors.join(' '))
    return
  }
  messageText.value = ''
  emit('toast', '消息仅写入本机演练数据；自动回复也是虚构内容。')
}

function submitComplaint() {
  const result = store.addComplaint({ subject: complaintSubject.value, content: complaintContent.value })
  if (!result.ok) {
    emit('toast', result.errors.join(' '))
    return
  }
  complaintSubject.value = ''
  complaintContent.value = ''
  emit('toast', result.message ?? '反馈已保存在本机演练数据中。')
}

function senderLabel(sender: string) {
  if (sender === 'demo-user') return '演练用户'
  if (sender === 'synthetic-contact') return '虚构邻居'
  if (sender === 'synthetic-auto-reply') return '合成自动回复'
  return '演练通知'
}

function timeLabel(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="page-stack messages-page">
    <section class="messages-intro">
      <div><span class="soft-label">KEEP THE LOOP LOCAL</span><h2>消息与服务进度</h2><p>查看本机求助进度、预置演练消息，或试写一条虚构对话。</p></div>
      <div class="message-orbit" aria-hidden="true"><span>✉</span><i></i><b></b></div>
    </section>

    <div class="message-warning"><span>i</span><p><strong>只在本机演练</strong> · 不向居民、志愿者或机构发送消息；反馈不会提交或被处理。</p></div>

    <div class="message-filter" role="tablist" aria-label="消息分类">
      <button v-for="filter in filters" :key="filter.key" type="button" role="tab" :aria-selected="activeKind === filter.key" :class="{ selected: activeKind === filter.key }" @click="selectFilter(filter.key)">{{ filter.label }}<span v-if="filter.key === 'feedback'"> {{ store.complaints.length }}</span></button>
    </div>

    <section v-if="activeKind === 'feedback'" class="feedback-layout">
      <form class="feedback-form" @submit.prevent="submitComplaint">
        <div class="section-heading"><div><span class="soft-label">LOCAL FEEDBACK</span><h2>演练反馈</h2></div><span class="demo-caption">仅本机留存</span></div>
        <label class="field-label">反馈主题 <span>*</span><input v-model="complaintSubject" maxlength="120" required placeholder="例如：服务说明需要更清楚" /></label>
        <label class="field-label">反馈内容 <span>*</span><textarea v-model="complaintContent" rows="4" maxlength="2000" required placeholder="请使用虚构内容，不要填写真实个人信息。"></textarea></label>
        <button class="button-primary" type="submit">保存演练反馈 <span>↗</span></button>
        <p class="form-privacy">保存后仅在本机显示“未提交”。不会发送给社区或任何处理方。</p>
      </form>
      <div class="feedback-list">
        <div class="section-heading"><div><span class="soft-label">YOUR NOTES</span><h2>本地记录</h2></div></div>
        <article v-for="item in visibleComplaints" :key="item.id" class="feedback-card">
          <div><strong>{{ item.subject }}</strong><time>{{ timeLabel(item.createdAt) }}</time></div>
          <p>{{ item.content }}</p>
          <span class="local-status"><i></i>本机保存 · 未提交</span>
        </article>
        <div v-if="!visibleComplaints.length" class="empty-state compact-empty">还没有演练反馈。</div>
      </div>
    </section>

    <section v-else-if="activeKind === 'order'" class="messages-progress-list" aria-live="polite">
      <div class="intake-progress-panel">
        <div class="intake-progress-panel-copy">
          <strong>A+ 受理进度（本机只读演练）</strong>
          <p v-if="intakeProgress.state === 'missing'">还没有 A+ 受理演练存档；求助可在工作台手动登记。</p>
          <p v-else-if="intakeProgress.state === 'unavailable'">A+ 存档暂不可读取，受理状态未显示；请在工作台处理存档后再返回。</p>
          <p v-else>工作台变更会在切回本页时重新读取；此处不显示内部备注或联系方式。</p>
        </div>
        <button class="button-ghost intake-progress-refresh" type="button" @click="refreshIntakeProgress">刷新进度</button>
      </div>
      <article v-for="post in myHelpOrders" :key="post.id" class="service-record-row">
        <div class="record-status" :class="{ done: post.orderStatus === 'accepted-local-demo' }"><i></i>{{ post.acceptedByMe ? '我演练接单' : post.orderStatus === 'accepted-local-demo' ? '已有人演练接单' : '等待演练接单' }}</div>
        <strong>{{ post.title }}</strong>
        <p>{{ post.timeWindow || '登记时段未填写' }} · {{ post.duration || '时长待确认' }}</p>
        <div v-if="progressForPost(post)" class="intake-progress-detail">
          <span class="intake-status-pill">{{ progressForPost(post)?.status }}</span>
          <p>{{ latestProgressActivity(post) }}</p>
          <small>最近更新 {{ progressUpdatedAt(post) }}</small>
        </div>
        <p v-else-if="post.author.id === demoUserId && intakeProgress.state === 'ready'" class="intake-progress-empty">工作台尚无匹配记录；可从社区求助中手动导入。</p>
        <small>所有状态仅为本机演练，不代表真实通知、派单或履约。</small>
      </article>
      <div v-if="!myHelpOrders.length" class="empty-state compact-empty"><h3>暂无服务进度</h3><p>发布一条合成求助后，可以在这里查看本机演练状态。</p></div>
    </section>

    <section v-else class="inbox-layout">
      <aside class="thread-list" aria-label="消息会话">
        <button v-for="thread in visibleThreads" :key="thread.id" type="button" :class="['thread-item', { active: activeThreadId === thread.id }]" @click="activeThreadId = thread.id">
          <span class="thread-avatar" :class="`thread-${thread.kind}`">{{ thread.kind === 'system' ? '✳' : thread.kind === 'order' ? '↗' : '南' }}</span>
          <span class="thread-copy"><strong>{{ thread.title }}</strong><small>{{ thread.messages.at(-1)?.content ?? '暂无消息' }}</small></span>
          <time>{{ timeLabel(thread.updatedAt) }}</time>
        </button>
        <div v-if="!visibleThreads.length" class="empty-state compact-empty">该分类下暂无演练消息。</div>
      </aside>

      <section v-if="activeThread" class="thread-detail" aria-label="消息内容">
        <header class="thread-header"><span><strong>{{ activeThread.title }}</strong><small>虚构会话 · {{ activeThread.kind === 'chat' ? '本机消息演练' : '只读预置通知' }}</small></span><span class="local-status"><i></i>本地</span></header>
        <div class="thread-notice">以下内容均为合成演练数据，不代表真实订单状态、通知或对话。</div>
        <div class="chat-history" aria-live="polite">
          <article v-for="message in activeThread.messages" :key="message.id" :class="['chat-message', { mine: message.sender === 'demo-user', automatic: message.automaticReply }]">
            <div class="message-meta"><strong>{{ senderLabel(message.sender) }}</strong><time>{{ timeLabel(message.createdAt) }}</time></div>
            <p>{{ message.content }}</p>
          </article>
        </div>
        <form v-if="activeThread.kind === 'chat'" class="chat-composer" @submit.prevent="sendMessage">
          <label class="sr-only" for="demo-message">输入演练消息</label><textarea id="demo-message" v-model="messageText" rows="2" maxlength="1000" placeholder="写一条虚构演练消息…"></textarea>
          <button class="button-primary" type="submit" :disabled="!messageText.trim()">本机发送 <span>↗</span></button>
          <small>自动回复由本地演示规则生成，不会联系真实的人。</small>
        </form>
        <div v-else class="read-only-note">系统与进度消息为只读示例；需要真实服务时请使用已获授权的运营渠道。</div>
      </section>
      <div v-else class="empty-state thread-empty"><span class="empty-icon">▤</span><h3>没有可显示的会话</h3><p>切换分类查看其他演练消息。</p></div>
    </section>
  </div>
</template>
