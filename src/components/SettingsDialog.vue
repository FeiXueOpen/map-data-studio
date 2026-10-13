<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import AppDialog from './AppDialog.vue'
import StorageSettings from './StorageSettings.vue'
import AutomationSettings from './AutomationSettings.vue'
import { errorMessage, getApiSettings, saveApiSettings, type ApiSettings } from '../services/amap'

const props = defineProps<{ busy: boolean }>()
const emit = defineEmits<{ close: [] }>()
const draft = reactive<ApiSettings>({ jsKey: '', securityJsCode: '', webKey: '' })
const fields: { key: keyof ApiSettings; label: string; hint: string }[] = [
  { key: 'jsKey', label: '高德 Web JS Key', hint: '用于显示地图，请填写 Web 端（JS API）类型的 Key。' },
  { key: 'securityJsCode', label: 'JS API 安全密钥', hint: '填写上述 JS Key 对应的 securityJsCode。' },
  { key: 'webKey', label: '高德 Web API Key', hint: '用于城市定位、POI 查询与详情采集，请填写 Web 服务类型的 Key。' },
]
const visible = reactive<Record<keyof ApiSettings, boolean>>({ jsKey: false, securityJsCode: false, webKey: false })
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const success = ref('')
let original: ApiSettings | undefined
async function load() {
  loading.value = true
  error.value = ''
  try { original = await getApiSettings(); Object.assign(draft, original) }
  catch (cause) { error.value = errorMessage(cause) }
  finally { loading.value = false }
}
async function save() {
  if (saving.value || loading.value || props.busy || !original) return
  saving.value = true
  error.value = ''; success.value = ''
  try {
    const config = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as ApiSettings
    const mapChanged = config.jsKey !== original.jsKey || config.securityJsCode !== original.securityJsCode
    await saveApiSettings(config)
    original = { ...config }; Object.assign(draft, config)
    success.value = mapChanged ? '配置已保存。Web API Key 对后续请求立即生效；请重启软件使新的 JS Key 和安全密钥生效。' : '配置已保存，后续查询使用新的 Web API Key。'
    for (const field of fields) visible[field.key] = false
  } catch (cause) { error.value = errorMessage(cause) }
  finally { saving.value = false }
}
onMounted(load)
</script>

<template>
  <AppDialog title="地图与采集设置" @close="!saving && emit('close')">
    <form class="detail-form api-settings-form" @submit.prevent="save">
      <p v-if="loading" class="muted" role="status">正在读取高德配置…</p>
      <div v-for="field in fields" :key="field.key" class="api-key-field">
        <label :for="`api-${field.key}`">{{ field.label }}</label>
        <div class="api-key-input"><input :id="`api-${field.key}`" v-model="draft[field.key]" :type="visible[field.key] ? 'text' : 'password'" :disabled="loading || saving" required maxlength="64" minlength="32" autocomplete="off" autocapitalize="off" spellcheck="false" :placeholder="`输入${field.label}`" @input="success = ''" /><button type="button" :disabled="loading || saving" :aria-label="`${visible[field.key] ? '隐藏' : '显示'}${field.label}`" :aria-pressed="visible[field.key]" @click="visible[field.key] = !visible[field.key]">{{ visible[field.key] ? '隐藏' : '显示' }}</button></div>
        <p class="muted">{{ field.hint }}</p>
      </div>
      <p class="muted">配置保存在本机用户配置目录，重新打开软件后继续使用。</p>
      <p v-if="busy" class="muted">当前正在定位、查询或采集，请等待完成后保存配置。</p>
      <p v-if="error" class="failed" role="alert">{{ error }}</p>
      <p v-if="success" class="settings-success" role="status">{{ success }}</p>
      <div class="settings-actions"><button v-if="!loading && !original" class="export-button" type="button" @click="load">重新读取</button><button class="collect-button" type="submit" :disabled="loading || saving || busy || !original">{{ saving ? '正在保存…' : '保存配置' }}</button></div>
      <hr class="settings-divider" />
      <StorageSettings :busy="busy || saving" /><hr class="settings-divider" /><AutomationSettings />
      <hr class="settings-divider" />
      <p>地图：高德 JS API 2.0 · 坐标系：GCJ-02</p>
      <p>启动和切换城市只定位地图，点击“开始查询并采集”后查询点位。</p>
      <p>详情采集：每批最多10条，递归查询关联数据和图片链接。导出Excel时保存本次导出点位的高德图片。</p>
      <p>Excel：默认导出主 POI 与任务日志；子点位可另行导出。</p>
    </form>
  </AppDialog>
</template>
