import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
const executable = resolve(process.env.MAP_DATA_TEST_EXECUTABLE || 'src-tauri/target/debug/map-data-studio')
function run(mode, args, input='', env={}) {
 return new Promise((resolve,reject)=>{ const child=spawn(executable,[mode,...args],{env:{...process.env,PATH:'/no-node-runtime',...env}}); let out='',err=''; child.stdout.on('data',(v)=>out+=v); child.stderr.on('data',(v)=>err+=v); child.on('error',reject); child.stdin.on('error',(e)=>{if(e.code!=='EPIPE')reject(e)}); child.on('close',(code,signal)=>resolve({out,err,code,signal})); if(input)child.stdin.end(input);else child.stdin.end() })
}
test('bundled native stdio and CLI work without Node on PATH, preserve RPC IDs and authenticate', async () => {
 const dir=await mkdtemp(join(tmpdir(),'map-data-mcp-')), file=join(dir,'connection.json'); let notifications=0; const calls=[]
 const server=createServer(async (req,res)=>{
  assert.equal(req.headers.authorization,'Bearer test-local-token'); assert.equal(req.url,'/mcp'); assert.ok(req.headers.accept.includes('text/event-stream'))
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  const message=JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if(message.method==='tools/call')calls.push(message)
  if(!('id' in message)) { notifications++; res.writeHead(202); res.end(); return }
  res.setHeader('content-type','application/json'); res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:message.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}}}:{content:[{type:'text',text:'{"total":61}'}],structuredContent:{total:61},isError:false}}))
 })
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
 try {
  await writeFile(file,JSON.stringify({endpoint:`http://127.0.0.1:${server.address().port}/mcp`,token:'test-local-token'}),{mode:0o600})
  const messages=[{jsonrpc:'2.0',id:'init',method:'initialize',params:{protocolVersion:'2025-11-25'}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'get_status',arguments:{}}}]
  const result=await run('--mcp-stdio',['--connection-file',file],messages.map(JSON.stringify).join('\n')+'\n')
  assert.equal(result.code,0,result.err||`native process signal: ${result.signal}`); assert.equal(result.err,''); const output=result.out.trim().split('\n').map(JSON.parse); assert.equal(output.length,2); assert.deepEqual(new Set(output.map((m)=>m.id)),new Set(['init',3])); assert.equal(notifications,1)
  const cli=await run('--cli',['--connection-file',file,'status']); assert.equal(cli.code,0); assert.equal(JSON.parse(cli.out).total,61)
  const shortCli=await run('status',['--json','--connection-file',file]); assert.equal(shortCli.code,0); assert.equal(JSON.parse(shortCli.out).total,61)
  const largeText='景区资料'.repeat(60000),argsFile=join(dir,'large-args.json');await writeFile(argsFile,JSON.stringify({text:largeText,rows:[1,2,3]}))
  const fileCall=await run('call',['supplement_pois','--args-file',argsFile,'--connection-file',file]);assert.equal(fileCall.code,0,fileCall.err)
  const stdinCall=await run('call',['supplement_pois','--stdin','--connection-file',file],JSON.stringify({text:largeText,source:'stdin'}));assert.equal(stdinCall.code,0,stdinCall.err)
  assert.equal(calls.at(-2).params.arguments.text,largeText);assert.deepEqual(calls.at(-2).params.arguments.rows,[1,2,3]);assert.equal(calls.at(-1).params.arguments.source,'stdin')
  const malformed=await run('--mcp-stdio',['--connection-file',file],'not-json\n'); assert.equal(JSON.parse(malformed.out).error.code,-32700)
  await writeFile(file,JSON.stringify({endpoint:'https://example.com/mcp',token:'test-local-token'})); const remote=await run('--cli',['--connection-file',file,'status']); assert.equal(remote.code,1); assert.match(remote.err,/本地连接配置无效/); assert.equal(remote.out,''); assert.ok(!remote.err.includes('test-local-token'))
 } finally { await new Promise((resolve)=>server.close(resolve)); await rm(dir,{recursive:true,force:true}) }
})
test('describe works offline and Skill installs without Node or an MCP connection', async () => {
 const home=await mkdtemp(join(tmpdir(),'map-data-ai-home-'))
 try {
  const env={MAP_DATA_AI_HOME:home,MAP_DATA_RESOURCE_ROOT:resolve('.')}
  const described=await run('describe',['--json'],'',env); assert.equal(described.code,0,described.err); const catalog=JSON.parse(described.out); assert.equal(catalog.defaultTransport,'cli'); assert.ok(catalog.tools.some(tool=>tool.name==='get_status'))
  const installed=await run('skill',['install','--client','doubao','--json'],'',env); assert.equal(installed.code,0,installed.err); const result=JSON.parse(installed.out); assert.equal(result.client,'doubao'); assert.ok(result.installed.some(path=>path.endsWith('.agents/skills/map-data-studio')))
  const skill=await readFile(join(home,'.agents/skills/map-data-studio/SKILL.md'),'utf8'); assert.match(skill,/Map Data Studio/)
 } finally { await rm(home,{recursive:true,force:true}) }
})
