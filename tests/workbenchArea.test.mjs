import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const compile = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText).toString('base64')}`
const rawHelper = compile((await readFile('src/services/poiRaw.ts','utf8')).replace(/^import .*$/gm,''))
const helpers = compile(await readFile('src/services/collectChildren.ts','utf8'))
const pagesHelper = compile(await readFile('src/services/loadPages.ts','utf8'))
const area = compile(await readFile('src/services/area.ts','utf8'))
const vue = pathToFileURL(`${process.cwd()}/node_modules/vue/dist/vue.runtime.esm-bundler.js`).href
const source = (await readFile('src/composables/useWorkbench.ts','utf8')).replace(/^import .*$/gm,'')
const {useWorkbench} = await import(compile(`
import {mergePoiData} from '${rawHelper}';
import {ref,reactive,computed,watch} from '${vue}';
import {collectChildren,descendantIds} from '${helpers}';
import {insideArea,areaRectangle} from '${area}';
import {loadPages} from '${pagesHelper}';
const cancelImageDownload=()=>Promise.resolve();
const downloadPoiImages=(...a)=>globalThis.__downloadImages?.(...a) ?? Promise.resolve({images:[],failures:[],requested:0,directory:'/tmp'});
const exportWorkbook=(...a)=>globalThis.__exportWorkbook(...a);
const prepareBaiduBatch=()=>Promise.resolve('batch'),clearBaiduBatch=()=>Promise.resolve();
const mergeDownloads=(p,r)=>p.downloadedImages=r.images;
const onMounted=()=>{},onUnmounted=()=>{};
const errorMessage=e=>e?.message||String(e),normalizePoi=p=>p,classifyPoi=(_code,name)=>name;
const poiAoi=(...a)=>globalThis.__poiAoi(...a);
const searchPois=(...a)=>globalThis.__querySearch(...a);
const searchArea=(...a)=>globalThis.__areaSearch(...a),poiDetails=(...a)=>globalThis.__areaDetails(...a);
${source}`))
globalThis.window={clearTimeout(){},setTimeout(){return 0}}
const poi=(id)=>({id,name:id,location:[112,28],category:'景点',source:'amap',parentId:'',children:[],photos:[],included:true,status:'done',address:'长沙'})
const polygon=[[111,27],[113,27],[113,29],[111,29]]
function fixture(){const w=useWorkbench();w.district.value={adcode:'430100'};w.mapReady.value=true;w.pois.value=[poi('root')];return w}
test('manual polygon waits for the user then completes only after area pages and child details/photos',async()=>{
 const w=fixture();let finishDetails;let pages=[]
 globalThis.__areaSearch=async(_polygon,page)=>{pages.push(page);return {pois:page===1?[poi('child')]:[poi('child2')],hasMore:page===1}}
 globalThis.__areaDetails=async(ids)=>{await new Promise(resolve=>{finishDetails=resolve});return ids.map(id=>({...poi(id),photos:['https://example.com/photo']}))}
 const request=w.requestAreaSelection(w.pois.value[0],true);assert.equal(request.state,'awaiting_user');assert.equal(w.detailOpen.value,false);assert.equal(w.areaTarget.value.id,'root');assert.equal(w.selectedId.value,'root')
 const collecting=w.finishAreaSelection(polygon);await new Promise(resolve=>setImmediate(resolve))
 assert.equal(w.areaSelection.value.state,'collecting');assert.deepEqual(pages,[1,2]);assert.equal(w.children.value.length,2)
 finishDetails();await collecting;assert.equal(w.areaSelection.value.state,'completed');assert.equal(w.areaSelection.value.childCount,2);assert.ok(w.areaSelection.value.finishedAt)
 assert.ok(w.children.value.every(p=>p.status==='done'&&p.photos.length===1));assert.equal(w.areaTarget.value,null)
})
test('cancelled selections and failed searches do not report completion',async()=>{
 const w=fixture();w.requestAreaSelection(w.pois.value[0],true);w.cancelAreaSelection();await w.finishAreaSelection(polygon);assert.equal(w.areaSelection.value.state,'cancelled')
 globalThis.__areaSearch=async()=>{throw new Error('接口失败')};w.requestAreaSelection(w.pois.value[0],true);await w.finishAreaSelection(polygon);assert.equal(w.areaSelection.value.state,'failed');assert.equal(w.areaSelection.value.error,'接口失败')
 let finishSearch;globalThis.__areaSearch=async()=>{await new Promise(resolve=>{finishSearch=resolve});return {pois:[poi('late')],hasMore:false}}
 w.requestAreaSelection(w.pois.value[0],true);const task=w.finishAreaSelection(polygon);w.cancelCollection();finishSearch();await task
 assert.equal(w.areaSelection.value.state,'cancelled');assert.equal(w.children.value.length,0)
})

test('one query waits for all pages then child details and photos; query-only mode remains available',async()=>{
 const w=fixture();const pages=[];let finishDetails
 globalThis.__querySearch=async(_adcode,_codes,_keyword,page)=>{pages.push(page);return {page,hasMore:page===1,pois:[{...poi('p'+page),status:'pending'}]}}
 globalThis.__areaDetails=async(ids)=>{await new Promise(resolve=>{finishDetails=resolve});return ids.map(id=>({...poi(id),photos:['https://example.com/detail-photo']}))}
 const task=w.runPreview();await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(pages,[1,2]);assert.equal(w.isPreviewing.value,false);assert.equal(w.isCollecting.value,true)
 finishDetails();await task;assert.ok(w.pois.value.every(p=>p.status==='done'&&p.photos.length===1));assert.equal(w.activeJob.value.status,'已完成')
 let calls=0;globalThis.__areaDetails=async()=>{calls++;return []};await w.runPreview(false,false);assert.equal(calls,0);assert.ok(w.pois.value.every(p=>p.status==='pending'))
})
test('failed or cancelled queries retain data and never auto-start detail collection',async()=>{
 const w=fixture();let detailCalls=0
 globalThis.__areaDetails=async()=>{detailCalls++;return []}
 globalThis.__querySearch=async(_a,_b,_c,page)=>{if(page===2)throw new Error('query failed');return {page,hasMore:true,pois:[{...poi('loaded'),status:'pending'}]}}
 await w.runPreview();assert.equal(w.previewState.value,'error');assert.equal(w.pois.value.length,1);assert.equal(detailCalls,0)
 let finish;globalThis.__querySearch=async()=>{await new Promise(resolve=>{finish=resolve});return {page:1,hasMore:false,pois:[poi('late')]}}
 const task=w.runPreview();w.cancelPreview();finish();await task;assert.equal(w.previewState.value,'cancelled');assert.equal(detailCalls,0);assert.equal(w.pois.value.length,0)
})

test('a manually added parent can select an area and collect real children without querying its local ID',async()=>{
 const w=fixture();w.pois.value=[];assert.equal(w.addManual('重新补录景区','长沙',[112,28],''),true)
 const parent=w.pois.value[0];assert.equal(parent.source,'user');assert.ok(parent.id.startsWith('user-'))
 globalThis.__areaSearch=async()=>({pois:[{...poi('official-child'),status:'pending'}],hasMore:false})
 const requested=[];globalThis.__areaDetails=async(ids)=>{requested.push(...ids);return ids.map(id=>({...poi(id),photos:['https://example.com/child-photo']}))}
 w.requestAreaSelection(parent,true);await w.finishAreaSelection(polygon)
 assert.equal(w.areaSelection.value.state,'completed');assert.deepEqual(requested,['official-child'])
 assert.equal(w.childPois(parent.id)[0].parentId,parent.id);assert.equal(w.childPois(parent.id)[0].relation,'area');assert.equal(w.childPois(parent.id)[0].status,'done');assert.equal(w.childPois(parent.id)[0].photos.length,1)
 assert.equal(parent.source,'user');assert.equal(parent.status,'manual')
})

test('detail collection retains query business data and source snapshots for both parent and child',async()=>{
 const w=fixture();const root={...poi('root'),status:'pending',tel:'原电话',photos:['https://example.com/search'],raw:{id:'root',business:{rating:'4.7',keytag:'4A景区'},unknown:'主查询字段'}}
 const child={...poi('child'),parentId:'root',status:'pending',raw:{id:'child',business:{rating:'3.2',alias:'子点别名'}}}
 w.pois.value=[root];w.children.value=[child]
 globalThis.__areaDetails=async(ids)=>ids.map(id=>({...poi(id),tel:'',photos:['https://example.com/detail'],raw:{id,business:{tel:''},detailOnly:'详情字段'}}))
 await w.startCollection()
 assert.equal(w.pois.value[0].tel,'原电话');assert.equal(w.pois.value[0].raw.business.rating,'4.7');assert.equal(w.pois.value[0].raw.detailOnly,'详情字段');assert.equal(w.pois.value[0].rawRecords.length,2)
 assert.equal(w.children.value[0].raw.business.rating,'3.2');assert.equal(w.children.value[0].raw.business.alias,'子点别名');assert.equal(w.children.value[0].rawRecords.length,2)
 assert.deepEqual(w.pois.value[0].photos,['https://example.com/search','https://example.com/detail'])
})

test('main-only detail collection does not discover or request embedded children',async()=>{
 const w=fixture();w.pois.value=[{...poi('root'),status:'pending'}];w.children.value=[{...poi('existing-child'),parentId:'root',status:'pending'}]
 const requested=[];globalThis.__areaDetails=async ids=>{requested.push(...ids);return ids.map(id=>({...poi(id),status:'done',children:[{...poi('embedded-child'),status:'pending'}],raw:{id,business:{rating:'4.8'}}}))}
 await w.startCollection(false,'',undefined,false)
 assert.deepEqual(requested,['root']);assert.equal(w.pois.value[0].status,'done');assert.equal(w.pois.value[0].raw.business.rating,'4.8');assert.equal(w.children.value.length,1);assert.equal(w.children.value[0].status,'pending')
})

test('AOI-first request automatically searches full boundary rings and filters bounding-box outsiders',async()=>{
 const w=fixture();const ring=[...polygon.slice(0,2),...[...Array(210)].map((_,i)=>[113,27+i/105]),polygon[3]]
 globalThis.__poiAoi=async id=>{assert.equal(id,'root');return {boundaries:[ring],raw:{aois:[{id,polyline:'original'}]}}}
 const queries=[];globalThis.__areaSearch=async(p,page)=>{queries.push(p);return {pois:[poi('inside'),{...poi('outside'),location:[114,28]}],hasMore:false}}
 globalThis.__areaDetails=async ids=>ids.map(poi)
 const request=w.requestAreaSelection(w.pois.value[0]);assert.equal(request.state,'resolving_boundary');assert.equal(w.areaTarget.value,null)
 while(['resolving_boundary','collecting'].includes(request.state))await new Promise(resolve=>setImmediate(resolve))
 assert.equal(request.state,'completed');assert.equal(request.boundarySource,'aoi');assert.equal(request.boundaries[0].length,213);assert.deepEqual(queries,[polygon]);assert.deepEqual(w.childPois('root').map(p=>p.id),['inside']);assert.ok(w.pois.value[0].raw.aoiBoundary)
})
test('missing AOI and API permission failures fall back to user drawing with a reason',async()=>{
 for(const lookup of [async()=>({boundaries:[],raw:{aois:[]}}),async()=>{throw new Error('权限不足')}]){
  const w=fixture();globalThis.__poiAoi=lookup
  const request=w.requestAreaSelection(w.pois.value[0]);await new Promise(resolve=>setImmediate(resolve))
  assert.equal(request.state,'awaiting_user');assert.ok(request.fallbackReason);assert.equal(w.areaTarget.value.id,'root');assert.equal(w.isCollecting.value,false)
 }
})
test('cancelling a pending AOI request prevents late drawing or searches',async()=>{
 const w=fixture();let finish;globalThis.__poiAoi=()=>new Promise(resolve=>{finish=resolve})
 const request=w.requestAreaSelection(w.pois.value[0]);w.cancelCollection();finish({boundaries:[polygon],raw:{}});await new Promise(resolve=>setImmediate(resolve))
 assert.equal(request.state,'cancelled');assert.equal(w.areaTarget.value,null);assert.equal(w.children.value.length,0);assert.equal(w.isCollecting.value,false)
})

test('query and detail collection retain photo links without downloading files',async()=>{
 const w=fixture();w.pois.value=[{...poi('root'),status:'pending'}];let calls=0
 globalThis.__areaDetails=async ids=>ids.map(id=>({...poi(id),photos:['https://example.com/a'],children:[]}))
 globalThis.__downloadImages=async()=>{calls++;return {images:[],requested:0,failures:[],directory:'/tmp'}}
 await w.startCollection();assert.equal(calls,0);assert.equal(w.isDownloadingImages.value,false);assert.equal(w.pois.value[0].photos.length,1);globalThis.__downloadImages=undefined
})
test('Excel export skips implicit images and downloads only explicitly requested rows',async()=>{
 const w=fixture();w.pois.value=[{...poi('root'),photos:['https://example.com/root']}];w.children.value=[{...poi('child'),parentId:'root',photos:['https://example.com/child']}]
 const calls=[],exports=[];globalThis.__downloadImages=async(p,_options,automatic)=>{assert.equal(automatic,true);calls.push(p.id);return {images:[{path:`/tmp/${p.id}.jpg`,source:'amap'}],requested:1,failures:[],directory:'/tmp'}}
 globalThis.__exportWorkbook=async(main,children)=>{exports.push({main,children});return '/tmp/export.xlsx'}
 await w.exportData('/tmp/main.xlsx');assert.deepEqual(calls,[]);assert.equal(exports[0].children.length,0);assert.equal(exports[0].main[0].downloadedImages,undefined)
 await w.exportData('/tmp/main-images.xlsx',{photoPoiIds:['root']});assert.deepEqual(calls,['root']);assert.equal(exports[1].main[0].downloadedImages[0].path,'/tmp/root.jpg')
 calls.length=0;await w.exportData('/tmp/children.xlsx',{parentId:'root',childrenOnly:true,photoPoiIds:['child']});assert.deepEqual(calls,['child']);assert.equal(exports[2].main.length,0);assert.equal(exports[2].children.length,1)
 globalThis.__downloadImages=undefined;globalThis.__exportWorkbook=undefined
})
test('explicit supplements retain requested counts and stop scheduling after cancellation',async()=>{
 const w=fixture();const finishes=[],calls=[]
 globalThis.__downloadImages=async(p,options,automatic)=>{calls.push({p,options,automatic});await new Promise(r=>{finishes.push(r)});return {images:[],failures:[],requested:3,directory:'/tmp'}}
 const task=w.downloadImages([poi('one'),poi('two'),poi('three'),poi('four')],{count:3,ratio:'3:4',engine:'bing',minWidth:600});await new Promise(resolve=>setImmediate(resolve));assert.equal(w.isCollecting.value,true);assert.equal(calls[0].automatic,false);assert.equal(calls[0].options.ratio,'3:4');w.cancelCollection();finishes.forEach(finish=>finish());await task;assert.equal(calls.length,3);assert.equal(w.isDownloadingImages.value,false);assert.equal(w.imageResults.value.length,0);globalThis.__downloadImages=undefined
})
