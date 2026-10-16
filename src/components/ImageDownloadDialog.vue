<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import {getStorageSettings} from '../services/storage'
import AppDialog from './AppDialog.vue'
import { getImageSettings, saveImageSettings, pickImageDirectory, revealImageFolder, type ImageBrowserStatus, type ImageOptions } from '../services/images'
const props = defineProps<{ busy: boolean; browserStatus: ImageBrowserStatus; scopeName: string; progress: string; report: string; results: {id:string; name:string; directory:string; saved:number; requested:number; failures:string[]}[] }>()
const emit = defineEmits<{ close: []; start: [options: ImageOptions] }>()
const options = reactive<ImageOptions>({ count: 3, ratio: 'original', engine: 'bing', intervalSeconds:8, proxy:'', size:'all', minWidth: 0, minHeight:0,width:0,height:0, includeChildren: false, directory: '' })
const error = ref(''), loading = ref(true)
onMounted(async () => { try { options.directory = (await getImageSettings()).directory;options.proxy=(await getStorageSettings()).settings.browserProxy } catch (e) { error.value=String(e) } finally { loading.value=false } })
async function reveal(path:string){try {await revealImageFolder(path)} catch(e){error.value=String(e)}}
async function choose(){ try { const path = await pickImageDirectory(); if(path) options.directory=path } catch(e){error.value=String(e)} }
async function start(){error.value='';try{if(((options.width||0)===0)!==((options.height||0)===0))throw new Error('搜索尺寸需同时填写宽高');await saveImageSettings(options.directory!);emit('start',{...options})}catch(e){error.value=String(e)}}
</script>
<template>
 <AppDialog title="联网补图并下载" @close="emit('close')">
  <form class="detail-form" @submit.prevent="start">
   <p>补图范围：{{ scopeName }}。搜索结果按相关性下载，请核对是否属于对应点位。</p>
   <label>搜索来源<select v-model="options.engine" :disabled="busy"><option value="bing">必应图片</option><option value="baidu">百度图片（浏览器模式）</option></select></label>
   <label v-if="options.engine==='baidu'">景区搜索间隔（秒）<input v-model.number="options.intervalSeconds" type="number" min="3" max="60" :disabled="busy" /></label>
   <label>每个点位下载图片数量<input v-model.number="options.count" type="number" min="1" max="30" required :disabled="busy" /></label>
   <label>搜索比例分类<select v-model="options.ratio" :disabled="busy"><option value="original">全部比例</option><option value="tall">细长竖图</option><option value="portrait">竖图</option><option value="square">方图</option><option value="landscape">横图</option><option value="wide">细长横图</option></select></label>
   <label>搜索图片尺寸<select v-model="options.size" :disabled="busy"><option value="all">全部尺寸</option><option value="wallpaper">超大图</option><option value="large">大图</option><option value="medium">中图</option><option value="small">小图</option></select></label>
   <label>自定义搜索宽度（像素，0不指定）<input v-model.number="options.width" type="number" min="0" max="6000" required :disabled="busy" /></label>
   <label>自定义搜索高度（像素，0不指定）<input v-model.number="options.height" type="number" min="0" max="6000" required :disabled="busy" /></label>
   <p v-if="options.engine === 'baidu'" class="muted">一个补图批次共用一个内置浏览器，并按设置间隔搜索。遇到安全验证时请在浏览器完成，之后自动继续；关闭浏览器可取消查询。无需安装 Python 或 Node.js。</p>
   <p class="muted">百度使用原生 imgratio、z、width、height 搜索参数。自定义宽高优先于尺寸分类，需同时填写。比例为百度分类；3:4 等精确比例在 MCP 中映射相应分类。图片下载保留原图，不裁剪、不缩放。</p>
   <label>原图最小宽度（本地校验，像素）<input v-model.number="options.minWidth" type="number" min="0" max="4000" required :disabled="busy" /></label>
   <label>原图最小高度（本地校验，像素）<input v-model.number="options.minHeight" type="number" min="0" max="6000" required :disabled="busy" /></label>
   <label class="inline-check"><input v-model="options.includeChildren" type="checkbox" :disabled="busy" />同时补充关联／范围子点位</label>
   <label>本地保存目录<input v-model="options.directory" required :disabled="busy" /></label>
   <button class="export-button" type="button" :disabled="busy" @click="choose">选择目录</button>
   <p class="muted">每个点位以名称建文件夹，同名点位自动区分。此目录也用于按需保存高德图片；查询、采集和普通Excel导出不会自动补图。</p>
   <p v-if="error" class="failed">{{ error }}</p><p v-if="browserStatus.state === 'awaiting_user'" class="area-notice" role="status">{{ browserStatus.message }}</p><p v-if="progress" role="status">{{ progress }}</p><p v-if="report" role="status">{{ report }}</p>
   <details v-for="result in results" :key="result.id"><summary>{{ result.name }}：{{ result.saved }} / {{ result.requested }} 张</summary><p>{{ result.directory }}</p><button v-if="result.directory" class="export-button" type="button" @click="reveal(result.directory)">在文件管理器中查看</button><p v-for="(failure,i) in result.failures" :key="i" class="muted">{{ failure }}</p></details>
   <button class="collect-button" type="submit" :disabled="busy || loading">{{ busy ? '正在下载…' : '开始联网补图' }}</button>
  </form>
 </AppDialog>
</template>
