// Uses the runtime shipped inside the app; no system Node.js/Python dependency.
import {access,cp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const options={}
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i]
  if(key==='--dry-run')options.dryRun=true
  else if(['--client','--command','--config-root'].includes(key)&&process.argv[i+1])options[key.slice(2)]=process.argv[++i]
  else throw new Error('参数：--client codex|claude|doubao|none --command 桌面程序绝对路径 [--dry-run]')
}

const client=options.client||'none'
if(!['codex','claude','doubao','none'].includes(client)||!options.command)throw new Error('需要有效的客户端和--command')
const command=resolve(options.command)
await access(command)

const scriptRoot=dirname(fileURLToPath(import.meta.url))
const sourceSkill=join(scriptRoot,'map-data-studio')
const userHome=options['config-root']?resolve(options['config-root']):homedir()
const resources=join(userHome,'Documents','Map Data Studio','Resources')
const sharedSkill=join(userHome,'.agents','skills','map-data-studio')
const codexRoot=options['config-root']?join(userHome,'.codex'):process.env.CODEX_HOME||join(userHome,'.codex')
const codexSkill=join(codexRoot,'skills','map-data-studio')
const claudeRoot=options['config-root']?join(userHome,'Claude'):process.platform==='win32'?join(process.env.APPDATA||join(userHome,'AppData','Roaming'),'Claude'):join(userHome,'Library','Application Support','Claude')
const connectionFile=process.platform==='win32'
  ? join(options['config-root']?join(userHome,'AppData','Roaming'):process.env.APPDATA||join(userHome,'AppData','Roaming'),'com.mapdatastudio.desktop','automation-connection.json')
  : join(userHome,process.platform==='darwin'?'Library/Application Support':'.config','com.mapdatastudio.desktop','automation-connection.json')
const entry=client==='doubao'
  ? {command:process.platform==='darwin'?'/usr/bin/env':command,args:[...(process.platform==='darwin'?[command]:[]),'--mcp-stdio','--connection-file',connectionFile]}
  : {command,args:['--mcp-stdio']}
const config={mcpServers:{'map-data-studio':entry}}
const skillZip='https://github.com/FeiXueOpen/map-data-studio/releases/latest/download/map-data-studio-skill.zip'

const verification={
  common:[
    '打开Map Data Studio，等待本地服务自动就绪',
    '确认客户端已加载map-data-studio工具与Skill',
    '在真实AI会话中仅通过MCP调用get_status，不使用CLI代替',
    '分别报告应用安装、Skill加载、MCP工具清单和真实会话调用；任一步失败都说明具体停点',
  ],
  codex:['执行codex mcp list检查注册','重新加载Codex会话后调用get_status'],
  claude:['重启Claude Desktop，在Connectors中确认工具','在Customize > Skills导入并启用Skill ZIP，再调用get_status'],
  doubao:['优先让当前豆包对话使用自身的技能安装和连接器管理能力完成注册','安装后绑定当前对话；仅在会话内注册能力不可用时使用GUI兜底'],
}

const plan={client,application:command,connector:{name:'map-data-studio',transport:'STDIO',...entry},connectionFile,autoStartControl:true,sameNamePolicy:'备份后更新旧的map-data-studio配置，保留所有其他MCP和Skill',skill:{sourceDirectory:sourceSkill,sharedDirectory:sharedSkill,zip:skillZip},verification:[...verification.common,...(verification[client]||[])]}
if(client==='codex'){
  plan.skill.codexDirectory=codexSkill
  plan.clientCompletionPrompt='确认config.toml中的同名旧路径已更新，执行codex mcp list，重载或新建Codex会话，再仅通过map-data-studio MCP调用get_status。'
}
if(client==='claude'){
  plan.desktopExtension='Release中与系统架构对应的map-data-studio-*.mcpb'
  plan.clientCompletionPrompt='优先安装匹配平台和架构的MCPB，在Customize > Skills导入Skill ZIP，重启Claude Desktop后仅通过map-data-studio MCP调用get_status。'
}
if(client==='doubao'){
  plan.registrationPriority=['当前豆包对话的技能安装与连接器管理能力','客户端支持时使用STDIO','只提供HTTP时读取本机连接文件配置自定义连接器','豆包公开管理界面兜底']
  plan.httpFallback={source:connectionFile,instruction:'读取其中当前endpoint和token，URL只填纯文本地址，Authorization填Bearer加空格和token；不要输出或上传token'}
  plan.conversationInstallPrompt=`请在当前豆包对话中安装 ${sharedSkill} 这个本地Skill并绑定当前对话。再使用豆包自身的连接器管理能力注册 map-data-studio：支持STDIO时严格使用本计划connector.command和独立args；只支持HTTP时从 ${connectionFile} 读取当前endpoint和token，URL不要使用Markdown格式，Authorization填写Bearer加空格和token且不要在回复中泄露。备份后更新同名旧连接器，保留其他连接器。最后在真实对话中仅通过MCP调用get_status，不用CLI代替，并分别报告四层结果。`
}

if(options.dryRun){
  console.log(JSON.stringify({client,command,skill:client==='codex'?[sharedSkill,codexSkill]:[sharedSkill],connectionRecipe:config,plan},null,2))
  process.exit(0)
}

async function backup(file){try{await cp(file,file+'.backup-'+Date.now(),{recursive:true})}catch(e){if(e.code!=='ENOENT')throw e}}
async function installSkill(target,backupRoot){
  try{await access(target);const saved=join(backupRoot,String(Date.now()));await mkdir(dirname(saved),{recursive:true});await cp(target,saved,{recursive:true})}catch(e){if(e.code!=='ENOENT')throw e}
  await mkdir(dirname(target),{recursive:true})
  await cp(sourceSkill,target,{recursive:true})
}
function codexConfig(old){
  const target=/^mcp_servers\.(?:map-data-studio|"map-data-studio"|'map-data-studio')(?:\.|$)/
  let skip=false
  const kept=[]
  for(const line of old.split(/\r?\n/)){
    const section=/^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line)
    if(section)skip=target.test(section[1].trim())
    if(!skip)kept.push(line)
  }
  const prefix=kept.join('\n').trimEnd()
  return (prefix?prefix+'\n\n':'')+'[mcp_servers.map-data-studio]\ncommand = '+JSON.stringify(command)+'\nargs = ["--mcp-stdio"]\n'
}

await mkdir(resources,{recursive:true})
await writeFile(join(resources,'map-data-studio-mcp.json'),JSON.stringify(config,null,2)+'\n')
await writeFile(join(resources,'ai-install-plan.json'),JSON.stringify(plan,null,2)+'\n')
await writeFile(join(resources,`${client}-install-plan.json`),JSON.stringify(plan,null,2)+'\n')

if(client==='codex'){
  const file=join(codexRoot,'config.toml');let old=''
  try{old=await readFile(file,'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
  const next=codexConfig(old)
  if(next!==old){await mkdir(codexRoot,{recursive:true});await backup(file);await writeFile(file,next);console.log('已添加或更新Codex的map-data-studio配置，其他配置保持不变。')}
}else if(client==='claude'){
  const file=join(claudeRoot,'claude_desktop_config.json');let obj={},old=''
  try{old=await readFile(file,'utf8');obj=JSON.parse(old)}catch(e){if(e.code!=='ENOENT')throw e}
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||obj.mcpServers&&(typeof obj.mcpServers!=='object'||Array.isArray(obj.mcpServers)))throw new Error('Claude配置结构不正确，未改写')
  obj.mcpServers||={}
  const same=JSON.stringify(obj.mcpServers['map-data-studio'])===JSON.stringify(entry)
  if(!same){obj.mcpServers['map-data-studio']=entry;await mkdir(claudeRoot,{recursive:true});await backup(file);await writeFile(file,JSON.stringify(obj,null,2)+'\n');console.log('已添加或更新Claude的map-data-studio配置，其他配置保持不变。')}
}

if(client!=='none'){
  await installSkill(sharedSkill,join(userHome,'.agents','map-data-studio-backups'))
  if(client==='codex'&&codexSkill!==sharedSkill)await installSkill(codexSkill,join(codexRoot,'skill-backups','map-data-studio'))
}

console.log('MCP连接配置：'+join(resources,'map-data-studio-mcp.json'))
console.log('AI客户端安装计划：'+join(resources,'ai-install-plan.json'))
if(client==='doubao'){
  console.log('豆包当前对话安装指令：')
  console.log(plan.conversationInstallPrompt)
}
if(client==='claude')console.log('Claude Desktop可直接使用已写入的配置，也可安装Release中对应平台的.mcpb桌面扩展；Skill需在Customize > Skills中导入ZIP。')
if(client==='codex')console.log('Codex MCP已写入config.toml，Skill已同时安装到Codex专用目录和共享目录。')
console.log('软件打开后自动开启AI控制。安装完成后必须在对应AI客户端真实会话调用get_status；CLI成功不代表会话已加载MCP。')
