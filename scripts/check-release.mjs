import {readFile} from 'node:fs/promises'
const read=async p=>JSON.parse(await readFile(p,'utf8'))
const pkg=await read('package.json'),tauri=await read('src-tauri/tauri.conf.json'),cargo=await readFile('src-tauri/Cargo.toml','utf8')
const version=/^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]
if(pkg.version!==tauri.version||version!==pkg.version)throw new Error('package.json、Cargo.toml、tauri.conf.json 版本必须一致')
if(process.env.RELEASE_TAG && process.env.RELEASE_TAG!==`v${pkg.version}`)throw new Error('发布标签必须为 v'+pkg.version)
if(Object.keys(tauri.bundle.resources).some(p=>p.includes('config.local')))throw new Error('安装包禁止包含本机密钥文件')
const defaults=await read('src-tauri/config.example.json');if(Object.values(defaults).some(Boolean))throw new Error('示例密钥必须全部为空')
console.log('发布校验通过：v'+pkg.version)
