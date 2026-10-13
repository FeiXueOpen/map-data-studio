import {fileURLToPath} from 'node:url'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright-core'
import {parseBaiduImages,publicImageUrl} from './baidu-parser.mjs'
export function browserProxy(env=process.env) {
 const value=env.HTTPS_PROXY||env.https_proxy||env.HTTP_PROXY||env.http_proxy
 if(!value)return undefined
 try {const url=new URL(value);if(!['http:','https:','socks5:'].includes(url.protocol))return undefined;return {server:`${url.protocol}//${url.host}`,username:decodeURIComponent(url.username)||undefined,password:decodeURIComponent(url.password)||undefined}}catch{return undefined}
}
export function baiduSearchUrl(options){
 const url=new URL('https://image.baidu.com/search/index')
 url.searchParams.set('tn','baiduimage');url.searchParams.set('word',options.query)
 const sizes={small:1,medium:2,large:3,wallpaper:9};if(sizes[options.size])url.searchParams.set('z',String(sizes[options.size]))
 if(options.width&&options.height){url.searchParams.delete('z');url.searchParams.set('width',String(options.width));url.searchParams.set('height',String(options.height))}
 const ratios={tall:1,portrait:2,square:3,landscape:4,wide:5}
 let ratio=ratios[options.ratio]
 if(!ratio&&options.ratio&&options.ratio!=='original'){
  const [w,h]=options.ratio.split(':').map(Number);if(w>0&&h>0)ratio=w===h?3:w<h?(w/h<0.5?1:2):(w/h>2?5:4)
 }
 if(ratio)url.searchParams.set('imgratio',String(ratio))
 return url.href
}
export async function searchBaidu(options,emit,driver=chromium){
 let context, closed=false, stage='', denied=false
 const searchUrl=baiduSearchUrl(options)
 const pool=new Map()
 const status=(state,message)=>{if(stage!==state){stage=state;emit({type:'status',state,message})}}
 const add=rows=>rows.forEach(row=>{const url=publicImageUrl(row.url);if(url&&!pool.has(url))pool.set(url,{url,page:publicImageUrl(row.page)||searchUrl})})
 const limit=Math.min(120,Math.max(35,(options.count||3)*12))
 const verificationDeadline=Date.now()+(options.waitMs ?? 300000)
 let readySince=0,scrolls=0
 try {
  status(options.keepBrowserOpen?'preparing':'launching',options.keepBrowserOpen?'准备景区图片搜索':'正在打开百度搜图浏览器')
  context=await driver.launchPersistentContext(options.profile,{headless:options.headless===true,viewport:{width:1200,height:850},locale:'zh-CN',acceptDownloads:false,proxy:options.proxy ? {server:options.proxy} : browserProxy()})
  // Deny browser permissions before navigating; image search needs no device or LAN access.
  await context.grantPermissions([], {origin:'https://image.baidu.com'})
  options.registerCancel?.(() => context.close().catch(()=>{}))
  const closeListener=()=>{closed=true};context.on('close',closeListener)
  const page=context.pages()[0]||await context.newPage()
  const responseListener=response=>{
   if(!response.url().startsWith('https://image.baidu.com/search/acjson'))return
   const word=new URL(response.url()).searchParams.get('word');if(word&&word!==options.query)return
   void response.body().then(body=>{
    if(body.length>5*1024*1024)return
    try {const data=JSON.parse(body.toString().replaceAll("\\'","'"));denied=data.antiFlag===1;add(parseBaiduImages(data))}catch{}
   }).catch(()=>{})
  }
  page.on('response',responseListener)
  options.cleanup=()=>{page.off?.('response',responseListener);context.off?.('close',closeListener)}
  status('searching','正在搜索百度图片')
  try {await page.goto(searchUrl,{waitUntil:'domcontentloaded',timeout:45000})}catch(e){if(closed)throw new Error('用户已关闭百度搜图浏览器');if(!String(e).includes('Timeout'))throw e}
  while(Date.now()<verificationDeadline){
   if(closed||page.isClosed())throw new Error('用户已关闭百度搜图浏览器，图片查询已取消')
   const snapshot=await page.evaluate(()=>({title:document.title,url:location.href,text:document.body?.innerText.slice(0,1200)||'',styleCount:document.styleSheets.length,rows:[...document.querySelectorAll('[data-objurl]')].map(el=>({url:el.getAttribute('data-objurl'),page:el.getAttribute('data-fromurl')}))})).catch(()=>null)
   if(!snapshot){await new Promise(r=>setTimeout(r,500));continue}
   add(snapshot.rows)
   const challenge=/wappass\.baidu\.com/.test(snapshot.url)||/安全验证|验证码|验证您的身份/.test(snapshot.title)||(!pool.size&&(/请完成.*验证|Forbid spider access/.test(snapshot.text)||denied))
   if(challenge){
    if(stage!=='awaiting_user' && options.screenshot) await page.screenshot({path:options.screenshot}).catch(()=>{})
    status('awaiting_user','百度要求安全验证，请在打开的浏览器中完成验证；完成后自动继续。关闭浏览器可取消。')
    readySince=0;scrolls=0
   }else{
    if(!readySince)readySince=Date.now()
    status('collecting','正在提取百度原图链接')
    if(pool.size>=limit||Date.now()-readySince>20000||(pool.size>0&&scrolls>=4))break
    await page.evaluate(()=>window.scrollBy(0,700)).catch(()=>{});scrolls++
   }
   await new Promise(r=>setTimeout(r,1000))
  }
  if(!pool.size){const broken=await page.evaluate(()=>document.styleSheets.length===0).catch(()=>false);if(broken)throw new Error('百度样式与脚本资源未正常加载，请检查图片浏览器代理设置');if(stage==='awaiting_user')throw new Error('等待百度安全验证超时，未取得图片；可完成验证后重试或改用必应');throw new Error('百度页面未返回可提取的图片链接')}
  const candidates=[...pool.values()].slice(0,limit)
  emit({type:'result',candidates})
  return candidates
 }finally{options.cleanup?.();if(context&&!closed && options.screenshot){const p=context.pages()[0];if(p)await p.screenshot({path:options.screenshot}).catch(()=>{})}if(context&&!closed&&!options.keepBrowserOpen)await context.close().catch(()=>{})}
}
export async function searchBaiduBatch(options,emit,driver=chromium){
 let context
 const results=[]
 const shared={launchPersistentContext:async(...args)=>{if(!context)context=await driver.launchPersistentContext(...args);return context}}
 const intervalSeconds=Math.max(3,Math.min(60,options.intervalSeconds??8))
 try {
  for(const [index,query] of options.queries.entries()){
   if(options.cancelled?.())throw new Error('图片搜索已取消')
   if(index>0){
    emit({type:'status',state:'waiting_interval',message:`搜索间隔 ${intervalSeconds} 秒`,poiId:query.id,poiName:query.name})
    const until=Date.now()+intervalSeconds*1000
    while(Date.now()<until){if(options.cancelled?.())throw new Error('图片搜索已取消');await new Promise(r=>setTimeout(r,Math.min(100,until-Date.now())))}
   }
   try {
    const candidates=await searchBaidu({...options,query:query.query,keepBrowserOpen:true},event=>{if(event.type!=='result')emit({...event,poiId:query.id,poiName:query.name})},shared)
    const result={id:query.id,candidates};results.push(result);emit({type:'query_result',...result})
   }catch(e){
    const error=e.message||String(e);const result={id:query.id,error,candidates:[]};results.push(result);emit({type:'query_result',...result})
    if(/closed|已关闭|已取消|资源未正常加载|安全验证超时/i.test(error)){
     for(const remaining of options.queries.slice(index+1)){const skipped={id:remaining.id,error:`前一查询失败，批次已停止：${error}`,candidates:[]};results.push(skipped);emit({type:'query_result',...skipped})}
     break
    }
   }
  }
  emit({type:'batch_completed'});return results
 }finally{if(context)await context.close().catch(()=>{})}
}
if(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]){
 try {
  const options=JSON.parse(await readFile(process.argv[2],'utf8'));let cancel;let stopped=false
  options.registerCancel=fn=>{cancel=fn;if(stopped)void fn()};options.cancelled=()=>stopped
  process.stdin.on('data',()=>{stopped=true;void cancel?.()});process.stdin.unref?.()
  const emit=event=>process.stdout.write(JSON.stringify(event)+'\n')
  if(Array.isArray(options.queries))await searchBaiduBatch(options,emit);else await searchBaidu(options,emit)
 }catch(e){process.stdout.write(JSON.stringify({type:'error',message:e.message||String(e)})+'\n');process.exitCode=1}
}
