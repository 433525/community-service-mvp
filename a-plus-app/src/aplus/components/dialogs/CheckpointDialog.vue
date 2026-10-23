<script setup lang="ts">
import { CHECKPOINT_SYNTHETIC_NOTICE, CONSENT_STATUSES } from '../../../domain/intake'
import { useAplusContext } from '../../context'

const {
  showCheckpoint,
  selectedCase,
  checkpointForm,
  checkpointError,
  saveCheckpoint,
  closeAllDialogs,
} = useAplusContext()
</script>

<template>
  <div v-if="showCheckpoint" class="modal-backdrop" @click.self="closeAllDialogs">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="checkpoint-title" aria-describedby="checkpoint-title-desc">
      <header class="modal-header"><div><h2 id="checkpoint-title">更新登记检查点</h2><p id="checkpoint-title-desc">{{ selectedCase?.id }} · 每次更新都会追加时间线记录。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
      <div class="modal-body">
        <div class="notice-inline" role="note">{{ CHECKPOINT_SYNTHETIC_NOTICE }} 只有同意状态为“已确认”且必填信息已完整时，才会开放普通接单、转介、跟进和模拟联系；高风险停止与人工交接通道不受限制。</div>
        <div class="field"><label for="checkpoint-consent">演练同意状态 <span aria-hidden="true">*</span></label><select id="checkpoint-consent" v-model="checkpointForm.consentStatus"><option v-for="status in CONSENT_STATUSES" :key="status.value" :value="status.value">{{ status.label }}</option></select></div>
        <label class="synthetic-confirm"><input v-model="checkpointForm.requiredInfoComplete" type="checkbox" /><span><strong>演练必填信息已完整</strong><small>仅表示虚构案例的必填字段齐备，不代表真实身份核验、法律同意或服务资格。</small></span></label>
        <div class="field"><label for="checkpoint-note">检查点更新说明 <span aria-hidden="true">*</span></label><textarea id="checkpoint-note" v-model="checkpointForm.note" maxlength="160" placeholder="只写虚构演练说明，不要输入真实个人信息"></textarea></div>
        <div class="hint">旧记录缺少检查点字段时按“未知 / 未完整”解释。重开记录会重置为“未知 / 未完整”。</div>
        <div v-if="checkpointError" class="form-error" role="alert">{{ checkpointError }}</div>
      </div>
      <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button primary" type="button" :disabled="!checkpointForm.note.trim()" @click="saveCheckpoint">保存检查点</button></footer>
    </section>
  </div>
</template>
