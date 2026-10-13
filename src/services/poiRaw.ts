import type { Poi } from './amap'
export function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
}
function mergeRaw(before: any, after: any): any {
  if (!present(after)) return before
  if (Array.isArray(before) && Array.isArray(after)) return [...new Map([...before, ...after].map(item => [JSON.stringify(item), item])).values()]
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const merged = { ...before }
    for (const key of Object.keys(after)) Object.defineProperty(merged, key, { value: mergeRaw(before[key], after[key]), enumerable: true, writable: true, configurable: true })
    return merged
  }
  return after
}
export function mergePoiData(before: Poi, after: Poi): Poi {
  const result = { ...after }
  for (const key of Object.keys(before)) if (!present((after as any)[key])) (result as any)[key] = (before as any)[key]
  result.photos = [...new Set([...before.photos, ...after.photos])]
  result.raw = mergeRaw(before.raw, after.raw)
  result.rawRecords = [...new Map([...(before.rawRecords || (before.raw ? [before.raw] : [])), ...(after.rawRecords || (after.raw ? [after.raw] : []))].map(record => [JSON.stringify(record), record])).values()]
  return result
}
export function rawPaths(raw: Record<string, unknown> = {}, prefix = ''): string[] {
  return Object.entries(raw).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length ? rawPaths(value as Record<string, unknown>, path) : [path]
  })
}
export function validRawField(field: string) {
  return field.startsWith('raw:') && field.slice(4).split('.').every(part => !!part && !/[\x00-\x1f]/.test(part))
}
export function readRawField(poi: Poi, field: string): string | number {
  if (!validRawField(field)) throw new Error('原始字段路径无效')
  let value: unknown = poi.raw
  for (const key of field.slice(4).split('.')) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return ''
    value = (value as Record<string, unknown>)[key]
  }
  if (!present(value)) return ''
  return typeof value === 'number' || typeof value === 'string' ? value : JSON.stringify(value)
}
