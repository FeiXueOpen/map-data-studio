import { cp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
const root = resolve('src-tauri/image-runtime')
const nodeVersion = '24.21.0'
const platform = process.platform, arch = process.arch
if (!['darwin','linux','win32'].includes(platform) || !['arm64','x64'].includes(arch)) throw new Error(`尚未支持 ${platform}/${arch} 的图片浏览器打包`)
const installed = JSON.parse(await readFile('node_modules/playwright-core/package.json','utf8'))
const stamp = {nodeVersion, playwrightVersion:installed.version, platform, arch}
let old
try { old=JSON.parse(await readFile(join(root,'runtime.json'),'utf8')) } catch {}
const nodeExe = join(root, platform==='win32'?'node.exe':'node')
if (JSON.stringify(old)===JSON.stringify(stamp)) {
  await access(nodeExe);await access(join(root,'browser'));await access(join(root,'node_modules/playwright-core/package.json'))
  await cp('browser-images',join(root,'worker'),{recursive:true})
  console.log('图片浏览器运行时已准备，可离线打包');process.exit(0)
}
await mkdir(root,{recursive:true})
const cache=resolve('.cache/image-runtime');await mkdir(cache,{recursive:true})
const extension=platform==='win32'?'zip':'tar.gz'
const filename=`node-v${nodeVersion}-${platform==='win32'?'win':platform}-${arch}.${extension}`
const url=`https://nodejs.org/dist/v${nodeVersion}`
const sums=execFileSync('curl',['--fail','--silent','--show-error','--location','--max-time','60',`${url}/SHASUMS256.txt`],{encoding:'utf8'})
const expected=sums.split('\n').map(l=>l.trim().split(/\s+/)).find(l=>l[1]===filename)?.[0]
if(!expected)throw new Error('官方 Node.js 清单中没有目标运行时')
const archive=join(cache,filename)
let bytes;try { bytes=await readFile(archive) } catch {}
if(!bytes || createHash('sha256').update(bytes).digest('hex')!==expected){
 execFileSync('curl',['--fail','--silent','--show-error','--location','--max-time','300',`${url}/${filename}`,'-o',archive],{stdio:'inherit'})
 bytes=await readFile(archive)
}
if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Node.js 运行时 SHA256 校验失败')
if(platform==='win32'){
 const quote=s=>`'${s.replaceAll("'","''")}'`
 execFileSync('powershell',['-NoProfile','-Command',`Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(cache)} -Force`],{stdio:'inherit'})
}else execFileSync('tar',['-xzf',archive,'-C',cache],{stdio:'inherit'})
const extracted=join(cache,`node-v${nodeVersion}-${platform==='win32'?'win':platform}-${arch}`)
await cp(join(extracted,platform==='win32'?'node.exe':'bin/node'),nodeExe)
await cp(join(extracted,'LICENSE'),join(root,'NODE-LICENSE'))
await rm(join(root,'node_modules/playwright-core'),{recursive:true,force:true})
await mkdir(join(root,'node_modules'),{recursive:true});await cp('node_modules/playwright-core',join(root,'node_modules/playwright-core'),{recursive:true})
execFileSync(nodeExe,[join(root,'node_modules/playwright-core/cli.js'),'install','chromium','--no-shell'],{env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:join(root,'browser')},stdio:'inherit'})
await cp('browser-images',join(root,'worker'),{recursive:true})
await writeFile(join(root,'runtime.json'),JSON.stringify(stamp,null,2))
console.log(`图片浏览器运行时准备完成：${platform}/${arch}`)
