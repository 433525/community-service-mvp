<script setup lang="ts">
import { useAplusContext } from '../context'

const { store, openCreate, openCommunityBridge } = useAplusContext()
</script>

<template>
  <nav class="mobile-nav" aria-label="移动导航">
    <button class="active" type="button"><span>▦</span><span>登记</span></button>
    <button type="button" :disabled="store.intakePaused" @click="openCreate"><span>＋</span><span>新建</span></button>
    <button type="button" @click="openCommunityBridge"><span>◎</span><span>社区求助</span></button>
    <a href="/community.html"><span aria-hidden="true">◎</span><span>社区</span></a>
  </nav>
</template>
