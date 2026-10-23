<script setup lang="ts">
import { useAplusContext } from '../context'

const { store, roles, showHelp } = useAplusContext()
</script>

<template>
  <header class="topbar">
    <div class="topbar-identity" aria-hidden="true"><span class="topbar-logo">邻</span><span class="topbar-name">邻里服务台</span></div>
    <div class="crumb">社区服务 <span aria-hidden="true">/</span> A+ 登记队列</div>
    <div class="top-actions">
      <span class="demo-pill"><i class="demo-dot"></i><span class="demo-pill-text">合成数据演练</span></span>
      <label class="role-select"><span>角色</span>
        <select v-model="store.currentDemoRole" aria-label="切换演示角色">
          <option v-for="role in roles" :key="role.value" :value="role.value">{{ role.label }}</option>
        </select>
      </label>
      <button class="icon-button" type="button" title="打开使用说明" aria-label="打开使用说明" @click="showHelp = true">i</button>
    </div>
  </header>
</template>
