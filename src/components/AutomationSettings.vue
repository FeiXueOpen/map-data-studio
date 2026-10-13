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
async function retry() {
  busy.value = true; message.value = ''
  try { info.value = await invoke<Info>('automation_enable', { enabled: true }); message.value = 'AI 控制连接已恢复' }
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
    <div class="automation-heading"><h3>AI 控制 / MCP</h3><button v-if="info && !info.enabled" class="export-button" type="button" :disabled="busy || !isTauri()" @click="retry">{{ busy ? '正在重试…' : '重试连接' }}</button></div>
    <p class="muted">软件启动后自动开启 AI 控制，退出时关闭。支持 MCP stdio、Streamable HTTP 和 CLI，无需手动开启或安装额外运行环境。查询、采集和导出仍由用户或 AI 指令发起。</p>
    <template v-if="info">
      <p class="automation-address">{{ info.enabled ? `已自动连接 · ${info.endpoint}` : '控制服务尚未就绪，可重试连接' }}</p>
      <div class="automation-actions"><button type="button" :disabled="!info.enabled" @click="copy('stdio')">复制 stdio 配置</button><button type="button" :disabled="!info.enabled" @click="copy('http')">复制 HTTP 配置</button><button type="button" @click="copy('cli')">复制 CLI 命令</button><button type="button" @click="copy('skill')">复制 Skill 路径</button></div>
      <details><summary>程序与连接文件位置</summary><p class="automation-address">内置程序：{{ info.executable }}</p><p class="automation-address">连接文件：{{ info.connectionFile }}</p><p class="automation-address">Skill：{{ info.skillPath }}</p></details>
      <p class="muted">服务仅监听 127.0.0.1，需要独立令牌。软件重启后 HTTP 端口和令牌会变化；stdio / CLI 自动读取新的连接文件。</p>
    </template>
    <p v-if="message" class="muted" role="status">{{ message }}</p>
  </section>
</template>
