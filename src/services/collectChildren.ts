// Children are embedded in detail responses, with no independent page cursor.
// Query every discovered ID once; preserve each parent-child association.
export async function collectChildren<T extends { id: string; children: T[] }>(options: {
  ids: string[]
  includeChildren?: boolean
  active: () => boolean
  request: (ids: string[]) => Promise<T[]>
  queued: (id: string) => void
  result: (id: string, record?: T, error?: unknown) => void
  discover: (parent: T, children: T[]) => void
}) {
  const queue = [...new Set(options.ids)]
  const seen = new Set(queue)
  for (let offset = 0; offset < queue.length;) {
    if (!options.active()) return
    const batch = queue.slice(offset, offset + 10)
    try {
      const records = await options.request(batch)
      if (!options.active()) return
      for (const id of batch) {
        const record = records.find((item) => item.id === id)
        options.result(id, record, record ? undefined : new Error('接口未返回该 POI 详情'))
        if (!record) continue
        if (options.includeChildren === false) continue
        const children = record.children.filter((child) => child.id && child.id !== record.id)
        options.discover(record, children)
        for (const child of children) {
          if (seen.has(child.id)) continue
          seen.add(child.id)
          queue.push(child.id)
          options.queued(child.id)
        }
      }
    } catch (error) {
      if (!options.active()) return
      batch.forEach((id) => options.result(id, undefined, error))
    }
    offset += batch.length
  }
}

export function descendantIds(parents: string[], edges: { id: string; parentId: string }[]) {
  const ids = new Set(parents)
  const byParent = new Map<string, string[]>()
  edges.forEach((edge) => { const list = byParent.get(edge.parentId) || []; list.push(edge.id); byParent.set(edge.parentId, list) })
  const queue = [...ids]
  for (const parent of queue) for (const child of byParent.get(parent) || []) {
    if (!ids.has(child)) { ids.add(child); queue.push(child) }
  }
  return ids
}
