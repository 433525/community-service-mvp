<script setup lang="ts">
import { getSyntheticSourceChannelLabel } from '../../../domain/intake'
import { INTAKE_PAUSED_NOTICE } from '../../../stores/intake'
import { useAplusContext } from '../../context'

const {
  showCommunityBridge,
  store,
  communityReviewRequired,
  communityPendingMapping,
  communityDuplicateCandidates,
  communityDuplicateConfirmed,
  communityDuplicateExplanation,
  communitySyntheticConfirmed,
  communityBridgeError,
  communityReadStatus,
  communityReadMessage,
  communityReadResult,
  communityReadWarnings,
  communityPostsWithStatus,
  communityOrderStatusLabel,
  caseStatusLabel,
  readCommunityArchive,
  startCommunityRegistration,
  cancelCommunityReview,
  confirmCommunityRegistration,
  closeCommunityBridge,
} = useAplusContext()
</script>

<template>
  <div v-if="showCommunityBridge" class="modal-backdrop" @click.self="closeCommunityBridge">
    <section class="modal bridge-modal" role="dialog" aria-modal="true" aria-labelledby="community-bridge-title" aria-describedby="community-bridge-title-desc">
      <header class="modal-header">
        <div>
          <h2 id="community-bridge-title">{{ communityReviewRequired ? '人工重复复核' : '社区求助（本机演练）' }}</h2>
          <p id="community-bridge-title-desc">{{ communityReviewRequired ? '创建已暂停；请先查看候选记录并完成人工复核。' : '手动、单向读取本机社区存档；列出审核通过的合成求助（含待接单、进行中、已完成或已关闭等状态，仅展示且不写回社区帖）。' }}</p>
        </div>
        <button class="icon-button" type="button" aria-label="关闭" @click="closeCommunityBridge">×</button>
      </header>

      <div class="modal-body">
        <div v-if="store.intakePaused" class="notice-inline" role="alert">{{ INTAKE_PAUSED_NOTICE }} 已有记录仍可继续跟进；请先恢复新登记再提交社区桥登记。</div>
        <template v-if="communityReviewRequired">
          <div class="notice-inline" role="alert">发现标签或摘要完全相同的已有记录。创建已暂停；不会合并、覆盖或删除候选，也不会写回社区帖。请先核对候选，再填写复核说明并确认。</div>
          <div class="hint">
            拟登记标签：{{ communityPendingMapping?.label }}<br />
            拟登记摘要：{{ communityPendingMapping?.summary }}
            <template v-if="communityPendingMapping?.summaryTruncated"><br />A+ 摘要超过显示上限时会截断；完整原文仍保留在原社区帖子中。</template>
          </div>
          <div class="related-case-list">
            <article v-for="candidate in communityDuplicateCandidates" :key="candidate.id" class="related-case bridge-candidate">
              <span>
                <strong>{{ candidate.id }} · {{ candidate.label }}</strong>
                <small>{{ candidate.summary }}</small>
                <small>来源渠道：{{ getSyntheticSourceChannelLabel(candidate.sourceChannel) }}<template v-if="candidate.sourcePostId"> · 社区帖子 ID：{{ candidate.sourcePostId }}</template></small>
              </span>
              <span class="tag">{{ caseStatusLabel(candidate) }}</span>
            </article>
          </div>
          <div class="hint">以上候选已在本页完整展示；不会打开候选而丢失本次填写。若仍需要登记，请填写复核说明并再次确认。</div>
          <label class="synthetic-confirm"><input v-model="communityDuplicateConfirmed" type="checkbox" /><span><strong>我已人工核对以上候选记录，确认需要另建一条独立记录</strong><small>不会合并、覆盖或删除候选记录；新记录会保留来源帖子 ID、关联候选并追加复核时间线。</small></span></label>
          <div class="field"><label for="community-duplicate-explanation">人工重复复核说明 <span aria-hidden="true">*</span></label><textarea id="community-duplicate-explanation" v-model="communityDuplicateExplanation" maxlength="160" placeholder="简要说明为何仍需登记为独立记录"></textarea></div>
          <label class="synthetic-confirm"><input v-model="communitySyntheticConfirmed" type="checkbox" /><span><strong>我确认本次登记只使用本机合成演练数据</strong><small>不写回社区帖状态，不生成公开订单或服务承诺；本原型无法识别或拦截真实个人信息。</small></span></label>
          <div v-if="communityBridgeError" class="form-error" role="alert">{{ communityBridgeError }}</div>
        </template>

        <template v-else>
          <div class="notice-inline">这里只读取社区演练存档中审核通过的合成求助（含待接单、进行中、已完成或已关闭等状态，仅展示标签，不写回社区）。发布社区求助不会自动进入 A+；读取和登记都不会写回或改变社区帖状态，也不会生成公开订单、服务承诺或外发消息。</div>
          <div class="bridge-toolbar">
            <span class="bridge-status" role="status" aria-live="polite">{{ communityReadStatus }}</span>
            <button class="button small" type="button" @click="readCommunityArchive">重新读取</button>
          </div>
          <div v-if="store.storageStatus === 'recovery-required'" class="notice-inline" role="alert">当前 A+ 存档无法读取，登记会被阻止。请先处理 A+ 存档；本入口不会覆盖、重置或补写任何一端存档。</div>
          <div v-if="communityReadMessage" class="empty-state" role="status">{{ communityReadMessage }}</div>
          <template v-else-if="communityReadResult?.status === 'ready'">
            <div v-if="communityReadWarnings.length" class="notice-inline" role="alert">
              <strong>已跳过 {{ communityReadWarnings.length }} 条无法解析的社区记录</strong>
              <p v-for="warning in communityReadWarnings.slice(0, 5)" :key="warning">{{ warning }}</p>
              <p v-if="communityReadWarnings.length > 5">另有 {{ communityReadWarnings.length - 5 }} 条未显示。</p>
              <p>原社区存档未被修改；跳过的记录不会出现在登记列表中。请先在社区页处理该存档后再试。</p>
            </div>
            <div v-if="!communityPostsWithStatus.length" class="empty-state" role="status">当前没有可登记的合成求助。社区存档保持原样，A+ 也未创建记录。</div>
            <template v-else>
              <label class="synthetic-confirm"><input v-model="communitySyntheticConfirmed" type="checkbox" /><span><strong>我确认本次登记只使用本机合成演练数据</strong><small>只登记下列合成求助；不会写回社区帖状态，也不会产生公开订单、服务承诺或真实外发。</small></span></label>
              <div class="bridge-post-list">
                <article v-for="item in communityPostsWithStatus" :key="item.post.id" class="bridge-post">
                  <div class="bridge-post-head">
                    <strong>{{ item.post.title }}</strong>
                    <span class="tag">社区状态：{{ communityOrderStatusLabel(item.post.orderStatus) }}</span>
                    <span class="tag" :class="item.registered ? 'status' : (store.intakePaused ? 'warning' : '')">{{ item.registered ? '已登记' : (store.intakePaused ? '登记已暂停' : '可登记') }}</span>
                  </div>
                  <p class="bridge-post-content">{{ item.post.content }}</p>
                  <p v-if="item.mapping.summaryTruncated" class="hint">登记到 A+ 的摘要限制为 240 字，超出部分仍保留在原社区帖子中。</p>
                  <div class="queue-meta">
                    <span class="tag">{{ item.post.category || '待分类' }}</span>
                    <span v-if="item.post.timeWindow" class="tag">时段：{{ item.post.timeWindow }}</span>
                    <span v-if="item.post.duration" class="tag">时长：{{ item.post.duration }}</span>
                    <span v-if="item.post.location" class="tag">{{ item.post.location }}</span>
                  </div>
                  <p v-if="item.post.specialNote" class="hint">{{ item.post.specialNote }}</p>
                  <div class="bridge-post-foot">
                    <small>帖子 ID：{{ item.post.id }}</small>
                    <span v-if="item.registered" class="tag status">已登记 · {{ item.registered.id }} · {{ caseStatusLabel(item.registered) }}</span>
                    <button v-else class="button small primary" type="button" :disabled="!communitySyntheticConfirmed || store.storageStatus === 'recovery-required' || store.intakePaused" @click="startCommunityRegistration(item.post)">登记到 A+ 队列</button>
                  </div>
                </article>
              </div>
            </template>
          </template>
          <div v-if="communityBridgeError" class="form-error" role="alert">{{ communityBridgeError }}</div>
        </template>
      </div>

      <footer v-if="communityReviewRequired" class="modal-footer">
        <button class="button" type="button" @click="cancelCommunityReview">返回帖子列表</button>
        <button class="button primary" type="button" :disabled="!communitySyntheticConfirmed || !communityDuplicateConfirmed || !communityDuplicateExplanation.trim() || store.intakePaused" @click="confirmCommunityRegistration">确认仍创建独立记录</button>
      </footer>
      <footer v-else class="modal-footer">
        <button class="button" type="button" @click="closeCommunityBridge">关闭</button>
      </footer>
    </section>
  </div>
</template>
