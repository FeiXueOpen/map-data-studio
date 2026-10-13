import { rawPaths } from './poiRaw'
import { backend, type Poi } from './amap'
import { exportFields, resolvedField, safeCell } from './poiFields'
import {addStandardScenicSheet} from './scenicExport'

export type Job = { id: string; city: string; adcode: string; types: string[]; keyword: string; startedAt: string; finishedAt: string; total: number; completed: number; failed: number; status: string; childTotal?: number; childCompleted?: number; childFailed?: number }
export function fieldStatus(poi: Poi) {
  return [['坐标', poi.location], ['地址', resolvedField(poi, 'address')], ['营业时间', resolvedField(poi, 'hours') || resolvedField(poi, 'weekHours')], ['电话', resolvedField(poi, 'tel')], ['特色', resolvedField(poi, 'tag')], ['图片', resolvedField(poi, 'photos')]].map(([label, value]) => `${label}：${value ? '有值' : poi.source === 'user' ? '用户未补录' : '接口未返回'}`).join('；')
}
const safe = safeCell


export async function exportWorkbook(pois: Poi[], children: Poi[], jobs: Job[], city: string, destination?: string) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Map Data Studio'
  workbook.created = new Date()
  if (pois.length || children.length) {
    if (pois.every(p=>p.category==='景点' || p.source==='user')) addStandardScenicSheet(workbook, [...pois, ...children])
  }
  const keys = Object.keys(exportFields)
  const rawKeys = [...new Set([...pois, ...children].flatMap(poi => rawPaths(poi.raw)))].sort().map(path => `raw:${path}`)
  const allKeys = [...keys, ...rawKeys]
  if (allKeys.length > 16384) throw new Error('原始字段列数超过 Excel 上限，请缩小导出范围')
  workbook.addWorksheet('主 POI')
  workbook.addWorksheet('子点位')
  const original = workbook.addWorksheet('高德原始响应')
  original.addRow(['POI ID', '父 POI ID', '点位名称', '响应序号', '分段序号', '总段数', '原始 POI JSON（按顺序拼接）'])
  const longValues = workbook.addWorksheet('长字段完整值')
  longValues.addRow(['POI ID', '父 POI ID', '字段', '分段序号', '总段数', '完整值（按顺序拼接）'])
  const chunks = (value: string) => {
    const result: string[] = []
    for (let offset = 0; offset < value.length;) {
      let end = Math.min(offset + 30000, value.length)
      if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]!)) end--
      result.push(value.slice(offset, end)); offset = end
    }
    return result
  }
  for (const poi of [...pois, ...children]) {
    const records = poi.rawRecords || (poi.raw ? [poi.raw] : [])
    records.forEach((record, index) => {
      const parts = chunks(JSON.stringify(record))
      parts.forEach((part, n) => original.addRow([poi.id, poi.parentId, poi.name, index + 1, n + 1, parts.length, part].map(safe)))
    })
  }
  const valueFor = (poi: Poi, field: string) => {
    const value = resolvedField(poi, field)
    if (typeof value !== 'string' || value.length <= 30000) return safe(value)
    const parts = chunks(value)
    parts.forEach((part, n) => longValues.addRow([poi.id, poi.parentId, field, n + 1, parts.length, part].map(safe)))
    return safe(value.slice(0, 29000) + '…（完整值见长字段完整值表）')
  }
  for (const [name, records] of [['主 POI', pois], ['子点位', children]] as const) {
    const sheet = workbook.getWorksheet(name)!
    sheet.addRow(allKeys.map(key => key.startsWith('raw:') ? `高德原始.${key.slice(4)}` : exportFields[key as keyof typeof exportFields]))
    records.forEach((poi) => sheet.addRow(allKeys.map(key => valueFor(poi, key))))
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: allKeys.length } }
    sheet.columns.forEach((column, index) => { column.width = index === 0 || index === 4 ? 30 : 20 })
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14263D' } }
  }
  const log = workbook.addWorksheet('采集日志')
  log.addRow(['任务', '城市', '高德行政区编码', '类型', '关键词', '开始时间', '结束时间', '总数', '完成', '失败', '状态', '子点详情总数', '子点详情完成', '子点详情失败'])
  jobs.forEach((job) => log.addRow([job.id, job.city, job.adcode, job.types.join('、'), job.keyword, job.startedAt, job.finishedAt, job.total, job.completed, job.failed, job.status, job.childTotal ?? 0, job.childCompleted ?? 0, job.childFailed ?? 0].map(safe)))
  log.addRow(['导出范围', city, '', '', '', new Date().toISOString(), '', pois.length, '', '', '仅导出已纳入的当前加载结果，非全城市总量'])
  const failedRecords = [...pois, ...children]
  failedRecords.filter((poi) => poi.error).forEach((poi) => log.addRow([poi.id, poi.name, '', '', '', '', '', '', '', '', safe(poi.error)]))
  log.columns.forEach((column) => { column.width = 24 })
  const audit = workbook.addWorksheet('AI补充来源')
  audit.addRow(['POI ID', '父 POI ID', '点位名称', '字段', '补充值', '来源 URL', '来源标题', '回填时间', '状态'])
  ;[...pois, ...children].forEach((poi) => (poi.supplements || []).forEach((item) => audit.addRow([poi.id, poi.parentId, poi.name, item.field, item.value, item.sourceUrl, item.sourceTitle, item.addedAt, 'AI 提供，附引用来源；未由软件核验'].map(safe))))
  audit.columns.forEach((column) => { column.width = 24 })
  const buffer = await workbook.xlsx.writeBuffer()
  if (destination) return backend<string>('save_export_path', { bytes: Array.from(new Uint8Array(buffer)), path: destination })
  return backend<string | null>('save_export', { bytes: Array.from(new Uint8Array(buffer)), fileName: `${city}-POI-${new Date().toISOString().slice(0, 10)}.xlsx` })
}
