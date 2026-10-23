<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { INTAKE_STORAGE_KEY } from '../../domain/intake-backup'
import { describeLatestIntakeActivity, readLocalIntakeProgress, type IntakeProgressSnapshot, type LocalIntakeProgress } from '../intake-progress'
import { useCommunityStore } from '../store'
import {
  ORDER_EVENT_ACTOR_LABELS,
  ORDER_EVENT_LABELS,
  ORDER_STATUS_LABELS,
  type Post,
} from '../types'
import PostCard from '../components/PostCard.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const emit = defineEmits<{ toast: [message: string]; navigate: [tab: 'community' | 'messages' | 'profile']; browseOpenHelp: []; openPost: [id: string] }>()
const store = useCommunityStore()
const activeSection = ref<'posts' | 'favorites' | 'ledger' | 'orders' | 'activities'>('posts')
const demoUserId = 'SYNTH-DEMO-USER'
const intakeProgress = ref<IntakeProgressSnapshot>({ state: 'missing', records: [] })
const myPosts = computed(() => store.posts.filter((post) => post.author.id === demoUserId).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const myComments = computed(() => store.posts.flatMap(post => post.comments.filter(comment => comment.author.id === demoUserId).map(comment => ({ post, comment }))))
const moderationLabels = { pending: '待审核', approved: '审核通过', rejected: '已驳回', hidden: '已下架' }
const favoritePosts = computed(() => store.visiblePosts.filter((post) => post.favorited).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const myOrders = computed(() => store.posts
  .filter((post) => post.mode === 'help' && (post.author.id === demoUserId || post.acceptedByMe === true))
  .slice()
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
type OrderFilterKey = 'all' | 'active' | 'completed' | 'closed' | 'feedback'
const orderFilter = ref<OrderFilterKey>('all')
const orderFilters: { key: OrderFilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'completed', label: '已完成' },
  { key: 'closed', label: '已关闭' },
  { key: 'feedback', label: '有体验' },
]
const feedbackOrders = computed(() => myOrders.value.filter((post) => post.orderFeedback))
const feedbackAverage = computed(() => feedbackOrders.value.length
  ? (feedbackOrders.value.reduce((sum, post) => sum + (post.orderFeedback?.rating ?? 0), 0) / feedbackOrders.value.length).toFixed(1)
  : '—')
const feedbackDistribution = computed(() => [5, 4, 3, 2, 1].map((rating) => ({
  rating,
  count: feedbackOrders.value.filter((post) => post.orderFeedback?.rating === rating).length,
})))
function orderBucket(post: Post): Exclude<OrderFilterKey, 'all' | 'feedback'> {
  if (post.orderStatus === 'completed-local-demo') return 'completed'
  if (post.orderStatus === 'cancelled-local-demo') return 'closed'
  return 'active'
}
const orderFilterCounts = computed(() => {
  const counts: Record<OrderFilterKey, number> = {
    all: myOrders.value.length,
    active: 0,
    completed: 0,
    closed: 0,
    feedback: feedbackOrders.value.length,
  }
  for (const post of myOrders.value) counts[orderBucket(post)] += 1
  return counts
})
const filteredOrders = computed(() => {
  if (orderFilter.value === 'all') return myOrders.value
  if (orderFilter.value === 'feedback') return feedbackOrders.value
  return myOrders.value.filter((post) => orderBucket(post) === orderFilter.value)
})
const expandedOrders = ref<Record<string, boolean>>({})
function visibleOrderEvents(post: Post) {
  const events = post.orderEvents ?? []
  return expandedOrders.value[post.id] ? events : events.slice(-3)
}
function toggleOrderEvents(postId: string) {
  expandedOrders.value = { ...expandedOrders.value, [postId]: !expandedOrders.value[postId] }
}
const myMinutes = computed(() => store.ledger.reduce((sum, entry) => sum + entry.minutes, 0))
const myActivities = computed(() => store.posts
  .filter((post) => post.mode === 'volunteer' && post.volunteerKind === 'activity' && post.signedUpByMe === true)
  .slice()
  .sort((a, b) => (a.eventStartsAt ?? a.createdAt).localeCompare(b.eventStartsAt ?? b.createdAt)))
const intakeProgressByPostId = computed(() => new Map(
  intakeProgress.value.state === 'ready'
    ? intakeProgress.value.records.map((record) => [record.sourcePostId, record] as const)
    : [],
))

const sections = [
  { key: 'posts', label: '我的发布' },
  { key: 'favorites', label: '我的收藏' },
  { key: 'orders', label: '服务记录' },
  { key: 'activities', label: '我的活动' },
  { key: 'ledger', label: '时间账本' },
] as const

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours ? `${hours} 小时${remainder ? ` ${remainder} 分` : ''}` : `${remainder} 分钟`
}

function statusLabel(post: Post) {
  if ((post.moderation ?? 'pending') === 'pending') return '待审核，尚未公开'
  if (post.moderation === 'rejected') return '审核未通过'
  if (post.moderation === 'hidden') return '已下架'
  if (post.mode !== 'help') return '普通动态'
  if (post.orderStatus) return ORDER_STATUS_LABELS[post.orderStatus]
  return '等待演练接单'
}

function formatProgressDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatActivityTime(value?: string) {
  if (!value) return '时间待定'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间待定'
    : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function activityState(post: Post) {
  if ((post.moderation ?? 'pending') !== 'approved') return moderationLabels[post.moderation ?? 'pending']
  if (post.publishedToFeed === false) return '仅自己可见'
  return '已演练报名'
}

function cancelActivity(post: Post) {
  const result = store.cancelEventSignup(post.id)
  emit('toast', result.ok ? (result.message ?? '已取消本机演练报名。') : result.errors.join(' '))
}

function progressForPost(post: Post): LocalIntakeProgress | undefined {
  if (post.author.id !== demoUserId) return undefined
  return intakeProgressByPostId.value.get(post.id)
}

function latestProgressActivity(post: Post) {
  const progress = progressForPost(post)
  return progress ? describeLatestIntakeActivity(progress) : ''
}

function progressUpdatedAt(post: Post) {
  const progress = progressForPost(post)
  return progress ? formatProgressDate(progress.updatedAt) : ''
}

function refreshIntakeProgress(showNotice = false) {
  intakeProgress.value = readLocalIntakeProgress()
  if (showNotice) emit('toast', '已重新读取当前浏览器中的本机受理演练进度。')
}

function onIntakeStorageChange(event: StorageEvent) {
  if (event.key === INTAKE_STORAGE_KEY || event.key === null) refreshIntakeProgress()
}

function onIntakeWindowFocus() {
  refreshIntakeProgress()
}

function onIntakeVisibilityChange() {
  if (document.visibilityState === 'visible') refreshIntakeProgress()
}

onMounted(() => {
  refreshIntakeProgress()
  window.addEventListener('storage', onIntakeStorageChange)
  window.addEventListener('focus', onIntakeWindowFocus)
  document.addEventListener('visibilitychange', onIntakeVisibilityChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('storage', onIntakeStorageChange)
  window.removeEventListener('focus', onIntakeWindowFocus)
  document.removeEventListener('visibilitychange', onIntakeVisibilityChange)
})

function reloadData() {
  const result = store.reloadFromStorage()
  emit('toast', result.ok ? (result.message ?? '已重新载入最新存档。') : result.errors.join(' '))
}

function downloadUnreadableData() {
  const raw = store.unreadableStoredData
  if (raw === null) return

  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `community-unreadable-local-save-${new Date().toISOString().slice(0, 10)}.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  emit('toast', '已下载原始存档；请妥善保存后再决定是否重置。')
}

const resetDialog = ref<{ open: boolean; unreadable: boolean }>({ open: false, unreadable: false })

function resetData() {
  const hasUnreadableData = store.storageStatus === 'recovery-required' || store.unreadableStoredData !== null
  resetDialog.value = { open: true, unreadable: hasUnreadableData }
}

function cancelReset() {
  resetDialog.value = { open: false, unreadable: false }
}

function confirmReset() {
  const unreadable = resetDialog.value.unreadable
  cancelReset()
  const result = store.resetDemoData()
  if (!result.ok) {
    emit('toast', result.errors.join(' '))
    return
  }
  emit('toast', result.message ?? (unreadable ? '已覆盖损坏存档并恢复初始演示数据。' : '已恢复演示数据。'))
}

const backupOpen = ref(false)
const backupText = ref('')

function toggleBackup() {
  if (!backupOpen.value) backupText.value = store.readBackupJson()
  backupOpen.value = !backupOpen.value
}

function selectBackup(event: FocusEvent) {
  (event.target as HTMLTextAreaElement | null)?.select()
}

async function copyBackup() {
  try {
    await navigator.clipboard.writeText(backupText.value)
    emit('toast', '已复制本机存档 JSON；其中只有合成演练数据。')
  } catch {
    emit('toast', '复制失败：请在下框内全选后手动复制。')
  }
}
</script>

<template>
  <div class="page-stack profile-page">
    <section class="profile-hero">
      <div class="profile-avatar">禾</div>
      <div class="profile-intro"><span class="soft-label">YOUR LOCAL SPACE</span><h1>演练居民·禾禾</h1><p>虚构演练用户 · 青禾里（虚构）</p><span class="profile-tag"><i></i>合成资料</span></div>
      <div class="profile-illustration" aria-hidden="true"><span>✳</span><i></i><b></b></div>
    </section>

    <section class="profile-stat-grid" aria-label="演练数据统计">
      <div><strong>{{ myPosts.length.toString().padStart(2, '0') }}</strong><span>我的发布</span></div>
      <div><strong>{{ favoritePosts.length.toString().padStart(2, '0') }}</strong><span>收藏动态</span></div>
      <div><strong>{{ myOrders.length.toString().padStart(2, '0') }}</strong><span>服务记录</span></div>
      <div><strong>{{ formatMinutes(myMinutes) }}</strong><span>账本演示时长</span></div>
    </section>

    <section class="profile-storage-card" :class="{ 'is-conflict': store.storageStatus === 'conflict' }">
      <div class="storage-icon" aria-hidden="true">▣</div>
      <div><strong>本机演练存档</strong><p v-if="store.storageStatus === 'saved'">已保存到当前浏览器。换浏览器或清理数据后不会自动迁移。</p><p v-else-if="store.storageStatus === 'conflict'">检测到其他标签页更新了本机存档。为避免覆盖较新的状态，已停止写入；请重新载入最新存档后再继续。</p><p v-else-if="store.storageStatus === 'recovery-required'">存档需要处理，原始内容已保留；当前不能写入。</p><p v-else-if="store.storageStatus === 'save-error'">最近一次写入失败，界面保留上一次成功保存的状态。</p><p v-else-if="store.storageStatus === 'memory-only'">当前只能保存在本次会话，刷新后可能丢失。</p><p v-else>首次使用；修改后保存在当前浏览器的本机演练数据中。</p><p v-if="store.storageError && (store.storageStatus === 'save-error' || store.storageStatus === 'recovery-required')" class="storage-error-detail">{{ store.storageError }}</p><button v-if="store.storageStatus === 'recovery-required' && store.unreadableStoredData" type="button" class="button-ghost storage-reload" @click="downloadUnreadableData">下载原始存档</button><button v-if="store.storageStatus === 'conflict'" type="button" class="button-ghost storage-reload" @click="reloadData">重新载入</button><button type="button" class="button-ghost storage-reload" @click="toggleBackup">{{ backupOpen ? '收起存档 JSON' : '查看存档 JSON' }}</button></div>
      <button type="button" class="text-link" @click="resetData">重置演练数据</button>
    </section>

    <section v-if="backupOpen" class="profile-backup-panel">
      <div class="backup-panel-head"><strong>本机存档 JSON（只读快照）</strong><span>仅含虚构演练数据，打开面板时生成；可直接留存或人工检查，不会上传。</span></div>
      <textarea class="backup-textarea" readonly :value="backupText" rows="10" spellcheck="false" aria-label="本机演练存档 JSON 只读内容" @focus="selectBackup"></textarea>
      <div class="moderation-actions"><button type="button" class="button-primary" @click="copyBackup">复制 JSON</button><button type="button" class="button-ghost" @click="backupOpen = false">收起</button></div>
    </section>

    <section class="profile-content-section">
      <div class="profile-tabs" v-tablist role="tablist" aria-label="个人内容">
        <button v-for="section in sections" :key="section.key" type="button" role="tab" :aria-selected="activeSection === section.key" :class="{ selected: activeSection === section.key }" @click="activeSection = section.key">{{ section.label }}<span v-if="section.key === 'posts'">{{ myPosts.length }}</span><span v-else-if="section.key === 'favorites'">{{ favoritePosts.length }}</span><span v-else-if="section.key === 'orders'">{{ myOrders.length }}</span><span v-else-if="section.key === 'activities'">{{ myActivities.length }}</span><span v-else>{{ store.ledger.length }}</span></button>
      </div>

      <div v-if="activeSection === 'posts'" class="profile-post-list">
        <article v-for="post in myPosts" :key="post.id" class="profile-post-row">
          <div class="profile-post-icon" :class="`kind-${post.mode}`">{{ post.mode === 'help' ? '↗' : post.mode === 'volunteer' ? '✳' : '⌂' }}</div>
          <div><strong>{{ post.title }}</strong><p>{{ post.mode === 'volunteer' && post.volunteerKind === 'activity' ? '志愿活动' : post.mode === 'volunteer' ? '志愿记录' : post.mode === 'help' ? '通用求助登记' : '邻里分享' }} · {{ post.publishedToFeed === false ? '仅自己可见' : post.moderation === 'approved' ? '社区动态可见' : '未公开' }} · {{ statusLabel(post) }}</p><p v-if="post.reviewNote">审核说明：{{ post.reviewNote }}</p></div>
          <span class="post-date">{{ new Date(post.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) }}</span>
        </article>
        <div v-if="!myPosts.length" class="empty-state compact-empty"><h3>还没有发布内容</h3><p>发布的演练内容会显示在这里。</p></div>
        <h3>我的评论</h3>
        <article v-for="item in myComments" :key="item.comment.id" class="feedback-card"><strong>{{ item.post.title }} · {{ moderationLabels[item.comment.moderation ?? 'pending'] }}</strong><p>{{ item.comment.content }}</p><p v-if="item.comment.reviewNote">审核说明：{{ item.comment.reviewNote }}</p></article>
        <p v-if="!myComments.length">暂无本机评论记录。</p>
      </div>

      <div v-else-if="activeSection === 'favorites'" class="feed-list profile-favorites">
        <PostCard v-for="post in favoritePosts" :key="post.id" :post="post" @toast="emit('toast', $event)" />
        <div v-if="!favoritePosts.length" class="empty-state compact-empty"><h3>还没有收藏</h3><p>在社区动态中点选星标后，会显示在这里。</p><button class="button-ghost" type="button" @click="emit('navigate', 'community')">去社区看看</button></div>
      </div>

      <div v-else-if="activeSection === 'orders'" class="profile-post-list">
        <section class="intake-progress-panel" aria-live="polite">
          <div class="intake-progress-panel-copy">
            <strong>A+ 受理进度（本机演练）</strong>
            <p v-if="intakeProgress.state === 'missing'">还没有检测到 A+ 受理演练存档。发布求助后，需要在工作台手动导入并登记。</p>
            <p v-else-if="intakeProgress.state === 'unavailable'">工作台存档暂时不可读取，进度未显示。请在工作台处理存档后再刷新；本页不会修改或覆盖它。</p>
            <p v-else>只读当前浏览器中与本人求助对应的受理演练记录；切回本页或刷新时会重新读取。</p>
          </div>
          <button class="button-ghost intake-progress-refresh" type="button" @click="refreshIntakeProgress(true)">刷新进度</button>
        </section>
        <p v-if="feedbackOrders.length" class="service-feedback-summary">本机体验记录 {{ feedbackOrders.length }} 条 · 平均 {{ feedbackAverage }} 星；仅当前浏览器，不参与真实评价或信誉。</p>
        <div v-if="feedbackOrders.length" class="feedback-distribution" aria-label="体验评分分布">
          <span v-for="row in feedbackDistribution" :key="row.rating"><b>{{ row.rating }}★</b> {{ row.count }}</span>
        </div>
        <div class="profile-order-filter" role="group" aria-label="服务记录筛选">
          <button v-for="filter in orderFilters" :key="filter.key" type="button" :aria-pressed="orderFilter === filter.key" :class="{ selected: orderFilter === filter.key }" @click="orderFilter = filter.key">{{ filter.label }}<span>{{ orderFilterCounts[filter.key] }}</span></button>
        </div>
        <article v-for="post in filteredOrders" :key="post.id" class="service-record-row">
          <div class="record-status" :class="{ done: post.orderStatus === 'completed-local-demo' }"><i></i>{{ post.acceptedByMe ? '我接单' : '我发布' }} · {{ statusLabel(post) }}</div>
          <strong>{{ post.title }}</strong>
          <p>{{ post.timeWindow || '登记时段未填写' }} · {{ post.duration || '时长待确认' }}</p>
          <div v-if="post.orderEvents?.length" class="order-event-mini-list" aria-label="订单履约演练记录">
            <p v-for="event in visibleOrderEvents(post)" :key="event.id"><span>{{ ORDER_EVENT_LABELS[event.type] }}</span> · {{ ORDER_EVENT_ACTOR_LABELS[event.actor] }}<template v-if="event.note"> · {{ event.note }}</template></p>
            <button v-if="(post.orderEvents?.length ?? 0) > 3" type="button" class="text-link order-event-more" @click="toggleOrderEvents(post.id)">{{ expandedOrders[post.id] ? '收起记录' : `展开全部 ${post.orderEvents?.length} 条记录` }}</button>
          </div>
          <div v-if="progressForPost(post)" class="intake-progress-detail">
            <span class="intake-status-pill">{{ progressForPost(post)?.status }}</span>
            <p>{{ latestProgressActivity(post) }}</p>
            <small>最近更新 {{ progressUpdatedAt(post) }}</small>
          </div>
          <p v-else-if="post.author.id === demoUserId && intakeProgress.state === 'ready'" class="intake-progress-empty">尚无匹配的工作台受理记录；可到工作台从社区求助中手动导入。</p>
          <small v-if="post.orderStatus === 'completed-local-demo'">本机演练完成已在时间账本生成“未结算”记录；没有真实结算、评价或双方确认。</small>
          <p v-if="post.orderFeedback" class="service-feedback">本机体验记录：{{ '★'.repeat(post.orderFeedback.rating) }}<span v-if="post.orderFeedback.note"> · {{ post.orderFeedback.note }}</span></p>
          <small v-else>状态只用于本机流程演示，不代表真实接单、派单或履约。</small>
          <button v-if="post.orderStatus === 'completion-requested' && post.moderation === 'approved'" type="button" class="button-ghost profile-order-action" @click="emit('openPost', post.id)">去社区动态处理</button>
          <p v-if="post.moderation === 'hidden'" class="intake-progress-empty">该求助已被审核下架，本机订单演练已停止；没有真实服务或结算发生。</p>
        </article>
        <div v-if="!filteredOrders.length" class="empty-state compact-empty"><h3>{{ myOrders.length ? '当前筛选下没有服务记录' : '暂无服务记录' }}</h3><p>{{ myOrders.length ? '换一个筛选条件查看其他存量的本机演练记录。' : '发布求助或接单演练后，记录会显示在这里。' }}</p><button class="button-ghost" type="button" @click="emit('browseOpenHelp')">去看看待接单求助</button></div>
      </div>

      <div v-else-if="activeSection === 'activities'" class="profile-post-list">
        <article v-for="post in myActivities" :key="post.id" class="service-record-row">
          <div class="record-status" :class="{ done: post.moderation === 'approved' }"><i></i>志愿活动 · {{ activityState(post) }}</div>
          <strong>{{ post.title }}</strong>
          <p>{{ formatActivityTime(post.eventStartsAt) }} · {{ post.location }}</p>
          <p>报名 {{ post.eventSignupCount ?? 0 }}<template v-if="post.eventCapacity"> / {{ post.eventCapacity }}</template> 人 · 仅本机演练</p>
          <button v-if="post.moderation === 'approved' && post.publishedToFeed !== false" type="button" class="button-ghost" @click="cancelActivity(post)">取消演练报名</button>
          <small>报名与取消只修改当前浏览器的合成数据；没有真实名额预留、通知或活动安排。</small>
        </article>
        <div v-if="!myActivities.length" class="empty-state compact-empty"><h3>还没有报名活动</h3><p>在社区的活动招募中点“演练报名”后，会显示在这里。</p><button class="button-ghost" type="button" @click="emit('navigate', 'community')">去社区看活动</button></div>
      </div>

      <div v-else class="ledger-list">
        <article v-for="entry in store.ledger" :key="entry.id" class="ledger-entry">
          <span class="ledger-symbol">◷</span><div><strong>{{ entry.title }}</strong><p>{{ entry.note }}</p><small>{{ new Date(entry.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) }} · {{ formatMinutes(entry.minutes) }}</small></div><span class="unsettled-badge">未核验</span>
        </article>
        <div v-if="!store.ledger.length" class="empty-state compact-empty">暂无虚构时间记录。</div>
        <p class="ledger-disclaimer">账本为演示记录：完成本机演练订单会生成一条“未结算”时长，但没有双方确认、兑换、结算或提现能力。</p>
      </div>
    </section>

    <section class="profile-help-row"><div><span class="soft-label">NEED A HAND?</span><h3>有想反馈的内容吗？</h3><p>反馈只保存在本机演练数据中。</p></div><button class="button-ghost" type="button" @click="emit('navigate', 'messages')">查看消息与反馈 <span>↗</span></button></section>
    <a class="profile-workspace-link" href="/">
      <span><strong>内部受理工作台（A+）</strong><small>登记、分诊、转介与人工跟进演练</small></span>
      <span aria-hidden="true">↗</span>
    </a>

    <ConfirmDialog
      :open="resetDialog.open"
      :title="resetDialog.unreadable ? '覆盖损坏存档并重置？' : '恢复演练数据？'"
      :message="resetDialog.unreadable
        ? '当前存档无法读取或版本不受支持。重置会覆盖这份损坏存档，覆盖后无法恢复；如需保留原文，请先“下载原始存档”。确认覆盖并恢复初始虚构示例吗？'
        : '本机新增的帖子、互动和反馈将被初始虚构示例覆盖。此操作只影响当前浏览器，无法撤销。'"
      :confirm-text="resetDialog.unreadable ? '覆盖并重置' : '恢复数据'"
      tone="danger"
      @confirm="confirmReset"
      @cancel="cancelReset"
    />
  </div>
</template>
