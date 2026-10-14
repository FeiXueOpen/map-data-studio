import test from 'node:test'
import assert from 'node:assert/strict'
import {createMcpbManifest} from '../scripts/mcpb-manifest.mjs'

test('Mac MCPB 使用包内原生程序和用户连接文件',()=>{
  const manifest=createMcpbManifest({version:'0.1.3',platform:'macos',arch:'arm64'})
  assert.equal(manifest.server.type,'binary')
  assert.equal(manifest.server.entry_point,'server/map-data-studio')
  assert.match(manifest.server.mcp_config.command,/\$\{__dirname\}/)
  assert.ok(manifest.server.mcp_config.args.includes('--connection-file'))
  assert.match(manifest.server.mcp_config.args.at(-1),/Library\/Application Support/)
  assert.deepEqual(manifest.compatibility.platforms,['darwin'])
})

test('Windows MCPB 指向 exe 与 Roaming 连接文件',()=>{
  const manifest=createMcpbManifest({version:'0.1.3',platform:'windows',arch:'x64'})
  assert.equal(manifest.server.entry_point,'server/map-data-studio.exe')
  assert.match(manifest.server.mcp_config.command,/map-data-studio\.exe$/)
  assert.match(manifest.server.mcp_config.args.at(-1),/AppData\\Roaming/)
  assert.deepEqual(manifest.compatibility.platforms,['win32'])
})
