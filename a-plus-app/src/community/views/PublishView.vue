<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useCommunityStore } from '../store'
import type { PostMode } from '../types'

const props = defineProps<{ initialMode: PostMode }>()
const emit = defineEmits<{ toast: [message: string]; published: [] }>()
const store = useCommunityStore()
const error = ref('')
const confirmedSynthetic = ref(false)
const form = reactive({
  mode: props.initialMode as PostMode,
  title: '', content: '', location: '演练社区（虚构）',
  category: '待分类', timeWindow: '', duration: '', specialNote: '',
  volunteerKind: 'update' as 'update' | 'activity', eventStartsAt: '', eventCapacity: '',
  anonymous: false, publishedToFeed: true,
})
watch(() => props.initialMode, (value) => { form.mode = value; error.value = '' })

function submit() {
  error.value = ''
  if (!confirmedSynthetic.value) {
    error.value = '请先确认这是虚构的演练内容。'
    return
  }
  const eventStartTimestamp = form.mode === 'volunteer' && form.volunteerKind === 'activity'
    ? Date.parse(form.eventStartsAt)
    : Number.NaN
  if (form.mode === 'volunteer' && form.volunteerKind === 'activity' && Number.isNaN(eventStartTimestamp)) {
    error.value = '请输入有效的活动开始时间。'
    return
  }
  const base = { mode: form.mode, title: form.title, content: form.content, location: form.location }
  const result = form.mode === 'help'
    ? store.publishPost({ ...base, category: form.category, timeWindow: form.timeWindow, duration: form.duration, specialNote: form.specialNote })
    : form.mode === 'volunteer'
      ? store.publishPost({
          ...base,
          volunteerKind: form.volunteerKind,
          anonymous: form.anonymous,
          publishedToFeed: form.publishedToFeed,
          ...(form.volunteerKind === 'activity' ? {
            eventStartsAt: new Date(eventStartTimestamp).toISOString(),
            ...(form.eventCapacity ? { eventCapacity: Number(form.eventCapacity) } : {}),
          } : {}),
        })
      : store.publishPost(base)
  if (!result.ok) {
    error.value = result.errors.join(' ')
    return
  }
  emit('toast', form.mode === 'help' ? '求助登记已添加到本机演练数据。' : '内容已添加到本机演练数据。')
  form.title = ''; form.content = ''; form.timeWindow = ''; form.duration = ''; form.specialNote = ''
  form.eventStartsAt = ''; form.eventCapacity = ''; form.anonymous = false; form.publishedToFeed = true
  confirmedSynthetic.value = false
  emit('published')
}
</script>

<template>
  <div class="page-stack publish-page">
    <section class="publish-heading"><span class="soft-label">SHARE WITH YOUR NEIGHBORS</span><h2>发布一件小事。</h2><p>这里先做通用登记；服务分类保持待定，后续由运营方确认。</p></section>
    <div class="publish-layout">
      <form class="publish-form" @submit.prevent="submit">
        <fieldset class="mode-picker"><legend>选择发布类型</legend><div class="mode-options">
          <button type="button" :class="{ selected: form.mode === 'help' }" @click="form.mode = 'help'"><span>↗</span><strong>求助登记</strong><small>通用需求</small></button>
          <button type="button" :class="{ selected: form.mode === 'volunteer' }" @click="form.mode = 'volunteer'"><span>✳</span><strong>志愿发布</strong><small>日记 / 活动</small></button>
          <button type="button" :class="{ selected: form.mode === 'neighbor' }" @click="form.mode = 'neighbor'"><span>⌂</span><strong>邻里分享</strong><small>日常信息</small></button>
        </div></fieldset>

        <div v-if="form.mode === 'volunteer'" class="submode-row"><span>内容类型</span><div><button type="button" :class="{ active: form.volunteerKind === 'update' }" @click="form.volunteerKind = 'update'">志愿记录</button><button type="button" :class="{ active: form.volunteerKind === 'activity' }" @click="form.volunteerKind = 'activity'">活动招募</button></div></div>

        <label class="field-label">标题 <span>*</span><input v-model="form.title" maxlength="120" required placeholder="用一句话说清楚" /></label>
        <label class="field-label">{{ form.mode === 'help' ? '需求说明' : form.mode === 'volunteer' ? (form.volunteerKind === 'activity' ? '活动介绍' : '志愿内容') : '分享内容' }} <span>*</span><textarea v-model="form.content" maxlength="2000" required rows="5" placeholder="补充背景、地点或参与方式。请勿填写真实个人信息。"></textarea><small>{{ form.content.length }} / 2000</small></label>

        <div v-if="form.mode === 'help'" class="form-section"><div class="form-section-title"><strong>通用服务登记</strong><small>服务类别暂不细分</small></div><div class="two-fields"><label class="field-label">服务分类<input v-model="form.category" maxlength="240" required /></label><label class="field-label">希望时段 <span>*</span><input v-model="form.timeWindow" maxlength="240" required placeholder="例如：周四下午" /></label></div><label class="field-label">预计时长 <span>*</span><input v-model="form.duration" maxlength="240" required placeholder="例如：约 1 小时" /></label><label class="field-label">补充说明<textarea v-model="form.specialNote" maxlength="240" rows="2" placeholder="可选；不要写真实姓名、电话或住址"></textarea></label></div>

        <div v-if="form.mode === 'volunteer' && form.volunteerKind === 'activity'" class="form-section"><div class="form-section-title"><strong>活动信息</strong><small>仅用于报名流程演示</small></div><div class="two-fields"><label class="field-label">活动开始时间 <span>*</span><input v-model="form.eventStartsAt" type="datetime-local" required /></label><label class="field-label">名额上限<input v-model="form.eventCapacity" type="number" min="1" max="200" placeholder="不限名额" /></label></div></div>

        <label class="field-label">演练地点<input v-model="form.location" maxlength="120" placeholder="演练社区（虚构）" /></label>

        <div v-if="form.mode === 'volunteer'" class="toggle-list"><label><span><strong>匿名显示</strong><small>动态中不显示演练用户名</small></span><input v-model="form.anonymous" type="checkbox" class="switch-input" /><i class="switch"></i></label><label><span><strong>公开到社区动态</strong><small>关闭后只在“我的发布”中可见</small></span><input v-model="form.publishedToFeed" type="checkbox" class="switch-input" /><i class="switch"></i></label></div>

        <label class="confirm-synthetic"><input v-model="confirmedSynthetic" type="checkbox" /><span>我确认以上全部是虚构演练内容，不包含真实居民信息。</span></label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="button-primary submit-button" type="submit" :disabled="!confirmedSynthetic">保存到本机演练数据 <span>↗</span></button>
        <p class="form-privacy">内容仅保存在此浏览器；不会发布到真实社区、发送消息或产生真实服务记录。</p>
      </form>
      <aside class="publish-aside"><div class="aside-art"><span class="aside-star">✳</span><div class="aside-orbit"></div><div class="aside-hands">⌂</div><span class="aside-caption">small things<br />make a community</span></div><div class="aside-copy"><span class="soft-label">A NOTE BEFORE YOU POST</span><h3>好的互助，<br />从清楚表达开始。</h3><ul><li><span>01</span>说清楚需要什么帮助</li><li><span>02</span>写下可行的时间范围</li><li><span>03</span>地点和身份都用虚构内容</li></ul><div class="aside-demo-label"><i></i> 本地演示 · 无外部发送</div></div></aside>
    </div>
  </div>
</template>
