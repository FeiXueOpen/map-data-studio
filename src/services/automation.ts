import { getStorageSettings } from './storage'
import catalog from '../../automation/tools.json'
import type { useWorkbench } from '../composables/useWorkbench'
import { getCities, getProvinces } from './cities'
import type { Poi } from './amap'
import { templateGaps, validateSupplements, resolvedField, formatTicketPrice } from './poiFields'
import { exportExcelTemplate, inspectExcelTemplate } from './excelTemplate'
import { rawPaths } from './poiRaw'
import { descendantIds } from './collectChildren'
import {getDefaultExportFormat} from './scenicExport'

type Workbench = ReturnType<typeof useWorkbench>
type Operation = { id: string; action: string; state: 'running' | 'completed' | 'failed' | 'cancelled'; startedAt: string; finishedAt?: string; durationMs?: number; result?: unknown; error?: string }
type Schema = { type?: string; required?: string[]; properties?: Record<string, Schema>; additionalProperties?: boolean; items?: Schema; minimum?: number; maximum?: number; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; pattern?: string; enum?: unknown[] }
export function validateArguments(action: string, args: unknown): asserts args is Record<string, any> {
  const tool = catalog.find((item) => item.name === action)
  if (!tool) throw new Error('未知控制操作')
  function check(value: unknown, schema: Schema, path: string) {
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} 不在允许选项中`)
    const type = schema.type
    if (type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} 必须是对象`)
      const fields = value as Record<string, unknown>
      for (const key of schema.required || []) if (!(key in fields)) throw new Error(`缺少参数 ${key}`)
      for (const [key, item] of Object.entries(fields)) {
        const prop = schema.properties?.[key]
        if (!prop && schema.additionalProperties === false) throw new Error(`未知参数 ${key}`)
        if (prop) check(item, prop, key)
      }
    } else if (type === 'array') {
      if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new Error(`${path} 数组长度无效`)
      if (schema.items) value.forEach((item) => check(item, schema.items!, path))
    } else if (type === 'string') {
      if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(value))) throw new Error(`${path} 文本格式无效`)
    } else if (type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`${path} 必须是布尔值`)
    } else if (type === 'integer' || type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isSafeInteger(value)) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`${path} 数值无效`)
    }
  }
  check(args, tool.inputSchema as unknown as Schema, 'arguments')
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export function createAutomationController(w: Workbench, regions = { getCities, getProvinces }, onBusy: (busy: boolean) => void = () => {}) {
  const operations: Operation[] = []
  const selections = new Map<string, any>()
  const supplementTasks = new Map<string, any>()
  // A selection remains valid while details, supplements, or children are added.
  // A new city/query replaces the root POI identity set and invalidates it.
  const fingerprint = () => JSON.stringify([w.city.value, w.pois.value.map(p=>p.id).sort()])
  const selection = (id: string) => {
    const result=selections.get(id)
    if(!result) throw new Error('筛选结果不存在')
    if(result.fingerprint!==fingerprint()) throw new Error('点位数据已变化，请重新筛选，不能复用旧selectionId')
    return result
  }
  const publicSource = (value: string) => { const url=new URL(value); if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw new Error('来源需为公开HTTP(S)网址'); return value }
  const numeric = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== '' && typeof value!=='boolean' && Number.isFinite(Number(value)) ? Number(value) : null
  const sameName = (left: string, right: string) => left.trim() === right.trim() || left.trim().replace(/[省市]$/, '') === right.trim().replace(/[省市]$/, '')
  const resolveCity = async (provinceName: string, cityName: string) => {
    const provinces = await regions.getProvinces()
    const province = provinces.find((item) => sameName(item.name, provinceName))
    if (!province) throw new Error(`未找到省份：${provinceName}`)
    const cities = await regions.getCities(province.id)
    const city = cities.find((item) => sameName(item.name, cityName))
    if (!city) throw new Error(`未在${province.name}找到城市：${cityName}`)
    return { province, city }
  }
  const setQuery = (categories: string[], keyword = '') => {
    if (new Set(categories).size !== categories.length || categories.some((name: string) => !w.categories.value.some((c) => c.name === name))) throw new Error('查询类型未知或重复，请先 list_categories')
    if (!categories.length && !keyword.trim()) throw new Error('请选择类型或输入关键词')
    for (const category of w.categories.value) if (w.selectedTypes.value.includes(category.name) !== categories.includes(category.name)) w.toggleType(category.name)
    w.keyword.value = keyword
  }
  const saveSelection = (records: Poi[], data: Record<string, any>) => {
    const result={selectionId:crypto.randomUUID(),city:w.city.value,createdAt:new Date().toISOString(),...data,poiIds:records.map(p=>p.id),items:records.map(p=>({id:p.id,name:p.name,parentId:p.parentId})),fingerprint:fingerprint(),scopeNote:'仅针对当前加载且符合条件的点位；AI推荐或高德评分不是实测客流排名'}
    if(selections.size>=50) selections.delete(selections.keys().next().value!)
    selections.set(result.selectionId,result)
    const {fingerprint:_,...visible}=result;return clone(visible)
  }
  const task = (id: string) => {const t=supplementTasks.get(id);if(!t)throw new Error('补全任务不存在');if(t.fingerprint!==fingerprint())throw new Error('补全任务的数据集已变化，请重新创建');return t}

  const busy = () => operations.some((op) => op.state === 'running') || w.cityBusy.value || w.isPreviewing.value || w.isCollecting.value || w.isExporting.value || w.isDownloadingImages?.value || !!w.areaTarget.value
  const idle = () => { if (busy()) throw new Error('工作台正在执行任务，请读取 get_status 等待或取消当前任务') }
  const ready = () => { idle(); if (!w.district.value) throw new Error('城市尚未定位，请先 select_city 并等待完成') }
  const find = (id: string, parentId?: string) => {
    const poi = parentId ? w.children.value.find((p) => p.id === id && p.parentId === parentId) : w.pois.value.find((p) => p.id === id) || w.children.value.find((p) => p.id === id)
    if (!poi) throw new Error('点位尚未加载或父点位不匹配')
    return poi
  }
  const coordinates = (point: number[]) => {
    if (Math.abs(point[0]!) > 180 || Math.abs(point[1]!) > 90) throw new Error('GCJ-02 经纬度超出范围')
    return point as [number, number]
  }
  const record = (poi: Poi) => ({ ...clone(poi), children: undefined, childCount: w.childPois(poi.id).length, rawFields: rawPaths(poi.raw).map((path) => `raw:${path}`) })
  function templateRecords(a: Record<string, any>) {
    if (a.childrenOnly && !a.parentId) throw new Error('childrenOnly 需要 parentId')
    const roots = a.parentId ? [find(a.parentId)] : w.pois.value.filter((p) => p.included)
    const descendants = descendantIds(roots.map((p) => p.id), w.children.value)
    let records = [...(a.childrenOnly ? [] : roots), ...((a.childrenOnly || a.includeChildren) ? w.children.value.filter((p) => descendants.has(p.parentId) && !roots.some((root) => root.id === p.id)) : [])]
    const selectedIds: string[] | undefined = a.selectionId ? selection(a.selectionId).poiIds : undefined
    if (a.poiIds && (new Set(a.poiIds).size!==a.poiIds.length || a.poiIds.some((id: string)=>!records.some(p=>p.id===id) || selectedIds && !selectedIds.includes(id)))) throw new Error('poiIds 包含重复或不在指定范围内的点位')
    const orderedIds = selectedIds ? selectedIds.filter(id=>!a.poiIds || a.poiIds.includes(id)) : a.poiIds
    if(orderedIds) records=orderedIds.map((id:string)=>{const p=records.find(p=>p.id===id);if(!p)throw new Error('筛选点位不在本次导出范围，请核对parentId和纳入状态');return p})
    return records
  }
  function photoRecords(records: Poi[], ids?: string[]) {
    if(ids && (new Set(ids).size!==ids.length || ids.some(id=>!records.some(p=>p.id===id))))throw new Error('photoPoiIds 必须属于实际导出点位且不能重复')
    return ids ? records.filter(p=>p.source==='amap' && p.photos.length>0 && ids.includes(p.id)) : []
  }
  function start(action: string, task: () => Promise<unknown>) {
    idle()
    const operation: Operation = { id: crypto.randomUUID(), action, state: 'running', startedAt: new Date().toISOString() }
    operations.unshift(operation)
    onBusy(true)
    if (operations.length > 50) operations.pop()
    w.error.value = ''
    // Reserve before yielding: concurrent AI clients cannot start overlapping mutations.
    void Promise.resolve().then(() => operation.state === 'running' ? task() : undefined).then((result) => {
      if (operation.state !== 'running') return
      operation.result = result
      operation.state = w.error.value ? 'failed' : (action === 'start_query' && w.previewState.value === 'cancelled') || (['start_query', 'start_collection', 'search_area'].includes(action) && w.activeJob.value?.status === '已取消') ? 'cancelled' : 'completed'
      if (w.error.value) operation.error = w.error.value
    }, (cause) => {
      if (operation.state !== 'running') return
      operation.state = 'failed'; operation.error = cause instanceof Error ? cause.message : '操作失败'
      w.error.value = operation.error
    }).finally(() => { operation.finishedAt ||= new Date().toISOString(); operation.durationMs = Math.max(0, Date.parse(operation.finishedAt) - Date.parse(operation.startedAt)); onBusy(operations.some((op) => op.state === 'running')) })
    return { operationId: operation.id, state: operation.state }
  }
  const operationView = (operation: Operation) => clone({
    ...operation,
    durationMs: operation.durationMs ?? Math.max(0, Date.now() - Date.parse(operation.startedAt)),
    stage: operation.state !== 'running' ? operation.state : w.imageProgress?.value ? 'images' : w.areaProgress.value ? 'area' : w.isPreviewing.value ? 'querying' : w.isCollecting.value ? 'collecting' : w.isExporting.value ? 'exporting' : w.cityBusy.value ? 'selecting_city' : 'running',
    progress: operation.state !== 'running' ? undefined : { status: w.status.value, preview: w.previewProgress.value, activeJob: w.activeJob.value && { total: w.activeJob.value.total, completed: w.activeJob.value.completed, failed: w.activeJob.value.failed, childTotal: w.activeJob.value.childTotal, childCompleted: w.activeJob.value.childCompleted } },
  })
  return async function execute(action: string, input: unknown = {}): Promise<Record<string, unknown>> {
    validateArguments(action, input)
    const a = input
    switch (action) {
      case 'filter_pois': {
        ready(); let records=templateRecords(a);const scopeTotal=records.length
        for(const f of a.filters||[]) {
          templateGaps([], [f.field]);if(!['is_missing','not_missing'].includes(f.operator) && f.value===undefined)throw new Error('筛选条件缺少value')
          if(['gte','lte'].includes(f.operator) && numeric(f.value)===null)throw new Error('数值筛选条件无效')
          records=records.filter(p=>{const v=resolvedField(p,f.field),n=numeric(v);switch(f.operator){case 'eq':return String(v)===f.value;case 'contains':return String(v).includes(f.value);case 'not_contains':return !String(v).includes(f.value);case 'gte':return n!==null && n>=Number(f.value);case 'lte':return n!==null && n<=Number(f.value);case 'is_missing':return v==='';case 'not_missing':return v!=='';default:return false}})
        }
        const matched=records.length;let missingSortValues=0
        if(a.sortBy){templateGaps([], [a.sortBy]);records=records.filter(p=>{if(numeric(resolvedField(p,a.sortBy))===null){missingSortValues++;return false}return true});records.sort((x,y)=>(numeric(resolvedField(x,a.sortBy))!-numeric(resolvedField(y,a.sortBy))!)*(a.order==='asc'?1:-1))}
        const result=saveSelection(records.slice(0,a.limit),{instruction:a.instruction,basis:a.sortBy?`field:${a.sortBy}`:'filtered_query_order',requested:a.limit,scopeTotal,matched,missingSortValues,available:records.length,shortfall:Math.max(0,a.limit-records.length),sortBy:a.sortBy,order:a.order||'desc'})
        return result
      }
      case 'create_poi_selection': {
        ready();const records=templateRecords(a);const selected=records.slice(0,a.limit||records.length)
        const evidence=a.evidence||[];if(new Set(evidence.map((e:any)=>e.id)).size!==evidence.length || evidence.some((e:any)=>!selected.some(p=>p.id===e.id)))throw new Error('推荐依据的点位重复或不属于本次名单')
        evidence.forEach((e:any)=>{if(e.sourceUrl)publicSource(e.sourceUrl)})
        return saveSelection(selected,{instruction:a.instruction,basis:a.basis,requested:a.limit||records.length,evidence,shortfall:Math.max(0,(a.limit||records.length)-records.length)})
      }
      case 'get_poi_selection': {const {fingerprint:_,...result}=selection(a.selectionId);return clone(result)}
      case 'get_operation': {
        const operation = operations.find((item) => item.id === a.operationId)
        if (!operation) throw new Error('操作不存在或已从历史记录中清理')
        return operationView(operation)
      }
      case 'create_supplement_task': {
        ready();const records=templateRecords(a);if(!records.length)throw new Error('补全范围没有点位');const defaults=getDefaultExportFormat();const fields=a.fields||defaults.columns.map(c=>c.field);const initial=templateGaps(records,fields,1,100)
        const supplied=a.fieldRules||[]
        if(new Set(supplied.map((r:any)=>r.field)).size!==supplied.length || supplied.some((r:any)=>!fields.includes(r.field)))throw new Error('列补填规则字段重复或不属于本任务；不同列需要不同内容时使用不同custom字段')
        const fieldRules=[...defaults.fieldRules.filter(r=>fields.includes(r.field)).map(r=>({...r,...supplied.find((s:any)=>s.field===r.field)})),...supplied.filter((s:any)=>!defaults.fieldRules.some(r=>r.field===s.field))]
        const t={taskId:crypto.randomUUID(),instruction:a.instruction,fields:[...new Set<string>(fields)],fieldRules,scope:{...a,poiIds:records.map(p=>p.id)},fingerprint:fingerprint(),initialMissingCount:initial.total,createdAt:new Date().toISOString()}
        if(supplementTasks.size>=50)supplementTasks.delete(supplementTasks.keys().next().value!)
        supplementTasks.set(t.taskId,t);return {taskId:t.taskId,instruction:t.instruction,fields:t.fields,fieldRules:t.fieldRules,poiIds:t.scope.poiIds,state:initial.total?'awaiting_ai':'completed',missingCount:initial.total,gaps:initial,enrichmentPolicy:defaults.enrichmentPolicy,groups:defaults.enrichmentPolicy.groups.map(g=>({...g,missingCount:templateGaps(records,g.fields.filter(f=>t.fields.includes(f))).total})),note:'请由AI执行逐列规则并附来源回填，MCP校验类型和长度，不自行研究或编造'}
      }
      case 'get_supplement_task': {
        const t=task(a.taskId),gaps=templateGaps(templateRecords(t.scope),t.fields,a.page||1,a.pageSize||50)
        const policy=getDefaultExportFormat().enrichmentPolicy
        return {taskId:t.taskId,instruction:t.instruction,fields:t.fields,fieldRules:t.fieldRules,poiIds:t.scope.poiIds,initialMissingCount:t.initialMissingCount,missingCount:gaps.total,state:gaps.total?'awaiting_ai':'completed',gaps,enrichmentPolicy:policy,groups:policy.groups.map(g=>({...g,missingCount:templateGaps(templateRecords(t.scope),g.fields.filter(f=>t.fields.includes(f))).total}))}
      }
      case 'supplement_pois': {
        ready();const t=a.taskId?task(a.taskId):undefined;const allowed=t?templateRecords(t.scope):undefined
        if(new Set(a.items.map((i:any)=>i.id)).size!==a.items.length)throw new Error('同一批不能重复点位ID')
        if(t) for(const item of a.items)for(const f of item.fields){
          const rule=t.fieldRules.find((r:any)=>r.field===f.field)
          if(rule?.format==='ticketPrice')formatTicketPrice(f.field,f.value)
          if(rule?.valueType==='number' && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(f.value.trim()) || !Number.isFinite(Number(f.value)) || ['custom:成人票','custom:学生票','custom:儿童票','custom:老人票'].includes(f.field)&&Number(f.value)<0))throw new Error(`字段 ${f.field} 必须符合数值规则；票价条件请写费用明细`)
          if(rule?.maxLength && [...f.value.trim()].length>rule.maxLength)throw new Error(`字段 ${f.field} 超过列规则的${rule.maxLength}字限制`)
        }
        const prepared=a.items.map((item:any)=>{const poi=find(item.id,item.parentId);if(allowed && (!allowed.some(p=>p.id===poi.id) || item.fields.some((f:any)=>!t.fields.includes(f.field))))throw new Error('回填点位或字段不属于补全任务');const additions=validateSupplements(poi,item.fields);const history=[...(poi.supplements||[]),...additions];if(history.length>500)throw new Error('补充记录超过上限');return {poi,history,count:additions.length}})
        prepared.forEach(({poi,history}:any)=>[...w.pois.value,...w.children.value].filter(p=>p.id===poi.id).forEach(p=>{p.supplements=clone(history)}))
        return {updatedPois:prepared.length,updatedFields:prepared.reduce((n:number,p:any)=>n+p.count,0),taskId:a.taskId}
      }
      case 'get_default_export_format': return clone(getDefaultExportFormat())
      case 'get_status': return clone({ city: w.city.value, selection: w.selection.value, district: w.district.value && { name: w.district.value.name, adcode: w.district.value.adcode, center: w.district.value.center },
        busy: busy(), cityBusy: w.cityBusy.value, querying: w.isPreviewing.value, collecting: w.isCollecting.value, exporting: w.isExporting.value,
        status: w.status.value, previewState: w.previewState.value, previewProgress: w.previewProgress.value, queryDirty: w.queryDirty.value, hasMore: w.hasMore.value,
        imageBrowserStatus: w.imageBrowserStatus?.value, imageProgress: w.imageProgress?.value, imageReport: w.imageReport?.value, imageResults: w.imageResults?.value, isDownloadingImages: w.isDownloadingImages?.value, areaProgress: w.areaProgress.value, areaNotice: w.areaNotice.value, areaSelection: w.areaSelection.value, mapReady: w.mapReady.value, total: w.pois.value.length, children: w.children.value.length, included: w.includedCount.value,
        failed: w.failedCount.value, query: { categories: w.selectedTypes.value, keyword: w.keyword.value }, error: w.error.value, activeJob: w.activeJob.value,
        operations: operations.map(operationView), history: w.jobs.value.slice(0, 20), coordinateSystem: 'GCJ-02' })
      case 'list_provinces': return { provinces: await regions.getProvinces() }
      case 'list_cities': return { cities: await regions.getCities(a.provinceId) }
      case 'select_city': return start(action, async () => {
        const provinces = await regions.getProvinces(); const province = provinces.find((p) => p.id === a.provinceId)
        if (!province) throw new Error('省份 ID 无效')
        const cities = await regions.getCities(province.id); const city = cities.find((c) => c.id === a.cityId)
        if (!city) throw new Error('城市 ID 不属于指定省份')
        await w.changeCity({ province, city }); return { city: w.city.value, adcode: w.district.value?.adcode }
      })
      case 'select_city_by_name': return start(action, async () => {
        const selected = await resolveCity(a.province, a.city)
        await w.changeCity(selected)
        return { city: w.city.value, adcode: w.district.value?.adcode, provinceId: selected.province.id, cityId: selected.city.id }
      })
      case 'set_query': {
        ready()
        setQuery(a.categories, a.keyword || '')
        return { categories: w.selectedTypes.value, keyword: w.keyword.value }
      }
      case 'start_query': {
        idle()
        if ((a.province && !a.city) || (a.city && !a.province)) throw new Error('province 和 city 必须同时提供')
        if (a.append && (a.city || a.categories || !w.hasMore.value)) throw new Error('追加查询不能切换城市、修改条件，且必须存在后续页')
        return start(action, async () => {
          if (a.city) await w.changeCity(await resolveCity(a.province, a.city))
          if (!w.district.value) throw new Error('城市尚未定位，请提供 province/city，或先选择城市')
          if (a.categories || a.keyword !== undefined) setQuery(a.categories || [...w.selectedTypes.value], a.keyword ?? w.keyword.value)
          await w.runPreview(a.append || false, a.autoCollect === true)
          return { total: w.pois.value.length, children: w.children.value.length, state: w.previewState.value, job: w.activeJob.value }
        })
      }
      case 'list_pois': {
        if (a.parentId) find(a.parentId)
        const source = a.parentId ? w.childPois(a.parentId) : w.pois.value
        const search = (a.search || '').toLowerCase()
        const rows = source.filter((p) => (!a.includedOnly || p.included) && (!search || `${p.name} ${p.address}`.toLowerCase().includes(search)))
        const page = a.page || 1, pageSize = a.pageSize || 25
        return { total: rows.length, page, pageSize, pageCount: Math.ceil(rows.length / pageSize), items: rows.slice((page - 1) * pageSize, page * pageSize).map((p) => ({ id: p.id, parentId: p.parentId, name: p.name, category: p.category, address: p.address, location: p.location, included: p.included, status: p.status, relation: p.relation, photos: p.photos.length, childCount: w.childPois(p.id).length })) }
      }
      case 'get_poi': { const poi = find(a.id, a.parentId); if (a.open) w.openPoi(poi.id, a.parentId || ''); return { poi: record(poi) } }
      case 'set_included': {
        ready(); const selected = a.ids.map((id: string) => { const poi = w.pois.value.find((p) => p.id === id); if (!poi) throw new Error('只能设置已加载的主点位'); return poi })
        selected.forEach((p: Poi) => { p.included = a.included }); return { updated: selected.length, included: w.includedCount.value }
      }
      case 'start_collection': {
        ready()
        const scoped = a.selectionId || a.poiIds ? templateRecords(a) : undefined
        if (!scoped?.length && !w.includedCount.value) throw new Error('没有纳入采集或明确指定的点位')
        return start(action, async () => { await w.startCollection(a.retryOnly || false, '', scoped?.map(p => p.id), a.includeChildren === true); return { job: w.activeJob.value, children: w.children.value.length, poiIds: scoped?.map(p => p.id), includeChildren: a.includeChildren === true } })
      }
      case 'request_area_selection': {
        ready()
        if (!a.id && !a.name) throw new Error('请提供点位 id 或 name')
        if (a.parentId && !a.id) throw new Error('parentId 需要同时提供点位 id')
        let poi: Poi
        if (a.id) poi = find(a.id, a.parentId)
        else {
          const matches = w.pois.value.filter((p) => p.name.trim() === a.name.trim())
          if (matches.length !== 1) throw new Error(matches.length ? '点位名称重复，请用 list_pois 核对地址后指定 id' : '当前主点位中没有该名称，请用 list_pois 查找；不要自动重新查询')
          poi = matches[0]!
        }
        if (a.name && poi.name.trim() !== a.name.trim()) throw new Error('点位 id 与 name 不匹配')
        return clone(w.requestAreaSelection(poi, a.manual === true))
      }
      case 'search_area': {
        ready(); const parent = find(a.parentId); const polygon = a.polygon.map(coordinates)
        if (new Set(polygon.map((p: number[]) => p.join(','))).size < 3) throw new Error('多边形需要至少 3 个不同顶点')
        return start(action, async () => { await w.collectArea(parent, polygon); return { childCount: w.childPois(parent.id).length, notice: w.areaNotice.value, job: w.activeJob.value } })
      }
      case 'get_storage_settings': return getStorageSettings()
      case 'download_images': {
        idle()
        const records = templateRecords(a)
        if (!records.length) throw new Error('指定范围没有可下载的点位')
        return start(action, async () => ({ results: await w.downloadImages(records, {count: a.count ?? 3, ratio: a.ratio || 'original', engine: a.engine || 'bing', intervalSeconds:a.intervalSeconds ?? 8, proxy:a.proxy, minWidth: a.minWidth ?? 0, size:a.size || 'all', minHeight:a.minHeight ?? 0, width:a.width ?? 0, height:a.height ?? 0, directory: a.directory}) }))
      }
      case 'cancel_operation': {
        if (operations.some((op) => op.state === 'running' && ['select_city', 'export_excel', 'export_excel_template', 'inspect_excel_template'].includes(op.action)) || w.cityBusy.value || w.isExporting.value) throw new Error('城市定位和导出不能取消，请等待完成')
        w.cancelPreview(); w.cancelCollection()
        operations.filter((op) => op.state === 'running').forEach((op) => { op.state = 'cancelled'; op.finishedAt = new Date().toISOString() })
        onBusy(false)
        return { cancelled: true, retained: w.pois.value.length, children: w.children.value.length }
      }
      case 'export_excel': { ready(); const records=templateRecords(a);if(!records.length)throw new Error('没有可导出的点位');photoRecords(records,a.photoPoiIds);const ids=records.map(p=>p.id);return start(action,async()=>{const path=await w.exportData(a.path,{...a,poiIds:ids});if(!path&&!w.error.value)throw new Error('未生成导出文件');return {path,selectionId:a.selectionId,poiIds:ids}}) }
      case 'add_manual_poi': ready(); if (!w.addManual(a.name, a.address || '', coordinates(a.location), a.hours || '')) throw new Error('补录点位无效'); return { poi: record(w.pois.value[0]!) }
      case 'list_categories': return { categories: clone(w.categories.value) }
      case 'add_category': ready(); if (!w.addCategory({ name: a.name, code: a.code, color: a.color, custom: true })) throw new Error(w.toast.value || '自定义类型无效'); return { categories: clone(w.categories.value) }
      case 'get_template_gaps': {
        return templateGaps(templateRecords(a), a.fields, a.page || 1, a.pageSize || 50)
      }
      case 'inspect_excel_template': {
        idle()
        return inspectExcelTemplate(a.path, a.headerRow || 1, a.sheetName)
      }
      case 'supplement_poi': {
        ready()
        const poi = find(a.id, a.parentId)
        const additions = validateSupplements(poi, a.fields)
        const history = [...(poi.supplements || []), ...additions]
        if (history.length > 500) throw new Error('该点位补充记录已达 500 条上限')
        const related = [...w.pois.value, ...w.children.value].filter((p) => p.id === poi.id)
        related.forEach((p) => { p.supplements = clone(history) })
        return { updated: additions.length, poi: record(poi) }
      }
      case 'export_excel_template': {
        ready()
        const records = templateRecords(a)
        if (!records.length) throw new Error('指定范围内没有可导出的点位')
        const mappedPhotos=a.columnMap.some((column:any)=>['originalPhotos','downloadedPhotos','imageSources'].includes(column.field))
        const photos=photoRecords(records,a.photoPoiIds ?? (mappedPhotos ? records.map(p=>p.id) : []))
        const selectionAudit=a.selectionId ? (()=>{const {fingerprint:_,...visible}=selection(a.selectionId);return clone(visible)})() : undefined
        const supplementAudit=[...supplementTasks.values()].filter(t=>t.fingerprint===fingerprint() && t.scope.poiIds.some((id:string)=>records.some(p=>p.id===id))).map(t=>({taskId:t.taskId,instruction:t.instruction,fields:t.fields,fieldRules:t.fieldRules,poiIds:t.scope.poiIds,missingCount:templateGaps(templateRecords(t.scope),t.fields).total}))
        return start(action, async () => {
          w.isExporting.value = true
          try {
            await w.downloadImages(photos,{count:3,ratio:'original',engine:'bing',minWidth:0},true)
            return await exportExcelTemplate(clone(records), {...a,selectionAudit,supplementAudit} as unknown as import('./excelTemplate').TemplateOptions) }
          finally { w.isExporting.value = false }
        })
      }
      case 'update_note': ready(); find(a.id, a.parentId).note = a.note; return { updated: true }
      default: throw new Error('未知控制操作')
    }
  }
}
