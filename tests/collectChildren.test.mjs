import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
const { outputText } = ts.transpileModule(await readFile('src/services/collectChildren.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } })
const { collectChildren, descendantIds } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const options = overrides => ({ ids: ['P'], active: () => true, queued: () => {}, result: () => {}, discover: () => {}, ...overrides })
const poi = (id, children = []) => ({ id, children, photos: ['a', 'b', 'c', 'd'] })
test('queries all children in batches, including deeper children, without truncating photos', async () => {
  const children = Array.from({ length: 23 }, (_, i) => poi(`C${i}`))
  const data = new Map([['P', poi('P', children)], ...children.map(child => [child.id, child]), ['G', poi('G')]])
  data.set('C0', poi('C0', [poi('G')]))
  const requested = [], complete = []
  await collectChildren(options({ request: async ids => { assert.ok(ids.length <= 10); requested.push(...ids); return ids.map(id => data.get(id)) }, result: (id, record) => complete.push(record) }))
  assert.equal(requested.length, 25); assert.equal(new Set(requested).size, 25)
  assert.ok(requested.includes('G')); assert.ok(complete.every(item => item.photos.length === 4))
})
test('shared children and cycles are requested once, while parent associations remain available', async () => {
  const data = { P: poi('P', [poi('A'), poi('B')]), A: poi('A', [poi('C')]), B: poi('B', [poi('C')]), C: poi('C', [poi('P')]) }
  const requests = [], edges = []
  await collectChildren(options({ request: async ids => { requests.push(...ids); return ids.map(id => data[id]) }, discover: (parent, children) => children.forEach(child => edges.push({ id: child.id, parentId: parent.id })) }))
  assert.deepEqual(new Set(requests), new Set(['P', 'A', 'B', 'C']))
  assert.equal(requests.length, 4); assert.equal(edges.filter(item => item.id === 'C').length, 2)
  assert.deepEqual(descendantIds(['P'], edges), new Set(['P', 'A', 'B', 'C']))
})
test('missing and failed child details are reported and can be retried independently', async () => {
  const results = []
  await collectChildren(options({ request: async ids => ids[0] === 'P' ? [poi('P', [poi('C')])] : [], result: (id, record, error) => results.push({ id, record, error }) }))
  assert.ok(results[0].record); assert.match(results[1].error.message, /未返回/)
  const retried = []
  await collectChildren(options({ ids: ['C'], request: async ids => ids.map(id => poi(id)), result: id => retried.push(id) }))
  assert.deepEqual(retried, ['C'])
})
test('cancellation discards in-flight child responses and does not queue descendants', async () => {
  let active = true, applied = 0, queued = 0
  await collectChildren(options({ active: () => active, request: async () => { active = false; return [poi('P', [poi('C')])] }, result: () => applied++, queued: () => queued++ }))
  assert.equal(applied, 0); assert.equal(queued, 0)
})
