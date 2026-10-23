<script setup lang="ts">
import { useAplusContext } from '../../context'

const { showHelp } = useAplusContext()
</script>

<template>
  <div v-if="showHelp" class="modal-backdrop" @click.self="showHelp = false">
    <section class="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="aplus-help-title" aria-describedby="aplus-help-desc">
      <header class="modal-header">
        <div>
          <span class="eyebrow">DEMO GUIDE</span>
          <h2 id="aplus-help-title">A+ 受理演练使用说明</h2>
          <p id="aplus-help-desc">解释演练角色、记录流程与本机数据边界；关闭不会修改任何记录。</p>
        </div>
        <button class="icon-button" type="button" aria-label="关闭使用说明" @click="showHelp = false">×</button>
      </header>
      <div class="modal-body">
        <div class="help-section-grid">
          <section class="help-section"><h3>1. 演练角色</h3><p>受理席、复核席、转介席只用于展示分工，不是登录、权限或真实身份。当前角色会写入之后的时间线。</p></section>
          <section class="help-section"><h3>2. 记录流程</h3><p>新建记录 → 开始初筛 → 标记待补充 → 记录已提供信息 → 进入待分诊 → 登记转介 → 录入接收确认。已提供信息可直接进入待分诊；如仍需初筛，可从“待补充”恢复初筛。已结束记录可另建关联记录。</p></section>
          <section class="help-section"><h3>3. 重复与投诉</h3><p>标签或摘要完全重复时会暂停创建，需勾选确认并填写复核说明；投诉进入独立复核队列，不会改写风险标记或跟进时间线。</p></section>
          <section class="help-section"><h3>4. 高风险交接</h3><p>标记高风险后停止普通初筛、联系模拟与状态操作，只保留可反复登记的人工交接结果。这不代表真实人员已接手或风险已解除。</p></section>
          <section class="help-section"><h3>5. 存档与备份</h3><p>数据只保存在当前浏览器，可用“导出备份”保存 JSON；“导入备份”会校验后整体替换。发现无法读取的旧存档时，须先下载原文才能重置。</p></section>
          <section class="help-section"><h3>6. 使用边界</h3><p>没有后端、真实账号、通知投递或生产权限；不会联系居民或机构，也不是紧急求助通道。请只使用虚构内容。</p></section>
        </div>
        <p class="notice-inline">推荐演示顺序：新建记录 → 初筛 → 待补充 → 已提供信息 → 待分诊 → 转介 → 接收确认；再试一次高风险人工交接与导出备份。</p>
      </div>
      <footer class="modal-footer">
        <small class="help-foot-note">所有记录仅保存在当前浏览器；本页不代表真实受理、服务授权或风险处置。</small>
        <button class="button primary" type="button" data-autofocus @click="showHelp = false">知道了</button>
      </footer>
    </section>
  </div>
</template>
