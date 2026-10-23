<script setup lang="ts">
import { CONTACT_SIMULATION_OUTCOMES } from '../../../domain/intake'
import { useAplusContext } from '../../context'

const {
  showContactSimulation,
  selectedCase,
  contactSimulationForm,
  syntheticConfirmed,
  contactSimulationError,
  saveContactSimulation,
  closeAllDialogs,
} = useAplusContext()
</script>

<template>
  <div v-if="showContactSimulation" class="modal-backdrop" @click.self="closeAllDialogs">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="contact-simulation-title" aria-describedby="contact-simulation-title-desc">
      <header class="modal-header"><div><h2 id="contact-simulation-title">记录模拟联系结果</h2><p id="contact-simulation-title-desc">{{ selectedCase?.id }} · 保存结果会更新负责人、下一步和截止时间，并追加到时间线。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
      <div class="modal-body">
        <div class="notice-inline" role="note">仅录入合成演练中的模拟结果，不代表真实联系。保存时还会用下方内容更新负责人、下一步和演练跟进截止时间，但不会改变登记状态。不要填写真实姓名、电话或其他个人信息；本操作不会联系任何人或发送通知。</div>
        <div class="field"><label for="contact-simulation-outcome">模拟结果 <span aria-hidden="true">*</span></label><select id="contact-simulation-outcome" v-model="contactSimulationForm.outcome"><option v-for="outcome in CONTACT_SIMULATION_OUTCOMES" :key="outcome.value" :value="outcome.value">{{ outcome.label }}</option></select></div>
        <div class="hint">自由文本无法技术性识别或阻止真实个人信息，只能填写虚构演练内容。</div>
        <div class="field"><label for="contact-simulation-note">演练说明 <span aria-hidden="true">*</span></label><textarea id="contact-simulation-note" v-model="contactSimulationForm.note" maxlength="160" placeholder="记录虚构的模拟结果和后续安排"></textarea></div>
        <div class="form-row">
          <div class="field"><label for="contact-simulation-owner">负责人 <span aria-hidden="true">*</span></label><input id="contact-simulation-owner" v-model="contactSimulationForm.owner" maxlength="40" /></div>
          <div class="field"><label for="contact-simulation-due">演练跟进截止 <span aria-hidden="true">*</span></label><input id="contact-simulation-due" v-model="contactSimulationForm.dueAt" type="datetime-local" /><div class="hint">截止时间仅用于演练，不构成运营 SLA。</div></div>
        </div>
        <div class="field"><label for="contact-simulation-next">下一步 <span aria-hidden="true">*</span></label><input id="contact-simulation-next" v-model="contactSimulationForm.nextStep" maxlength="120" /></div>
        <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
        <div v-if="contactSimulationError" class="form-error" role="alert">{{ contactSimulationError }}</div>
      </div>
      <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!syntheticConfirmed" @click="saveContactSimulation">保存模拟记录</button></footer>
    </section>
  </div>
</template>
