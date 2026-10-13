// Uses the runtime shipped inside the app; no system Node.js/Python dependency.
import {readFile,writeFile,mkdir,cp,access} from 'node:fs/promises'
import {homedir} from 'node:os'
import {resolve,join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--dry-run')options.dryRun=true;else if(['--client','--command','--config-root'].includes(key)&&process.argv[i+1])options[key.slice(2)]=process.argv[++i];else throw new Error('参数：--client codex|claude|doubao|none --command 桌面程序绝对路径 [--dry-run]')}
const client=options.client||'none';if(!['codex','claude','doubao','none'].includes(client)||!options.command)throw new Error('需要有效的客户端和--command')
const command=resolve(options.command);await access(command)
const userHome=options['config-root']?resolve(options['config-root']):homedir()
const resources=join(userHome,'Documents','Map Data Studio','Resources'),skill=join(userHome,'.agents','skills','map-data-studio')
const codexRoot=options['config-root']?join(userHome,'.codex'):process.env.CODEX_HOME||join(userHome,'.codex')
const claudeRoot=options['config-root']?join(userHome,'Claude'):process.platform==='win32'?join(process.env.APPDATA||join(userHome,'AppData','Roaming'),'Claude'):join(userHome,'Library','Application Support','Claude')
const connectionFile=process.platform==='win32'?join(options['config-root']?join(userHome,'AppData','Roaming'):process.env.APPDATA||join(userHome,'AppData','Roaming'),'com.mapdatastudio.desktop','automation-connection.json'):join(userHome,process.platform==='darwin'?'Library/Application Support':'.config','com.mapdatastudio.desktop','automation-connection.json')
const entry=client==='doubao'?{command:process.platform==='darwin'?'/usr/bin/env':command,args:[...(process.platform==='darwin'?[command]:[]),'--mcp-stdio','--connection-file',connectionFile]}:{command,args:['--mcp-stdio']},config={mcpServers:{'map-data-studio':entry}}
if(options.dryRun){console.log(JSON.stringify({client,command,skill,connectionRecipe:config},null,2));process.exit(0)}
async function backup(file){try{await cp(file,file+'.backup-'+Date.now())}catch(e){if(e.code!=='ENOENT')throw e}}
await mkdir(resources,{recursive:true});await writeFile(join(resources,'map-data-studio-mcp.json'),JSON.stringify(config,null,2)+'\n')
if(client==='doubao'){
 const plan={client:'doubao',application:command,connector:{name:'map-data-studio',transport:'STDIO',...entry},skillDirectory:skill,skillZip:'https://github.com/FeiXueOpen/map-data-studio/releases/latest/download/map-data-studio-skill.zip',connectionFile,autoStartControl:true,registration:'通过豆包界面新建连接器或编辑同名项；命令与每条参数分别填入，不拼成一行，不添加shell引号',verification:['先打开工作台并等待本地服务就绪；尚未填写高德Key也可验证连接','在豆包连接器详情中确认操作清单已加载且开关开启','新建会话，选择或启用该连接器，仅通过MCP调用get_status；不能用CLI结果代替','如果会话没有工具，重载客户端后再测；仍无工具则报告会话注入未完成，保留CLI可用的单独结论']}
 await writeFile(join(resources,'doubao-install-plan.json'),JSON.stringify(plan,null,2)+'\n')
 console.log('豆包计划文件：'+join(resources,'doubao-install-plan.json'))
}
if(client==='codex'){
 const file=join(codexRoot,'config.toml');let old='';try{old=await readFile(file,'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
 const header=/^\s*\[mcp_servers\.(?:map-data-studio|"map-data-studio"|'map-data-studio')\]\s*$/m
 if(header.test(old))console.log('Codex已有同名MCP配置，保留原配置；请对照生成的JSON核对路径。')
 else{await mkdir(codexRoot,{recursive:true});await backup(file);await writeFile(file,old+'\n[mcp_servers.map-data-studio]\ncommand = '+JSON.stringify(command)+'\nargs = ["--mcp-stdio"]\n');console.log('已添加Codex MCP配置。')}
}else if(client==='claude'){
 const file=join(claudeRoot,'claude_desktop_config.json');let obj={};try{obj=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||obj.mcpServers&&(typeof obj.mcpServers!=='object'||Array.isArray(obj.mcpServers)))throw new Error('Claude配置结构不正确，未改写')
 obj.mcpServers||={};if(obj.mcpServers['map-data-studio'])console.log('Claude已有同名MCP配置，保留；请核对生成的JSON。')
 else{obj.mcpServers['map-data-studio']=entry;await mkdir(claudeRoot,{recursive:true});await backup(file);await writeFile(file,JSON.stringify(obj,null,2)+'\n');console.log('已添加Claude Desktop MCP配置。')}
}
if(client!=='none'){
 try{await access(skill);const saved=join(userHome,'.agents','map-data-studio-backups',String(Date.now()));await mkdir(saved,{recursive:true});await cp(skill,saved,{recursive:true})}catch(e){if(e.code!=='ENOENT')throw e}
 await mkdir(dirname(skill),{recursive:true});await cp(join(dirname(fileURLToPath(import.meta.url)),'map-data-studio'),skill,{recursive:true})
}
console.log('MCP连接配置：'+join(resources,'map-data-studio-mcp.json'))
if(client==='doubao')console.log('豆包专用安装计划已生成。必须在真实会话通过MCP调用get_status；CLI成功不能代替连接器验证。豆包无已核实的公开自动注册接口：请AI通过豆包界面新建连接器。优先stdio，command和args以生成的计划文件为准，各参数分别填入；仅HTTP时使用桌面设置中的HTTP配置。Skill可在豆包界面导入Release提供的技能ZIP。')
console.log('软件打开后自动开启AI控制，无需手动开启。查询前请在设置填写自己的三项高德密钥；连接器配置完成后重载AI客户端。')
