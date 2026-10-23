<script setup lang="ts">
import { useAplusContext } from '../context'

const { anyDialogOpen, currentDemoRoleLabel } = useAplusContext()
</script>

<template>
  <aside class="side-rail" aria-label="主导航" :inert="anyDialogOpen">
    <div class="brand">
      <div class="brand-mark">邻</div>
      <div class="brand-name">邻里服务台<small>COMMUNITY OPERATIONS</small></div>
    </div>
    <div class="nav-label">A+ 内部演练原型</div>
    <nav class="nav-list">
      <button class="nav-item active" type="button" aria-current="page"><span class="nav-icon" aria-hidden="true">▦</span><span>登记队列</span></button>
    </nav>
    <div class="nav-label nav-label-secondary">相关入口</div>
    <nav class="nav-list" aria-label="相关入口">
      <a class="nav-item nav-link" href="/community.html">
        <span class="nav-icon" aria-hidden="true">◎</span><span class="nav-label">社区演练</span><span class="nav-arrow" aria-hidden="true">↗</span>
      </a>
    </nav>
    <div class="rail-spacer"></div>
    <div class="pilot-card">
      <strong>受控演练空间</strong>
      <p>所有记录均为虚构场景。此页面不接收居民申请，也不发送联系或服务通知。</p>
    </div>
    <div class="user-chip">
      <div class="avatar">演</div>
      <div><strong>{{ currentDemoRoleLabel }}</strong><small>仅供流程演练</small></div>
    </div>
  </aside>
</template>
