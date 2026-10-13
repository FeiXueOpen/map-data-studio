<script setup lang="ts">
import { ref, watch } from 'vue'
const props = defineProps<{ url?: string; name: string; compact?: boolean }>()
const failed = ref(false)
const retry = ref(0)
watch(() => props.url, () => { failed.value = false; retry.value = 0 })
</script>

<template>
  <div class="poi-photo" :class="{ compact }">
    <img v-if="url && !failed" :key="`${url}-${retry}`" :src="url" :alt="`${name}照片`" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="failed = true" />
    <div v-else class="photo-placeholder" :title="failed ? '图片链接加载失败' : '接口未返回图片'">
      <slot><span>{{ failed ? '图片加载失败' : '暂无图片' }}</span></slot>
      <button v-if="failed && !compact" type="button" @click="failed = false; retry++">重新加载</button>
    </div>
  </div>
</template>
