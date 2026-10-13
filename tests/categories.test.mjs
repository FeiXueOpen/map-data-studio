import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
const { outputText } = ts.transpileModule(await readFile('src/services/categories.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } })
const { classifyPoi, colorForCategory, defaultColors, validateCategory } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const categories = [{ name: '餐饮', code: '050000', color: defaultColors.餐饮 }, { name: '酒店', code: '100000', color: defaultColors.酒店 }, { name: '咖啡厅', code: '050500', color: '#0891b2', custom: true }]
test('custom subtype overrides broad category without relabeling unrelated POIs', () => {
  assert.equal(classifyPoi('050501', '餐饮', categories), '咖啡厅')
  assert.equal(classifyPoi('050100', '餐饮', categories), '餐饮')
  assert.equal(classifyPoi('100101', '酒店', categories), '酒店')
  assert.equal(classifyPoi('050501|060101', '其他', categories), '咖啡厅')
})
test('sidebar and markers resolve the same colors, and food differs from hotel', () => {
  assert.notEqual(colorForCategory('餐饮', categories), colorForCategory('酒店', categories))
  assert.equal(colorForCategory('咖啡厅', categories), '#0891b2')
  categories[2].color = '#d53e92'
  assert.equal(colorForCategory('咖啡厅', categories), '#d53e92')
})
test('rejects duplicate names/codes and invalid stored colors', () => {
  assert.ok(validateCategory({ name: '餐饮', code: '140100', color: '#8f64e9' }, categories))
  assert.ok(validateCategory({ name: '咖啡', code: '050500', color: '#8f64e9' }, categories))
  assert.ok(validateCategory({ name: '博物馆', code: '140100', color: 'invalid' }, categories))
  assert.equal(validateCategory({ name: '博物馆', code: '140100', color: '#8f64e9' }, categories), '')
})
