<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
type Info = { enabled: boolean; endpoint: string | null; token: string | null; connectionFile: string; executable: string; skillPath: string }
const info = ref<Info>()
const busy = ref(false)
const message = ref('')
async function load() {
  if (!isTauri()) return
  try { info.value = await invoke<Info>('automation_info') } catch { message.value = '无法读取 AI 控制配置' }
}
async function toggle() {
  busy.value = true; message.value = ''
  try { info.value = await invoke<Info>('automation_enable', { enabled: !info.value?.enabled }); message.value = info.value.enabled ? 'AI 控制已开启' : 'AI 控制已关闭；已启动的业务任务可在工作台取消。' }
  catch (cause) { message.value = typeof cause === 'string' ? cause : '控制服务启动失败' }
  finally { busy.value = false }
}
async function copy(mode: 'stdio' | 'http' | 'cli' | 'skill') {
  if (!info.value) return
  const i = info.value
  const windows = navigator.userAgent.includes("Windows")
  const quote = (value: string) => windows ? "'" + value.replace(/'/g, "''") + "'" : "'" + value.replace(/'/g, "'\"'\"'") + "'"
  const value = mode === 'stdio' ? JSON.stringify({ mcpServers: { 'map-data-studio': { command: i.executable, args: ['--mcp-stdio', '--connection-file', i.connectionFile] } } }, null, 2)
    : mode === 'http' ? JSON.stringify({ mcpServers: { 'map-data-studio': { url: i.endpoint, headers: { Authorization: `Bearer ${i.token}` } } } }, null, 2)
    : mode === 'cli' ? `${windows ? '& ' : ''}${quote(i.executable)} --cli --connection-file ${quote(i.connectionFile)} status` : i.skillPath
  try { await navigator.clipboard.writeText(value); message.value = mode === 'http' ? '已复制 HTTP 配置，含本地控制令牌；客户端的配置字段以其文档为准。' : mode === 'cli' && windows ? '已复制 PowerShell 命令' : '已复制' }
  catch { message.value = '无法写入剪贴板，请使用下方路径手动配置。' }
}
onMounted(load)
</script>
<template>
  <section class="automation-settings">
    <div class="automation-heading"><h3>AI 控制 / MCP</h3><button class="export-button" type="button" :disabled="busy || !isTauri()" @click="toggle">{{ busy ? '正在切换…' : info?.enabled ? '关闭 AI 控制' : '开启 AI 控制' }}</button></div>
    <p class="muted">AI 操作同步到当前工作台。支持 MCP stdio、Streamable HTTP 和 CLI。每次打开软件后手动开启；控制程序已内置，无需安装 Node.js 或其他运行环境。</p>
    <template v-if="info">
      <p class="automation-address">{{ info.enabled ? info.endpoint : '当前未开启' }}</p>
      <div class="automation-actions"><button type="button" :disabled="!info.enabled" @click="copy('stdio')">复制 stdio 配置</button><button type="button" :disabled="!info.enabled" @click="copy('http')">复制 HTTP 配置</button><button type="button" @click="copy('cli')">复制 CLI 命令</button><button type="button" @click="copy('skill')">复制 Skill 路径</button></div>
      <details><summary>程序与连接文件位置</summary><p class="automation-address">内置程序：{{ info.executable }}</p><p class="automation-address">连接文件：{{ info.connectionFile }}</p><p class="automation-address">Skill：{{ info.skillPath }}</p></details>
      <p class="muted">服务仅监听 127.0.0.1，需要独立令牌。HTTP 端口和令牌在重新开启后变化；stdio / CLI 自动读取新的连接文件。</p>
    </template>
    <p v-if="message" class="muted" role="status">{{ message }}</p>
  </section>
</template>
