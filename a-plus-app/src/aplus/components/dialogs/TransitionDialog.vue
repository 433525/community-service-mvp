<script setup lang="ts">
import { HIGH_RISK_HANDOFF_OUTCOMES } from '../../../domain/intake'
import { useAplusContext } from '../../context'

const {
  showTransition,
  selectedCase,
  actionOptions,
  actionLabels,
  transitionForm,
  transitionReasonOptions,
  reasonLabels,
  needsReason,
  transitionNoteRequired,
  transitionActionBlockedReason,
  transitionTargetIsOpen,
  transitionErrors,
  transitionSubmitDisabled,
  syntheticConfirmed,
  applyTransition,
  closeAllDialogs,
} = useAplusContext()
</script>

<template>
  <div v-if="showTransition" class="modal-backdrop" @click.self="closeAllDialogs">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="transition-title" aria-describedby="transition-title-desc">
      <header class="modal-header"><div><h2 id="transition-title">{{ transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF' ? '记录演练人工交接' : '更新登记状态' }}</h2><p id="transition-title-desc">{{ selectedCase?.id }} · 所有变化将加入时间线。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
      <div class="modal-body">
        <div class="field"><label for="action-select">登记动作 <span aria-hidden="true">*</span></label><select id="action-select" v-model="transitionForm.action"><option :value="null">请选择登记动作</option><option v-for="action in actionOptions" :key="action" :value="action">{{ actionLabels[action] }}</option></select></div>
        <div v-if="transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF'" class="field"><label for="handoff-outcome">交接结果 <span aria-hidden="true">*</span></label><select id="handoff-outcome" v-model="transitionForm.handoffOutcome"><option value="">请选择交接结果</option><option v-for="outcome in HIGH_RISK_HANDOFF_OUTCOMES" :key="outcome.value" :value="outcome.value">{{ outcome.label }}</option></select></div>
        <div v-if="transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF' && transitionForm.handoffOutcome === 'accepted'" class="field"><label for="handoff-owner">虚构接手人 <span aria-hidden="true">*</span></label><input id="handoff-owner" v-model="transitionForm.handoffOwner" maxlength="40" placeholder="例如：演练-复核席-02" /></div>
        <div v-if="needsReason" class="field"><label for="reason-select">原因 <span aria-hidden="true">*</span></label><select id="reason-select" v-model="transitionForm.reasonCode"><option value="">请选择原因</option><option v-for="reason in transitionReasonOptions" :key="reason" :value="reason">{{ reasonLabels[reason] }}</option></select></div>
        <div v-if="transitionActionBlockedReason" class="notice-inline" role="alert">{{ transitionActionBlockedReason }} 请先在详情面板更新登记检查点。</div>
        <div v-if="transitionForm.action === 'REFER'" class="notice-inline">转介对象只填虚构演练名称；本原型不会发送转介，也不代表外部机构已收到。</div>
        <div v-if="transitionForm.action === 'CONFIRM_REFERRAL'" class="notice-inline">此项只录入虚构演练确认依据，不会发送转介，也不代表外部机构真实接收。</div>
        <div v-if="transitionForm.action === 'REFERRAL_FAILED'" class="notice-inline">只把记录退回待分诊并保留人工跟进；不会联系外部机构或发送通知。请填写虚构的责任人、下一步和截止时间。</div>
        <div v-if="transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF'" class="notice-inline" role="alert">每次保存只追加本地演练交接记录，可反复登记，状态保持开放；保存后会更新负责人、下一步和演练截止时间。选择“有人接手”时必须填写虚构接手人；选择“暂无人接手”时不得填写接手人。不会实际联系、通知或派单，风险标记不会解除，也不代表真实升级完成、风险已解除或服务已完成。真实高风险情形必须按运营方批准的流程处理。</div>
        <div v-if="transitionForm.action === 'CLOSE_FOLLOW_UP'" class="notice-inline">结束的是本原型中的人工跟进记录，不代表服务已提供、完成或核实；请在说明中记录虚构的结束依据。</div>
        <div v-if="transitionForm.action === 'REFER'" class="field"><label for="referral-target">虚构演练转介对象 <span aria-hidden="true">*</span></label><input id="referral-target" v-model="transitionForm.referralTarget" maxlength="80" placeholder="例如：演练-社区支持点 A" /></div>
        <div class="hint">自由文本无法技术性识别或阻止真实个人信息。这里只能填写虚构演练内容。</div>
        <div class="field"><label for="transition-note">{{ transitionForm.action === 'CONFIRM_REFERRAL' ? '虚构演练确认依据' : transitionForm.action === 'REFER' ? '虚构转介依据' : transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF' ? '交接说明' : '处理说明' }}<span v-if="transitionNoteRequired" aria-hidden="true"> *</span></label><textarea id="transition-note" v-model="transitionForm.note" maxlength="240" :placeholder="transitionNoteRequired ? '请填写虚构演练说明，不要输入真实个人信息' : '只记录演练过程；不要输入真实个人信息'"></textarea></div>
        <div v-if="transitionTargetIsOpen" class="form-row">
          <div class="field"><label for="transition-owner">负责人 <span aria-hidden="true">*</span></label><input id="transition-owner" v-model="transitionForm.owner" maxlength="40" /></div>
          <div class="field"><label for="transition-due">演练跟进截止 <span aria-hidden="true">*</span></label><input id="transition-due" v-model="transitionForm.dueAt" type="datetime-local" /></div>
        </div>
        <div v-if="transitionTargetIsOpen" class="field"><label for="transition-next">下一步 <span aria-hidden="true">*</span></label><input id="transition-next" v-model="transitionForm.nextStep" maxlength="120" /></div>
        <div v-if="transitionTargetIsOpen" class="hint">{{ transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF' ? '两种交接结果都必须填写负责人、下一步和演练截止时间；截止时间仅用于演练，不构成运营 SLA。' : '默认截止时间仅为演练值，不构成运营 SLA。' }}</div>
        <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
        <div v-if="transitionErrors.length" class="form-error" role="alert"><span v-for="error in transitionErrors" :key="error">{{ error }}</span></div>
      </div>
      <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="transitionSubmitDisabled" @click="applyTransition">{{ transitionForm.action === 'RECORD_HIGH_RISK_HANDOFF' ? '保存交接记录' : '确认更新' }}</button></footer>
    </section>
  </div>
</template>
