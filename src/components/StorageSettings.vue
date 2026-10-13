<script setup lang="ts">
import {onMounted,reactive,ref} from 'vue'
import {getStorageSettings,saveStorageSettings,type StorageSettings} from '../services/storage'
import {pickImageDirectory} from '../services/images'
defineProps<{busy:boolean}>()
const draft=reactive<StorageSettings>({excelDirectory:'',imageDirectory:'',resourceDirectory:'',browserProxy:''})
const fields=[{key:'excelDirectory',label:'Excel 默认保存目录'},{key:'imageDirectory',label:'图片保存目录'},{key:'resourceDirectory',label:'其他静态资源目录'}] as const
const loading=ref(true),saving=ref(false),error=ref(''),message=ref('')
let defaults:StorageSettings
async function load(){try{const result=await getStorageSettings();Object.assign(draft,result.settings);defaults=result.defaults;if(result.warning)error.value=result.warning}catch(e){error.value=String(e)}finally{loading.value=false}}
async function choose(key:keyof StorageSettings){try{const directory=await pickImageDirectory();if(directory){draft[key]=directory;message.value=''}}catch(e){error.value=String(e)}}
async function save(){saving.value=true;error.value='';message.value='';try{await saveStorageSettings({...draft});message.value='存储目录已保存，后续导出和下载立即使用；已有文件保留在原目录。'}catch(e){error.value=String(e)}finally{saving.value=false}}
function reset(){if(defaults){Object.assign(draft,defaults);message.value='已填入默认目录，点击保存目录生效。'}}
onMounted(load)
</script>
<template>
 <section class="detail-form"><h3>文件与静态资源存储</h3><p class="muted">默认位于系统文档目录的 Map Data Studio 文件夹。Excel 导出对话框默认打开设置目录；图片按点位名称分文件夹保存。</p>
  <label v-for="field in fields" :key="field.key">{{field.label}}<input v-model="draft[field.key]" :disabled="busy||loading||saving" maxlength="2000" /><button type="button" class="export-button" :disabled="busy||loading||saving" @click="choose(field.key)">选择目录</button></label>
  <label>图片浏览器代理（留空使用系统／环境代理）<input v-model="draft.browserProxy" :disabled="busy||loading||saving" placeholder="例如：http://127.0.0.1:7897" /></label><p class="muted">百度页面没有样式、图片加载失败时，可填写正在使用的本机代理地址。</p><p class="muted">其他静态资源目录用于附件和资源文件的保存位置；软件内置浏览器与程序文件仍随安装包管理。</p>
  <p v-if="error" class="failed">{{error}}</p><p v-if="message" class="settings-success">{{message}}</p>
  <div class="settings-actions"><button type="button" class="export-button" :disabled="busy||loading||saving" @click="reset">恢复默认目录</button><button type="button" class="collect-button" :disabled="busy||loading||saving" @click="save">{{saving?'正在保存…':'保存目录'}}</button></div>
 </section>
</template>
