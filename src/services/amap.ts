import { invoke, isTauri } from '@tauri-apps/api/core'
import type { DownloadedImage } from './images'
import type { Supplement } from './poiFields'

export type District = { name: string; adcode: string; center: [number, number]; boundaries: [number, number][][] }
export type Poi = {
  id: string; name: string; category: string; typecode: string; location: [number, number] | null
  address: string; province: string; city: string; district: string; hours: string; weekHours: string
  tel: string; tag: string; photos: string[]; source: 'amap' | 'user'; collectedAt: string
  downloadedImages?: DownloadedImage[]; raw?: Record<string, unknown>; rawRecords?: Record<string, unknown>[]; parentId: string; relation?: 'child' | 'area'; children: Poi[]; included: boolean; status: 'pending' | 'done' | 'error' | 'manual'; error: string; note: string; supplements?: Supplement[]
}
export type MapConfig = { jsKey: string; securityJsCode: string; categories: { name: string; code: string }[] }
export type ApiSettings = { webKey: string; jsKey: string; securityJsCode: string }
export type SearchResult = { pois: Poi[]; hasMore: boolean; page: number }

export function backend<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return Promise.reject(new Error('请在桌面应用中使用高德查询'))
  return invoke<T>(command, args)
}
let configPromise: Promise<MapConfig> | undefined
export const getApiSettings = () => backend<ApiSettings>('get_api_settings')
export async function saveApiSettings(config: ApiSettings) {
  await backend<void>('save_api_settings', { config })
  configPromise = undefined
}
export function getMapConfig() {
  return configPromise ??= backend<MapConfig>('get_map_config').catch((error) => { configPromise = undefined; throw error })
}
export const resolveDistrict = (city: string, province: string) => backend<District>('resolve_district', { city, province })
export const searchPois = (adcode: string, codes: string[], keywords: string, page: number) => backend<SearchResult>('search_pois', { adcode, codes, keywords, page })
export const poiDetails = (ids: string[]) => backend<Poi[]>('poi_details', { ids })
export const searchArea = (polygon: [number, number][], page: number) => backend<SearchResult>('search_area', { polygon, page })
export const normalizePoi = (poi: Poi): Poi => ({ ...poi, included: true, status: 'pending', error: '', note: '', collectedAt: new Date().toISOString() })
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
export const symbols: Record<string, string> = { 景点: '✦', 商场: '▣', 酒店: '⌂', 餐饮: '♨', 自定义: '+', 其他: '●' }

export const poiAoi = (id: string) => backend<{ boundaries: [number, number][][]; raw: Record<string, unknown> }>('poi_aoi', { id })
