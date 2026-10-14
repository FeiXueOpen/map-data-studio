import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
const script=resolve('automation/setup-ai.mjs')
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'map-data-setup-'));try{await fn(root)}finally{await rm(root,{recursive:true,force:true})}}
function setup(root,client,dry=false){return execFileSync(process.execPath,[script,'--client',client,'--command',process.execPath,'--config-root',root,...(dry?['--dry-run']:[])],{encoding:'utf8'})}
test('Codex安装保留其他配置、更新同名旧路径并且重复安装不重复注册',()=>fixture(async root=>{
 await mkdir(join(root,'.codex'));const file=join(root,'.codex/config.toml'),original='model = "existing"\n[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers."map-data-studio"]\ncommand = "/old/app"\nargs = ["--old"]\n[mcp_servers."map-data-studio".env]\nOLD = "1"\n';await writeFile(file,original)
 setup(root,'codex');const added=await readFile(file,'utf8');assert.match(added,/model = "existing"/);assert.match(added,/\[mcp_servers.other\]/);assert.doesNotMatch(added,/\/old\/app|OLD =/);assert.equal(added.match(/\[mcp_servers.map-data-studio\]/g).length,1)
 setup(root,'codex');assert.equal(await readFile(file,'utf8'),added);assert.ok((await readdir(join(root,'.codex'))).some(v=>v.startsWith('config.toml.backup-')))
 assert.ok((await readFile(join(root,'.agents/skills/map-data-studio/SKILL.md'),'utf8')).includes('Map Data Studio'))
 assert.ok((await readFile(join(root,'.codex/skills/map-data-studio/SKILL.md'),'utf8')).includes('Map Data Studio'))
 const plan=JSON.parse(await readFile(join(root,'Documents/Map Data Studio/Resources/codex-install-plan.json'),'utf8'));assert.equal(plan.client,'codex');assert.equal(plan.skill.codexDirectory,join(root,'.codex/skills/map-data-studio'));assert.ok(plan.verification.some(v=>v.includes('codex mcp list')))
}))
test('Claude保留其他服务并更新同名旧服务',()=>fixture(async root=>{
 await mkdir(join(root,'Claude'));const file=join(root,'Claude/claude_desktop_config.json');await writeFile(file,JSON.stringify({theme:'dark',mcpServers:{other:{command:'other'}}}))
 setup(root,'claude');const config=JSON.parse(await readFile(file,'utf8'));assert.equal(config.theme,'dark');assert.equal(config.mcpServers.other.command,'other');assert.deepEqual(config.mcpServers['map-data-studio'].args,['--mcp-stdio'])
 config.mcpServers['map-data-studio'].command='old-path';await writeFile(file,JSON.stringify(config));setup(root,'claude');const updated=JSON.parse(await readFile(file,'utf8'));assert.equal(updated.mcpServers['map-data-studio'].command,process.execPath);assert.equal(updated.mcpServers.other.command,'other')
 const plan=JSON.parse(await readFile(join(root,'Documents/Map Data Studio/Resources/claude-install-plan.json'),'utf8'));assert.equal(plan.client,'claude');assert.match(plan.desktopExtension,/\.mcpb/);assert.ok(plan.verification.some(v=>v.includes('Customize > Skills')))
}))
test('豆包生成接入文件而不虚构注册；dry-run不写入配置',()=>fixture(async root=>{
 setup(root,'codex',true);assert.deepEqual(await readdir(root),[])
 const output=setup(root,'doubao');assert.ok(output.includes('当前对话安装指令'));assert.ok(!(await readdir(root)).includes('.codex'))
 const recipe=JSON.parse(await readFile(join(root,'Documents/Map Data Studio/Resources/map-data-studio-mcp.json'),'utf8'));const entry=recipe.mcpServers['map-data-studio'];assert.equal(entry.command,process.platform==='darwin'?'/usr/bin/env':process.execPath)
 assert.ok(entry.args.includes('--connection-file'));assert.ok(entry.args.includes('--mcp-stdio'))
 const plan=JSON.parse(await readFile(join(root,'Documents/Map Data Studio/Resources/doubao-install-plan.json'),'utf8'));assert.deepEqual(plan.connector.args,entry.args);assert.equal(plan.autoStartControl,true);assert.equal(plan.defaultControl,'cli');assert.ok(plan.verification.some(v=>v.includes('doctor --json')));assert.match(plan.conversationInstallPrompt,/绑定当前对话/);assert.match(plan.conversationInstallPrompt,/默认通过/);assert.match(plan.registrationPriority[0],/CLI/);assert.equal(plan.httpFallback.source,plan.connectionFile)
}))
test('自动模式安装通用Skill并把CLI设为默认通道',()=>fixture(async root=>{
 await mkdir(join(root,'.codex'))
 const output=setup(root,'auto');assert.match(output,/默认使用内置CLI/)
 assert.ok((await readFile(join(root,'.agents/skills/map-data-studio/SKILL.md'),'utf8')).includes('Map Data Studio'))
 assert.ok((await readFile(join(root,'.codex/skills/map-data-studio/SKILL.md'),'utf8')).includes('Map Data Studio'))
 const plan=JSON.parse(await readFile(join(root,'Documents/Map Data Studio/Resources/auto-install-plan.json'),'utf8'));assert.equal(plan.defaultControl,'cli');assert.deepEqual(plan.cli.args.status,['status','--json']);assert.equal(plan.cli.argumentInput.file,'--args-file');assert.equal(plan.cli.argumentInput.maxBytes,16*1024*1024);assert.equal(plan.skill.codexDirectory,join(root,'.codex/skills/map-data-studio'))
}))
