<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCommunityStore } from '../store'
import type { Post } from '../types'
import { SYNTHETIC_DEMO_AUTHOR } from '../fixtures'

const props = withDefaults(defineProps<{ post: Post; compact?: boolean }>(), { compact: false })
const emit = defineEmits<{ toast: [message: string] }>()
const store = useCommunityStore()
const showComment = ref(false)
const commentText = ref('')
const reportReason = ref('')
const reportTarget = ref<{type: 'post' | 'comment'; id: string} | null>(null)
const approvedComments = computed(() => props.post.comments.filter(c => c.moderation === 'approved'))
const moderationLabel = computed(() => ({pending:'待审核', approved:'审核通过', rejected:'已驳回', hidden:'已下架'})[props.post.moderation ?? 'pending'])
function report() {
 if (!reportTarget.value) return
 const result = store.reportContent(reportTarget.value.type, reportTarget.value.id, reportReason.value)
 emit('toast', result.ok ? '举报已进入本机审核队列。' : result.errors.join(' '))
 if(result.ok) { reportTarget.value = null; reportReason.value = '' }
}

const modeLabel = (mode: Post['mode']) => ({ help: '互助求助', volunteer: '志愿动态', neighbor: '邻里分享' })[mode]
const dateLabel = (value: string) => new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
const isMyHelpPost = props.post.mode === 'help' && props.post.author.id === SYNTHETIC_DEMO_AUTHOR.id

function run(action: () => { ok: boolean; errors: string[]; message?: string }, success: string) {
  const result = action()
  emit('toast', result.ok ? (result.message ?? success) : result.errors.join(' '))
}

function addComment() {
  const result = store.addComment(props.post.id, commentText.value)
  if (!result.ok) return emit('toast', result.errors.join(' '))
  commentText.value = ''
  emit('toast', '评论已提交审核；通过前不会公开显示。')
}
</script>

<template>
  <article class="post-card" :class="{ compact }">
    <div class="post-topline">
      <span class="post-kind" :class="`kind-${post.mode}`"><i></i>{{ modeLabel(post.mode) }}</span>
      <span class="post-date">{{ dateLabel(post.createdAt) }} · 演练</span>
    </div>
    <div class="post-author-row">
      <span class="post-avatar" :class="`avatar-${post.mode}`">{{ post.anonymous ? '匿' : post.author.name.slice(-2, -1) }}</span>
      <div><strong>{{ post.anonymous ? '匿名志愿者（虚构）' : post.author.name }}</strong><small>{{ post.location }}</small></div>
      <button v-if="post.moderation === 'approved' && post.publishedToFeed !== false" class="icon-button post-save" type="button" :aria-label="post.favorited ? '取消收藏' : '收藏'" @click="run(() => store.toggleFavorite(post.id), post.favorited ? '已取消收藏。' : '已收藏。')">{{ post.favorited ? '★' : '☆' }}</button>
    </div>
    <p class="moderation-badge">{{ moderationLabel }}<span v-if="post.reviewNote"> · {{ post.reviewNote }}</span></p>
    <h3 class="post-title">{{ post.title }}</h3>
    <p class="post-content">{{ post.content }}</p>
    <div v-if="post.mode === 'help' && (post.category || post.timeWindow || post.duration)" class="help-detail-row">
      <span v-if="post.category">分类：{{ post.category }}</span>
      <span v-if="post.timeWindow">时段：{{ post.timeWindow }}</span>
      <span v-if="post.duration">预计：{{ post.duration }}</span>
    </div>
    <div v-if="post.specialNote" class="post-note">补充说明：{{ post.specialNote }}</div>
    <div v-if="post.mode === 'volunteer' && post.volunteerKind === 'activity'" class="event-detail">
      <span>◷ {{ post.eventStartsAt ? new Date(post.eventStartsAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间待定' }}</span>
      <span>报名 {{ post.eventSignupCount ?? 0 }}<template v-if="post.eventCapacity"> / {{ post.eventCapacity }} 人</template></span>
    </div>
    <div v-if="!compact && post.moderation === 'approved'" class="post-actions">
      <button type="button" :class="{ chosen: post.likedByMe }" @click="run(() => store.toggleLike(post.id), '已更新点赞。')"><span>♡</span>{{ post.likeCount }}</button>
      <button type="button" @click="showComment = !showComment"><span>▱</span>{{ approvedComments.length }} 条评论</button>
      <button v-if="post.mode === 'help'" class="post-action-cta" type="button" :disabled="post.orderStatus !== 'open' || isMyHelpPost" @click="run(() => store.acceptOrder(post.id), '已在本机演练中标记接单。')">{{ isMyHelpPost ? '我的求助' : post.acceptedByMe ? '我已接单' : post.orderStatus === 'accepted-local-demo' ? '已有人接单' : '演练接单' }}</button>
      <button v-else-if="post.mode === 'volunteer' && post.volunteerKind === 'activity'" class="post-action-cta" type="button" :disabled="!!post.signedUpByMe || (!!post.eventCapacity && (post.eventSignupCount ?? 0) >= post.eventCapacity)" @click="run(() => store.signUpForEvent(post.id), '已在本机演练中记录报名。')">{{ post.signedUpByMe ? '已演练报名' : '演练报名' }}</button>
      <span v-else class="local-action-label">仅本机互动</span>
      <button type="button" @click="reportTarget = {type: 'post', id: post.id}">举报</button>
    </div>
    <div v-if="showComment && !compact && post.moderation === 'approved'" class="comment-panel">
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
