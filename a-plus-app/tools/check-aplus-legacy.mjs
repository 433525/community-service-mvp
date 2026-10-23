// A+ legacy deadlocked complaint: UI explanation + backup import rejection.
// Run: node tools/check-aplus-legacy.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-aplus-legacy')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `aplus-legacy-${name}.png`)
  await page.screenshot(file)
  return file
}
async function intakeStore(page, fn) {
  return page.eval((source) => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('intake')
    return (new Function('store', `return (${source})(store)`))(store)
  }, fn.toString())
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/`)
  await page.waitForSelector('#app')
  await page.waitForText('新建演练记录')

  const injected = await intakeStore(page, (store) => {
    const caseId = store.cases[0]?.id
    if (!caseId) return { ok: false }
    store.complaints.push({
      id: 'CMP-LEGACY-DEADLOCK',
      caseId,
      targetRole: 'demo-referral',
      submittedByRole: 'demo-review',
      description: '历史死锁投诉注入（合成）',
      status: '待复核',
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewerRole: null,
      resolution: '',
    })
    return { ok: true, id: 'CMP-LEGACY-DEADLOCK', count: store.complaints.length }
  })
  await sleep(400)
  await page.waitForText('CMP-LEGACY-DEADLOCK')
  await page.clickByText('CMP-LEGACY-DEADLOCK', { selector: '.complaint-panel .queue-item', exact: false })
  await sleep(300)
  const text = await page.bodyText()
  const hasBlocked = text.includes('该历史投诉组合没有可用复核角色')
  const contradictory = text.includes('当前演示角色可复核（仍受提交人 / 被投诉角色回避限制）')
  step('L1', '历史死锁投诉提示明确', '选中后提示“没有可用复核角色”，不出现“当前演示角色可复核”',
    `injected=${injected.ok} blocked=${hasBlocked} contradictory=${contradictory}`,
    injected.ok && hasBlocked && !contradictory,
    await shot(page, 'l1-ui-blocked'))

  const imported = await intakeStore(page, (store) => {
    const backup = JSON.parse(store.exportBackup())
    backup.complaints.push({
      id: 'CMP-LEGACY-IMPORT',
      caseId: backup.cases[0]?.id ?? 'SYNTH-NONE',
      targetRole: 'demo-referral',
      submittedByRole: 'demo-review',
      description: '历史死锁投诉导入验证（合成）',
      status: '待复核',
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewerRole: null,
      resolution: '',
    })
    return store.importBackup(JSON.stringify(backup))
  })
  step('L2', '导入拒绝死锁投诉', '导入失败并说明该投诉组合没有可用复核角色',
    `ok=${imported.ok} errors=${JSON.stringify(imported.errors ?? [])}`,
    imported.ok === false && (imported.errors ?? []).some((item) => item.includes('没有可用复核角色')),
    await shot(page, 'l2-import-rejected'))

  await writeFile(join(evidenceDir, 'aplus-legacy-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
