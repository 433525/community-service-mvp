<script setup lang="ts">
import { INTAKE_PAUSED_NOTICE } from '../../../stores/intake'
import {
  HIGH_RISK_STOP_NEXT_STEP,
  SYNTHETIC_SOURCE_CHANNELS,
  getSyntheticSourceChannelLabel,
} from '../../../domain/intake'
import { useAplusContext } from '../../context'

const {
  showCreate,
  store,
  createForm,
  createError,
  duplicateCandidates,
  duplicateReviewRequired,
  duplicateConfirmed,
  duplicateExplanation,
  duplicateError,
  syntheticConfirmed,
  createRecord,
  cancelDuplicateReview,
  openDuplicateCandidate,
  caseStatusLabel,
  closeAllDialogs,
} = useAplusContext()
</script>

<template>
  <div v-if="showCreate" class="modal-backdrop" @click.self="closeAllDialogs">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="create-title" aria-describedby="create-title-desc">
      <header class="modal-header"><div><h2 id="create-title">{{ duplicateReviewRequired ? '发现完全重复的登记内容' : '新建演练记录' }}</h2><p id="create-title-desc">{{ duplicateReviewRequired ? '创建已暂停；请人工核对候选记录。' : '只建立虚构案例，不连接居民入口或外部服务。' }}</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
      <div class="modal-body">
        <div v-if="store.intakePaused" class="notice-inline" role="alert">{{ INTAKE_PAUSED_NOTICE }} 请先恢复新登记再创建；已有记录仍可继续跟进。</div>
        <template v-if="duplicateReviewRequired">
          <div class="notice-inline" role="alert">发现标签或摘要完全相同的已有记录（仅比较去除首尾空白、折叠连续空白并忽略大小写后的文本，不做模糊匹配）。创建已暂停；不会合并、覆盖或删除任何记录。</div>
          <div class="hint">本次拟建记录的来源渠道演练标记：{{ getSyntheticSourceChannelLabel(createForm.sourceChannel) }}。请对照下方候选记录的来源，判断是否为跨合成来源的重复登记。</div>
          <div class="related-case-list">
            <button v-for="candidate in duplicateCandidates" :key="candidate.id" class="related-case" type="button" @click="openDuplicateCandidate(candidate.id)">
              <span><strong>{{ candidate.id }} · {{ candidate.label }}</strong><small>{{ candidate.summary }}</small><small>来源渠道：{{ getSyntheticSourceChannelLabel(candidate.sourceChannel) }}</small></span>
              <span class="tag">{{ caseStatusLabel(candidate) }}</span>
            </button>
          </div>
          <div class="hint">打开候选记录会离开本次创建，当前填写内容不会保存。若仍需新建独立记录，请填写复核说明并再次确认。</div>
          <label class="synthetic-confirm"><input v-model="duplicateConfirmed" type="checkbox" /><span><strong>我已人工核对以上候选记录，确认需要另建一条独立记录</strong><small>不会合并、覆盖或删除候选记录；新记录会保留当前表单内容，关联候选记录并追加复核时间线。</small></span></label>
          <div class="field"><label for="duplicate-explanation">人工重复复核说明 <span aria-hidden="true">*</span></label><textarea id="duplicate-explanation" v-model="duplicateExplanation" maxlength="160" placeholder="简要说明为何仍需另建独立记录"></textarea></div>
          <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
          <div v-if="duplicateError" class="form-error" role="alert">{{ duplicateError }}</div>
        </template>
        <template v-else>
          <div class="notice-inline">本表单是自由文本，无法技术性识别或阻止真实信息。这里只能填写虚构案例；不得输入姓名、电话、精确地址、健康或儿童信息。高风险选项只演练“停止普通初筛”，不会触发通知。</div>
          <div class="field"><label for="record-label">演练标签</label><input id="record-label" v-model="createForm.label" maxlength="30" placeholder="例如：演练-006" /><div class="hint">创建前会检查标签或摘要是否完全重复；发现候选时会暂停创建。</div></div>
          <div class="field"><label for="record-summary">模拟登记摘要 <span aria-hidden="true">*</span></label><textarea id="record-summary" v-model="createForm.summary" maxlength="240" required aria-required="true" :aria-invalid="createError.includes('摘要')" aria-describedby="create-record-error" placeholder="只写一般性虚构演练描述"></textarea><div class="hint">自由文本字段没有真实信息检测或拦截功能。只能填写虚构内容。</div></div>
          <div class="field">
            <label for="record-source">来源渠道演练标记 <span aria-hidden="true">*</span></label>
            <select id="record-source" v-model="createForm.sourceChannel" required aria-required="true">
              <option v-for="channel in SYNTHETIC_SOURCE_CHANNELS" :key="channel.value" :value="channel.value">{{ channel.label }}</option>
            </select>
            <div class="hint">仅标记本条合成演练记录的虚构来源，不会创建或连接真实居民入口、社区渠道、外部机构或受理系统。默认“人工录入演练”。</div>
          </div>
          <div class="form-row">
            <div class="field"><label for="record-owner">负责人 <span aria-hidden="true">*</span></label><input id="record-owner" v-model="createForm.owner" maxlength="40" required aria-required="true" placeholder="演练-受理席-01" /></div>
            <div class="field"><label for="record-due">演练跟进截止 <span aria-hidden="true">*</span></label><input id="record-due" v-model="createForm.dueAt" type="datetime-local" required aria-required="true" /><div class="hint">默认值仅用于演练，不构成运营 SLA。</div></div>
          </div>
          <label class="risk-choice"><input v-model="createForm.highRisk" type="checkbox" /><span><strong>高风险停止初筛演练</strong><small>只添加模拟停止标记；不联系、不通知、不派单。</small></span></label>
          <div v-if="createForm.highRisk" class="notice-inline" role="alert">{{ HIGH_RISK_STOP_NEXT_STEP }}。本原型只记录演练标记，不会启动真实升级流程。</div>
          <div v-if="createForm.highRisk" class="field"><label for="record-high-risk-note">停止初筛的演练依据 <span aria-hidden="true">*</span></label><textarea id="record-high-risk-note" v-model="createForm.highRiskNote" maxlength="240" aria-required="true" placeholder="只写虚构演练依据，不要填写真实个人信息"></textarea></div>
          <div v-if="!createForm.highRisk" class="field"><label for="record-next">下一步 <span aria-hidden="true">*</span></label><input id="record-next" v-model="createForm.nextStep" maxlength="120" aria-required="true" /></div>
          <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
          <div v-if="createError" id="create-record-error" class="form-error" role="alert">{{ createError }}</div>
        </template>
      </div>
      <footer v-if="duplicateReviewRequired" class="modal-footer"><button class="button" type="button" @click="cancelDuplicateReview">返回修改</button><button class="button primary" type="button" :disabled="!syntheticConfirmed || !duplicateConfirmed || !duplicateExplanation.trim() || store.intakePaused" @click="createRecord">确认仍创建独立记录</button></footer>
      <footer v-else class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!syntheticConfirmed || store.intakePaused" @click="createRecord">创建演练记录</button></footer>
    </section>
  </div>
</template>
