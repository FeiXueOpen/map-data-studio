import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
const catalog = JSON.parse(await readFile('automation/tools.json', 'utf8'))
const standardFormat=JSON.parse(await readFile('automation/scenic-export-format.json','utf8'))
const source = (await readFile('src/services/automation.ts', 'utf8')).replace(/^import .*$/gm, '')
const rawSource = (await readFile('src/services/poiRaw.ts', 'utf8')).replace(/^import .*$/gm, '')
const rawJS = ts.transpileModule(rawSource, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const rawURL = `data:text/javascript;base64,${Buffer.from(rawJS).toString('base64')}`
const fieldsSource = (await readFile('src/services/poiFields.ts', 'utf8')).replace(/^import .*$/gm, '')
const fieldsJS = ts.transpileModule(`import { readRawField, validRawField } from '${rawURL}';\n${fieldsSource}`, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const fieldsURL = `data:text/javascript;base64,${Buffer.from(fieldsJS).toString('base64')}`
const childrenSource = (await readFile('src/services/collectChildren.ts', 'utf8')).replace(/^import .*$/gm, '')
const childrenJS = ts.transpileModule(childrenSource, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const childrenURL = `data:text/javascript;base64,${Buffer.from(childrenJS).toString('base64')}`
const { outputText } = ts.transpileModule(`import { rawPaths } from '${rawURL}'; import { templateGaps, validateSupplements, resolvedField, formatTicketPrice } from '${fieldsURL}'; import { descendantIds } from '${childrenURL}'; const catalog = ${JSON.stringify(catalog)}; const getDefaultExportFormat=()=>(${JSON.stringify(standardFormat)}); const getCities = async () => []; const getProvinces = async () => []; const inspectExcelTemplate = async (path,headerRow,sheetName) => ({path,headerRow,sheetName,sheets:[]}); const exportExcelTemplate = async (records, options) => { globalThis.__selectedExport = records; globalThis.__exportOptions = options; return {path:options.path, rows:records.length} };\n${source}`, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } })
const { createAutomationController, validateArguments } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const ref = (value) => ({ value })
const point = (id, parentId = '') => ({ id, parentId, name: `点位${id}`, category: '景点', address: '地址', location: [112.9,28.2], included: true, status: 'pending', photos: ['a','b','c','d','e'], children: [] })
function fixture() {
 const w = Object.fromEntries(Object.entries({ city:'杭州市', selection:null, district:{ name:'杭州市', adcode:'330100', center:[120,30] }, cityBusy:false, isPreviewing:false, isCollecting:false, isExporting:false, status:'待查询', previewState:'idle', previewProgress:'', queryDirty:false, hasMore:false, areaProgress:'', areaNotice:'', areaTarget:null, areaSelection:null, mapReady:true, pois:[], children:[], includedCount:1, failedCount:0, selectedTypes:['景点'], keyword:'', error:'', activeJob:null, jobs:[], categories:[{name:'景点', code:'110000', color:'#12ab34'}], toast:'' }).map(([k,v])=>[k,ref(v)]))
 w.childPois = (id) => w.children.value.filter((p)=>p.parentId===id)
 w.toggleType = (name) => { w.selectedTypes.value = w.selectedTypes.value.includes(name) ? w.selectedTypes.value.filter((n)=>n!==name) : [...w.selectedTypes.value,name] }
 w.openPoi = (...args) => { w.opened=args }
 w.cancelPreview = () => { if(w.isPreviewing.value) { w.isPreviewing.value=false; w.previewState.value='cancelled' } }
 w.cancelCollection = () => { w.isCollecting.value=false; w.areaTarget.value=null; if(w.areaSelection.value) w.areaSelection.value.state='cancelled' }
 w.requestAreaSelection = (p, manual) => { w.lastManual=manual; w.openPoi(p.id,p.parentId); w.areaTarget.value=p; return w.areaSelection.value={requestId:'request', parentId:p.id, name:p.name, state:'awaiting_user'} }
 w.runPreview = async () => { w.isPreviewing.value=true; w.pois.value=Array.from({length:61},(_,i)=>point(`${i}`)); w.previewState.value='complete'; w.isPreviewing.value=false }
 w.startCollection = async () => { w.children.value=[point('child','0')]; w.children.value[0].status='done'; w.activeJob.value={status:'已完成', completed:1, failed:0} }
 w.changeCity = async (selection) => { w.city.value=selection.city.name; w.selection.value=selection; w.pois.value=[]; w.children.value=[] }
 w.downloadImages = async()=>[]
 w.exportData = async (path) => path
 return w
}
const tick = () => new Promise((resolve)=>setImmediate(resolve))
test('validates arguments before mutations, including invalid coordinates and unknown fields', async () => {
 const w=fixture(), call=createAutomationController(w)
 assert.throws(()=>validateArguments('set_included',{ids:['0'],included:'false'}))
 assert.throws(()=>validateArguments('get_status',{webKey:'secret'}))
 assert.throws(()=>validateArguments('list_pois',{pageSize:101}))
 assert.throws(()=>validateArguments('search_area',{parentId:'0',polygon:[[1,2],[1,2],[Infinity,3]]}))
 await assert.rejects(call('set_query',{categories:['不存在']})); assert.deepEqual(w.selectedTypes.value,['景点'])
})
test('query shares workbench records; paginates every result and returns all images and children', async () => {
 const w=fixture(), call=createAutomationController(w)
 await call('set_query',{categories:['景点'],keyword:'湖'}); const query=await call('start_query')
 await tick(); const status=await call('get_status'); assert.equal(status.operations[0].id,query.operationId); assert.equal(status.operations[0].state,'completed'); assert.equal(status.total,61)
 const pages=await Promise.all([1,2,3].map((page)=>call('list_pois',{page,pageSize:25})))
 assert.deepEqual(pages.map((p)=>p.items.length),[25,25,11]); assert.equal(new Set(pages.flatMap((p)=>p.items.map((i)=>i.id))).size,61)
 await call('start_collection'); await tick(); assert.equal((await call('list_pois',{parentId:'0'})).items[0].id,'child')
 assert.equal((await call('get_poi',{id:'child',parentId:'0',open:true})).poi.photos.length,5); assert.deepEqual(w.opened,['child','0'])
 const statusJSON=JSON.stringify(await call('get_status')); assert.ok(!statusJSON.includes('securityJsCode'))
})
test('reserves long tasks before yielding and cancellation prevents a queued task from running', async () => {
 const w=fixture(); let runs=0; w.runPreview=async()=>{runs++}
 const call=createAutomationController(w); const pending=call('start_query')
 await assert.rejects(call('set_query',{categories:['景点']}),/正在执行任务/)
 await pending; await tick(); assert.equal(runs,1)
 let finish; w.runPreview=async()=>{w.isPreviewing.value=true; await new Promise((resolve)=>{finish=resolve})}
 await call('start_query'); await tick(); await call('cancel_operation'); finish(); await tick()
 assert.equal((await call('get_status')).operations[0].state,'cancelled')
})
test('city IDs are verified in their province and city changes do not initiate queries', async () => {
 const w=fixture(); let queries=0; w.runPreview=async()=>{queries++}
 const regions={getProvinces:async()=>[{id:1,name:'江西省'}],getCities:async()=>[{id:2,name:'南昌市'}]}; const call=createAutomationController(w,regions)
 await call('select_city',{provinceId:1,cityId:99}); await tick(); assert.equal((await call('get_status')).operations[0].state,'failed'); assert.equal(w.city.value,'杭州市')
 await call('select_city',{provinceId:1,cityId:2}); await tick(); assert.equal(w.city.value,'南昌市'); assert.equal(queries,0)
})
test('fast path combines city and query setup, exposes one-operation status and collects only a selection',async()=>{
 const w=fixture();let preview,collection
 w.runPreview=async(append,autoCollect)=>{preview={append,autoCollect};w.pois.value=[point('a'),point('b')];w.previewState.value='complete'}
 w.startCollection=async(retry,scope,ids,includeChildren)=>{collection={retry,scope,ids,includeChildren};w.activeJob.value={status:'已完成',completed:ids.length,failed:0}}
 const regions={getProvinces:async()=>[{id:1,name:'湖南省'}],getCities:async()=>[{id:2,name:'长沙市'}]};const call=createAutomationController(w,regions)
 const query=await call('start_query',{province:'湖南',city:'长沙',categories:['景点'],keyword:'景区',autoCollect:false});await tick();assert.deepEqual(preview,{append:false,autoCollect:false});assert.equal(w.city.value,'长沙市');assert.equal(w.keyword.value,'景区')
 const operation=await call('get_operation',{operationId:query.operationId});assert.equal(operation.state,'completed');assert.equal(typeof operation.durationMs,'number')
 const selected=await call('filter_pois',{instruction:'前1',limit:1});const collect=await call('start_collection',{selectionId:selected.selectionId});await tick();assert.deepEqual(collection,{retry:false,scope:'',ids:['a'],includeChildren:false});assert.equal((await call('get_operation',{operationId:collect.operationId})).state,'completed')
 await call('start_collection',{selectionId:selected.selectionId,includeChildren:true});await tick();assert.equal(collection.includeChildren,true)
 w.pois.value[0].collectedAt='2026-10-16T00:00:00.000Z';w.children.value.push(point('child','a'));assert.equal((await call('get_poi_selection',{selectionId:selected.selectionId})).poiIds[0],'a')
 const inspected=await call('inspect_excel_template',{path:'/tmp/template.xlsx',headerRow:2,sheetName:'数据'});assert.equal(inspected.path,'/tmp/template.xlsx');assert.equal(inspected.headerRow,2);assert.equal(inspected.operationId,undefined)
})
test('inclusion changes are atomic; failed exports are never reported as completed', async () => {
 const w=fixture(); w.pois.value=[point('0'),point('1')]; const call=createAutomationController(w)
 await assert.rejects(call('set_included',{ids:['0','missing'],included:false})); assert.equal(w.pois.value[0].included,true)
 w.exportData=async()=>{w.error.value='文件已存在'; return undefined}
 const op=await call('export_excel',{path:'/tmp/existing.xlsx'}); await tick(); const status=await call('get_status'); assert.equal(status.operations[0].id,op.operationId); assert.equal(status.operations[0].state,'failed'); assert.equal(status.operations[0].error,'文件已存在')
})

test('AI supplements are sourced, atomic, visible in details, and never overwrite AMap values', async () => {
 const w=fixture(); const p=point('0'); p.tel=''; w.pois.value=[p]; const call=createAutomationController(w)
 await assert.rejects(call('supplement_poi',{id:'0',fields:[{field:'tel',value:'123',sourceUrl:'https://example.com'},{field:'address',value:'覆盖地址',sourceUrl:'https://example.com'}]}),/已有原始值/)
 assert.equal(p.supplements,undefined)
 await call('supplement_poi',{id:'0',fields:[{field:'tel',value:'123',sourceUrl:'https://example.com/contact',sourceTitle:'景区官网'},{field:'custom:门票价格',value:'0',sourceUrl:'https://example.com/tickets'}]})
 assert.equal((await call('get_poi',{id:'0'})).poi.supplements.length,2); assert.equal(p.tel,'')
 const gaps=await call('get_template_gaps',{fields:['name','tel','custom:门票价格','custom:景区等级']}); assert.equal(gaps.total,1); assert.equal(gaps.items[0].field,'custom:景区等级')
 await assert.rejects(call('supplement_poi',{id:'0',fields:[{field:'custom:等级',value:'5A',sourceUrl:'javascript:alert(1)'}]}),/HTTP/)
})

test('AI requests AOI-first selection by a unique loaded name; ambiguous names never pick a point', async () => {
 const w=fixture(); w.pois.value=[point('0'),point('1')]; const call=createAutomationController(w)
 await assert.rejects(call('request_area_selection',{}),/id 或 name/)
 w.pois.value[1].name=w.pois.value[0].name
 await assert.rejects(call('request_area_selection',{name:'点位0'}),/名称重复/); assert.equal(w.areaTarget.value,null)
 await assert.rejects(call('request_area_selection',{id:'0',name:'另一个'}),/不匹配/)
 const request=await call('request_area_selection',{id:'0',name:'点位0'}); assert.equal(request.parentId,'0');assert.equal(w.lastManual,false)
 const status=await call('get_status'); assert.equal(status.areaSelection.state,'awaiting_user'); assert.equal(status.busy,true)
 await assert.rejects(call('start_query'),/正在执行任务/)
 assert.equal((await call('list_pois',{search:'点位0'})).total,2)
 await call('cancel_operation'); assert.equal((await call('get_status')).areaSelection.state,'cancelled'); assert.equal(w.areaTarget.value,null)
 await call('request_area_selection',{id:'0',manual:true});assert.equal(w.lastManual,true)
})
test('template child scope includes descendants of one parent and filters identically for gaps and export', async () => {
 const w=fixture(); w.pois.value=[point('root'),point('other')]; w.pois.value[0].included=false
 w.children.value=[point('child','root'),point('grandchild','child'),point('unrelated','other')]
 const call=createAutomationController(w)
 const args={parentId:'root',childrenOnly:true,fields:['custom:等级']}
 const all=await call('get_template_gaps',args); assert.deepEqual(all.items.map(p=>p.id),['child','grandchild'])
 const filtered=await call('get_template_gaps',{...args,poiIds:['grandchild']}); assert.equal(filtered.items[0].id,'grandchild'); assert.equal(filtered.total,1)
 await assert.rejects(call('get_template_gaps',{fields:args.fields,childrenOnly:true}),/需要 parentId/)
 await assert.rejects(call('get_template_gaps',{...args,poiIds:['unrelated']}),/指定范围/)
 const op=await call('export_excel_template',{templatePath:'/tmp/template.xlsx',path:'/tmp/children.xlsx',sheetName:'子点位',parentId:'root',childrenOnly:true,poiIds:['grandchild'],columnMap:[{column:1,field:'name'}]})
 await tick(); assert.deepEqual(globalThis.__selectedExport.map(p=>p.id),['grandchild']); assert.equal((await call('get_status')).operations.find(o=>o.id===op.operationId).state,'completed')
 assert.deepEqual(w.pois.value.map(p=>p.included),[false,true])
 w.children.value=[]
 await assert.rejects(call('export_excel_template',{templatePath:'/tmp/t.xlsx',path:'/tmp/o.xlsx',sheetName:'子点位',parentId:'root',childrenOnly:true,columnMap:[{column:1,field:'name'}]}),/没有可导出/)
})

test('AI query defaults to list-only and waits for collection only when explicitly requested',async()=>{
 const w=fixture();let finish;let received
 w.runPreview=async(append,autoCollect)=>{received={append,autoCollect};w.previewState.value='complete';w.isCollecting.value=autoCollect;if(autoCollect)await new Promise(resolve=>{finish=resolve});w.isCollecting.value=false}
 const call=createAutomationController(w);const listOnly=await call('start_query');await tick();assert.deepEqual(received,{append:false,autoCollect:false});assert.equal((await call('get_operation',{operationId:listOnly.operationId})).state,'completed')
 const op=await call('start_query',{autoCollect:true});await tick();assert.equal(received.autoCollect,true);assert.equal((await call('get_status')).operations.find(o=>o.id===op.operationId).state,'running')
 finish();await tick();assert.equal((await call('get_status')).operations[0].state,'completed')
 const cancelled=await call('start_query',{autoCollect:true});await tick();await call('cancel_operation');finish();await tick();assert.equal((await call('get_status')).operations.find(o=>o.id===cancelled.operationId).state,'cancelled')
})

test('image supplements require a separate explicit tool and respect count, ratio and child scope',async()=>{
 const w=fixture();w.pois.value=[point('root'),point('other')];w.children.value=[point('child','root'),point('grandchild','child'),point('unrelated','other')]
 let received;w.downloadImages=async(records,options)=>{received={records,options};return [{saved:2,requested:3,failures:['不足']}]}
 const call=createAutomationController(w)
 await assert.rejects(call('download_images',{count:0}),/数值/);await assert.rejects(call('download_images',{ratio:'wrong'}),/枚举|选项|无效/)
 const op=await call('download_images',{parentId:'root',childrenOnly:true,count:3,ratio:'5:7',width:500,height:700,minWidth:400,minHeight:600});await tick();assert.deepEqual(received.records.map(p=>p.id),['child','grandchild']);assert.equal(received.options.count,3);assert.equal(received.options.ratio,'5:7');assert.equal(received.options.width,500);assert.equal(received.options.height,700);assert.equal(received.options.minHeight,600);assert.equal(received.options.engine,'bing');assert.equal((await call('get_status')).operations.find(p=>p.id===op.operationId)?.state || (await call('get_status')).operations[0].state,'completed')
})

test('MCP validates and forwards per-column time and Excel formatting',async()=>{
 const w=fixture();w.pois.value=[point('root')];const call=createAutomationController(w);
 const columnMap=[{column:1,field:'hours',valueType:'text',numberFormat:'@',textFormat:'openingHours',timeFormat:'HH:mm',rangeSeparator:'至',wrapText:true}];
 await call('export_excel_template',{templatePath:'/tmp/t.xlsx',path:'/tmp/o.xlsx',sheetName:'模板',columnMap});await tick();assert.deepEqual(globalThis.__exportOptions.columnMap,columnMap);
 assert.throws(()=>validateArguments('export_excel_template',{templatePath:'/tmp/t.xlsx',path:'/tmp/o.xlsx',sheetName:'模板',columnMap:[{...columnMap[0],timeFormat:'arbitrary'}]}));
})

test('AI discovers the built-in scenic format without a user template or querying the city',async()=>{
 const w=fixture(),call=createAutomationController(w);const before=w.pois.value;const result=await call('get_default_export_format');assert.equal(result.columns.length,34);assert.equal(result.columns[17].field,'openingHours');assert.equal(w.pois.value,before);assert.equal((await call('get_status')).busy,false);
})
test('AI controls top10/top50 numeric filters; missing metrics do not become zero or fake traffic',async()=>{
 const w=fixture();w.pois.value=Array.from({length:60},(_,i)=>({...point(String(i)),raw:{business:{rating:String(i/10)}}}));w.pois.value.push(point('missing'));const call=createAutomationController(w);
 const result=await call('filter_pois',{instruction:'按评分筛选前50，评分并非客流',sortBy:'rating',limit:50});assert.equal(result.poiIds.length,50);assert.equal(result.poiIds[0],'59');assert.equal(result.missingSortValues,1);
 const ten=await call('filter_pois',{instruction:'前10',sortBy:'rating',limit:10,filters:[{field:'rating',operator:'gte',value:'4'}]});assert.equal(ten.poiIds.length,10);
 const traffic=await call('filter_pois',{instruction:'按同口径客流取前10',sortBy:'custom:客流人次',limit:10});assert.equal(traffic.poiIds.length,0);assert.equal(traffic.shortfall,10);
})
test('AI ordered selection is reused by gaps/export and photo downloads can be limited independently',async()=>{
 const w=fixture();w.pois.value=[point('a'),point('b'),point('c')].map(p=>({...p,source:'amap'}));const call=createAutomationController(w);let photos;w.downloadImages=async rows=>{photos=rows.map(p=>p.id);return[]};
 const chosen=await call('create_poi_selection',{instruction:'AI选2个并按推荐顺序排列',basis:'ai_recommendation',poiIds:['c','a','b'],limit:2,evidence:[{id:'c',reason:'推荐理由',sourceUrl:'https://example.com/scenic'}]});assert.deepEqual(chosen.poiIds,['c','a']);
 const gaps=await call('get_template_gaps',{selectionId:chosen.selectionId,fields:['custom:基本简介']});assert.deepEqual(gaps.items.map(x=>x.id),['c','a']);
 await call('export_excel_template',{templatePath:'/tmp/t.xlsx',path:'/tmp/o.xlsx',sheetName:'模板',selectionId:chosen.selectionId,photoPoiIds:['a'],columnMap:[{column:1,field:'name'}]});await tick();assert.deepEqual(globalThis.__selectedExport.map(p=>p.id),['c','a']);assert.deepEqual(photos,['a']);
 await assert.rejects(call('export_excel_template',{templatePath:'/tmp/t.xlsx',path:'/tmp/o.xlsx',sheetName:'模板',selectionId:chosen.selectionId,photoPoiIds:['b'],columnMap:[{column:1,field:'name'}]}),/photoPoiIds/);
 w.pois.value=[point('different')];await assert.rejects(call('get_poi_selection',{selectionId:chosen.selectionId}),/数据已变化/);
})
test('supplement instruction is tracked separately and sourced batch updates are atomic and task-scoped',async()=>{
 const w=fixture();w.pois.value=[point('a'),point('b'),point('outside')];const call=createAutomationController(w);
 const plan=await call('create_supplement_task',{instruction:'联网核实并补全基本简介，找不到留空',poiIds:['a','b'],fields:['custom:基本简介']});assert.equal(plan.missingCount,2);
 const item=id=>({id,fields:[{field:'custom:基本简介',value:'已查证的简介',sourceUrl:'https://example.com/'+id}]});
 await assert.rejects(call('supplement_pois',{taskId:plan.taskId,items:[item('a'),{id:'b',fields:[{field:'custom:基本简介',value:'简介',sourceUrl:'file:///bad'}]}]}));assert.equal(w.pois.value[0].supplements,undefined);
 await assert.rejects(call('supplement_pois',{taskId:plan.taskId,items:[item('outside')]}),/不属于/);
 const result=await call('supplement_pois',{taskId:plan.taskId,items:[item('a'),item('b')]});assert.equal(result.updatedFields,2);assert.equal((await call('get_supplement_task',{taskId:plan.taskId})).state,'completed');
})

test('default supplement tasks include every ticket and guide field and report groups beyond the first gap page',async()=>{
 const w=fixture();w.pois.value=Array.from({length:10},(_,i)=>point(String(i)));const call=createAutomationController(w)
 const t=await call('create_supplement_task',{instruction:'按默认杭州格式导出景区并补全'});
 for(const field of ['custom:成人票','custom:学生票','custom:儿童票','custom:老人票','custom:费用明细','custom:交通指南','closingTime'])assert.ok(t.fields.includes(field));
 assert.ok(t.missingCount>100);assert.equal(t.gaps.items.length,100);assert.equal(t.groups.find(g=>g.name==='票价与费用').missingCount,50);assert.ok(t.enrichmentPolicy.enabledByDefault);
 const status=await call('get_supplement_task',{taskId:t.taskId});assert.equal(status.groups.find(g=>g.name==='票价与费用').missingCount,50);
 const only=await call('create_supplement_task',{instruction:'只补简介',fields:['custom:基本简介']});assert.equal(only.groups.find(g=>g.name==='票价与费用').missingCount,0);assert.deepEqual(only.fields,['custom:基本简介']);
})

test('column-specific AI instructions are returned, enforced atomically and user rules override defaults',async()=>{
 const w=fixture();w.pois.value=[point('a'),point('b')];const call=createAutomationController(w);
 const t=await call('create_supplement_task',{instruction:'按每列要求补填',fields:['custom:成人票','custom:儿童票','custom:基本简介'],fieldRules:[{field:'custom:基本简介',column:5,instruction:'简介不超过4字',valueType:'text',maxLength:4}]});
 assert.equal(t.fieldRules.find(r=>r.field==='custom:儿童票').format,'ticketPrice');assert.equal((await call('get_supplement_task',{taskId:t.taskId})).fieldRules.find(r=>r.field==='custom:基本简介').instruction,'简介不超过4字');
 const item=(id,field,value)=>({id,fields:[{field,value,sourceUrl:'https://example.com/official'}]});
 await assert.rejects(call('supplement_pois',{taskId:t.taskId,items:[item('a','custom:成人票','45'),item('b','custom:儿童票','0（旺季免票，需预约）')]}),/票价格式/);assert.equal(w.pois.value[0].supplements,undefined);
 await assert.rejects(call('supplement_pois',{taskId:t.taskId,items:[item('a','custom:基本简介','超过四字限制')]}),/字限制/);
 await call('supplement_pois',{taskId:t.taskId,items:[item('a','custom:儿童票','0 (1.2米以下)'),item('b','custom:成人票','22.5')]});
 await assert.rejects(call('create_supplement_task',{instruction:'错误列',fields:['custom:成人票'],fieldRules:[{field:'custom:其他',instruction:'不能越过范围'}]}),/不属于/);
 const override=await call('create_supplement_task',{instruction:'用户模板自定义票价列',fields:['custom:成人票'],fieldRules:[{field:'custom:成人票',instruction:'保留单位',valueType:'text',format:'original'}]});
 assert.equal(override.fieldRules[0].format,'original');await call('supplement_pois',{taskId:override.taskId,items:[item('a','custom:成人票','45元')]});
})
