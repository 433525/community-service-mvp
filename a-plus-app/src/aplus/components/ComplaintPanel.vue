<script setup lang="ts">
import { COMPLAINT_SYNTHETIC_NOTICE } from '../../domain/intake'
import { useAplusContext } from '../context'

const {
  store,
  complaintFilter,
  filteredComplaints,
  selectedComplaintId,
  selectedComplaint,
  selectedComplaintCase,
  selectedComplaintReviewBlockedReason,
  canReviewSelectedComplaint,
  currentRoleReviewLabel,
  currentDemoRoleLabel,
  complaintReviewResolution,
  complaintReviewError,
  selectComplaint,
  reviewSelectedComplaint,
  openComplaintCase,
  roleLabel,
  formatDate,
} = useAplusContext()
</script>

<template>
  <section class="panel complaint-panel" aria-label="独立投诉复核队列" tabindex="-1">
    <div class="panel-head">
      <div>
        <h2 class="panel-title">投诉复核队列 <small>{{ store.pendingComplaints.length }} 条待复核 · 独立存档</small></h2>
        <p class="panel-subtitle">{{ COMPLAINT_SYNTHETIC_NOTICE }} 投诉不会改写 case 风险标记或跟进时间线。</p>
      </div>
      <div class="filters" v-tablist role="tablist" aria-label="筛选投诉">
        <button class="filter" :class="{ active: complaintFilter === '待复核' }" type="button" role="tab" :aria-selected="complaintFilter === '待复核'" @click="complaintFilter = '待复核'">投诉待复核</button>
        <button class="filter" :class="{ active: complaintFilter === '全部投诉' }" type="button" role="tab" :aria-selected="complaintFilter === '全部投诉'" @click="complaintFilter = '全部投诉'">全部投诉</button>
      </div>
    </div>
    <div class="complaint-grid">
      <div v-if="filteredComplaints.length" class="queue-list" aria-label="投诉列表">
        <button v-for="complaint in filteredComplaints" :key="complaint.id" class="queue-item" :class="{ selected: selectedComplaintId === complaint.id }" type="button" @click="selectComplaint(complaint.id)">
          <span class="queue-marker" :class="{ warning: complaint.status === '待复核' }"></span>
          <span class="queue-body">
            <span class="queue-top"><span class="queue-id">{{ complaint.id }} <small>· {{ complaint.caseId }}</small></span><span class="queue-time">{{ formatDate(complaint.submittedAt) }}</span></span>
            <span class="queue-summary">{{ complaint.description }}</span>
            <span class="queue-meta">
              <span class="tag" :class="complaint.status === '待复核' ? 'warning' : 'status'">{{ complaint.status }}</span>
              <span class="tag">提交：{{ roleLabel(complaint.submittedByRole) }}</span>
              <span class="tag">被投诉：{{ roleLabel(complaint.targetRole) }}</span>
            </span>
          </span>
        </button>
      </div>
      <div v-else class="empty-state">当前没有{{ complaintFilter === '待复核' ? '待复核' : '' }}投诉记录。<br />可在上方登记详情中提交演示投诉。</div>
      <div class="complaint-detail">
        <template v-if="selectedComplaint">
          <div class="detail-head">
            <div class="detail-title-row">
              <div>
                <div class="detail-id">{{ selectedComplaint.id }} <span>·</span> {{ selectedComplaint.caseId }}</div>
                <h3 class="detail-title">演示投诉复核详情</h3>
              </div>
              <span class="tag" :class="selectedComplaint.status === '待复核' ? 'warning' : 'status'">{{ selectedComplaint.status }}</span>
            </div>
          </div>
          <div class="detail-content">
            <div class="notice-inline">{{ COMPLAINT_SYNTHETIC_NOTICE }} 当前演示角色：{{ currentDemoRoleLabel }}。</div>
            <div class="info-grid">
              <div class="info-item"><span>针对的演示角色</span><strong>{{ roleLabel(selectedComplaint.targetRole) }}</strong></div>
              <div class="info-item"><span>提交人演示角色</span><strong>{{ roleLabel(selectedComplaint.submittedByRole) }}</strong></div>
              <div class="info-item"><span>提交时间</span><strong>{{ formatDate(selectedComplaint.submittedAt) }}</strong></div>
              <div class="info-item"><span>复核时间</span><strong>{{ selectedComplaint.reviewedAt ? formatDate(selectedComplaint.reviewedAt) : '—' }}</strong></div>
              <div class="info-item"><span>复核人演示角色</span><strong>{{ selectedComplaint.reviewerRole ? roleLabel(selectedComplaint.reviewerRole) : '—' }}</strong></div>
              <div class="info-item"><span>关联 case</span><strong>{{ selectedComplaint.caseId }}</strong></div>
            </div>
            <div class="detail-section">
              <div class="section-label">投诉说明</div>
              <div class="next-step-card"><p>{{ selectedComplaint.description }}</p></div>
            </div>
            <div class="detail-section">
              <div class="section-label">处理说明</div>
              <div class="next-step-card"><p>{{ selectedComplaint.resolution || '尚未填写。' }}</p></div>
            </div>
            <div class="detail-actions">
              <button v-if="selectedComplaintCase" class="button" type="button" @click="openComplaintCase(selectedComplaint.caseId)">打开关联 case（不改时间线）</button>
            </div>
            <div v-if="selectedComplaint.status === '待复核'" class="detail-section">
              <div class="section-label">完成复核</div>
              <div class="hint">{{ currentRoleReviewLabel }}</div>
              <div v-if="selectedComplaintReviewBlockedReason" class="notice-inline" role="alert">{{ selectedComplaintReviewBlockedReason }}</div>
              <div class="field"><label :for="`complaint-resolution-${selectedComplaint.id}`">处理说明 <span aria-hidden="true">*</span></label><textarea :id="`complaint-resolution-${selectedComplaint.id}`" v-model="complaintReviewResolution" maxlength="240" placeholder="填写演练复核处理说明；不会改动 case 风险时间线"></textarea></div>
              <div v-if="complaintReviewError" class="form-error" role="alert">{{ complaintReviewError }}</div>
              <button class="button primary" type="button" :disabled="!canReviewSelectedComplaint || !complaintReviewResolution.trim()" @click="reviewSelectedComplaint">确认复核</button>
            </div>
          </div>
        </template>
        <div v-else class="detail-placeholder"><div><strong>选择一条投诉</strong><p>查看独立投诉详情并完成演示复核。</p></div></div>
      </div>
    </div>
  </section>
</template>
