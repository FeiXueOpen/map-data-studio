<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import CityPicker from './components/CityPicker.vue'
import AmapView from './components/AmapView.vue'
import PoiPhoto from './components/PoiPhoto.vue'
import ChildPoiList from './components/ChildPoiList.vue'
import CategoryDialog from './components/CategoryDialog.vue'
import AppDialog from './components/AppDialog.vue'
import ImageDownloadDialog from './components/ImageDownloadDialog.vue'
import { descendantIds } from './services/collectChildren'
import type { ImageOptions } from './services/images'
import SettingsDialog from './components/SettingsDialog.vue'
import type { CitySelection } from './services/cities'
import { symbols, type Poi } from './services/amap'
import { fieldStatus } from './services/export'
import { exportFields, resolvedField } from './services/poiFields'
import { usePanelResize } from './composables/usePanelResize'
import { useAutomation } from './composables/useAutomation'
import { useWorkbench } from './composables/useWorkbench'

const { workspace, sidebar, dataPanel, resizing, panelStyle, currentWidth, maxWidth, startResize, moveResize, stopResize, resizeWithKeyboard } = usePanelResize()
const workbench = useWorkbench()
const { busy: automationBusy } = useAutomation(workbench)
const {
  city, selection: citySelection, district, categories, selectedTypes, keyword, listSearch, activeFilter, sort, filters,
  pois, children, childPois, filteredPois, visiblePois, selectedPoi, includedCount, failedCount, page, pageCount, hasMore, queryDirty,
  cityBusy, isPreviewing, previewState, previewProgress, isCollecting, areaProgress, areaNotice, areaTarget, isExporting, mapReady, error, toast, adding, selectedId, detailOpen, jobs, activeJob, status,
  changeCity, runPreview, cancelPreview, toggleType, categoryColor, addCategory, updateCategoryColor, removeCategory, openPoi, requestAreaSelection, finishAreaSelection, cancelAreaSelection, startCollection, cancelCollection, exportData, addManual,
} = workbench
const imageDialogOpen = ref(false)
const imageDialogPoi = ref<Poi | null>(null)
const imageScopeName = computed(() => imageDialogPoi.value?.name || `已纳入的 ${includedCount.value} 个主点位`)
async function beginImageDownload(options: ImageOptions) {
  const roots = imageDialogPoi.value ? [imageDialogPoi.value] : pois.value.filter(p => p.included)
  const tree = descendantIds(roots.map(p => p.id), children.value)
  const records = options.includeChildren ? [...roots, ...children.value.filter(p => tree.has(p.parentId))] : roots
  try { await workbench.downloadImages(records, options) } catch(e) { workbench.notify(String(e)) }
}
const expandedParents = ref(new Set<string>())
const selectedParentName = computed(() => { const id = selectedPoi.value?.parentId; return id ? pois.value.find((poi) => poi.id === id)?.name || children.value.find((poi) => poi.id === id)?.name || id : '' })
const mapPois = computed(() => {
  const records = [...filteredPois.value, ...children.value.filter((poi) => expandedParents.value.has(poi.parentId))]
  if (selectedPoi.value && !records.some((poi) => poi.id === selectedPoi.value!.id)) records.push(selectedPoi.value)
  return [...new Map(records.map((poi) => [poi.id, poi])).values()]
})
function beginAreaSearch() {
  if (!selectedPoi.value || !mapReady.value || isCollecting.value || isPreviewing.value) return
  try { requestAreaSelection(selectedPoi.value) } catch (cause) { workbench.notify(cause instanceof Error ? cause.message : '无法开始圈选') }
}
function finishAreaSearch(polygon: [number, number][]) {
  const parent = areaTarget.value
  if (parent) { expandedParents.value.add(parent.id); void finishAreaSelection(polygon) }
}
function toggleChildren(id: string) { if (expandedParents.value.has(id)) expandedParents.value.delete(id); else expandedParents.value.add(id) }
watch(isCollecting, (busy, previous) => { if (previous && !busy) visiblePois.value.filter((poi) => childPois(poi.id).length).forEach((poi) => expandedParents.value.add(poi.id)) })
watch(district, () => { expandedParents.value.clear(); cancelAreaSelection() })
const appWindow = isTauri() ? getCurrentWindow() : null
const cityPickerOpen = ref(false)
const historyOpen = ref(false)
const settingsOpen = ref(false)
const categoryDialogOpen = ref(false)
const categoryColors = computed(() => Object.fromEntries(categories.value.map((item) => [item.name, item.color])))
const manualOpen = ref(false)
const manualDraft = reactive({ name: '', address: '', hours: '', location: [0, 0] as [number, number] })
const allIncluded = computed(() => filteredPois.value.length > 0 && filteredPois.value.every((poi) => poi.included))
const statuses: Record<Poi['status'], string> = { pending: '待采集', done: '已采集', error: '失败', manual: '用户补录' }
function selectCity(selection: CitySelection) { if (automationBusy.value) return; cityPickerOpen.value = false; manualOpen.value = false; void changeCity(selection) }
function selectPoint(location: [number, number]) {
  manualDraft.name = ''; manualDraft.address = ''; manualDraft.hours = ''; manualDraft.location = location; manualOpen.value = true
}
function saveManual() {
  if (addManual(manualDraft.name, manualDraft.address, manualDraft.location, manualDraft.hours)) manualOpen.value = false
}
function toggleAll(event: Event) { const checked = (event.target as HTMLInputElement).checked; filteredPois.value.forEach((poi) => { poi.included = checked }) }
const coordinate = (poi: Poi) => poi.location ? `${poi.location[0].toFixed(5)}\n${poi.location[1].toFixed(5)}` : '未返回'
const dateTime = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—'
async function minimizeWindow() { await appWindow?.minimize() }
async function toggleMaximizeWindow() { await appWindow?.toggleMaximize() }
async function closeWindow() { await appWindow?.close() }
</script>

<template>
  <main class="app-shell">
    <header class="titlebar" data-tauri-drag-region="deep">
      <div class="brand-mark">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.75c-6.2 0-11.25 4.94-11.25 11.02 0 7.75 9.45 14.16 10.47 14.84a1.38 1.38 0 0 0 1.56 0c1.02-.68 10.47-7.09 10.47-14.84C27.25 7.69 22.2 2.75 16 2.75Z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="16" cy="13.8" r="3.65" fill="currentColor"/></svg>
      </div>
      <div class="brand-name">Map Data Studio</div>
      <div class="brand-divider"></div>
      <div class="brand-tagline">让地理数据创造更多可能</div>
      <div class="window-actions" data-tauri-drag-region="false">
        <button type="button" class="window-button" aria-label="最小化" title="最小化" :disabled="!appWindow" @click="minimizeWindow"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg></button>
        <button type="button" class="window-button maximize-button" aria-label="最大化或还原" title="最大化或还原" :disabled="!appWindow" @click="toggleMaximizeWindow"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx=".5" /></svg></button>
        <button type="button" class="window-button close-button" aria-label="关闭" title="关闭" :disabled="!appWindow" @click="closeWindow"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg></button>
      </div>
    </header>

    <div ref="workspace" class="workspace" :class="{ 'is-resizing': resizing }" :style="panelStyle">
      <aside ref="sidebar" class="sidebar">
        <nav class="primary-nav">
          <button class="nav-item active"><span class="nav-icon">⌂</span>采集工作台</button>
          <button class="nav-item" @click="historyOpen = true"><span class="nav-icon">◷</span>历史任务</button>
          <button class="nav-item" @click="settingsOpen = true"><span class="nav-icon">⚙</span>设置</button>
        </nav>

        <div class="filter-panel">
          <div class="section-label">采集范围</div>
          <button class="select-control" :disabled="automationBusy" @click="cityPickerOpen = true"><span class="pin-icon">●</span>{{ city }}<svg class="chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></button>

          <div class="section-label type-label">POI 类型</div>
          <div class="type-grid">
            <button v-for="type in categories" :key="type.name" class="type-option" :disabled="automationBusy" :class="{ checked: selectedTypes.includes(type.name) }" @click="toggleType(type.name)">
              <span class="check-box" :style="{ borderColor: type.color, background: selectedTypes.includes(type.name) ? type.color : 'transparent' }">{{ selectedTypes.includes(type.name) ? '✓' : '' }}</span>{{ type.name }}
            </button>
          </div>

          <button class="add-category-button" :disabled="automationBusy" @click="categoryDialogOpen = true"><span aria-hidden="true">＋</span>自定义类型</button>

          <div class="section-label keyword-label">关键词 <small>（可选）</small></div>
          <div class="search-input"><span>⌕</span><input :disabled="automationBusy" v-model="keyword" placeholder="例如：西湖、博物馆、咖啡" /></div>
          <button class="preview-button" :disabled="automationBusy || isPreviewing || cityBusy || isCollecting || !district" @click="runPreview()"><span>▶</span>{{ isPreviewing ? '正在查询…' : isCollecting ? '正在采集详情…' : '开始查询并采集' }}</button>
          <p class="city-preview-note">{{ queryDirty ? '条件已修改，点击重新查询并采集' : previewState === 'idle' ? '点击后逐页查询，再采集详情与关联数据；导出时保存本次导出点位的高德图片。' : '自动查询全部可返回结果，并采集详情、子点位和图片。' }}</p>
        </div>

        <div class="sidebar-foot">
          <div class="mountain-art"><span>⌁</span><span>♜</span><span>⌁</span></div>
          <div>用数据，发现更大的世界</div>
          <small>Map Data Studio v1.0.0</small>
        </div>
      </aside>

      <section class="map-section">
        <div class="map-toolbar">
          <button class="map-city" :disabled="automationBusy" @click="cityPickerOpen = true"><span class="map-pin">●</span>{{ city }}<svg class="chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></button>
          <button class="add-point-button" :disabled="automationBusy || !mapReady || !district || cityBusy || !!areaTarget || isCollecting" :class="{ active: adding }" @click="adding = !adding"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg><span>手动补点</span></button>
        </div>
        <AmapView :category-colors="categoryColors" :district="district" :pois="mapPois" :selected-id="selectedId" :adding="adding" :area-target="areaTarget" @area="finishAreaSearch" @select="openPoi" @point="selectPoint" @ready="mapReady = $event" />
        <div v-if="cityBusy || !district" class="city-map-overlay" role="status"><p>{{ cityBusy ? `正在定位${city}…` : error || '城市尚未定位' }}</p><button v-if="!cityBusy" @click="changeCity()">重试定位</button></div>
        <div v-if="areaTarget" class="map-add-hint area-draw-hint">沿「{{ areaTarget.name }}」边界逐点连线，至少 3 个顶点；双击结束并闭合范围<button @click="cancelAreaSelection">取消圈选</button></div>
        <div v-if="adding && district && !cityBusy" class="map-add-hint">点击地图选择补录位置<button @click="adding = false">取消</button></div>
      </section>

      <div
        class="panel-resizer"
        role="separator"
        tabindex="0"
        aria-label="调整地图与 POI 列表宽度"
        aria-orientation="vertical"
        aria-controls="poi-data-panel"
        :aria-valuenow="currentWidth"
        :aria-valuemin="475"
        :aria-valuemax="maxWidth"
        :aria-valuetext="`POI 列表宽度 ${currentWidth} 像素`"
        title="左右拖动调整宽度，也可使用左右方向键"
        @pointerdown="startResize"
        @pointermove="moveResize"
        @pointerup="stopResize"
        @pointercancel="stopResize"
        @lostpointercapture="stopResize"
        @keydown="resizeWithKeyboard"
      ><span aria-hidden="true"></span></div>

      <aside id="poi-data-panel" ref="dataPanel" class="data-panel">
        <div class="data-header"><h1>POI 数据</h1><span>已加载 {{ pois.length }} 个点位</span></div>
        <div class="data-controls">
          <div class="filter-tabs"><button v-for="filter in filters" :key="filter" :class="{ active: activeFilter === filter }" @click="activeFilter = filter">{{ filter }}<small v-if="filter === '全部'">（{{ pois.length }}）</small></button></div>
          <select v-model="sort" class="sort-button" aria-label="列表排序"><option value="default">接口顺序</option><option value="name">名称排序</option><option value="category">类型排序</option></select>
        </div>
        <div class="table-tools">
          <div class="table-search"><span>⌕</span><input v-model="listSearch" aria-label="搜索 POI 名称" placeholder="搜索 POI 名称" /></div>
          <div class="data-actions">
            <button class="export-button" :disabled="automationBusy || isCollecting || workbench.isDownloadingImages.value || !includedCount" @click="imageDialogPoi = null; imageDialogOpen = true">联网补图</button>
            <button class="export-button" :disabled="automationBusy || !includedCount || isExporting || isCollecting" @click="exportData()"><span aria-hidden="true">⇩</span>{{ isExporting ? '正在导出…' : '导出景区 Excel' }}</button>
          </div>
        </div>
        <div class="data-subtools"><label><input type="checkbox" :checked="allIncluded" :disabled="automationBusy || isCollecting" @change="toggleAll" />纳入 {{ includedCount }} 条</label><span>关联子点 {{ children.filter(poi => poi.relation !== 'area').length }} · 范围点位 {{ children.filter(poi => poi.relation === 'area').length }}</span><button v-if="failedCount" :disabled="automationBusy || isCollecting" @click="startCollection(true)">重试 {{ failedCount }} 条失败项</button><button v-if="isCollecting" @click="cancelCollection">取消采集</button></div>
        <div v-if="error" class="workbench-error" role="alert">{{ error }}<button aria-label="收起错误提示" @click="error = ''">×</button></div>
        <div v-if="previewState !== 'idle'" class="preview-progress" role="status"><div><strong>{{ previewProgress }}</strong><button v-if="isPreviewing" @click="cancelPreview">取消加载</button><button v-else-if="hasMore" :disabled="isCollecting || cityBusy" @click="runPreview(true)">继续加载</button></div><progress v-if="isPreviewing" aria-label="正在逐页加载 POI"></progress></div>
        <div v-if="workbench.imageBrowserStatus.value.state === 'awaiting_user' && workbench.isDownloadingImages.value" class="area-notice" role="status">{{ workbench.imageBrowserStatus.value.message }}</div>
        <div v-if="workbench.imageProgress.value" class="preview-progress" role="status"><strong>{{ workbench.imageProgress.value }}</strong><progress></progress></div>
        <div v-if="workbench.imageReport.value" class="area-notice">{{ workbench.imageReport.value }} <button @click="imageDialogPoi = null; imageDialogOpen = true">查看下载记录</button></div>
        <div v-if="areaProgress" class="preview-progress" role="status"><strong>{{ areaProgress }}</strong><progress aria-label="正在逐页搜索范围内点位"></progress></div>
        <div v-if="areaNotice" class="area-notice" role="status">{{ areaNotice }}</div>
        <div v-if="isCollecting && activeJob" class="collection-progress"><progress :value="activeJob.completed + activeJob.failed" :max="activeJob.total"></progress><span>{{ activeJob.completed + activeJob.failed }} / {{ activeJob.total }} · 子点详情 {{ activeJob.childCompleted || 0 }} / {{ activeJob.childTotal || 0 }}</span></div>
        <div class="table-scroll">
        <div class="table-head"><span>名称</span><span>类型</span><span>开放时间</span><span>经度 / 纬度</span><span>操作</span></div>
        <div class="poi-list">
          <div v-if="!filteredPois.length" class="poi-empty">{{ cityBusy || isPreviewing ? '正在加载…' : previewState === 'idle' ? '请选择查询条件，点击「开始查询并采集」加载点位' : '暂无点位，请调整条件后预览' }}</div>
          <div v-for="poi in visiblePois" :key="poi.id" class="poi-group"><article class="poi-row" :class="{ excluded: !poi.included, selected: poi.id === selectedId }">
            <div class="poi-main"><input v-model="poi.included" type="checkbox" :disabled="automationBusy || isCollecting" :aria-label="`纳入${poi.name}`" /><PoiPhoto :url="poi.photos[0]" :name="poi.name" compact><span :style="{ color: categoryColor(poi.category) }">{{ symbols[poi.category] || '●' }}</span></PoiPhoto><div><button class="poi-title" @click="openPoi(poi.id)" :title="poi.name">{{ poi.name }}</button><p>{{ poi.address || '地址未返回' }}</p><small :class="{ failed: poi.status === 'error' }">{{ statuses[poi.status] }}</small><button v-if="childPois(poi.id).length" class="child-toggle" :aria-expanded="expandedParents.has(poi.id)" @click="toggleChildren(poi.id)">{{ expandedParents.has(poi.id) ? '收起' : '展开' }}关联/范围点位（{{ childPois(poi.id).length }}）</button><small v-else-if="poi.status === 'done'">接口未返回关联子点位</small></div></div>
            <span class="category-pill" :style="{ color: categoryColor(poi.category), background: categoryColor(poi.category) + '18' }">{{ poi.category }}</span>
            <span class="hours">{{ poi.hours || '未返回' }}</span>
            <span class="coordinate">{{ coordinate(poi) }}</span>
            <button class="more-button" :aria-label="`查看${poi.name}详情`" @click="openPoi(poi.id)">•••</button>
          </article><ChildPoiList v-if="expandedParents.has(poi.id)" :items="childPois(poi.id)" :get-children="childPois" :color="categoryColor" :ancestors="[poi.id]" @select="openPoi" /></div>
        </div>
        </div>
        <div class="pagination"><span>{{ filteredPois.length }} 条</span><button :disabled="page <= 1" aria-label="上一页" @click="page--">‹</button><span>{{ page }} / {{ pageCount }}</span><button :disabled="page >= pageCount" aria-label="下一页" @click="page++">›</button></div>
      </aside>
    </div>

    <footer class="statusbar"><div class="status-message"><span class="status-check">{{ error ? '!' : '✓' }}</span><strong>{{ status }}</strong><span class="status-divider"></span><span class="status-muted">高德地图 / 官方 API · GCJ-02</span></div><span v-if="district" class="last-update">{{ citySelection?.province.name }} · {{ district.name }} · {{ district.adcode }}</span></footer>
    <CategoryDialog v-if="categoryDialogOpen" :categories="categories" @close="categoryDialogOpen = false" @add="addCategory" @color="updateCategoryColor" @remove="removeCategory" />
    <CityPicker v-if="cityPickerOpen" :selection="citySelection" :city-name="city" @close="cityPickerOpen = false" @select="selectCity" />
    <AppDialog v-if="manualOpen" title="补录点位" @close="manualOpen = false">
      <form class="detail-form" @submit.prevent="saveManual"><label>名称<input v-model="manualDraft.name" required maxlength="100" placeholder="输入点位名称" autofocus /></label><label>地址<input v-model="manualDraft.address" maxlength="300" placeholder="可选，用户补录" /></label><label>营业时间<input v-model="manualDraft.hours" maxlength="200" placeholder="可选，用户补录" /></label><p>经度 {{ manualDraft.location[0].toFixed(6) }}，纬度 {{ manualDraft.location[1].toFixed(6) }} · GCJ-02</p><p class="muted">来源：用户补录，不作为高德官方 POI。</p><button class="collect-button" type="submit">保存点位</button></form>
    </AppDialog>
    <AppDialog v-if="detailOpen && selectedPoi" :title="selectedPoi.name" @close="detailOpen = false">
      <div class="detail-form"><p class="muted">{{ selectedPoi.source === 'user' ? '用户补录' : '高德官方 API' }} · {{ selectedPoi.id }} · {{ statuses[selectedPoi.status] }}</p><p>{{ selectedPoi.address || '地址未返回' }}</p><p>经纬度：{{ coordinate(selectedPoi).replace('\n', '，') }}（GCJ-02）</p><p>今日营业时间：{{ selectedPoi.hours || '接口未返回' }}</p><p>每周营业时间：{{ selectedPoi.weekHours || '接口未返回' }}</p><p>电话：{{ selectedPoi.tel || '接口未返回' }}</p><p v-for="field in ['rating', 'keytag', 'rectag', 'alias', 'cost', 'businessArea', 'parkingType']" :key="field">{{ exportFields[field as keyof typeof exportFields] }}：{{ resolvedField(selectedPoi, field) === '' ? '接口未返回' : resolvedField(selectedPoi, field) }}</p><p>特色：{{ selectedPoi.tag || '接口未返回' }}</p><p v-if="selectedPoi.parentId" class="muted">{{ selectedPoi.relation === 'area' ? '范围所属点位' : '高德关联父点位' }}：{{ selectedParentName }}</p><p>关联子点位：{{ childPois(selectedPoi.id).filter(poi => poi.relation !== 'area').length }} 条；范围内点位：{{ childPois(selectedPoi.id).filter(poi => poi.relation === 'area').length }} 条；照片：{{ selectedPoi.photos.length }} 张</p><div v-if="selectedPoi.photos.length" class="poi-photo-gallery" aria-label="点位照片"><PoiPhoto v-for="url in selectedPoi.photos" :key="url" :url="url" :name="selectedPoi.name" /></div><p v-else class="muted">{{ selectedPoi.source === 'user' ? '用户尚未添加图片' : '高德接口未返回该点位图片' }}</p><p v-if="selectedPoi.downloadedImages?.length">本地已保存 {{ selectedPoi.downloadedImages.length }} 张图片</p><button class="export-button" :disabled="automationBusy || isCollecting || workbench.isDownloadingImages.value" @click="imageDialogPoi = selectedPoi; imageDialogOpen = true">为此点位联网补图</button><p class="muted">{{ fieldStatus(selectedPoi) }}</p><p v-if="selectedPoi.error" class="failed">{{ selectedPoi.error }}</p><button v-if="selectedPoi.location" class="export-button" :disabled="!mapReady || isCollecting || isPreviewing || cityBusy" @click="beginAreaSearch">查询景区内部点位（优先 AOI）</button><p class="muted">关联子点位不是范围内所有点位；优先使用高德 AOI 边界逐页补充，没有可用边界时手动圈选，查询不限左侧勾选类型。</p><section v-if="selectedPoi.supplements?.length" class="poi-supplements"><h3>AI 补充信息</h3><p class="muted">由 AI 提供，附引用来源；原始高德字段保留。软件未自动核验来源内容。</p><article v-for="(item, index) in selectedPoi.supplements" :key="index"><strong>{{ exportFields[item.field as keyof typeof exportFields] || item.field.replace(/^custom:/, '') }}</strong><p>{{ item.value }}</p><a :href="item.sourceUrl" target="_blank" rel="noopener noreferrer">{{ item.sourceTitle || item.sourceUrl }}</a><small class="muted"> · {{ dateTime(item.addedAt) }}</small></article></section><label>备注<textarea v-model="selectedPoi.note" maxlength="2000" placeholder="用户备注" /></label><label v-if="!selectedPoi.parentId" class="inline-check"><input v-model="selectedPoi.included" type="checkbox" :disabled="automationBusy || isCollecting" />纳入采集与导出</label><button v-if="childPois(selectedPoi.id).length" class="export-button" :disabled="automationBusy || isCollecting || isExporting" @click="workbench.exportData(undefined, {parentId:selectedPoi.id,childrenOnly:true})">导出此点位的子数据 Excel</button><button class="export-button" @click="detailOpen = false">完成</button></div>
    </AppDialog>
    <AppDialog v-if="historyOpen" title="历史任务" @close="historyOpen = false"><p class="muted">保留最近 50 条任务摘要，导出包含当前已加载的点位。</p><p v-if="!jobs.length" class="poi-empty">暂无采集任务</p><article v-for="job in jobs" :key="job.id" class="job-card"><strong>{{ job.city }} · {{ job.status }}</strong><p>{{ job.types.join('、') }} · {{ job.keyword || '无关键词' }}</p><p>{{ dateTime(job.startedAt) }} · 成功 {{ job.completed }} / 失败 {{ job.failed }} / 总数 {{ job.total }}</p><p v-if="job.childTotal">子点详情 {{ job.childCompleted || 0 }} / {{ job.childTotal }} · 失败 {{ job.childFailed || 0 }}</p></article></AppDialog>
    <SettingsDialog v-if="settingsOpen" :busy="automationBusy || cityBusy || isPreviewing || isCollecting || isExporting" @close="settingsOpen = false" />
    <Transition name="toast"><div v-if="toast" class="toast" role="status">{{ toast }}</div></Transition>
  </main>
  <ImageDownloadDialog v-if="imageDialogOpen" :busy="workbench.isDownloadingImages.value || isCollecting || automationBusy" :scope-name="imageScopeName" :browser-status="workbench.imageBrowserStatus.value" :progress="workbench.imageProgress.value" :report="workbench.imageReport.value" :results="workbench.imageResults.value" @close="imageDialogOpen = false" @start="beginImageDownload" />
</template>
