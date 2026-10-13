<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { getMapConfig, errorMessage, type District, type Poi } from '../services/amap'
import { defaultColors } from '../services/categories'

const props = defineProps<{ district: District | null; pois: Poi[]; selectedId: string; adding: boolean; areaTarget: Poi | null; categoryColors: Record<string, string> }>()
const emit = defineEmits<{ select: [id: string]; point: [location: [number, number]]; area: [polygon: [number, number][]]; ready: [ready: boolean] }>()
const container = ref<HTMLElement>()
const error = ref('')
const loading = ref(true)
// The SDK owns these runtime objects; application data stays strongly typed above.
let sdk: any
let map: any
let polygons: any[] = []
let markers = new Map<string, any>()
let markerContents = new Map<string, HTMLElement>()
let markerSignatures = new Map<string, string>()
let info: any
let mouseTool: any
let areaPolygon: any
let observer: ResizeObserver | undefined
let disposed = false
let script: HTMLScriptElement | undefined
let loadTimer: number | undefined
let completeTimer: number | undefined
let settleLoad: (() => void) | undefined

async function loadSdk() {
  const config = await getMapConfig()
  if (!config.jsKey) throw new Error('尚未配置高德 JS Key')
  const global = window as any
  if (global.AMap) return global.AMap
  global._AMapSecurityConfig = { securityJsCode: config.securityJsCode }
  await new Promise<void>((resolve, reject) => {
    script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.jsKey)}&plugin=AMap.Scale,AMap.ToolBar,AMap.MouseTool`
    const finish = (message?: string) => {
      window.clearTimeout(loadTimer)
      script!.onload = script!.onerror = null
      settleLoad = undefined
      if (message) { script!.remove(); reject(new Error(message)) } else resolve()
    }
    settleLoad = () => finish('地图加载已取消')
    script.onload = () => finish()
    script.onerror = () => finish('地图脚本加载失败，请检查网络后重试')
    loadTimer = window.setTimeout(() => finish('地图加载超时，请检查 JS Key、安全密钥及域名白名单'), 20000)
    document.head.appendChild(script)
  })
  if (!global.AMap?.Map) throw new Error('地图 SDK 未初始化，请检查 JS Key 配置')
  return global.AMap
}

function drawDistrict() {
  if (!map) return
  info?.close()
  if (polygons.length) map.remove(polygons)
  polygons = []
  if (areaPolygon) { map.remove(areaPolygon); areaPolygon = undefined }
  if (!props.district) return
  polygons = props.district.boundaries.map((path) => new sdk.Polygon({ path, strokeColor: '#169a76', strokeWeight: 2, fillColor: '#19a77d', fillOpacity: 0.06, bubble: true }))
  map.add(polygons)
  map.setZoomAndCenter(11, props.district.center)
  if (polygons.length) map.setFitView(polygons, false, [80, 35, 40, 35], 12)
}

function drawMarkers() {
  if (!map) return
  const visible = new Set(props.pois.filter((poi) => poi.location).map((poi) => poi.id))
  for (const [id, marker] of markers) {
    if (!visible.has(id)) { map.remove(marker); markers.delete(id); markerContents.delete(id); markerSignatures.delete(id) }
  }
  if (!visible.has(props.selectedId)) info?.close()
  const additions: any[] = []
  props.pois.forEach((poi) => {
    if (!poi.location) return
    const signature = JSON.stringify([poi.location, poi.name, poi.category, poi.source])
    const color = props.categoryColors[poi.category] || defaultColors[poi.category] || '#8f64e9'
    const className = `real-poi-marker${poi.id === props.selectedId ? ' selected' : ''}`
    if (markerSignatures.get(poi.id) === signature) {
      markerContents.get(poi.id)!.className = className
      markerContents.get(poi.id)!.style.backgroundColor = color
      return
    }
    if (markers.has(poi.id)) map.remove(markers.get(poi.id))
    const content = document.createElement('div')
    content.className = className
    content.style.backgroundColor = color
    content.textContent = poi.source === 'user' ? '+' : '●'
    const marker = new sdk.Marker({ position: poi.location, content, title: poi.name, anchor: 'center' })
    marker.on('click', () => { if (!props.areaTarget) emit('select', poi.id) })
    markers.set(poi.id, marker)
    markerContents.set(poi.id, content)
    markerSignatures.set(poi.id, signature)
    additions.push(marker)
  })
  if (additions.length) map.add(additions)
}

function focusPoi() {
  if (!map) return
  const poi = props.pois.find((item) => item.id === props.selectedId)
  if (!poi?.location) { info?.close(); return }
  const content = document.createElement('div')
  content.className = 'map-info'
  const title = document.createElement('strong')
  title.textContent = poi.name
  const address = document.createElement('p')
  address.textContent = poi.address || '地址未返回'
  content.append(title, address)
  info.setContent(content)
  map.setCenter(poi.location)
  info.open(map, poi.location)
}

async function initialize() {
  error.value = ''
  loading.value = true
  emit('ready', false)
  try {
    sdk = await loadSdk()
    if (disposed || !container.value) return
    map?.destroy()
    polygons = []
    markers.clear(); markerContents.clear(); markerSignatures.clear()
    map = new sdk.Map(container.value, { viewMode: '2D', zoom: 11, resizeEnable: true, center: props.district?.center || [120.209903, 30.246566] })
    info = new sdk.InfoWindow({ offset: new sdk.Pixel(0, -16) })
    mouseTool = new sdk.MouseTool(map)
    mouseTool.on('draw', (event: any) => {
      const path: [number, number][] = event.obj.getPath().map((point: any) => [point.getLng(), point.getLat()])
      mouseTool.close(true)
      if (areaPolygon) map.remove(areaPolygon)
      areaPolygon = new sdk.Polygon({ path, strokeColor: '#1765ef', strokeWeight: 2, fillColor: '#1765ef', fillOpacity: 0.08, bubble: true })
      map.add(areaPolygon)
      map.setDefaultCursor('grab')
      emit('area', path)
    })
    completeTimer = window.setTimeout(() => { loading.value = false; error.value = '地图未完成加载，请检查 JS Key、安全密钥及域名白名单'; emit('ready', false) }, 20000)
    map.on('complete', () => { window.clearTimeout(completeTimer); loading.value = false; error.value = ''; emit('ready', true) })
    map.on('error', (event: any) => { window.clearTimeout(completeTimer); loading.value = false; error.value = `地图服务错误：${event.info || event.message || '请检查 Key 和安全密钥'}`; emit('ready', false) })
    map.on('click', (event: any) => { if (props.adding) emit('point', [event.lnglat.getLng(), event.lnglat.getLat()]) })
    map.addControl(new sdk.Scale())
    map.addControl(new sdk.ToolBar({ position: { bottom: '55px', right: '16px' } }))
    drawDistrict()
    drawMarkers()
    observer?.disconnect()
    observer = new ResizeObserver(() => { if (map?.resize) map.resize(); else window.dispatchEvent(new Event('resize')) })
    observer.observe(container.value)
  } catch (cause) { if (!disposed) { error.value = errorMessage(cause); loading.value = false } }
}

watch(() => props.district, () => { drawDistrict(); drawMarkers() })
watch(() => props.pois, drawMarkers, { deep: true })
watch(() => props.categoryColors, drawMarkers, { deep: true })
watch(() => props.selectedId, () => { drawMarkers(); focusPoi() })
watch(() => props.adding, () => map?.setDefaultCursor(props.adding ? 'crosshair' : 'grab'))
watch(() => props.areaTarget, (target) => {
  mouseTool?.close(true)
  if (!map || !target) { map?.setDefaultCursor('grab'); return }
  if (areaPolygon) { map.remove(areaPolygon); areaPolygon = undefined }
  info?.close()
  if (target.location) map.setZoomAndCenter(15, target.location)
  map.setDefaultCursor('crosshair')
  // Draw an open chain first; the draw handler closes it as a polygon only
  // after the user finishes placing vertices.
  mouseTool.polyline({ strokeColor: '#1765ef', strokeWeight: 2 })
})
onMounted(initialize)
onUnmounted(() => { disposed = true; observer?.disconnect(); settleLoad?.(); window.clearTimeout(completeTimer); map?.destroy() })
</script>

<template>
  <div ref="container" class="amap-container"></div>
  <div v-if="loading || error" class="map-load-overlay" role="status">
    <p>{{ error || '正在加载高德地图…' }}</p><button v-if="error" @click="initialize">重试加载地图</button>
  </div>
</template>
