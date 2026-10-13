import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from '@tauri-apps/api/core'
import { downloadPoiImages, prepareBaiduBatch, clearBaiduBatch, mergeDownloads, cancelImageDownload, getImageBrowserStatus, type ImageBrowserStatus, type ImageOptions } from '../services/images'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { errorMessage, getMapConfig, normalizePoi, poiDetails, resolveDistrict, searchPois, searchArea, poiAoi, type District, type Poi } from '../services/amap'
import { insideArea, areaRectangle, type Point } from '../services/area'
import { mergePoiData } from '../services/poiRaw'
import type { CitySelection } from '../services/cities'
import { loadPages } from '../services/loadPages'
import { collectChildren, descendantIds } from '../services/collectChildren'
import { classifyPoi, colorForCategory, defaultColors, validateCategory, type PoiCategory } from '../services/categories'
import typeCatalog from '../data/poi-types.json'
import { exportWorkbook, type Job } from '../services/export'

export function useWorkbench() {
  const city = ref('杭州市')
  const selection = ref<CitySelection | null>(null)
  const district = ref<District | null>(null)
  const categories = ref<PoiCategory[]>([])
  const selectedTypes = ref(['景点', '商场', '酒店', '餐饮'])
  const keyword = ref('')
  const listSearch = ref('')
  const activeFilter = ref('全部')
  const sort = ref('default')
  const pois = ref<Poi[]>([])
  const children = ref<Poi[]>([])
  const cityBusy = ref(false)
  const isPreviewing = ref(false)
  const isCollecting = ref(false)
  const imageBrowserStatus = ref<ImageBrowserStatus>({state:'idle',message:'',poiId:'',poiName:''})
  let browserUnlisten: UnlistenFn | undefined
  let browserDisposed = false
  const isDownloadingImages = ref(false)
  const imageProgress = ref('')
  const imageReport = ref('')
  const imageResults = ref<{ id: string; parentId: string; name: string; directory: string; saved: number; requested: number; failures: string[] }[]>([])
  let imageGeneration = 0
  const areaProgress = ref('')
  const areaNotice = ref('')
  const areaTarget = ref<Poi | null>(null)
  const areaSelection = ref<{
    requestId: string; parentId: string; name: string;
    state: 'resolving_boundary' | 'awaiting_user' | 'collecting' | 'completed' | 'failed' | 'cancelled';
    boundarySource?: 'aoi' | 'manual'; fallbackReason?: string; boundaries?: Point[][]; startedAt: string; finishedAt?: string; polygon?: Point[]; childCount?: number; notice?: string; error?: string
  } | null>(null)
  const isExporting = ref(false)
  const mapReady = ref(false)
  const error = ref('')
  const toast = ref('')
  const adding = ref(false)
  const selectedId = ref('')
  const selectedParentId = ref('')
  const detailOpen = ref(false)
  const page = ref(1)
  const remotePage = ref(0)
  const hasMore = ref(false)
  const loadingPage = ref(0)
  const previewState = ref<'idle' | 'loading' | 'cancelled' | 'error' | 'complete' | 'limit'>('idle')
  const previewProgress = computed(() => isPreviewing.value
    ? `正在加载第 ${loadingPage.value} 页 · 已完成 ${remotePage.value} 页 · 已加载 ${pois.value.length} 个点位`
    : previewState.value === 'limit' ? `已加载 ${remotePage.value} 页，已达到接口分页上限`
    : previewState.value === 'complete' ? `加载完成 · ${remotePage.value} 页 · ${pois.value.length} 个点位`
    : `加载${previewState.value === 'error' ? '中断' : '已取消'} · 已保留 ${pois.value.length} 个点位`)
  const jobs = ref<Job[]>([])
  const activeJob = ref<Job | null>(null)
  const query = ref<{ adcode: string; selected: string[]; codes: string[]; keywords: string } | null>(null)
  let cityGeneration = 0
  let searchGeneration = 0
  let collectionGeneration = 0
  let toastTimer: number | undefined
  const filters = computed(() => ['全部', ...categories.value.map((item) => item.name), ...(pois.value.some((poi) => poi.source === 'user') ? ['自定义'] : [])])
  const categoryColor = (name: string) => colorForCategory(name, categories.value)
  const normalizeRecord = (poi: Poi) => ({ ...normalizePoi(poi), category: poi.source === 'user' ? poi.category : classifyPoi(poi.typecode, poi.category, categories.value) })
  function storeCategories() { try { localStorage.setItem('map-data.categories', JSON.stringify(categories.value)); localStorage.setItem('map-data.selectedTypes', JSON.stringify(selectedTypes.value)) } catch { notify('类型已更新，但本地保存失败') } }
  function addCategory(item: PoiCategory) {
    const problem = validateCategory(item, categories.value)
    if (problem) { notify(problem); return false }
    if (categories.value.length >= 30) { notify('最多添加 30 个类型'); return false }
    categories.value.push({ ...item, name: item.name.trim(), custom: true })
    selectedTypes.value.push(item.name.trim())
    storeCategories()
    for (const poi of [...pois.value, ...children.value]) { if (poi.source !== 'user') poi.category = classifyPoi(poi.typecode, poi.category, categories.value) }
    notify('类型已添加并勾选，点击开始查询并采集')
    return true
  }
  function updateCategoryColor(name: string, color: string) {
    if (!/^#[\da-f]{6}$/i.test(color)) return
    const item = categories.value.find((item) => item.name === name)
    if (item) { item.color = color; storeCategories() }
  }
  function removeCategory(name: string) {
    categories.value = categories.value.filter((item) => item.name !== name || !item.custom)
    selectedTypes.value = selectedTypes.value.filter((item) => item !== name)
    if (activeFilter.value === name) activeFilter.value = '全部'
    for (const poi of [...pois.value, ...children.value]) {
      if (poi.source !== 'user') poi.category = classifyPoi(poi.typecode, '其他', categories.value)
    }
    storeCategories()
  }
  const filteredPois = computed(() => {
    const records = pois.value.filter((poi) => (activeFilter.value === '全部' || poi.category === activeFilter.value)
      && `${poi.name} ${poi.address}`.toLowerCase().includes(listSearch.value.trim().toLowerCase()))
    if (sort.value === 'name') records.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    if (sort.value === 'category') records.sort((a, b) => a.category.localeCompare(b.category, 'zh-CN'))
    return records
  })
  const pageCount = computed(() => Math.max(1, Math.ceil(filteredPois.value.length / 10)))
  const visiblePois = computed(() => filteredPois.value.slice((page.value - 1) * 10, page.value * 10))
  const selectedPoi = computed(() => selectedParentId.value ? children.value.find((poi) => poi.id === selectedId.value && poi.parentId === selectedParentId.value) || null : pois.value.find((poi) => poi.id === selectedId.value) || children.value.find((poi) => poi.id === selectedId.value) || null)
  const childrenByParent = computed(() => {
    const result = new Map<string, Poi[]>()
    children.value.forEach((poi) => { const list = result.get(poi.parentId) || []; list.push(poi); result.set(poi.parentId, list) })
    return result
  })
  const childPois = (parentId: string) => childrenByParent.value.get(parentId) || []
  const includedTree = computed(() => descendantIds(pois.value.filter((poi) => poi.included).map((poi) => poi.id), children.value))
  const includedCount = computed(() => pois.value.filter((poi) => poi.included).length)
  const failedCount = computed(() => new Set([...pois.value.filter((poi) => poi.included && poi.status === 'error'), ...children.value.filter((poi) => includedTree.value.has(poi.parentId) && poi.status === 'error')].map((poi) => poi.id)).size)
  const queryDirty = computed(() => !!query.value && (query.value.keywords !== keyword.value.trim() || JSON.stringify(query.value.selected) !== JSON.stringify(selectedTypes.value)))
  const status = computed(() => cityBusy.value ? `正在定位${city.value}…` : isPreviewing.value ? previewProgress.value
    : imageProgress.value || areaProgress.value || (isCollecting.value ? `详情采集 ${activeJob.value?.completed ?? 0}/${activeJob.value?.total ?? 0}`
    : error.value ? '操作未完成，请重试' : `${city.value} · 已加载 ${pois.value.length} 个点位`))

  function notify(message: string) {
    toast.value = message
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => { toast.value = '' }, 3500)
  }
  function storeHistory() {
    try { localStorage.setItem('map-data.jobs', JSON.stringify(jobs.value.slice(0, 50))) } catch { /* history storage must not block a task */ }
  }
  function cancelAreaSelection() {
    areaTarget.value = null
    const request = areaSelection.value
    if (request && ['resolving_boundary', 'awaiting_user', 'collecting'].includes(request.state)) {
      request.state = 'cancelled'
      request.finishedAt = new Date().toISOString()
    }
  }
  function cancelCollection() {
    cancelAreaSelection()
    imageGeneration++
    if (isDownloadingImages.value) void cancelImageDownload().catch(() => {})
    isDownloadingImages.value = false
    imageProgress.value = ''
    collectionGeneration++
    if (isCollecting.value && activeJob.value) {
      activeJob.value.status = '已取消'
      activeJob.value.finishedAt = new Date().toISOString()
      storeHistory()
    }
    isCollecting.value = false
    areaProgress.value = ''
  }
  async function changeCity(next?: CitySelection) {
    const token = ++cityGeneration
    searchGeneration++
    cancelCollection()
    if (next) {
      selection.value = next
      city.value = next.city.name
      try { localStorage.setItem('map-data.city', JSON.stringify(next)) } catch { /* optional preference */ }
    }
    cityBusy.value = true
    isPreviewing.value = false
    district.value = null
    pois.value = []
    children.value = []
    areaNotice.value = ''
    query.value = null
    hasMore.value = false
    remotePage.value = 0
    previewState.value = 'idle'
    selectedId.value = ''
    selectedParentId.value = ''
    detailOpen.value = false
    adding.value = false
    activeFilter.value = '全部'
    listSearch.value = ''
    error.value = ''
    page.value = 1
    try {
      const result = await resolveDistrict(city.value, selection.value?.province.name || '浙江省')
      if (token !== cityGeneration) return
      district.value = result
      cityBusy.value = false
    } catch (cause) { if (token === cityGeneration) error.value = errorMessage(cause) }
    finally { if (token === cityGeneration) cityBusy.value = false }
  }
  async function runPreview(append = false, autoCollect = true) {
    if (!district.value || cityBusy.value || isCollecting.value || isPreviewing.value || areaTarget.value || (append && !hasMore.value)) return
    if (!append && !selectedTypes.value.length && !keyword.value.trim()) { error.value = '请选择类型或输入关键词'; return }
    const token = ++searchGeneration
    const context = append ? query.value : { adcode: district.value.adcode, selected: [...selectedTypes.value], codes: categories.value.filter((item) => selectedTypes.value.includes(item.name)).map((item) => item.code), keywords: keyword.value.trim() }
    if (!context) return
    const nextPage = append ? remotePage.value + 1 : 1
    isPreviewing.value = true
    previewState.value = 'loading'
    activeJob.value = null
    error.value = ''
    if (!append) { query.value = context; pois.value = pois.value.filter((poi) => poi.source === 'user'); children.value = []; remotePage.value = 0; page.value = 1; selectedId.value = '' }
    hasMore.value = true
    try {
      const existing = new Set(pois.value.map((poi) => poi.id))
      const outcome = await loadPages({ startPage: nextPage,
        request: (page) => searchPois(context.adcode, context.codes, context.keywords, page),
        active: () => token === searchGeneration,
        waiting: (page) => { loadingPage.value = page },
        apply: (result) => {
          const additions = result.pois.filter((poi) => {
            if (existing.has(poi.id)) {
              const previous = pois.value.find(item => item.id === poi.id)
              if (previous) Object.assign(previous, mergePoiData(previous, normalizeRecord(poi)), { included: previous.included, status: previous.status, error: previous.error, note: previous.note, supplements: previous.supplements })
              return false
            }
            existing.add(poi.id); return true
          })
          pois.value.push(...additions.map(normalizeRecord))
          remotePage.value = result.page
          hasMore.value = result.hasMore
        },
      })
      if (token !== searchGeneration) return
      previewState.value = outcome
      hasMore.value = false
      notify(outcome === 'limit' ? '已达到接口分页上限，建议缩小查询条件' : `加载完成：${pois.value.length} 个点位`)
    } catch (cause) { if (token === searchGeneration) { previewState.value = 'error'; error.value = `第 ${loadingPage.value} 页加载失败：${errorMessage(cause)}` } }
    finally { if (token === searchGeneration) isPreviewing.value = false }
    if (autoCollect && token === searchGeneration && !error.value && ['complete', 'limit'].includes(previewState.value) && includedCount.value) {
      await startCollection()
    }
  }
  function cancelPreview() {
    if (!isPreviewing.value) return
    searchGeneration++
    isPreviewing.value = false
    previewState.value = 'cancelled'
    notify('已取消加载，已加载点位保留')
  }
  function toggleType(type: string) {
    selectedTypes.value = selectedTypes.value.includes(type) ? selectedTypes.value.filter((item) => item !== type) : [...selectedTypes.value, type]
    storeCategories()
  }
  function openPoi(id: string, parentId = '') { selectedId.value = id; selectedParentId.value = parentId; detailOpen.value = true }
  function requestAreaSelection(parent: Poi, manual = false) {
    if (!mapReady.value || !district.value) throw new Error('地图尚未就绪，请等待后重试')
    if (cityBusy.value || isPreviewing.value || isCollecting.value || isExporting.value || areaTarget.value) throw new Error('工作台正在执行任务或等待圈选')
    if (!parent.location || !parent.location.every(Number.isFinite) || Math.abs(parent.location[0]) > 180 || Math.abs(parent.location[1]) > 90) throw new Error('点位需要有效的 GCJ-02 坐标才能圈选范围')
    openPoi(parent.id, parent.parentId || '')
    adding.value = false
    detailOpen.value = false
    areaNotice.value = ''
    error.value = ''
    activeJob.value = null
    areaSelection.value = { requestId: crypto.randomUUID(), parentId: parent.id, name: parent.name, state: manual ? 'awaiting_user' : 'resolving_boundary', boundarySource: 'manual', startedAt: new Date().toISOString() }
    const request = areaSelection.value
    if (manual) areaTarget.value = parent
    else {
      isCollecting.value = true
      areaProgress.value = `正在获取「${parent.name}」的 AOI 边界`
      void resolveAreaBoundary(parent, request)
    }
    return request
  }
  async function resolveAreaBoundary(parent: Poi, request: NonNullable<typeof areaSelection.value>) {
    let rings: Point[][] = []
    try {
      if (parent.source === 'user') request.fallbackReason = '手动补点没有高德 POI ID，无法获取 AOI 边界'
      else {
        const result = await poiAoi(parent.id)
        if (request.state !== 'resolving_boundary') return
        rings = result.boundaries.filter(ring => ring.length >= 3 && ring.every(p => p.every(Number.isFinite)))
        parent.raw = { ...parent.raw, aoiBoundary: result.raw }
        if (!rings.length) request.fallbackReason = '高德未返回可用的 AOI 边界'
      }
    } catch (cause) {
      if (request.state !== 'resolving_boundary') return
      request.fallbackReason = `AOI 边界查询失败：${errorMessage(cause)}`
    }
    if (request.state !== 'resolving_boundary') return
    isCollecting.value = false
    areaProgress.value = ''
    if (!rings.length) {
      request.state = 'awaiting_user'
      areaNotice.value = `${request.fallbackReason}；请手动圈选范围。`
      areaTarget.value = parent
      notify(areaNotice.value)
      return
    }
    request.boundarySource = 'aoi'
    request.boundaries = rings
    request.polygon = rings[0]
    request.state = 'collecting'
    await collectArea(parent, areaRectangle(rings), rings)
    completeAreaRequest(request)
  }
  function completeAreaRequest(request: NonNullable<typeof areaSelection.value>) {
    if (request.state !== 'collecting') return
    request.state = error.value || activeJob.value?.failed ? 'failed' : 'completed'
    request.error = error.value || (activeJob.value?.failed ? '部分点位详情采集失败，请检查并重试' : undefined)
    request.childCount = childPois(request.parentId).length
    request.notice = areaNotice.value
    request.finishedAt = new Date().toISOString()
  }
  async function finishAreaSelection(polygon: Point[]) {
    const parent = areaTarget.value
    const request = areaSelection.value
    if (!parent || !request || request.state !== 'awaiting_user') return
    areaTarget.value = null
    request.polygon = polygon
    request.state = 'collecting'
    await collectArea(parent, polygon)
    completeAreaRequest(request)
  }
  async function collectArea(parent: Poi, polygon: Point[], boundaries: Point[][] = [polygon]) {
    if (isCollecting.value || isPreviewing.value || cityBusy.value || !district.value) return
    if (polygon.length < 3 || polygon.length > 100) { error.value = '请圈选有效范围，最多 100 个顶点'; return }
    const token = ++collectionGeneration
    activeJob.value = null
    isCollecting.value = true
    error.value = ''
    areaNotice.value = ''
    let loaded = 0
    try {
      for (let page = 1; page <= 8; page++) {
        areaProgress.value = `范围搜索第 ${page} 页 · 已发现 ${loaded} 个点位`
        const result = await searchArea(polygon, page)
        if (token !== collectionGeneration) return
        result.pois.forEach((poi) => {
          if (poi.id === parent.id || !poi.location || !boundaries.some(ring => insideArea(poi.location!, ring))) return
          const previous = children.value.find(child => child.id === poi.id && child.parentId === parent.id)
          if (previous) {
            Object.assign(previous, mergePoiData(normalizeRecord(poi), previous))
            return
          }
          const existing = [...pois.value, ...children.value].find((item) => item.id === poi.id && item.status === 'done')
          children.value.push({ ...normalizeRecord(existing || poi), parentId: parent.id, relation: 'area', status: existing ? 'done' : 'pending' })
          loaded++
        })
        if (!result.hasMore) break
        if (page === 8) areaNotice.value = '本次范围搜索达到高德单次条件 200 条上限；可继续圈选更小的范围补充，结果按 ID 去重。'
      }
      if (token !== collectionGeneration) return
      areaNotice.value ||= `已为「${parent.name}」补充 ${loaded} 个范围内点位。范围来自${areaSelection.value?.boundarySource === 'aoi' ? '高德 AOI 边界' : '用户圈选'}，范围关联不代表高德官方父子关系，也不保证地图上的全部标注都能由 API 返回。`
      areaProgress.value = ''
      isCollecting.value = false
      await startCollection(false, parent.id)
    } catch (cause) {
      if (token === collectionGeneration) { error.value = errorMessage(cause); areaProgress.value = ''; isCollecting.value = false }
    }
  }
  async function startCollection(retry = false, scopeId = '') {
    if (isCollecting.value || isPreviewing.value || areaTarget.value || !district.value) return
    const scope = scopeId ? descendantIds([scopeId], children.value) : includedTree.value
    const targets = pois.value.filter((poi) => (scopeId ? poi.id === scopeId : poi.included) && (retry ? poi.status === 'error' : poi.status !== 'done'))
    const childTargets = children.value.filter((poi) => scope.has(poi.parentId) && (retry ? poi.status === 'error' : poi.status !== 'done'))
    if (!targets.length && !childTargets.length) { notify('没有待采集点位'); return }
    const token = ++collectionGeneration
    const job = reactive<Job>({ id: crypto.randomUUID(), city: city.value, adcode: district.value.adcode,
      types: [...(query.value?.selected || selectedTypes.value)], keyword: query.value?.keywords || '', startedAt: new Date().toISOString(), finishedAt: '',
      total: 0, completed: 0, failed: 0, status: '采集中', childTotal: 0, childCompleted: 0, childFailed: 0 })
    jobs.value.unshift(job)
    activeJob.value = job
    isCollecting.value = true
    error.value = ''
    const manual = targets.filter((poi) => poi.source === 'user')
    job.total = manual.length
    manual.forEach((poi) => { poi.status = 'manual'; job.completed++ })
    const official = targets.filter((poi) => poi.source === 'amap')
    const rootIds = new Set(official.map((poi) => poi.id))
    const ids = [...new Set([...rootIds, ...childTargets.map((poi) => poi.id)])]
    job.total += ids.length
    job.childTotal = ids.filter((id) => !rootIds.has(id)).length
    const recordsById = new Map<string, Poi>()
    const errorsById = new Map<string, string>()
    await collectChildren({ ids, active: () => token === collectionGeneration, request: poiDetails,
      queued: () => { job.total++; job.childTotal!++ },
      result: (id, record, cause) => {
        const related = [...pois.value.filter((poi) => poi.id === id), ...children.value.filter((poi) => poi.id === id)]
        if (!record) {
          const message = errorMessage(cause)
          errorsById.set(id, message)
          related.forEach((poi) => { poi.status = 'error'; poi.error = message })
          job.failed++; if (!rootIds.has(id)) job.childFailed!++
          return
        }
        recordsById.set(id, record)
        related.forEach((poi) => {
          const { included, note, supplements, parentId, relation, province, city, district } = poi
          Object.assign(poi, mergePoiData(poi, normalizeRecord(record)), { included, note, supplements, parentId, relation, province: record.province || province, city: record.city || city, district: record.district || district, status: 'done' })
        })
        job.completed++; if (!rootIds.has(id)) job.childCompleted!++
      },
      discover: (parent, records) => {
        const parentPoi = pois.value.find((poi) => poi.id === parent.id) || children.value.find((poi) => poi.id === parent.id)
        records.forEach((child) => {
          const index = children.value.findIndex((poi) => poi.id === child.id && poi.parentId === parent.id)
          if (index >= 0) {
            const previous = children.value[index]!
            const merged = mergePoiData(normalizeRecord(child), previous)
            children.value[index] = { ...merged, relation: 'child' }
            return
          }
          const full = recordsById.get(child.id)
          const failure = errorsById.get(child.id)
          children.value.push({ ...normalizeRecord(full || child), parentId: parent.id,
            city: (full || child).city || parentPoi?.city || city.value, province: (full || child).province || parentPoi?.province || '',
            status: full ? 'done' : failure ? 'error' : 'pending', error: failure || '' })
        })
      },
    })
    if (token !== collectionGeneration) return
    job.status = job.failed ? '部分失败' : '已完成'
    job.finishedAt = new Date().toISOString()
    isCollecting.value = false
    storeHistory()
    notify(`采集完成：${job.completed} 条成功，${job.failed} 条失败；子点详情 ${job.childCompleted}/${job.childTotal}`)
  }
  async function downloadImages(records: Poi[], options: ImageOptions, automatic = false) {
    if (isDownloadingImages.value) throw new Error('已有图片下载任务正在执行')
    if (!automatic && (isCollecting.value || isPreviewing.value || cityBusy.value || isExporting.value || areaTarget.value)) throw new Error('工作台正在执行任务，请等待完成')
    if (!automatic) { isCollecting.value = true; activeJob.value = null }
    const unique = [...new Map(records.map(p => [p.id, p])).values()]
    const token = ++imageGeneration
    isDownloadingImages.value = true
    imageReport.value = ''; imageResults.value = []
    imageBrowserStatus.value = {state:'idle',message:'',poiId:'',poiName:''}
    let saved = 0, missing = 0
    let batchId:string|undefined
    try {
      if (!automatic && options.engine==='baidu') {imageProgress.value='准备百度批量搜索（共用一个浏览器）';batchId=await prepareBaiduBatch(unique,options);if(token!==imageGeneration)return}
      for (const [index, poi] of unique.entries()) {
        if (token !== imageGeneration) return
        imageProgress.value = `${automatic ? '保存高德图片' : '联网补图'} ${index + 1}/${unique.length} · ${poi.name}`
        try {
          const result = await downloadPoiImages(poi, options, automatic,batchId)
          if (token !== imageGeneration) return
          for (const record of [...pois.value, ...children.value].filter(p => p.id === poi.id)) mergeDownloads(record, result)
          saved += result.images.length; missing += Math.max(0, result.requested - result.images.length)
          imageResults.value.push({id: poi.id, parentId: poi.parentId, name: poi.name, directory: result.directory, saved: result.images.length, requested: result.requested, failures: result.failures})
        } catch(cause) {
          if (token !== imageGeneration) return
          missing += automatic ? poi.photos.length : options.count
          imageResults.value.push({id: poi.id, parentId: poi.parentId, name: poi.name, directory: options.directory || '', saved: 0, requested: automatic ? poi.photos.length : options.count, failures: [errorMessage(cause)]})
        }
      }
      imageReport.value = `${automatic ? '高德图片保存' : '联网补图'}完成：${unique.length} 个点位，已保存／复用 ${saved} 张${missing ? `，缺少 ${missing} 张（请查看失败记录）` : ''}`
      notify(imageReport.value)
      return imageResults.value
    } finally { if(batchId)await clearBaiduBatch(batchId).catch(()=>{}); if (token === imageGeneration) { isDownloadingImages.value = false; imageProgress.value = ''; if (!automatic) isCollecting.value = false } }
  }
  async function exportData(destination?: string, options: {parentId?: string; childrenOnly?: boolean; includeChildren?: boolean; poiIds?: string[]; photoPoiIds?: string[]} = {}) {
    if (isExporting.value || isCollecting.value || isPreviewing.value || isDownloadingImages.value) return
    const roots = options.parentId ? [pois.value.find(p=>p.id===options.parentId) || children.value.find(p=>p.id===options.parentId)].filter((p):p is Poi=>!!p) : pois.value.filter(p=>p.included)
    const tree = descendantIds(roots.map(p=>p.id),children.value)
    let selected = options.childrenOnly ? [] : roots
    let scopedChildren = options.childrenOnly || options.includeChildren ? children.value.filter(p=>tree.has(p.parentId) && !roots.some(r=>r.id===p.id)) : []
    if(options.poiIds){const ids=new Set(options.poiIds);selected=selected.filter(p=>ids.has(p.id));scopedChildren=scopedChildren.filter(p=>ids.has(p.id));selected.sort((a,b)=>options.poiIds!.indexOf(a.id)-options.poiIds!.indexOf(b.id));scopedChildren.sort((a,b)=>options.poiIds!.indexOf(a.id)-options.poiIds!.indexOf(b.id))}
    if(!selected.length && !scopedChildren.length){notify('指定范围没有可导出的点位');return}
    isExporting.value = true
    error.value = ''
    try {
      await downloadImages([...selected,...scopedChildren].filter(p=>p.source==='amap'&&p.photos.length>0&&(!options.photoPoiIds||options.photoPoiIds.includes(p.id))),{count:3,ratio:'original',engine:'bing',minWidth:0},true)
      const mainSnapshot:Poi[]=JSON.parse(JSON.stringify(selected)), childSnapshot:Poi[]=JSON.parse(JSON.stringify(scopedChildren))
      const path = await exportWorkbook(mainSnapshot, childSnapshot, JSON.parse(JSON.stringify(jobs.value)), options.parentId ? `${roots[0]!.name}${options.childrenOnly ? '-子点位' : ''}` : city.value, destination)
      if (path) notify('Excel 已保存'); else notify('已取消导出')
      return path
    } catch (cause) { error.value = errorMessage(cause) }
    finally { isExporting.value = false }
  }
  function addManual(name: string, address: string, location: [number, number], hours: string) {
    if (!district.value || !name.trim() || !location.every(Number.isFinite) || Math.abs(location[0]) > 180 || Math.abs(location[1]) > 90) return false
    pois.value.unshift({ id: `user-${crypto.randomUUID()}`, name: name.trim(), category: '自定义', typecode: '', location,
      address: address.trim(), province: selection.value?.province.name || '', city: city.value, district: '', hours: hours.trim(), weekHours: '', tel: '', tag: '', photos: [],
      source: 'user', collectedAt: new Date().toISOString(), parentId: '', children: [], included: true, status: 'manual', error: '', note: '' })
    adding.value = false
    activeFilter.value = '全部'
    listSearch.value = ''
    page.value = 1
    notify('用户补录点已添加')
    return true
  }
  watch([activeFilter, listSearch, sort], () => { page.value = 1 })
  watch(pageCount, (count) => { if (page.value > count) page.value = count })
  onMounted(async () => {
    if (isTauri()) {
      try {
        const unlisten = await listen<ImageBrowserStatus>('image-browser-status', ({payload}) => { if (!browserDisposed) {imageBrowserStatus.value = payload;if(isDownloadingImages.value && payload.poiName)imageProgress.value=`${payload.poiName} · ${payload.message}`}  })
        if (browserDisposed) unlisten(); else browserUnlisten = unlisten
        if (!browserDisposed) imageBrowserStatus.value = await getImageBrowserStatus()
      } catch { /* image status cannot block app startup */ }
    }
    try {
      const saved = JSON.parse(localStorage.getItem('map-data.city') || 'null')
      if (saved?.city?.name && saved?.province?.name && Number.isSafeInteger(saved.city.id) && Number.isSafeInteger(saved.province.id)) { selection.value = saved; city.value = saved.city.name }
      const previousJobs = JSON.parse(localStorage.getItem('map-data.jobs') || '[]')
      if (Array.isArray(previousJobs)) jobs.value = previousJobs.filter((job) => typeof job.id === 'string' && typeof job.city === 'string' && Array.isArray(job.types)).slice(0, 50)
    } catch { /* Ignore damaged local preferences. */ }
    try {
      const config = await getMapConfig()
      categories.value = config.categories.map((item) => ({ ...item, color: defaultColors[item.name] || '#8f64e9' }))
      try {
        const saved: unknown = JSON.parse(localStorage.getItem('map-data.categories') || '[]')
        if (Array.isArray(saved)) for (const item of saved) {
          if (!item || typeof item.name !== 'string' || typeof item.code !== 'string' || typeof item.color !== 'string' || !/^#[\da-f]{6}$/i.test(item.color)) continue
          const builtIn = categories.value.find((old) => old.name === item.name && old.code === item.code)
          if (builtIn) builtIn.color = item.color
          else if (item.custom && categories.value.length < 30 && typeCatalog.some((type) => type.code === item.code) && !validateCategory(item, categories.value)) categories.value.push({ name: item.name, code: item.code, color: item.color, custom: true })
        }
        const selected: unknown = JSON.parse(localStorage.getItem('map-data.selectedTypes') || 'null')
        if (Array.isArray(selected)) selectedTypes.value = selected.filter((name) => typeof name === 'string' && categories.value.some((item) => item.name === name))
      } catch { /* Damaged saved types must not block city loading. */ }
      await changeCity()
    }
    catch (cause) { error.value = errorMessage(cause) }
  })
  onUnmounted(() => { browserDisposed = true; browserUnlisten?.(); cityGeneration++; searchGeneration++; cancelCollection(); window.clearTimeout(toastTimer) })
  return { city, selection, district, categories, selectedTypes, keyword, listSearch, activeFilter, sort, filters,
    pois, children, childPois, filteredPois, visiblePois, selectedPoi, includedCount, failedCount, page, pageCount, hasMore, queryDirty,
    cityBusy, isPreviewing, previewState, previewProgress, isCollecting, isDownloadingImages, imageBrowserStatus, imageProgress, imageReport, imageResults, areaProgress, areaNotice, areaTarget, areaSelection, isExporting, mapReady, error, toast, adding, selectedId, detailOpen, jobs, activeJob, status,
    changeCity, runPreview, cancelPreview, toggleType, categoryColor, addCategory, updateCategoryColor, removeCategory, openPoi, requestAreaSelection, finishAreaSelection, cancelAreaSelection, collectArea, downloadImages, startCollection, cancelCollection, exportData, addManual, notify }
}
