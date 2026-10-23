<script setup lang="ts">
import { useAplusContext } from '../context'

const {
  store,
  storageStatusLabel,
  lastSavedLabel,
  exportBackup,
  viewBackupText,
  chooseBackup,
  reloadLatestSnapshot,
  exportUnreadableBackup,
  resetDemo,
} = useAplusContext()
</script>

<template>
  <div class="synthetic-banner" role="note">
    <div class="synthetic-icon">✳</div>
    <div class="synthetic-copy">
      <strong>合成数据演练 · 不得录入真实居民信息</strong>
      <span class="synthetic-detail">表单为自由文本，无法识别或阻止真实个人信息；数据以明文保存在当前浏览器，清理后无法恢复，请定期导出备份。</span>
      <div class="storage-status" :data-state="store.storageStatus" role="status" aria-live="polite">
        {{ storageStatusLabel }}<span v-if="lastSavedLabel"> · 最近保存 {{ lastSavedLabel }}</span>
      </div>
    </div>
    <div class="banner-actions">
      <button class="button small" type="button" @click="exportBackup">导出备份</button>
      <button class="button small" type="button" @click="viewBackupText">查看备份文本</button>
      <button class="button small" type="button" @click="chooseBackup">导入备份</button>
      <button v-if="store.storageStatus === 'conflict'" class="button small" type="button" @click="reloadLatestSnapshot">重新载入最新存档</button>
      <button v-if="store.storageStatus === 'recovery-required'" class="button small" type="button" @click="exportUnreadableBackup">下载无法读取的旧存档</button>
      <button class="button small danger" type="button" @click="resetDemo">重置演练</button>
    </div>
  </div>
</template>
