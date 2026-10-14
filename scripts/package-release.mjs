import {mkdir,cp,readFile,writeFile,access,chmod} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createMcpbManifest} from './mcpb-manifest.mjs'
const target=process.argv[2];if(!['x86_64-pc-windows-msvc','aarch64-apple-darwin','x86_64-apple-darwin'].includes(target))throw new Error('未知发布目标')
const version=JSON.parse(await readFile('package.json')).version
const platform=target.includes('windows')?'windows':'macos',arch=target.startsWith('aarch64')?'arm64':'x64'
if((platform==='windows')!==(process.platform==='win32') || (arch==='arm64')!==(process.arch==='arm64'))throw new Error('浏览器运行时必须与构建架构一致，禁止混用交叉编译资源')
const directory=resolve('release-assets');await mkdir(directory,{recursive:true});const name=`map-data-studio-${version}-${platform}-${arch}.zip`,output=join(directory,name)
const release=resolve('src-tauri/target',target,'release')
if(platform==='macos'){
 const app=join(release,'bundle/macos/Map Data Studio.app');await access(app)
 execFileSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',app,output],{stdio:'inherit'})
}else{
 const stage=resolve('.cache/release-package/Map Data Studio');await mkdir(stage,{recursive:true})
 await cp(join(release,'map-data-studio.exe'),join(stage,'map-data-studio.exe'))
 for(const [source,dest] of [['src-tauri/config.example.json','config.example.json'],['automation','automation'],['src-tauri/image-runtime','image-runtime'],['README.md','README.md']])await cp(resolve(source),join(stage,dest),{recursive:true})
 const quote=s=>`'${s.replaceAll("'","''")}'`
 execFileSync('powershell',['-NoProfile','-Command',`Compress-Archive -LiteralPath ${quote(stage)} -DestinationPath ${quote(output)} -Force`],{stdio:'inherit'})
}
const sha=createHash('sha256').update(await readFile(output)).digest('hex');await writeFile(output+'.sha256',`${sha}  ${name}\n`);console.log('安装资源及SHA256已生成：'+name)

const mcpbStage=resolve(`.cache/mcpb-${platform}-${arch}`),mcpbServer=join(mcpbStage,'server')
await mkdir(mcpbServer,{recursive:true})
const mcpbExecutable=platform==='windows'?'map-data-studio.exe':'map-data-studio'
await cp(platform==='windows'?join(release,'map-data-studio.exe'):join(release,'map-data-studio'),join(mcpbServer,mcpbExecutable))
if(platform==='macos')await chmod(join(mcpbServer,mcpbExecutable),0o755)
await writeFile(join(mcpbStage,'manifest.json'),JSON.stringify(createMcpbManifest({version,platform,arch}),null,2)+'\n')
const mcpbName=`map-data-studio-${version}-${platform}-${arch}.mcpb`,mcpbOutput=join(directory,mcpbName)
if(platform==='macos')execFileSync('zip',['-r','-X',mcpbOutput,'.'],{cwd:mcpbStage,stdio:'inherit'})
else{
 const quote=s=>`'${s.replaceAll("'","''")}'`
 execFileSync('powershell',['-NoProfile','-Command',`Compress-Archive -Path ${quote(join(mcpbStage,'*'))} -DestinationPath ${quote(mcpbOutput)} -Force`],{stdio:'inherit'})
}
console.log('Claude Desktop MCPB已生成：'+mcpbName)
