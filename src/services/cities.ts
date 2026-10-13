import { invoke, isTauri } from '@tauri-apps/api/core'

export type Region = { id: number; name: string; pinyin: string; first: string }
export type CitySelection = { province: Region; city: Region }

async function request(command: string, provinceId?: number): Promise<Region[]> {
  if (isTauri()) {
    return invoke<Region[]>(command, provinceId === undefined ? {} : { provinceId })
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 15000)
  try {
    const endpoint = provinceId === undefined ? 'provinces' : 'cities'
    const base = import.meta.env.DEV ? '/city-api' : 'https://api.lvxiaolue.com/api/common/city'
    const response = await fetch(`${base}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(provinceId === undefined ? {} : { provinceId }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`省市接口请求失败（HTTP ${response.status}）`)
    const payload = await response.json()
    if (payload.code !== 200) throw new Error(payload.msg || '省市查询失败')
    if (!Array.isArray(payload.data) || payload.data.some((region: Region) =>
      !Number.isSafeInteger(region.id) || region.id <= 0 || typeof region.name !== 'string' || !region.name.trim(),
    )) throw new Error('省市接口返回格式异常')
    return payload.data
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('省市查询超时，请重试')
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export const getProvinces = () => request('get_provinces')
export const getCities = (provinceId: number) => request('get_cities', provinceId)
