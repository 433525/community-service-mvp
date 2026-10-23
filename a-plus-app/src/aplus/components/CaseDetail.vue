<script setup lang="ts">
import {
  CHECKPOINT_SYNTHETIC_NOTICE,
  getCaseConsentStatus,
  getConsentStatusLabel,
  getContactSimulationOutcomeLabel,
  getHighRiskHandoffOutcomeLabel,
  getSyntheticSourceChannelLabel,
  isCaseRequiredInfoComplete,
  isOpenIntakeStatus,
} from '../../domain/intake'
import { useAplusContext } from '../context'

const {
  store,
  roles,
  reasonLabels,
  selectedCase,
  selectedRiskNotice,
  selectedHighRiskHandoffCount,
  linkedCases,
  selectedCaseCheckpointReady,
  selectedCaseCheckpointBlockedReason,
  actionOptions,
  lifecycleText,
  backToQueue,
  selectRelatedCase,
  copySelectedCaseLink,
  openTransition,
  openCheckpoint,
  openFollowUp,
  openContactSimulation,
  openHighRiskStop,
  openReopen,
  openComplaint,
  caseHasHighRisk,
  caseStatusLabel,
  eventHeading,
  eventChangeValue,
  isCaseOverdue,
  formatDate,
} = useAplusContext()
</script>

<template>
  <section class="panel detail-panel" aria-label="登记记录详情" tabindex="-1">
    <template v-if="selectedCase">
      <header class="print-header">
        <strong>邻里服务台 · A+ 受控登记演练</strong>
        <span>合成数据 · 非真实受理记录 · {{ selectedCase.id }}</span>
      </header>
      <div class="detail-head">
        <button class="detail-back" type="button" @click="backToQueue">← 返回队列</button>
        <div class="detail-title-row">
          <div>
            <div class="detail-id">{{ selectedCase.id }} <span>·</span> {{ selectedCase.label }}</div>
            <h2 class="detail-title">{{ selectedCase.summary }}</h2>
          </div>
          <div class="detail-head-side">
            <span class="tag" :class="caseHasHighRisk(selectedCase) ? 'risk' : (isCaseOverdue(selectedCase) ? 'warning' : 'status')">{{ caseHasHighRisk(selectedCase) ? '停止普通初筛 · 风险未解除' : selectedCase.status }}</span>
            <button class="detail-link" type="button" title="复制可分享的当前记录链接" @click="copySelectedCaseLink">复制链接</button>
            <button class="detail-link" type="button" title="提交演示投诉到独立复核队列" @click="openComplaint">提交投诉</button>
          </div>
        </div>
        <div class="detail-date">登记 {{ formatDate(selectedCase.createdAt) }} <span>·</span> 更新 {{ formatDate(selectedCase.updatedAt) }}</div>
      </div>
      <div class="detail-content">
        <div class="detail-actions" aria-label="记录操作">
          <button v-if="actionOptions.length" class="button primary" type="button" @click="openTransition">{{ caseHasHighRisk(selectedCase) ? '记录演练人工交接 →' : '更新登记状态 →' }}</button>
          <button v-if="isOpenIntakeStatus(selectedCase.status) && !caseHasHighRisk(selectedCase)" class="button" type="button" @click="openCheckpoint">更新登记检查点</button>
          <button v-if="isOpenIntakeStatus(selectedCase.status) && !caseHasHighRisk(selectedCase)" class="button" type="button" :disabled="!selectedCaseCheckpointReady" :title="selectedCaseCheckpointBlockedReason || '调整负责人与下一步'" @click="openFollowUp">调整跟进</button>
          <button v-if="isOpenIntakeStatus(selectedCase.status) && !caseHasHighRisk(selectedCase)" class="button" type="button" :disabled="!selectedCaseCheckpointReady" :title="selectedCaseCheckpointBlockedReason || '记录模拟联系结果'" @click="openContactSimulation">记录模拟联系</button>
          <button v-if="isOpenIntakeStatus(selectedCase.status) && !caseHasHighRisk(selectedCase)" class="button danger" type="button" title="标记高风险并停止常规初筛" @click="openHighRiskStop">标记高风险</button>
          <button v-if="!isOpenIntakeStatus(selectedCase.status) && selectedCase.status !== '已提供信息' && !caseHasHighRisk(selectedCase)" class="button" type="button" :disabled="store.intakePaused" :title="store.intakePaused ? '本机合成演练已暂停新登记' : '建立关联的重开演练记录'" @click="openReopen">建立关联重开</button>
          <span v-if="caseHasHighRisk(selectedCase)" class="tag risk">已停止普通初筛；风险未解除；可反复记录演练人工交接{{ selectedHighRiskHandoffCount ? '（已记录 ' + selectedHighRiskHandoffCount + ' 次）' : '' }}</span>
          <span v-if="!actionOptions.length && !isOpenIntakeStatus(selectedCase.status) && !caseHasHighRisk(selectedCase)" class="tag">当前原记录已结束并保留</span>
        </div>
        <div class="checkpoint-callout" :class="{ ready: selectedCaseCheckpointReady }" role="note">
          <strong>登记检查点：{{ selectedCaseCheckpointReady ? '已完成' : '未完成' }} · 合成演练字段</strong>
          <p>{{ CHECKPOINT_SYNTHETIC_NOTICE }}</p>
            <p v-if="!selectedCaseCheckpointReady">{{ selectedCaseCheckpointBlockedReason }} 高风险停止与人工交接通道始终可用。</p>
        </div>
        <div v-if="selectedRiskNotice" class="risk-callout" role="alert">
          <span class="risk-symbol">⚠</span>
          <div><strong>高风险停止标记：请停止普通初筛（风险未解除）</strong><p>{{ selectedRiskNotice }}</p></div>
        </div>
        <div v-if="selectedCase.riskFlags.length" class="risk-flag-list" aria-label="演练风险标记">
          <article v-for="flag in selectedCase.riskFlags" :key="flag.code" class="risk-flag-item">
            <strong>{{ flag.label }} <small>· 演练标记</small></strong>
            <p>{{ flag.note }}</p>
          </article>
        </div>
        <div v-if="selectedCase.status.includes('转介')" class="notice-inline" role="note">
          本原型没有向外部机构发送转介，也没有收到真实回执。此状态仅记录虚构演练，不代表外部机构已接收或已提供服务。
        </div>

        <div class="detail-section">
          <div class="section-label">记录概况</div>
          <div class="info-grid">
            <div class="info-item"><span>服务类型</span><strong>{{ selectedCase.serviceType }}</strong></div>
            <div class="info-item"><span>来源渠道演练标记</span><strong>{{ getSyntheticSourceChannelLabel(selectedCase.sourceChannel) }}</strong></div>
            <div v-if="selectedCase.sourcePostId" class="info-item"><span>社区来源帖子 ID</span><strong>{{ selectedCase.sourcePostId }}</strong></div>
            <div class="info-item"><span>演练同意检查点</span><strong>{{ getConsentStatusLabel(getCaseConsentStatus(selectedCase)) }}</strong></div>
            <div class="info-item"><span>必填信息检查点</span><strong>{{ isCaseRequiredInfoComplete(selectedCase) ? '已完整（演练）' : '未完整 / 未登记（演练）' }}</strong></div>
            <div class="info-item"><span>登记检查点</span><strong>{{ selectedCaseCheckpointReady ? '已完成（可进行普通流程）' : '未完成（普通流程已锁定）' }}</strong></div>
            <div class="info-item"><span>当前状态</span><strong>{{ caseStatusLabel(selectedCase) }}</strong></div>
            <div class="info-item"><span>负责人</span><strong>{{ selectedCase.owner || '—' }}</strong></div>
            <div class="info-item"><span>演练跟进截止</span><strong>{{ formatDate(selectedCase.dueAt) }}<template v-if="isCaseOverdue(selectedCase)"> · 演练已逾期</template></strong></div>
          </div>
        </div>

        <div class="detail-section">
          <div class="section-label">下一步</div>
          <div class="next-step-card"><strong>{{ lifecycleText }}</strong><p>{{ selectedCase.nextStep || '当前没有开放跟进动作。' }}</p></div>
        </div>

        <div v-if="linkedCases.length" class="detail-section">
          <div class="section-label">关联演练记录</div>
          <div class="related-case-list">
            <button v-for="item in linkedCases" :key="item.id" class="related-case" type="button" @click="selectRelatedCase(item.id)">
              <span><strong>{{ item.id }} · {{ item.label }}</strong><small>{{ item.summary }}</small></span>
              <span class="tag">{{ caseStatusLabel(item) }}</span>
            </button>
          </div>
        </div>

        <div class="detail-section">
          <div class="section-label">跟进时间线 <span class="tag">追加记录</span></div>
          <div class="timeline">
            <div v-for="event in [...selectedCase.events].reverse()" :key="event.id" class="timeline-item">
              <span class="timeline-dot"></span>
              <div class="timeline-text">
                <strong>{{ eventHeading(event) }}</strong>
                <small v-if="event.fromStatus && event.toStatus && event.fromStatus !== event.toStatus">{{ event.fromStatus }} → {{ event.toStatus }}</small>
                <small v-if="event.reasonCode">原因：{{ reasonLabels[event.reasonCode] }}</small>
                <small v-if="event.contactOutcome">结果：{{ getContactSimulationOutcomeLabel(event.contactOutcome) }}</small>
                <small v-if="event.handoffOutcome">人工交接结果：{{ getHighRiskHandoffOutcomeLabel(event.handoffOutcome) }}</small>
                <small v-if="event.handoffOutcome === 'accepted' && event.handoffOwner">虚构接手人：{{ event.handoffOwner }}</small>
                <small v-if="event.kind === 'checkpoint-update'">检查点：同意 {{ getConsentStatusLabel(event.consentStatus) }} · 必填信息 {{ event.requiredInfoComplete ? '已完整' : '未完整' }}</small>
                <small v-if="event.duplicateCandidateIds?.length">候选记录：{{ event.duplicateCandidateIds?.join('、') }}</small>
                <small v-for="change in event.changes ?? []" :key="change.field">
                  {{ change.label }}：{{ eventChangeValue(change.field, change.before) }} → {{ eventChangeValue(change.field, change.after) }}
                </small>
                <span>{{ event.note }}</span>
                <small>{{ formatDate(event.at) }} · {{ event.actorRole ? roles.find((role) => role.value === event.actorRole)?.label : '系统标记' }}</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="detail-placeholder">
      <div><div class="detail-placeholder-icon">⌁</div><strong>选择一条演练记录</strong><p>查看记录状态、人工下一步和追加式跟进时间线。</p></div>
    </div>
  </section>
</template>
