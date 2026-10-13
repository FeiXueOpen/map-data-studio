<script setup lang="ts">
import { computed, ref } from 'vue'
import AppDialog from './AppDialog.vue'
import catalog from '../data/poi-types.json'
import { validateCategory, type PoiCategory } from '../services/categories'
const props = defineProps<{ categories: PoiCategory[] }>()
const emit = defineEmits<{ close: []; add: [item: PoiCategory]; color: [name: string, color: string]; remove: [name: string] }>()
const search = ref('')
const code = ref('')
const name = ref('')
const color = ref('#8f64e9')
const error = ref('')
const palette = ['#19a77d', '#3275e9', '#ef7d22', '#e94d47', '#8f64e9', '#0891b2', '#d53e92', '#475569']
const matches = computed(() => {
  const term = search.value.trim().toLowerCase()
  return catalog.filter((item) => term ? `${item.name} ${item.parent} ${item.group} ${item.code}`.toLowerCase().includes(term) : item.code.endsWith('00'))
})
function choose(item: (typeof catalog)[number]) {
  const previous = catalog.find((item) => item.code === code.value)
  if (!name.value || name.value === previous?.name) name.value = item.name
  code.value = item.code
  error.value = ''
}
function save() {
  const item = { name: name.value.trim(), code: code.value, color: color.value, custom: true }
  error.value = validateCategory(item, props.categories)
  if (!error.value && props.categories.length >= 30) error.value = '最多添加 30 个类型'
  if (!error.value) { emit('add', item); name.value = ''; code.value = ''; search.value = '' }
}
</script>

<template>
  <AppDialog title="自定义 POI 类型" @close="emit('close')">
    <form class="detail-form category-form" @submit.prevent="save">
      <label>选择分类<input v-model="search" placeholder="搜索分类，如：博物馆、咖啡厅、公园" /></label>
      <div class="category-catalog" aria-label="高德分类目录">
        <button v-for="item in matches" :key="item.code" type="button" :class="{ chosen: code === item.code }" @click="choose(item)"><strong>{{ item.name }}</strong><small>{{ item.group }} / {{ item.parent }}</small><span v-if="code === item.code">✓</span></button>
        <p v-if="!matches.length" class="muted">没有匹配分类，请换一个名称搜索</p>
      </div>
      <label>选项名称<input v-model="name" required maxlength="20" placeholder="在左侧显示的名称" /></label>
      <div class="category-color-field"><span>代表颜色</span><div class="color-palette"><button v-for="value in palette" :key="value" type="button" :style="{ background: value }" :class="{ chosen: color === value }" :aria-label="`选择颜色 ${value}`" :aria-pressed="color === value" @click="color = value">{{ color === value ? '✓' : '' }}</button><label class="custom-color-picker">更多颜色<input v-model="color" type="color" aria-label="自选代表颜色" /></label></div></div>
      <p v-if="error" class="failed" role="alert">{{ error }}</p>
      <button class="collect-button" type="submit">添加选项</button>
    </form>
    <div class="saved-categories"><strong>已有选项</strong><div v-for="item in categories" :key="item.name"><input type="color" :value="item.color" :aria-label="`${item.name}代表颜色`" @input="emit('color', item.name, ($event.target as HTMLInputElement).value)" /><span>{{ item.name }}</span><button v-if="item.custom" @click="emit('remove', item.name)">移除</button><small v-else>默认类型</small></div></div>
  </AppDialog>
</template>
