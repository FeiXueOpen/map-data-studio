<script setup lang="ts">
import { ref } from 'vue'
import PoiPhoto from './PoiPhoto.vue'
import type { Poi } from '../services/amap'
const props = defineProps<{ items: Poi[]; getChildren: (id: string) => Poi[]; color: (category: string) => string; ancestors: string[] }>()
const emit = defineEmits<{ select: [id: string, parentId: string] }>()
const expanded = ref(new Set<string>())
const statuses = { pending: '详情待采集', done: '已采集', error: '采集失败', manual: '用户补录' }
const nested = (poi: Poi) => props.getChildren(poi.id).filter((child) => ![...props.ancestors, poi.id].includes(child.id))
function toggle(id: string) { if (expanded.value.has(id)) expanded.value.delete(id); else expanded.value.add(id) }
</script>
<template>
  <div class="child-poi-list">
    <div v-for="poi in items" :key="`${poi.parentId}/${poi.id}`" class="child-poi-item">
      <div class="child-poi-summary">
        <PoiPhoto :url="poi.photos[0]" :name="poi.name" compact><span :style="{ color: color(poi.category) }">↳</span></PoiPhoto>
        <div class="child-poi-content"><button class="poi-title" @click="emit('select', poi.id, poi.parentId)" :title="poi.name">{{ poi.name }}</button><p>{{ poi.address || '地址未返回' }}</p><small :class="{ failed: poi.status === 'error' }">{{ poi.relation === 'area' ? '范围内点位' : '高德关联子点' }} · {{ statuses[poi.status] }} · {{ poi.photos.length }} 张图片</small></div>
        <span class="category-pill" :style="{ color: color(poi.category), background: color(poi.category) + '18' }">{{ poi.category }}</span>
        <button class="child-detail-button" @click="emit('select', poi.id, poi.parentId)">详情</button>
      </div>
      <p class="child-poi-fields">{{ poi.hours || (poi.status === 'pending' ? '营业时间待查询' : '营业时间未返回') }}<span>{{ poi.location ? poi.location.map((value) => value.toFixed(5)).join('，') : '坐标未返回' }}</span></p>
      <p v-if="poi.error" class="failed child-poi-error">{{ poi.error }}</p>
      <button v-if="nested(poi).length" class="child-toggle" :aria-expanded="expanded.has(poi.id)" @click="toggle(poi.id)">{{ expanded.has(poi.id) ? '收起' : '展开' }}下级点位（{{ nested(poi).length }}）</button>
      <ChildPoiList v-if="expanded.has(poi.id)" :items="nested(poi)" :get-children="getChildren" :color="color" :ancestors="[...ancestors, poi.id]" @select="(id, parentId) => emit('select', id, parentId)" />
    </div>
  </div>
</template>
