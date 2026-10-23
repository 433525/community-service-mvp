<script setup lang="ts">
import { COMPLAINT_SYNTHETIC_NOTICE } from '../../../domain/intake'
import { useAplusContext } from '../../context'

const {
  showComplaint,
  selectedCase,
  complaintTargetRoles,
  complaintForm,
  currentDemoRoleLabel,
  complaintSyntheticConfirmed,
  complaintError,
  submitComplaint,
  closeAllDialogs,
} = useAplusContext()
</script>

<template>
  <div v-if="showComplaint" class="modal-backdrop" @click.self="closeAllDialogs">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="complaint-title" aria-describedby="complaint-title-desc">
      <header class="modal-header"><div><h2 id="complaint-title">提交演示投诉</h2><p id="complaint-title-desc">{{ selectedCase?.id }} · 独立投诉队列，不改写 case 风险时间线。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
      <div class="modal-body">
        <div class="notice-inline" role="note">{{ COMPLAINT_SYNTHETIC_NOTICE }} 任一演示角色可以针对其他角色提交；投诉不会改动风险标记、跟进时间线或 case 状态。</div>
        <div class="field"><label for="complaint-target">针对的演示角色 <span aria-hidden="true">*</span></label><select id="complaint-target" v-model="complaintForm.targetRole"><option v-for="role in complaintTargetRoles" :key="role.value" :value="role.value">{{ role.label }}</option></select><div class="hint">提交人演示角色：{{ currentDemoRoleLabel }}。不能针对提交人自己的演示角色提交。</div></div>
        <div class="field"><label for="complaint-description">投诉说明 <span aria-hidden="true">*</span></label><textarea id="complaint-description" v-model="complaintForm.description" maxlength="240" placeholder="只填写虚构演练内容，不要输入真实个人信息"></textarea></div>
        <label class="synthetic-confirm"><input v-model="complaintSyntheticConfirmed" type="checkbox" /><span><strong>我确认本次投诉只使用演示角色和虚构内容</strong><small>这是演示角色校验，不是真实账号权限、实名举报或正式申诉流程。</small></span></label>
        <div v-if="complaintError" class="form-error" role="alert">{{ complaintError }}</div>
      </div>
      <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!complaintSyntheticConfirmed || !complaintForm.description.trim()" @click="submitComplaint">提交到复核队列</button></footer>
    </section>
  </div>
</template>
