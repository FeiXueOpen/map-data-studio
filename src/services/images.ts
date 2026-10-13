import { backend, type Poi } from './amap'
export type DownloadedImage = { url: string; sourceUrl: string; source: 'amap' | 'bing' | 'baidu'; path: string; width: number; height: number; ratio: string; originalPath?:string; originalWidth?:number; originalHeight?:number }
export type ImageOptions = { count: number; ratio: string; engine: 'bing' | 'baidu'; intervalSeconds?:number; proxy?:string; size?:string; minWidth: number; minHeight?:number; width?:number; height?:number; directory?: string; includeChildren?: boolean; query?: string }
export type ImageResult = { directory: string; images: DownloadedImage[]; failures: string[]; requested: number }
export const getImageSettings = () => backend<{ directory: string }>('get_image_settings')
export const saveImageSettings = (directory: string) => backend<void>('save_image_settings', { directory })
export const pickImageDirectory = () => backend<string | null>('pick_image_directory')
export const downloadPoiImages = (poi: Poi, options: ImageOptions, automatic = false, batchId?:string) => backend<ImageResult>('download_poi_images', {
  batchId:batchId || null, id: poi.id, name: poi.name, query: options.query || `${poi.city} ${poi.name}`.trim(), engine: automatic ? 'amap' : options.engine,
  count: automatic ? poi.photos.length : options.count, ratio: automatic ? 'original' : options.ratio,
  minWidth: automatic ? 0 : options.minWidth, size: automatic ? 'all' : options.size || 'all', minHeight: automatic ? 0 : options.minHeight || 0, width: automatic ? 0 : options.width || 0, height: automatic ? 0 : options.height || 0, urls: automatic ? poi.photos : [], directory: options.directory || null,
})
export function mergeDownloads(poi: Poi, result: ImageResult) {
  const merged = new Map((poi.downloadedImages || []).map(image => [image.path, image]))
  result.images.forEach(image => merged.set(image.path, image))
  poi.downloadedImages = [...merged.values()]
}

export const revealImageFolder = (path: string) => backend<void>('reveal_image_folder', {path})

export type ImageBrowserStatus = {state: string; message: string; poiId: string; poiName: string}
export const getImageBrowserStatus = () => backend<ImageBrowserStatus>('get_image_browser_status')
export const cancelImageDownload = () => backend<void>('cancel_image_download')

export const prepareBaiduBatch=(records:Poi[],options:ImageOptions)=>backend<string>('prepare_baidu_batch',{queries:records.map(p=>({id:p.id,name:p.name,query:options.query||`${p.city} ${p.name}`.trim()})),options})
export const clearBaiduBatch=(batchId:string)=>backend<void>('clear_baidu_batch',{batchId})
