<script setup lang="ts">
import { HIGH_RISK_STOP_NEXT_STEP } from '../../../domain/intake'
import { useAplusContext } from '../../context'

const {
  showHighRiskStop,
  selectedCase,
  highRiskNote,
  syntheticConfirmed,
  highRiskError,
  saveHighRiskStop,
  closeAllDialogs,
} = useAplusContext()
</script>

<template>
  <div v-if="showHighRiskStop" class="modal-backdrop" @click.self="closeAllDialogs">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="high-risk-title" aria-describedby="high-risk-title-desc">
      <header class="modal-header"><div><h2 id="high-risk-title">停止常规初筛</h2><p id="high-risk-title-desc">{{ selectedCase?.id }} · 追加高风险演练标记。</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeAllDialogs">×</button></header>
      <div class="modal-body">
        <div class="notice-inline" role="alert">{{ HIGH_RISK_STOP_NEXT_STEP }}。保存后将锁定常规初筛、模拟联系和普通状态更新，仅允许反复记录演练人工交接结果。不会实际联系、通知或调度；风险标记不会解除，也不代表真实升级已完成。</div>
        <div class="hint">自由文本无法技术性识别或阻止真实个人信息，只能填写虚构演练内容。</div>
        <div class="field"><label for="high-risk-note">停止初筛的演练依据 <span aria-hidden="true">*</span></label><textarea id="high-risk-note" v-model="highRiskNote" maxlength="240" placeholder="记录虚构演练中的标记依据"></textarea></div>
        <label class="synthetic-confirm"><input v-model="syntheticConfirmed" type="checkbox" /><span><strong>我确认本次填写内容均为虚构演练数据</strong><small>此确认仅代表操作人确认使用虚构内容；本原型无法识别或拦截真实姓名、电话、地址、健康或儿童信息。</small></span></label>
        <div v-if="highRiskError" class="form-error" role="alert">{{ highRiskError }}</div>
      </div>
      <footer class="modal-footer"><button class="button" type="button" @click="closeAllDialogs">取消</button><button class="button danger" type="button" :disabled="!syntheticConfirmed || !highRiskNote.trim()" @click="saveHighRiskStop">停止初筛并记录</button></footer>
    </section>
  </div>
</template>
