export type PoiCategory = { name: string; code: string; color: string; custom?: boolean }
export const defaultColors: Record<string, string> = { 景点: '#19a77d', 商场: '#3275e9', 酒店: '#ef7d22', 餐饮: '#e94d47', 自定义: '#8f64e9', 其他: '#8f64e9' }
export const colorForCategory = (name: string, categories: PoiCategory[]) => categories.find((item) => item.name === name)?.color || defaultColors[name] || '#8f64e9'
export function classifyPoi(typecode: string, fallback: string, categories: PoiCategory[]) {
  const codes = typecode.split('|')
  const matches = categories.map((item) => ({ item, prefix: item.code.replace(/(?:00){1,2}$/, '') }))
    .filter(({ prefix }) => codes.some((code) => code.startsWith(prefix)))
    .sort((a, b) => b.prefix.length - a.prefix.length || Number(!!b.item.custom) - Number(!!a.item.custom))
  return matches[0]?.item.name || fallback
}
export function validateCategory(item: PoiCategory, existing: PoiCategory[]) {
  if (!item.name.trim() || item.name.trim().length > 20) return '名称需要 1–20 个字'
  if (['全部', '自定义', '其他'].includes(item.name.trim()) || existing.some((old) => old.name === item.name.trim())) return '该名称已存在或已被使用'
  if (!/^\d{6}$/.test(item.code)) return '请选择一个高德分类'
  if (existing.some((old) => old.code === item.code)) return '该分类已经添加'
  if (!/^#[\da-f]{6}$/i.test(item.color)) return '请选择有效颜色'
  return ''
}
