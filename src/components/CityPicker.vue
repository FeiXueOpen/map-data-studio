<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { getCities, getProvinces, type CitySelection, type Region } from '../services/cities'

const props = defineProps<{ selection: CitySelection | null; cityName: string }>()
const emit = defineEmits<{ close: []; select: [selection: CitySelection] }>()
const dialog = ref<HTMLDialogElement>()
const provinces = ref<Region[]>([])
const cities = ref<Region[]>([])
const provinceId = ref<number | null>(null)
const provinceLoading = ref(false)
const cityLoading = ref(false)
const provinceError = ref('')
const cityError = ref('')
const search = ref('')
let generation = 0
let disposed = false
const province = computed(() => provinces.value.find((item) => item.id === provinceId.value))
const visibleCities = computed(() => {
  const query = search.value.trim().toLowerCase()
  return cities.value.filter((item) => `${item.name} ${item.pinyin} ${item.first}`.toLowerCase().includes(query))
})
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

async function loadProvinces() {
  provinceLoading.value = true
  provinceError.value = ''
  try {
    const records = await getProvinces()
    if (disposed) return
    provinces.value = records
    provinceId.value = records.find((item) => item.id === props.selection?.province.id)?.id
      ?? records.find((item) => item.name === '浙江省')?.id ?? records[0]?.id ?? null
  } catch (error) {
    if (!disposed) provinceError.value = errorMessage(error)
  } finally {
    if (!disposed) provinceLoading.value = false
  }
}

async function loadCities() {
  const current = ++generation
  cities.value = []
  cityError.value = ''
  search.value = ''
  if (provinceId.value === null) return
  cityLoading.value = true
  try {
    const records = await getCities(provinceId.value)
    if (!disposed && current === generation) cities.value = records
  } catch (error) {
    if (!disposed && current === generation) cityError.value = errorMessage(error)
  } finally {
    if (!disposed && current === generation) cityLoading.value = false
  }
}

function selectCity(city: Region) {
  if (province.value) emit('select', { province: province.value, city })
}

watch(provinceId, loadCities)
onMounted(() => {
  dialog.value?.showModal()
  void loadProvinces()
})
onUnmounted(() => { disposed = true; generation++ })
</script>

<template>
  <dialog ref="dialog" class="city-dialog" aria-labelledby="city-dialog-title" @cancel.prevent="emit('close')" @click.self="emit('close')">
    <div class="city-picker">
      <header class="city-picker-header">
        <div><h2 id="city-dialog-title">选择城市</h2><p>先选择省份，再选择采集城市</p></div>
        <button type="button" class="city-dialog-close" aria-label="关闭城市选择" @click="emit('close')"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
      </header>
      <div v-if="provinceLoading" class="city-feedback" role="status">正在加载省份…</div>
      <div v-else-if="provinceError" class="city-feedback" role="alert">{{ provinceError }}<button @click="loadProvinces">重新加载</button></div>
      <div v-else-if="!provinces.length" class="city-feedback">接口暂未提供省份</div>
      <div v-else class="city-picker-body">
        <nav class="province-list" aria-label="省份">
          <button v-for="item in provinces" :key="item.id" :class="{ active: provinceId === item.id }" :aria-pressed="provinceId === item.id" @click="provinceId = item.id">{{ item.name }}</button>
        </nav>
        <section class="city-options">
          <div class="city-options-header"><strong>{{ province?.name }}</strong><span v-if="!cityLoading && !cityError">{{ cities.length }} 个城市</span></div>
          <input v-model="search" class="city-search" aria-label="搜索城市" placeholder="输入城市名称或拼音" :disabled="cityLoading || !!cityError" />
          <div v-if="cityLoading" class="city-feedback" role="status">正在加载城市…</div>
          <div v-else-if="cityError" class="city-feedback" role="alert">{{ cityError }}<button @click="loadCities">重试</button></div>
          <div v-else-if="!cities.length" class="city-feedback">该省份暂无可选城市</div>
          <div v-else-if="!visibleCities.length" class="city-feedback">没有匹配的城市</div>
          <div v-else class="city-grid">
            <button v-for="item in visibleCities" :key="item.id" :class="{ active: props.selection ? props.selection.city.id === item.id : props.cityName === item.name }" @click="selectCity(item)">{{ item.name }}</button>
          </div>
        </section>
      </div>
      <footer class="city-picker-footer">当前城市：{{ cityName }}<span>城市目录由旅小略接口提供</span></footer>
    </div>
  </dialog>
</template>
