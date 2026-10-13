import { validRawField } from './poiRaw'
import type ExcelJS from 'exceljs'
import { backend, type Poi } from './amap'
import { exportFields, fieldSupplement, resolvedField, safeCell } from './poiFields'
export type TemplateColumn = { column: number; field: string; instruction?: string; valueType?: 'text' | 'number'; numberFormat?: string; wrapText?: boolean; textFormat?: 'original' | 'openingHours'; timeFormat?: 'HH:mm' | 'H:mm' | 'H点mm分'; rangeSeparator?: string }
export type TemplateOptions = { templatePath: string; path: string; sheetName: string; headerRow?: number; startRow?: number; columnMap: TemplateColumn[]; includeChildren?: boolean; requireComplete?: boolean; selectionAudit?: Record<string, unknown>; supplementAudit?: Record<string, unknown>[] }
// Change presentation only: keep weekdays, seasons, last-entry notes and unknown text.
export function formatOpeningHours(value: string, mapping: TemplateColumn) {
  const pattern = /(?<!\d)(\d{1,2})(?:[:：](\d{2})|\s*[点时](?:\s*(\d{1,2})\s*分?)?(?:钟)?)(?!\d)/g
  const tokens = [...value.matchAll(pattern)].filter(m => Number(m[1]) < 24 && Number(m[2] || m[3] || 0) < 60 || Number(m[1]) === 24 && Number(m[2] || m[3] || 0) === 0)
  let output = '', end = 0
  for (const [index, token] of tokens.entries()) {
    const gap = value.slice(end, token.index)
    output += index > 0 && /^\s*[-—–~～至到]\s*$/.test(gap) ? mapping.rangeSeparator ?? '-' : gap
    const hour = Number(token[1]), minute = String(Number(token[2] || token[3] || 0)).padStart(2, '0')
    output += mapping.timeFormat === 'H点mm分' ? `${hour}点${minute}分` : `${mapping.timeFormat === 'H:mm' ? hour : String(hour).padStart(2, '0')}:${minute}`
    end = token.index! + token[0].length
  }
  return output + value.slice(end)
}
async function readWorkbook(path: string) {
  const { default: ExcelJS } = await import('exceljs')
  const bytes = await backend<number[]>('read_excel_template', { path })
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(new Uint8Array(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]) }
  catch { throw new Error('无法解析模板，请使用有效的 .xlsx 文件（不支持旧版 .xls、加密或宏模板）') }
  return workbook
}
function cellText(cell: ExcelJS.Cell) {
  if (cell.type === 6) return `[公式] ${cell.formula || cell.text}`
  return cell.text.slice(0, 1000)
}
export async function inspectExcelTemplate(path: string, headerRow = 1, sheetName?: string) {
  const workbook = await readWorkbook(path)
  const sheets = sheetName ? [workbook.getWorksheet(sheetName)].filter((sheet): sheet is ExcelJS.Worksheet => !!sheet) : workbook.worksheets
  if (!sheets.length) throw new Error('指定工作表不存在')
  return { path, headerRow, fields: exportFields, customFieldPrefix: 'custom:', rawFieldPrefix: 'raw:', rawFieldExample: 'raw:business.rating', columnFormatting: { numberFormat: 'Excel 显示格式，如 @、0.00；不转换营业时间文本', wrapText: '自动换行', textFormat: ['original', 'openingHours'], timeFormat: ['HH:mm', 'H:mm', 'H点mm分'], rangeSeparator: '营业时间区间分隔符，默认 -；保留星期、季节、最晚入园等说明', example: {column: 3, field: 'weekHours', valueType: 'text', numberFormat: '@', textFormat: 'openingHours', timeFormat: 'HH:mm', rangeSeparator: '-', wrapText: true} }, sheets: sheets.map((sheet) => ({
    name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount,
    headers: Array.from({ length: Math.min(sheet.columnCount, 256) }, (_, index) => ({ column: index + 1, address: sheet.getCell(headerRow, index + 1).address, label: cellText(sheet.getCell(headerRow, index + 1)), numberFormat: sheet.getCell(Math.min(headerRow + 1, 1048576), index + 1).numFmt || '' })),
    sampleRows: Array.from({ length: Math.min(sheet.rowCount, 6) }, (_, index) => ({ row: index + 1, cells: Array.from({ length: Math.min(sheet.columnCount, 32) }, (_, c) => cellText(sheet.getCell(index + 1, c + 1))) })),
    merges: (sheet.model.merges || []).slice(0, 200), note: sheet.columnCount > 256 ? '仅返回前 256 列，请缩小模板范围' : '',
  })) }
}
export function fillTemplate(workbook: ExcelJS.Workbook, records: Poi[], options: TemplateOptions) {
  const sheet = workbook.getWorksheet(options.sheetName)
  if (!sheet) throw new Error('指定工作表不存在')
  const headerRow = options.headerRow ?? 1, startRow = options.startRow ?? headerRow + 1
  if (startRow <= headerRow || startRow + records.length - 1 > 1048576) throw new Error('写入行必须在表头之后，且不超过 Excel 行数上限')
  if (!options.columnMap.length || new Set(options.columnMap.map((item) => item.column)).size !== options.columnMap.length) throw new Error('列映射不能为空或重复')
  for (const mapping of options.columnMap) {
    const {column, field, instruction, valueType, numberFormat, wrapText, textFormat, timeFormat, rangeSeparator} = mapping
    const validFormatString = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f]/.test(value)
    if (
      instruction !== undefined && (typeof instruction!=='string' || !instruction.trim() || instruction.length>4000) ||
      valueType !== undefined && !['text','number'].includes(valueType) ||
      numberFormat !== undefined && !validFormatString(numberFormat, 200) ||
      wrapText !== undefined && typeof wrapText !== 'boolean' ||
      textFormat !== undefined && !['original','openingHours'].includes(textFormat) ||
      timeFormat !== undefined && !['HH:mm','H:mm','H点mm分'].includes(timeFormat) ||
      rangeSeparator !== undefined && !validFormatString(rangeSeparator, 20)
    ) throw new Error('单元格数据格式无效')
    if ((timeFormat || rangeSeparator !== undefined) && textFormat !== 'openingHours') throw new Error('时间样式与区间分隔符需配合 openingHours 使用')
    if (textFormat === 'openingHours' && valueType === 'number') throw new Error('营业时间必须写入文本列，不能指定 number')
    if (!Number.isInteger(column) || column < 1 || column > 16384 || (!(Object.prototype.hasOwnProperty.call(exportFields, field)) && !validRawField(field) && !/^custom:[^\x00-\x1f]{1,80}$/.test(field))) throw new Error('列编号或导出字段无效')
    if (!sheet.getCell(headerRow, column).text.trim()) throw new Error(`第 ${column} 列缺少表头，请先检查模板`) 
  }
  // Validate every destination before changing any cell, including merged cells/formulas.
  const missing: { id: string; name: string; column: number; field: string; valueType?: 'text' | 'number' }[] = []
  const styleRow = sheet.getRow(startRow)
  const styles = new Map(options.columnMap.map(({ column }) => [column, JSON.parse(JSON.stringify(styleRow.getCell(column).style))]))
  const valueFor = (poi: Poi, mapping: TemplateColumn) => {
    const {field, valueType} = mapping
    const original = resolvedField(poi, field)
    const value = mapping.textFormat === 'openingHours' ? formatOpeningHours(String(original), mapping) : original
    if (typeof value === 'string' && value.length > 32760) throw new Error(`字段 ${field} 超过 Excel 单元格长度上限，请映射更具体的原始字段，或使用普通导出保留完整值`)
    if (valueType === 'number' && value !== '') {
      const number = Number(value)
      if (!Number.isFinite(number)) throw new Error(`字段 ${field} 不是有效数字，不能写入数值列`)
      return number
    }
    return valueType === 'text' ? String(value) : value
  }
  records.forEach((poi, index) => options.columnMap.forEach(mapping => {
    const {column, field} = mapping
    const cell = sheet.getCell(startRow + index, column)
    if (cell.isMerged || cell.value !== null) throw new Error(`目标单元格 ${cell.address} 已有内容、公式或合并；请指定空白数据区域`)
    valueFor(poi, mapping)
    if (resolvedField(poi, field) === '') missing.push({ id: poi.id, name: poi.name, column, field })
  }))
  if (options.requireComplete && missing.length) throw new Error(`仍有 ${missing.length} 个模板字段缺失，请补充后再导出，或允许保留空白`)
  records.forEach((poi, index) => {
    const row = sheet.getRow(startRow + index)
    row.height ??= styleRow.height
    options.columnMap.forEach(mapping => {
      const {column, numberFormat, wrapText} = mapping
      const cell = row.getCell(column)
      cell.value = safeCell(valueFor(poi, mapping)) as string | number
      cell.style = JSON.parse(JSON.stringify(styles.get(column)))
      if (numberFormat !== undefined) cell.numFmt = numberFormat
      if (wrapText !== undefined) cell.alignment = {...cell.alignment, wrapText}
    })
  })
  let auditName = 'AI补充来源'; let n = 1
  while (workbook.getWorksheet(auditName)) auditName = `AI补充来源_${n++}`
  const audit = workbook.addWorksheet(auditName)
  audit.addRow(['目标工作表', '目标单元格', 'POI ID', '点位名称', '字段', '补充值', '信息来源', '来源标题', '回填时间', '状态'])
  records.forEach((poi, index) => options.columnMap.forEach(({ column, field }) => {
    const supplement = fieldSupplement(poi, field)
    if (supplement) audit.addRow([sheet.name, sheet.getCell(startRow + index, column).address, poi.id, poi.name, field, supplement.value, supplement.sourceUrl, supplement.sourceTitle, supplement.addedAt, 'AI 提供，附引用来源；未由软件核验'].map(safeCell))
    else if (resolvedField(poi, field) === '') audit.addRow([sheet.name, sheet.getCell(startRow + index, column).address, poi.id, poi.name, field, '', '', '', '', '缺失，未编造'].map(safeCell))
    else if (['openingHours','lastEntry','closingTime'].includes(field)) audit.addRow([sheet.name, sheet.getCell(startRow + index, column).address, poi.id, poi.name, field, resolvedField(poi,field), '', JSON.stringify({hours:poi.hours,weekHours:poi.weekHours}), '', '根据高德时间整理；营业结束推导不等于已核实独立闭馆规定'].map(safeCell))
  }))
  audit.columns.forEach((column) => { column.width = 24 })
  if(options.selectionAudit || options.supplementAudit?.length || options.columnMap.some(c=>c.instruction)) {
    let name='筛选与补全指令', suffix=1
    while(workbook.getWorksheet(name))name=`筛选与补全指令_${suffix++}`
    const notes=workbook.addWorksheet(name);notes.addRow(['类型','指令与依据（JSON）'])
    const add=(kind:string,value:unknown)=>{const text=JSON.stringify(value);for(let i=0;i<text.length;i+=30000)notes.addRow([kind,safeCell(text.slice(i,i+30000))])}
    if(options.selectionAudit)add('AI筛选说明',options.selectionAudit)
    if(options.columnMap.some(c=>c.instruction))add('逐列补填规则',options.columnMap.filter(c=>c.instruction))
    options.supplementAudit?.forEach(t=>add('补全任务描述',t))
    notes.getColumn(1).width=24;notes.getColumn(2).width=90;notes.getColumn(2).alignment={wrapText:true}
  }
  return { rows: records.length, missingCount: missing.length, missing: missing.slice(0, 200), auditSheet: auditName }
}
export async function exportExcelTemplate(records: Poi[], options: TemplateOptions) {
  const workbook = await readWorkbook(options.templatePath)
  const report = fillTemplate(workbook, records, options)
  const buffer = await workbook.xlsx.writeBuffer()
  const path = await backend<string>('save_export_path', { bytes: Array.from(new Uint8Array(buffer)), path: options.path })
  return { path, ...report }
}
