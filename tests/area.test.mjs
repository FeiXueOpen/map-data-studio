import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
const { outputText } = ts.transpileModule(await readFile('src/services/area.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } })
const { insideArea } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
test('excludes nearby points outside a concave scenic boundary in either winding', () => {
  const path = [[0,0],[4,0],[4,4],[2,2],[0,4]]
  for(const polygon of [path,[...path].reverse(),[...path,path[0]]]) {
    assert.equal(insideArea([2,1],polygon),true)
    assert.equal(insideArea([2,3],polygon),false)
    assert.equal(insideArea([5,2],polygon),false)
    assert.equal(insideArea([0,2],polygon),true)
    assert.equal(insideArea([2,2],polygon),true)
  }
})
