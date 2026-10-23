<script setup lang="ts">
import { useAplusContext } from '../context'

const { backupText, backupTextInput } = useAplusContext()
</script>

<template>
  <section v-if="backupText" class="panel" aria-label="合成备份文本">
    <div class="panel-head">
      <h2 class="panel-title">合成备份文本</h2>
      <button class="button small" type="button" @click="backupText = ''">关闭备份文本</button>
    </div>
    <div class="field">
      <label for="backup-text">打开时生成的完整 JSON 快照（只读）</label>
      <textarea id="backup-text" ref="backupTextInput" :value="backupText" readonly :spellcheck="false" rows="8" @focus="backupTextInput?.select()" />
      <p class="notice-inline">点击文本框全选后复制，粘贴到记事本，以 UTF-8 保存为 .json 文件。请保留完整内容，之后可使用“导入备份”恢复；保存后关闭此区域。若记录有更新，请重新点击“查看备份文本”。</p>
    </div>
  </section>
</template>
