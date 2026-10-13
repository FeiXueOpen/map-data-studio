import type ExcelJS from 'exceljs'
import type {Poi} from './amap'
import format from '../../automation/scenic-export-format.json'
import {resolvedField, safeCell, formatTicketPrice} from './poiFields'
import {formatOpeningHours} from './excelTemplate'

export function getDefaultExportFormat() {
  return {...format, fields: format.columns.map(c=>c.field), note:'默认AI导出流程需逐项研究缺失字段，包含票价、预约与攻略；遵循enrichmentPolicy。时间按杭州格式拆分，季节条件保留，高德原始数据保留附表。无法核实的事实留空并报告，不编造。'}
}
export function addStandardScenicSheet(workbook: ExcelJS.Workbook, records: Poi[]) {
  const sheet=workbook.addWorksheet(format.sheetName)
  sheet.properties.defaultRowHeight=format.defaultRowHeight
  sheet.properties.defaultColWidth=format.defaultColWidth
  sheet.addRow(format.columns.map(c=>c.label))
  format.columns.forEach(c=>{sheet.getColumn(c.column).width=c.width})
  for (const poi of records) {
    const row=sheet.addRow([]);row.height=format.rowHeight
    for (const column of format.columns) {
      const cell=row.getCell(column.column)
      cell.style=JSON.parse(JSON.stringify(column.style))
      const value=resolvedField(poi,column.field)
      if(value===''){cell.value=null;continue}
      let output:string|number=String(value)
      if(column.kind==='price') {
        output=formatTicketPrice(column.field,value)
      }else if(column.kind==='number') {
        const n=Number(value);if(Number.isFinite(n))output=n
      }else if(column.kind==='time') {
        const m=/^(\d{1,2})[:：](\d{2})$/.exec(String(value).trim())
        if(m && Number(m[1])<24 && Number(m[2])<60)output=Number(m[1])/24+Number(m[2])/1440
      }else if(column.kind==='openingHours') {
        output=/^(全天开放|全天|24小时开放|24小时营业)$/.test(String(value).trim())?'00:00-00:00':formatOpeningHours(String(value),{column:column.column,field:column.field,timeFormat:'HH:mm',rangeSeparator:'-'})
      }
      cell.value=safeCell(typeof output==='string' && output.length>30000 ? output.slice(0,29000)+'…（完整值见主 POI／子点位及长字段完整值表）':output) as string|number
    }
  }
  return sheet
}
