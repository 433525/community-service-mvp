<template>
  <div class="view-status view-error" role="alert">
    <p>页面载入失败，可能是本机资源暂时不可用。当前存档没有被修改。</p>
    <button class="button-ghost" type="button" @click="reload">重新载入</button>
  </div>
</template>

<script setup lang="ts">
function reload() {
  window.location.reload()
}
</script>
