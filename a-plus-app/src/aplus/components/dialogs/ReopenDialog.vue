<script setup lang="ts">
import { INTAKE_PAUSED_NOTICE } from '../../../stores/intake'
import { useAplusContext } from '../../context'

const {
  showReopen,
  selectedCase,
  store,
  reopenForm,
  syntheticConfirmed,
  reopenError,
  createReopenedRecord,
  closeAllDialogs,
} = useAplusContext()
</script>

<template>
  <div v-if="showReopen" class="modal-backdrop" @click.self="closeAllDialogs">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="reopen-title" aria-describedby="reopen-title-desc">
      <header class="modal-header"><div><h2 id="reopen-title">建立关联重开演练记录</h2><p id="reopen-title-desc">{{ selectedCase?.id }} · 新建开放记录并关联原记录。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
      <div class="modal-body">
        <div v-if="store.intakePaused" class="notice-inline" role="alert">{{ INTAKE_PAUSED_NOTICE }} 请先恢复新登记再建立关联记录。</div>
        <div class="notice-inline">重开会创建一条新的合成演练记录，原记录及时间线保留不变。自由文本无法技术性识别或拦截真实个人信息，只能填写虚构内容。</div>
        <div class="form-row">
          <div class="field"><label for="reopen-owner">负责人 <span aria-hidden="true">*</span></label><input id="reopen-owner" v-model="reopenForm.owner" maxlength="40" /></div>
          <div class="field"><label for="reopen-due">演练跟进截止 <span aria-hidden="true">*</span></label><input id="reopen-due" v-model="reopenForm.dueAt" type="datetime-local" /><div class="hint">默认值仅用于演练，不构成运营 SLA。</div></div>
        </div>
        <div class="field"><label for="reopen-next">下一步 <span aria-hidden="true">*</span></label><input id="reopen-next" v-model="reopenForm.nextStep" maxlength="120" /></div>
        <div class="field"><label for="reopen-note">重开原因 <span aria-hidden="true">*</span></label><textarea id="reopen-note" v-model="reopenForm.note" maxlength="160" placeholder="填写虚构演练原因"></textarea></div>
        <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
        <div v-if="reopenError" class="form-error" role="alert">{{ reopenError }}</div>
      </div>
      <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!syntheticConfirmed || store.intakePaused" @click="createReopenedRecord">创建关联记录</button></footer>
    </section>
  </div>
</template>
