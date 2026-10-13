import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
function compiled(source) { return `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText).toString('base64')}` }
const rawURL=compiled((await readFile('src/services/poiRaw.ts','utf8')).replace(/^import .*$/gm,''))
const fieldsURL=compiled(`import {readRawField,validRawField} from '${rawURL}';\n`+(await readFile('src/services/poiFields.ts','utf8')).replace(/^import .*$/gm,''))
const excelURL=pathToFileURL(resolve('node_modules/exceljs/excel.js')).href
const source=(await readFile('src/services/excelTemplate.ts','utf8')).replace(/^import .*$/gm,'').replace("import('exceljs')",`import('${excelURL}')`)
const templateURL=compiled(`import {validRawField} from '${rawURL}'; import {exportFields,fieldSupplement,resolvedField,safeCell} from '${fieldsURL}'; const backend=(...args)=>globalThis.__templateBackend(...args);\n${source}`)
const {fillTemplate,inspectExcelTemplate,exportExcelTemplate,formatOpeningHours}=await import(templateURL)
const {validateSupplements,templateGaps}=await import(fieldsURL)
function poi(id='1') { return {id,name:'橘子洲',category:'景点',parentId:'',address:'长沙市岳麓区',province:'湖南省',city:'长沙市',district:'岳麓区',location:[112.96,28.19],hours:'',weekHours:'',tel:'',tag:'',photos:[],source:'amap',collectedAt:'2026-10-09',note:'',children:[],included:true,status:'done'} }
function workbook() {
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('长沙景区');sheet.mergeCells('A1:D1');sheet.getCell('A1').value='长沙景区采集表'
 sheet.getRow(2).values=['景区名称','门票价格','营业时间','地址','说明/公式'];sheet.getColumn(1).width=30
 sheet.getRow(3).height=28;sheet.getCell('B3').numFmt='0.00';sheet.getCell('A3').font={bold:true,color:{argb:'FF123456'}};sheet.getCell('E3').value={formula:'1+1',result:2}
 book.addWorksheet('说明').getCell('A1').value='保留说明';return book
}
const options={templatePath:'/tmp/template.xlsx',path:'/tmp/filled.xlsx',sheetName:'长沙景区',headerRow:2,startRow:3,columnMap:[{column:1,field:'name'},{column:2,field:'custom:门票价格',valueType:'number'},{column:3,field:'hours'},{column:4,field:'address'}]}
test('opening-hour formatting preserves contextual facts, unknown values and source records',()=>{
 const mapping={column:3,field:'weekHours',textFormat:'openingHours',timeFormat:'HH:mm',rangeSeparator:'-'}
 assert.equal(formatOpeningHours('周一至周日 9：00 — 17:30；暑期 09:00~21:00 最晚进入20:00',mapping),'周一至周日 09:00-17:30；暑期 09:00-21:00 最晚进入20:00')
 assert.equal(formatOpeningHours('上午9点至下午17点30分',mapping),'上午09:00至下午17:30')
 assert.equal(formatOpeningHours('09:05-17:00',{...mapping,timeFormat:'H点mm分',rangeSeparator:'至'}),'9点05分至17点00分')
 assert.equal(formatOpeningHours('09:05-24:00',{...mapping,timeFormat:'H:mm',rangeSeparator:'—'}),'9:05—24:00')
 for(const text of ['', '全天开放','暂停营业','25:00-26:00','需预约，电话咨询'])assert.equal(formatOpeningHours(text,mapping),text)
 const p=poi();p.hours='周末 9:00—17:00';const book=workbook();fillTemplate(book,[p],{...options,columnMap:[{...mapping,field:'hours'}]});assert.equal(book.getWorksheet('长沙景区').getCell('C3').value,'周末 09:00-17:00');assert.equal(p.hours,'周末 9:00—17:00')
})
test('per-column Excel formats survive XLSX roundtrip while preserving unrelated styles',async()=>{
 const book=workbook(),p=poi();p.hours='9:00～17:30';p.supplements=validateSupplements(p,[{field:'custom:门票价格',value:'12.5',sourceUrl:'https://example.com'}]);const sheet=book.getWorksheet('长沙景区');sheet.getCell('C3').alignment={horizontal:'left'}
 fillTemplate(book,[p,{...p,id:'2'}],{...options,columnMap:[{column:1,field:'name'},{column:2,field:'custom:门票价格',valueType:'number',numberFormat:'0.000'},{column:3,field:'hours',valueType:'text',numberFormat:'@',textFormat:'openingHours',timeFormat:'HH:mm',wrapText:true}]})
 const restored=new ExcelJS.Workbook();await restored.xlsx.load(await book.xlsx.writeBuffer());const s=restored.getWorksheet('长沙景区');assert.equal(s.getCell('B3').value,12.5);assert.equal(s.getCell('B4').numFmt,'0.000');assert.equal(s.getCell('C4').value,'09:00-17:30');assert.equal(s.getCell('C4').numFmt,'@');assert.equal(s.getCell('C4').alignment.wrapText,true);assert.equal(s.getCell('C4').alignment.horizontal,'left');assert.equal(s.getCell('A4').font.bold,true)
})
test('invalid formatting and numeric hours are rejected before partial writes',()=>{
 for(const bad of [{textFormat:'openingHours',valueType:'number'},{numberFormat:'x'.repeat(201)},{timeFormat:'HH:mm'},{textFormat:'openingHours',rangeSeparator:''},{textFormat:'openingHours',timeFormat:'bad'}]){
  const book=workbook();assert.throws(()=>fillTemplate(book,[poi()],{...options,columnMap:[{column:1,field:'name'},{column:3,field:'hours',...bad}]}));assert.equal(book.getWorksheet('长沙景区').getCell('A3').value,null)
 }
})
test('fills a template with sourced supplements, preserves title/styles/formulas and serialises a valid workbook', async () => {
 const book=workbook(),p=poi();p.supplements=validateSupplements(p,[{field:'custom:门票价格',value:'0',sourceUrl:'https://example.com/tickets',sourceTitle:'官网门票'},{field:'hours',value:'08:00-18:00',sourceUrl:'https://example.com/opening',sourceTitle:'官网开放时间'}])
 const report=fillTemplate(book,[p,{...p,id:'2',name:'=HYPERLINK("bad")'}],options);assert.equal(report.rows,2);assert.equal(report.missingCount,0)
 const bytes=await book.xlsx.writeBuffer();const restored=new ExcelJS.Workbook();await restored.xlsx.load(bytes);const sheet=restored.getWorksheet('长沙景区')
 assert.equal(sheet.getCell('A1').value,'长沙景区采集表');assert.ok(sheet.getCell('A1').isMerged);assert.equal(sheet.getCell('A3').value,'橘子洲');assert.equal(sheet.getCell('B3').value,0);assert.equal(sheet.getCell('B3').numFmt,'0.00');assert.equal(sheet.getCell('C4').value,'08:00-18:00')
 assert.equal(sheet.getCell('A4').font.bold,true);assert.equal(sheet.getColumn(1).width,30);assert.equal(sheet.getCell('E3').formula,'1+1');assert.equal(restored.getWorksheet('说明').getCell('A1').value,'保留说明')
 assert.ok(sheet.getCell('A4').value.startsWith("'="));const audit=restored.getWorksheet(report.auditSheet);assert.equal(audit.rowCount,5);assert.equal(audit.getCell('G2').value,'https://example.com/tickets')
})
test('refuses populated/formula/merged destinations and missing required fields without partial cell writes', () => {
 for(const value of ['existing',{formula:'1+1',result:2}]) {const book=workbook();book.getWorksheet('长沙景区').getCell('B3').value=value;assert.throws(()=>fillTemplate(book,[poi()],options),/已有内容/);assert.equal(book.getWorksheet('长沙景区').getCell('A3').value,null)}
 const book=workbook();assert.throws(()=>fillTemplate(book,[poi()],{...options,requireComplete:true}),/字段缺失/);assert.equal(book.getWorksheet('长沙景区').getCell('A3').value,null)
 const bad=poi();bad.supplements=validateSupplements(bad,[{field:'custom:门票价格',value:'免费/收费',sourceUrl:'https://example.com'}]);assert.throws(()=>fillTemplate(workbook(),[bad],options),/有效数字/)
 assert.throws(()=>fillTemplate(workbook(),[poi()],{...options,columnMap:[{column:1,field:'__proto__'}]}),/字段无效/)
})
test('inspect and export use the supplied local template and report unresolved cells', async () => {
 const book=workbook();const input=await book.xlsx.writeBuffer();let output
 globalThis.__templateBackend=async(command,args)=>{if(command==='read_excel_template'){assert.equal(args.path,'/tmp/template.xlsx');return Array.from(input)}if(command==='save_export_path'){output=args;return args.path}throw new Error('unexpected command')}
 const inspection=await inspectExcelTemplate('/tmp/template.xlsx',2,'长沙景区');assert.equal(inspection.sheets[0].headers[1].label,'门票价格');assert.equal(inspection.sheets[0].headers[1].numberFormat,'0.00');assert.equal(inspection.fields.hours,'今日营业时间')
 const result=await exportExcelTemplate([poi()],options);assert.equal(result.path,'/tmp/filled.xlsx');assert.equal(result.missingCount,2);assert.equal(output.path,'/tmp/filled.xlsx');const restored=new ExcelJS.Workbook();await restored.xlsx.load(new Uint8Array(output.bytes));assert.equal(restored.getWorksheet(result.auditSheet).rowCount,3)
})
test('missing-field pagination remains complete and does not treat numeric zero as missing', () => {
 const records=Array.from({length:51},(_,i)=>poi(String(i)));records[0].supplements=validateSupplements(records[0],[{field:'custom:门票价格',value:'0',sourceUrl:'https://example.com'}])
 const first=templateGaps(records,['custom:门票价格','tel'],1,100),second=templateGaps(records,['custom:门票价格','tel'],2,100);assert.equal(first.total,101);assert.equal(first.items.length,100);assert.equal(second.items.length,1)
 assert.throws(()=>templateGaps(records,['constructor']),/未知模板字段/)
})

test('business fields and arbitrary raw paths map to templates without becoming false AI gaps',()=>{
 const p=poi();p.raw={business:{rating:'4.7',keytag:'4A景区',rectag:'春节亲子',alias:'别名',cost:0,extra:{flag:false}},type:'风景名胜',photos:[{title:'照片标题',url:'https://example.com/photo'}]}
 const fields=['rating','keytag','alias','cost','raw:business.extra.flag','raw:photos']
 assert.equal(templateGaps([p],fields).total,0)
 assert.throws(()=>validateSupplements(p,[{field:'rating',value:'5',sourceUrl:'https://example.com'}]),/已有原始值/)
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('模板');sheet.addRow(fields)
 fillTemplate(book,[p],{...options,sheetName:'模板',headerRow:1,startRow:2,columnMap:fields.map((field,i)=>({column:i+1,field,valueType:['rating','cost'].includes(field)?'number':'text'}))})
 assert.equal(sheet.getCell('A2').value,4.7);assert.equal(sheet.getCell('B2').value,'4A景区');assert.equal(sheet.getCell('D2').value,0);assert.equal(sheet.getCell('E2').value,'false');assert.ok(sheet.getCell('F2').value.includes('照片标题'))
})
const standardFormat=JSON.parse(await readFile('automation/scenic-export-format.json','utf8'))
const scenicSource=(await readFile('src/services/scenicExport.ts','utf8')).replace(/^import .*$/gm,'')
const scenicURL=compiled(`import {resolvedField,safeCell,formatTicketPrice} from '${fieldsURL}'; import {formatOpeningHours} from '${templateURL}'; const format=${JSON.stringify(standardFormat)};\n${scenicSource}`)
const {addStandardScenicSheet,getDefaultExportFormat}=await import(scenicURL)
test('standard scenic sheet matches all reference headers, preserves number/time types and leaves unknown facts blank',async()=>{
 const expectedHeaders='省份|城市|区县|景区名称|基本简介|热门指数|景区经度|景区纬度|景区地址|电话|景区评分|景区等级|预约小程序名称|微信小程序 appid|预约时间|提前几天预约|预约难度|开放时间|停止入园|闭馆时间|成人票|学生票|儿童票|老人票|热门推荐|费用明细|小贴士|交通指南|内部交通|游览时长|最佳游览|周边推荐|适合人群|景区类型'.split('|');
 const p=poi();p.raw={business:{rating:'4.7',keytag:'4A景区'}};p.hours='周末 9:00—17:00 最晚进入16:30';p.supplements=validateSupplements(p,[{field:'custom:成人票',value:'0',sourceUrl:'https://example.com'},{field:'custom:儿童票',value:'0 (1.2米以下)',sourceUrl:'https://example.com'},{field:'custom:预约时间',value:'09:30',sourceUrl:'https://example.com'}]);
 const book=new ExcelJS.Workbook(),sheet=addStandardScenicSheet(book,[p]);const headers=sheet.getRow(1).values;
 assert.deepEqual(headers.slice(1),expectedHeaders);assert.equal(sheet.columnCount,34);
 assert.equal(sheet.getCell('K2').value,4.7);assert.equal(sheet.getCell('L2').value,'4A');assert.equal(sheet.getCell('R2').value,'周末 09:00-17:00');assert.equal(sheet.getCell('S2').value,16.5/24);assert.equal(sheet.getCell('S2').numFmt,'h:mm');assert.equal(sheet.getCell('O2').value,9.5/24);assert.equal(sheet.getCell('U2').value,0);assert.equal(sheet.getCell('W2').value,'0 (1.2米以下)');assert.equal(sheet.getCell('F2').value,null);assert.equal(sheet.getCell('T2').value,'17:00（营业结束，按高德开放时间整理）');assert.equal(p.hours,'周末 9:00—17:00 最晚进入16:30');
 const restored=new ExcelJS.Workbook();await restored.xlsx.load(await book.xlsx.writeBuffer());assert.equal(restored.getWorksheet('景区数据').getCell('S2').numFmt,'h:mm');assert.equal(getDefaultExportFormat().fields.length,34);
})
test('scenic-derived fields preserve seasonal admission rules without inventing levels, tickets or popularity',()=>{
 const {fields}=getDefaultExportFormat();const p=poi();p.raw={business:{keytag:'亲子景区'}};p.weekHours='冬季 9:00-17:00 最晚进入16:00；夏季 9:00-21:00 最晚进入20:00';const missing=templateGaps([p],fields).items.map(g=>g.field);assert.ok(!missing.includes('lastEntry'));assert.ok(missing.includes('scenicLevel'));assert.ok(missing.includes('custom:成人票'));assert.ok(missing.includes('custom:热门指数'));
 const b=new ExcelJS.Workbook(),s=addStandardScenicSheet(b,[p]);assert.equal(s.getCell('L2').value,null);assert.equal(s.getCell('S2').value,'冬季 16:00；夏季 20:00');assert.ok(s.getCell('R2').value.includes('冬季'));
 const q=poi('24');q.hours='全天开放';const b2=new ExcelJS.Workbook();assert.equal(addStandardScenicSheet(b2,[q]).getCell('R2').value,'00:00-00:00');
})
test('default export includes every raw column and reconstructable full response snapshots for roots and children',async()=>{
 const source=(await readFile('src/services/export.ts','utf8')).replace(/^import .*$/gm,'').replace("import('exceljs')",`import('${excelURL}')`)
 const {exportWorkbook}=await import(compiled(`import {addStandardScenicSheet} from '${scenicURL}'; import {rawPaths} from '${rawURL}'; import {exportFields,resolvedField,safeCell} from '${fieldsURL}'; const backend=(...args)=>globalThis.__rawExportBackend(...args);\n${source}`))
 const p=poi();p.raw={id:p.id,business:{rating:'4.7',keytag:'4A景区',extra:{unknown:'保留未知字段'}},photos:[{title:'标题',url:'https://example.com/p'}],long:'汉字'.repeat(20000)};p.rawRecords=[p.raw,{id:p.id,business:{alias:'详情别名'}}]
 const child={...poi('child'),parentId:p.id,raw:{business:{rating:0},another:'子点原始字段'}}
 let output;globalThis.__rawExportBackend=async(_command,args)=>{output=args;return args.path}
 await exportWorkbook([p],[child],[],'长沙','/tmp/raw.xlsx')
 const book=new ExcelJS.Workbook();await book.xlsx.load(new Uint8Array(output.bytes));const root=book.getWorksheet('主 POI'),sub=book.getWorksheet('子点位')
 assert.equal(book.worksheets[0].name,'景区数据');assert.equal(book.worksheets[0].rowCount,3);
 const headers=root.getRow(1).values;const col=label=>headers.indexOf(label)
 assert.equal(root.getCell(2,col('高德评分')).value,'4.7');assert.equal(root.getCell(2,col('高德标识（如景区级别）')).value,'4A景区')
 assert.equal(root.getCell(2,col('高德原始.business.extra.unknown')).value,'保留未知字段');assert.equal(sub.getCell(2,col('高德评分')).value,0)
 const raw=book.getWorksheet('高德原始响应');let chunks=[];raw.eachRow((row,index)=>{if(index>1&&row.getCell(1).value===p.id&&row.getCell(4).value===1)chunks.push(row.getCell(7).value)})
 assert.deepEqual(JSON.parse(chunks.join('')),p.raw)
 const longs=book.getWorksheet('长字段完整值');let parts=[];longs.eachRow((row,index)=>{if(index>1&&row.getCell(3).value==='raw:long')parts.push(row.getCell(6).value)})
 assert.equal(parts.join(''),p.raw.long)
})
test('template export keeps the AI selection and supplement instruction audit beside sourced cells',()=>{
 const b=workbook(),p=poi();fillTemplate(b,[p],{...options,columnMap:[{column:1,field:'name'}],selectionAudit:{instruction:'推荐前10，不是客流排名',basis:'ai_recommendation',poiIds:['1']},supplementAudit:[{instruction:'查证简介，未知留空',missingCount:2}]});const s=b.getWorksheet('筛选与补全指令');assert.equal(s.rowCount,3);assert.ok(s.getCell('B2').value.includes('ai_recommendation'));assert.ok(s.getCell('B3').value.includes('未知留空'));
})

test('related times retain season and performance conditions and never guess admission cutoff',async()=>{
 const {scheduleFields,resolvedField}=await import(fieldsURL);
 assert.deepEqual(scheduleFields('9:00—17:00 最晚进入16:30'),{openingHours:'09:00-17:00',lastEntry:'16:30',closingTime:'17:00（营业结束，按高德开放时间整理）'});
 const mixed=scheduleFields('冬季 09:00-17:00 最晚进入16:00；夏季 09:00-21:00 最晚进入20:00');assert.equal(mixed.lastEntry,'冬季 16:00；夏季 20:00');assert.ok(mixed.openingHours.includes('夏季'));assert.ok(mixed.closingTime.includes('冬季'));
 const part=scheduleFields('周一 09:00-17:00 最晚进入16:00；周二 09:00-18:00');assert.equal(part.lastEntry,'周一 16:00');
 assert.equal(scheduleFields('冬令时 第一场19:00-19:15，第二场20:00-20:15').closingTime,'');assert.equal(scheduleFields('09:00-17:00').lastEntry,'');assert.equal(scheduleFields('全天开放').lastEntry,'');assert.equal(scheduleFields('暂停营业').closingTime,'');assert.ok(scheduleFields('09:00-17:00 最晚进入25:00').openingHours.includes('25:00'));
 const p=poi();p.hours='09:00-17:00';p.supplements=validateSupplements(p,[{field:'custom:闭馆时间',value:'16:45（馆内展厅）',sourceUrl:'https://example.com/official',sourceTitle:'官方闭馆规则'}]);assert.equal(resolvedField(p,'closingTime'),'16:45（馆内展厅）');const b=workbook();fillTemplate(b,[p],{...options,columnMap:[{column:1,field:'closingTime'}]});assert.equal(b.getWorksheet('AI补充来源').getCell('G2').value,'https://example.com/official');assert.equal(p.hours,'09:00-17:00');
})

test('Beijing live schedules handle reverse cutoff phrases, weekly fallbacks and internal gates',async()=>{
 const {scheduleFields,resolvedField}=await import(fieldsURL);
 const palace=scheduleFields('旺季4月1日至10月31日 周二至周日 08:30-17:00 16:00停止检票，淡季11月1日至3月31日 周二至周日 08:30-16:30 15:30停止检票，周一全天关闭');assert.ok(palace.lastEntry.includes('旺季4月1日至10月31日 周二至周日 16:00'));assert.ok(palace.lastEntry.includes('淡季11月1日至3月31日 周二至周日 15:30'));assert.ok(palace.openingHours.includes('周一全天关闭'));assert.ok(!palace.openingHours.includes('停止检票'));
 const p=poi();p.hours='08:30-17:00';p.weekHours='周二至周日08:30-17:00(16:10停止检票),周一闭馆(法定节假日除外)';assert.equal(resolvedField(p,'lastEntry'),'周二至周日 16:10');
 const hill=poi();hill.hours='06:00-19:30 06:00-19:00';hill.weekHours='04-01至11-15 06:00-19:30 最晚进入18:30；11-16至03-31 06:00-19:00 最晚进入18:00';assert.ok(resolvedField(hill,'openingHours').includes('11-16至03-31'));assert.ok(resolvedField(hill,'lastEntry').includes('18:30'));
 const temple=scheduleFields('冬季 06:30-22:00 最晚进入21:00 园中园08:00-17:00(16:30停止入园)；夏季 06:00-22:00 最晚进入21:00 园中园08:00-18:00(17:30停止入园)');assert.ok(temple.lastEntry.includes('冬季 园中园 16:30'));assert.ok(temple.lastEntry.includes('夏季 园中园 17:30'));assert.ok(temple.lastEntry.includes('冬季 21:00'));assert.equal(temple.closingTime,'');
})

test('reference ticket format uses numeric adult/student cells and only short child/senior conditions',async()=>{
 const {formatTicketPrice}=await import(fieldsURL);
 assert.equal(formatTicketPrice('custom:成人票','45'),45);assert.equal(formatTicketPrice('custom:学生票','22.5'),22.5);assert.equal(formatTicketPrice('custom:儿童票','0 (1.2 米以下)'),'0 (1.2米以下)');assert.equal(formatTicketPrice('custom:老人票','65（60岁以上）'),'65 (60岁以上)');
 for(const [field,value] of [['custom:成人票','旺季60；淡季40'],['custom:学生票','22.5 (凭学生证)'],['custom:儿童票','0 (旺季免票)'],['custom:老人票','0 (身份证预约)'],['custom:成人票','-1']])assert.throws(()=>formatTicketPrice(field,value),/票价格式/);
 const p=poi();p.supplements=validateSupplements(p,[{field:'custom:成人票',value:'45',sourceUrl:'https://example.com'},{field:'custom:学生票',value:'22.5',sourceUrl:'https://example.com'},{field:'custom:儿童票',value:'0 (1.2米以下)',sourceUrl:'https://example.com'},{field:'custom:老人票',value:'65 (60岁以上)',sourceUrl:'https://example.com'}]);const b=new ExcelJS.Workbook();const s=addStandardScenicSheet(b,[p]);assert.equal(s.getCell('U2').value,45);assert.equal(s.getCell('V2').value,22.5);assert.equal(s.getCell('W2').value,'0 (1.2米以下)');assert.equal(s.getCell('X2').value,'65 (60岁以上)');
 const book=workbook();fillTemplate(book,[poi()],{...options,columnMap:[{column:1,field:'name',instruction:'填官方景区名称'}]});assert.ok(book.getWorksheet('筛选与补全指令').getCell('B2').value.includes('填官方景区名称'));
})
