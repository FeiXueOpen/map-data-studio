import { readRawField, validRawField } from './poiRaw'
import type { Poi } from './amap'
export type Supplement = { field: string; value: string; sourceUrl: string; sourceTitle: string; addedAt: string }
export function formatTicketPrice(field: string, value: string | number): string | number {
  const match=/^(\d+(?:\.\d+)?)(?:\s*[（(]([^()（）\r\n]{1,40})[）)])?$/.exec(String(value).trim())
  const condition=match?.[2]?.replace(/\s+/g,'')
  if(!match || !Number.isFinite(Number(match[1])) || condition && (!['custom:儿童票','custom:老人票'].includes(field) || !/\d/.test(condition) || !/(?:米|岁)/.test(condition) || !/^[0-9.\-—~～至米岁周未满不含及以上下或且身高<>=≤≥]+$/.test(condition))) throw new Error(`字段 ${field} 票价格式无效：成人/学生仅填价格；儿童/老人可填价格 (年龄或身高条件)，其他说明写费用明细`)
  return condition ? `${Number(match[1])} (${condition})` : Number(match[1])
}
export const exportFields = {
  id: 'POI ID', name: '名称', category: '类别', typecode: '高德类型编码', parentId: '父 POI ID',
  address: '地址', province: '省份', city: '城市', district: '区县', longitude: '经度', latitude: '纬度', coordinateSystem: '坐标系',
  rating: '高德评分', keytag: '高德标识（如景区级别）', rectag: '推荐标签', alias: '别名', cost: '人均消费', businessArea: '商圈', parkingType: '停车场类型',
  scenicLevel: '景区等级', openingHours: '开放时间', lastEntry: '停止入园', closingTime: '闭馆／营业结束时间',
  hours: '今日营业时间', weekHours: '每周营业时间', tel: '电话', tag: '特色', photos: '高德图片链接', downloadedPhotos: '本地下载原图路径', originalPhotos: '本地原图路径', imageSources: '下载图片来源记录', source: '来源', collectedAt: '采集时间', note: '备注', relation: '关联方式',
} as const
export const supplementable = ['address', 'province', 'city', 'district', 'hours', 'weekHours', 'tel', 'tag', 'photos', 'rating', 'keytag', 'rectag', 'alias', 'cost', 'businessArea', 'parkingType', 'scenicLevel', 'openingHours', 'lastEntry', 'closingTime']
// These are export views only. hours/weekHours and raw API responses remain unchanged.
export function scheduleFields(text: string) {
  const validTime = (h: string, m: string) => Number(h) <= 24 && Number(m) < 60 && (Number(h) !== 24 || Number(m) === 0)
  const clock = (h: string, m: string) => `${h.padStart(2, '0')}:${m}`
  if (/^(全天开放|全天|24小时开放|24小时营业)$/.test(text.trim())) return {openingHours:'00:00-00:00', lastEntry:'', closingTime:'无（24小时开放）'}
  const segments = text.replace(/[,，]\s*(?=(?:淡季|旺季|周一全天关闭|周一闭馆))/g,'；').split(/[；;\n]/).map(s=>s.trim()).filter(Boolean)
  const entries: {context:string; time:string}[] = [], closes: {context:string; time:string}[] = []
  const openingHours = segments.map(segment => {
    const admission = /(?:最晚(?:进入|入园)|停止(?:入园|入院|进入|入馆)|停止检票)\s*[:：]?\s*(\d{1,2})[:：](\d{2})|(\d{1,2})[:：](\d{2})\s*(?:停止(?:入园|入院|进入|入馆)|停止检票)/g
    const rangeIndex = segment.search(/\d{1,2}[:：]\d{2}\s*[-—–~～至]/)
    const context = rangeIndex >= 0 ? segment.slice(0, rangeIndex).trim() : ''
    for(const match of segment.matchAll(admission)) {
      const h=match[1]||match[3]!,m=match[2]||match[4]!
      if(validTime(h,m)) entries.push({context:context+(segment.slice(0,match.index).includes('园中园')?' 园中园':''),time:clock(h,m)})
    }
    const explicit = /(?:闭馆|闭园|结束营业)\s*(?:时间)?\s*[:：]?\s*(\d{1,2})[:：](\d{2})/.exec(segment)
    const ranges = [...segment.matchAll(/(\d{1,2})[:：](\d{2})\s*[-—–~～至]\s*(\d{1,2})[:：](\d{2})/g)].filter(m=>validTime(m[1]!,m[2]!)&&validTime(m[3]!,m[4]!))
    if (explicit && validTime(explicit[1]!,explicit[2]!)) closes.push({context,time:clock(explicit[1]!,explicit[2]!)})
    else if (ranges.length===1 && !/(场|演出|喷泉|暂停|关闭|休息)/.test(segment)) closes.push({context,time:`${clock(ranges[0]![3]!,ranges[0]![4]!)}（营业结束，按高德开放时间整理）`})
    return segment.replace(admission,(original,h,m,reverseH,reverseM)=>validTime(h||reverseH,m||reverseM)?'':original).replace(/\(\s*\)/g,'').trim().replace(/(\d{1,2})[:：](\d{2})\s*[-—–~～至]\s*(\d{1,2})[:：](\d{2})/g,(original,h,m,endH,endM)=>validTime(h,m)&&validTime(endH,endM)?`${clock(h,m)}-${clock(endH,endM)}`:original)
  }).join('；')
  const related = (values: {context:string; time:string}[]) => {
    if (!values.length) return ''
    const distinct = [...new Set(values.map(v=>v.time))]
    if (distinct.length===1 && values.length===segments.length) return distinct[0]!
    return [...new Set(values.map(v=>`${v.context ? v.context+' ' : ''}${v.time}`))].join('；')
  }
  return {openingHours, lastEntry:related(entries), closingTime:related(closes)}
}
export function rawField(poi: Poi, field: string): string | number {
  if (field.startsWith('raw:')) return readRawField(poi, field)
  if (field === 'scenicLevel') {
    const label = String(readRawField(poi, 'raw:business.keytag'))
    return /^(?:国家)?([1-5]A)(?:级)?(?:景区|旅游景区)?$/i.exec(label.trim())?.[1]?.toUpperCase() || resolvedField(poi, 'custom:景区等级')
  }
  if (['openingHours','lastEntry','closingTime'].includes(field)) {
    const today=String(resolvedField(poi,'hours')), week=String(resolvedField(poi,'weekHours'))
    const ambiguousToday=[...today.matchAll(/\d{1,2}[:：]\d{2}\s*[-—–~～至]\s*\d{1,2}[:：]\d{2}/g)].length>1
    const schedule = scheduleFields(week && ambiguousToday ? week : today || week)
    // A simple today's interval often omits admission rules that the weekly schedule has.
    if(field==='lastEntry' && !schedule.lastEntry && week) schedule.lastEntry=scheduleFields(week).lastEntry
    const custom:Record<string,string> = {openingHours:'开放时间',lastEntry:'停止入园',closingTime:'闭馆时间'}
    // Prefer an explicitly researched closing rule over a derived business end.
    if(field==='closingTime') return resolvedField(poi,'custom:闭馆时间') || schedule.closingTime
    return schedule[field as keyof typeof schedule] || resolvedField(poi,`custom:${custom[field]}`)
  }
  const businessKeys: Record<string, string> = { rating: 'rating', keytag: 'keytag', rectag: 'rectag', alias: 'alias', cost: 'cost', businessArea: 'business_area', parkingType: 'parking_type' }
  if (businessKeys[field]) return readRawField(poi, `raw:business.${businessKeys[field]}`)
  if (field === 'longitude') return poi.location?.[0] ?? ''
  if (field === 'latitude') return poi.location?.[1] ?? ''
  if (field === 'coordinateSystem') return 'GCJ-02'
  if (field === 'originalPhotos') return (poi.downloadedImages || []).map(p => p.originalPath || p.path).join('\n')
  if (field === 'downloadedPhotos') return (poi.downloadedImages || []).map(p => p.path).join('\n')
  if (field === 'imageSources') return poi.downloadedImages?.length ? JSON.stringify(poi.downloadedImages) : ''
  if (field === 'photos') return poi.photos.join('\n')
  if (field === 'source') return poi.source === 'user' ? '用户补录' : '高德 API'
  if (field === 'relation') return !poi.parentId ? '主点位' : poi.relation === 'area' ? '范围内点位（非官方父子关系）' : '高德关联子点位'
  if (field.startsWith('custom:')) return ''
  if (!(Object.prototype.hasOwnProperty.call(exportFields, field))) throw new Error(`未知导出字段：${field}`)
  return (poi as unknown as Record<string, string>)[field] || ''
}
export function fieldSupplement(poi: Poi, field: string): Supplement | undefined {
  if (['openingHours','lastEntry','closingTime'].includes(field)) {
    const custom:Record<string,string>={openingHours:'开放时间',lastEntry:'停止入园',closingTime:'闭馆时间'}
    const matching=[...(poi.supplements||[])].reverse().find(s=>s.field===`custom:${custom[field]}`)
    if(matching && (field==='closingTime' || !String(resolvedField(poi,'hours') || resolvedField(poi,'weekHours')))) return matching
    const source=fieldSupplement(poi,'hours') || fieldSupplement(poi,'weekHours')
    if(source && rawField(poi,field)!=='')return source
  }
  if (rawField(poi, field) !== '') return undefined
  return [...(poi.supplements || [])].reverse().find((item) => item.field === field)
}
export function resolvedField(poi: Poi, field: string): string | number { return rawField(poi, field) !== '' ? rawField(poi, field) : fieldSupplement(poi, field)?.value ?? '' }
export function safeCell(value: unknown) { return typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value }
export function validateSupplements(poi: Poi, fields: (Omit<Supplement, 'addedAt' | 'sourceTitle'> & { sourceTitle?: string })[]): Supplement[] {
  const names = new Set<string>()
  return fields.map((item) => {
    if (names.has(item.field)) throw new Error('同一批补充字段不能重复')
    names.add(item.field)
    if (!supplementable.includes(item.field) && !/^custom:[^\x00-\x1f]{1,80}$/.test(item.field)) throw new Error('仅能补充缺失字段或 custom: 开头的模板自定义字段')
    if (!item.value.trim()) throw new Error('补充内容不能为空；无法确认的字段请保留为空')
    if (rawField(poi, item.field) !== '') throw new Error(`字段 ${item.field} 已有原始值，不允许 AI 覆盖`)
    const url = new URL(item.sourceUrl)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('每个补充字段必须提供公开 HTTP(S) 信息来源')
    if (item.field === 'photos') for (const photo of item.value.split('\n').filter(Boolean)) {
      const link = new URL(photo.trim()); if (!['https:', 'http:'].includes(link.protocol) || link.username || link.password) throw new Error('补充图片必须为 HTTP(S) 链接')
    }
    return { ...item, sourceTitle: item.sourceTitle || '', value: item.value.trim(), addedAt: new Date().toISOString() }
  })
}
export function templateGaps(records: Poi[], fields: string[], page = 1, pageSize = 50) {
  for (const field of fields) if (!(Object.prototype.hasOwnProperty.call(exportFields, field)) && !validRawField(field) && !/^custom:[^\x00-\x1f]{1,80}$/.test(field)) throw new Error(`未知模板字段：${field}`)
  let total = 0
  const items: { id: string; parentId: string; name: string; city: string; address: string; field: string }[] = []
  const offset = (page - 1) * pageSize
  for (const poi of records) for (const field of [...new Set(fields)]) {
    if (resolvedField(poi, field) !== '') continue
    if (total >= offset && items.length < pageSize) items.push({ id: poi.id, parentId: poi.parentId, name: poi.name, city: poi.city, address: poi.address, field })
    total++
  }
  return { total, page, pageSize, pageCount: Math.ceil(total / pageSize), items }
}
