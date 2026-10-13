<script setup lang="ts">
import { onMounted, ref } from 'vue'
defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
onMounted(() => dialog.value?.showModal())
</script>
<template>
  <dialog ref="dialog" class="city-dialog app-dialog" aria-labelledby="app-dialog-title" @cancel.prevent="emit('close')" @click.self="emit('close')">
    <header class="city-picker-header"><h2 id="app-dialog-title">{{ title }}</h2><button class="city-dialog-close" aria-label="关闭弹窗" @click="emit('close')"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></header>
    <div class="app-dialog-body"><slot /></div>
  </dialog>
</template>
