import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseBaiduImages,decodeBaiduUrl,publicImageUrl} from '../browser-images/baidu-parser.mjs'
import {searchBaidu,browserProxy,baiduSearchUrl,searchBaiduBatch} from '../browser-images/search-baidu.mjs'
test('Baidu parsing prefers original and source URLs and decodes encrypted originals',()=>{
 const plain='0123456789abcdefghijklmnopqrstuvw',encoded='7dgjmoru140852vsnkheb963wtqplifca'
 const inverse=Object.fromEntries([...encoded].map((c,i)=>[c,plain[i]]))
 const original='https://example.com/photo.jpg'
 const encrypted=[...original].map(c=>inverse[c]||c).join('').replaceAll(':','_z2C$q').replaceAll('.','_z&e3B').replaceAll('/','AzdH3F')
 assert.equal(decodeBaiduUrl(encrypted),original)
 assert.deepEqual(parseBaiduImages({data:[{objURL:encrypted,hoverURL:'https://example.com/preview.jpg',replaceUrl:[{FromURL:'https://example.com/page'}]}]}),[{url:original,page:'https://example.com/page'}])
 assert.equal(parseBaiduImages({data:[{replaceUrl:[{ObjURL:'https://example.com/original.png',FromURL:'https://example.com/source'}],middleURL:'https://example.com/thumb.jpg'}]})[0].url,'https://example.com/original.png')
 assert.deepEqual(parseBaiduImages({data:[{hoverURL:'https://example.com/preview.jpg',middleURL:'https://example.com/thumbnail.jpg'}]}),[]);
 assert.equal(publicImageUrl('file:///tmp/private'),'');assert.equal(publicImageUrl('https://user:password@example.com/image'),'')
})
test('the browser denies Baidu device and LAN permissions before navigating',async()=>{
 const order=[],events=[];let closed=false
 const rows=Array.from({length:40},(_,i)=>({url:`https://example.com/${i}.jpg`,page:'https://example.com/page'}))
 const page={on(){},isClosed:()=>false,goto:async url=>{order.push('navigate');assert.equal(new URL(url).searchParams.get('word'),'长沙 橘子洲')},evaluate:async()=>({title:'百度图片搜索',url:'https://image.baidu.com/search/index',text:'',rows})}
 const context={grantPermissions:async(p,o)=>{assert.deepEqual(p,[]);assert.equal(o.origin,'https://image.baidu.com');order.push('deny')},on(){},pages:()=>[page],close:async()=>{closed=true}}
 const driver={launchPersistentContext:async(_profile,o)=>{assert.equal(o.headless,false);return context}}
 const result=await searchBaidu({query:'长沙 橘子洲',count:3,profile:'/tmp/test',waitMs:1000},e=>events.push(e),driver)
 assert.deepEqual(order,['deny','navigate']);assert.equal(result.length,36);assert.ok(closed);assert.ok(events.some(e=>e.type==='result'))
})
test('browser proxy uses explicit user network settings without exposing credentials in the URL',()=>{
 assert.deepEqual(browserProxy({HTTPS_PROXY:'http://user:secret@127.0.0.1:7897'}),{server:'http://127.0.0.1:7897',username:'user',password:'secret'})
 assert.equal(browserProxy({HTTPS_PROXY:'socks5://127.0.0.1:1080'}).server,'socks5://127.0.0.1:1080');
 assert.equal(browserProxy({}),undefined);assert.equal(browserProxy({HTTPS_PROXY:'file:///tmp'}),undefined)
})
test('a user-closed browser never reports successful image collection',async()=>{
 const page={on(){},isClosed:()=>true,goto:async()=>{}}
 const context={grantPermissions:async()=>{},on(){},pages:()=>[page],close:async()=>{}}
 await assert.rejects(searchBaidu({query:'长沙 橘子洲',profile:'/tmp/test',waitMs:1000},()=>{},{launchPersistentContext:async()=>context}),/已关闭/)
})
test('Baidu verification waits for the user and resumes extraction after verification clears',async()=>{
 const events=[];let snapshots=0
 const rows=Array.from({length:40},(_,i)=>({url:`https://example.com/${i}.jpg`,page:''}))
 const page={on(){},isClosed:()=>false,goto:async()=>{},evaluate:async()=>++snapshots===1?{title:'百度安全验证',url:'https://wappass.baidu.com/static/captcha',text:'请完成验证',rows:[]}:{title:'百度图片',url:'https://image.baidu.com/search/index',text:'',rows}}
 const context={grantPermissions:async()=>{},on(){},pages:()=>[page],close:async()=>{}}
 const result=await searchBaidu({query:'长沙 橘子洲',profile:'/tmp/test',waitMs:4000},e=>events.push(e),{launchPersistentContext:async()=>context})
 assert.ok(events.some(e=>e.state==='awaiting_user'));assert.ok(events.some(e=>e.state==='collecting'));assert.equal(result.length,36)
 assert.ok(result.every(r=>r.page.includes('image.baidu.com/search/index')))
})

test('Baidu search sends native ratio and size parameters without treating them as image transformations',()=>{
 const url=new URL(baiduSearchUrl({query:'长沙 橘子洲',ratio:'portrait',size:'large'}));assert.equal(url.searchParams.get('imgratio'),'2');assert.equal(url.searchParams.get('z'),'3');
 const custom=new URL(baiduSearchUrl({query:'长沙 橘子洲',ratio:'3:4',size:'large',width:900,height:1200}));assert.equal(custom.searchParams.get('imgratio'),'2');assert.equal(custom.searchParams.get('width'),'900');assert.equal(custom.searchParams.get('height'),'1200');assert.equal(custom.searchParams.has('z'),false);
 const square=new URL(baiduSearchUrl({query:'长沙 橘子洲',ratio:'square'}));assert.equal(square.searchParams.get('imgratio'),'3');
})

test('a Baidu batch reuses one browser and waits between scenic queries',async()=>{
 let launches=0,closed=0;const visits=[],events=[]
 const page={on(){},off(){},isClosed:()=>false,goto:async url=>{visits.push({url,time:Date.now()})},evaluate:async()=>({title:'百度图片',url:'https://image.baidu.com/search/index',text:'',rows:Array.from({length:40},(_,i)=>({url:`https://example.com/${i}.jpg`,page:''}))})}
 const context={grantPermissions:async()=>{},on(){},pages:()=>[page],close:async()=>{closed++}}
 const result=await searchBaiduBatch({queries:[{id:'one',name:'一',query:'长沙 橘子洲'},{id:'two',name:'二',query:'长沙 岳麓山'}],profile:'/tmp/test',intervalSeconds:3,waitMs:1000},e=>events.push(e),{launchPersistentContext:async()=>{launches++;return context}})
 assert.equal(launches,1);assert.equal(closed,1);assert.equal(result.length,2);assert.ok(visits[1].time-visits[0].time>=2900);assert.ok(events.some(e=>e.state==='waiting_interval'))
})
