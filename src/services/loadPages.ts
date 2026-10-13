// Totals are not available from this endpoint; stop when a page is short.
export async function loadPages<T extends { page: number; hasMore: boolean }>(options: {
  startPage: number
  request: (page: number) => Promise<T>
  active: () => boolean
  apply: (result: T) => void
  waiting: (page: number) => void
}) {
  for (let page = options.startPage; page <= 100; page++) {
    if (!options.active()) return 'cancelled' as const
    options.waiting(page)
    const result = await options.request(page)
    if (!options.active()) return 'cancelled' as const
    options.apply(result)
    if (!result.hasMore) return 'complete' as const
  }
  return 'limit' as const
}
