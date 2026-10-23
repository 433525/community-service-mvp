<script setup lang="ts">
import { useAplusContext } from '../../context'

const {
  showFollowUp,
  selectedRiskNotice,
  followUpForm,
  syntheticConfirmed,
  followUpError,
  saveFollowUp,
  closeAllDialogs,
} = useAplusContext()
</script>

<template>
  <div v-if="showFollowUp" class="modal-backdrop" @click.self="closeAllDialogs">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="followup-title" aria-describedby="followup-title-desc">
      <header class="modal-header"><div><h2 id="followup-title">调整人工跟进</h2><p id="followup-title-desc">变更记录会追加到时间线，不会自动联系任何人。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
      <div class="modal-body">
        <div v-if="selectedRiskNotice" class="notice-inline">{{ selectedRiskNotice }}</div>
        <div class="notice-inline">自由文本无法技术性识别或阻止真实个人信息。这里只能填写虚构演练内容。</div>
        <div class="form-row">
          <div class="field"><label for="followup-owner">负责人 <span aria-hidden="true">*</span></label><input id="followup-owner" v-model="followUpForm.owner" maxlength="40" /></div>
          <div class="field"><label for="followup-due">演练跟进截止 <span aria-hidden="true">*</span></label><input id="followup-due" v-model="followUpForm.dueAt" type="datetime-local" /><div class="hint">截止时间仅用于演练，不构成运营 SLA。</div></div>
        </div>
        <div class="field"><label for="followup-next">下一步 <span aria-hidden="true">*</span></label><input id="followup-next" v-model="followUpForm.nextStep" maxlength="120" /></div>
        <div class="field"><label for="followup-note">调整原因 <span aria-hidden="true">*</span></label><textarea id="followup-note" v-model="followUpForm.note" maxlength="160" placeholder="说明为什么调整负责人或下一步"></textarea></div>
        <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
        <div v-if="followUpError" class="form-error" role="alert">{{ followUpError }}</div>
      </div>
      <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!syntheticConfirmed" @click="saveFollowUp">保存跟进</button></footer>
    </section>
  </div>
</template>
