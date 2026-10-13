import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
const { outputText } = ts.transpileModule(await readFile('src/services/loadPages.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } })
const { loadPages } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const setup = (overrides = {}) => ({ startPage: 1, active: () => true, waiting: () => {}, apply: () => {}, ...overrides })
test('loads every page in order and renders before requesting the next', async () => {
  const events = []
  const result = await loadPages(setup({ request: async page => { events.push(`request${page}`); return { page, hasMore: page < 3 } }, apply: result => events.push(`render${result.page}`) }))
  assert.equal(result, 'complete')
  assert.deepEqual(events, ['request1', 'render1', 'request2', 'render2', 'request3', 'render3'])
})
test('cancel or city change discards in-flight results and stops further requests', async () => {
  let active = true, applied = 0, requested = 0
  const result = await loadPages(setup({ active: () => active, request: async page => { requested++; active = false; return { page, hasMore: true } }, apply: () => applied++ }))
  assert.equal(result, 'cancelled'); assert.equal(applied, 0); assert.equal(requested, 1)
})
test('failure keeps completed pages and resume begins at the failed page', async () => {
  const rendered = []
  await assert.rejects(loadPages(setup({ request: async page => { if (page === 2) throw Error('offline'); return { page, hasMore: true } }, apply: result => rendered.push(result.page) })), /offline/)
  assert.deepEqual(rendered, [1])
  await loadPages(setup({ startPage: 2, request: async page => ({ page, hasMore: false }), apply: result => rendered.push(result.page) }))
  assert.deepEqual(rendered, [1, 2])
})
test('stops at the supported page limit without requesting page 101', async () => {
  const pages = []
  const result = await loadPages(setup({ startPage: 99, request: async page => { pages.push(page); return { page, hasMore: true } } }))
  assert.equal(result, 'limit'); assert.deepEqual(pages, [99, 100])
})
