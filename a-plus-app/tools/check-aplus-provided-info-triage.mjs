// Regression: information requested, provided, triaged, referred, and synthetically accepted.
// Run: node tools/check-aplus-provided-info-triage.mjs --base=http://127.0.0.1:5180
import { withBrowser, sleep } from './cdp.mjs'

const base = (process.argv.find((arg) => arg.startsWith('--base=')) || '--base=http://127.0.0.1:5180')
  .slice(7)
  .replace(/\/$/, '')
const summary = '回归-已提供信息直达分诊-合成'
const steps = []
let failures = 0

function step(id, expected, actual, ok) {
  steps.push({ id, expected, actual, ok })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${actual}`)
  if (!ok) throw new Error(`${id}: expected ${expected}; got ${actual}`)
}

async function statusSnippet(page) {
  return page.eval((needle) => {
    const text = document.body.innerText
    const index = text.indexOf(needle)
    return index < 0 ? '' : text.slice(index, index + 180).replace(/\s+/g, ' ').trim()
  }, summary)
}

await withBrowser({ windowSize: { width: 1280, height: 900 } }, async (page) => {
  await page.navigate(`${base}/`)
  await page.waitForText('新建演练记录')
  await page.clickByText('新建演练记录', { exact: false })
  await page.setValue('#record-summary', summary)
  await page.checkSelector('[role="dialog"] .synthetic-confirm input')
  await page.clickByText('创建演练记录', { selector: '[role="dialog"] button', exact: true })
  await page.waitForText(summary)
  let snippet = await statusSnippet(page)
  step('PI1-create', '合成记录处于已收件', snippet, snippet.includes('已收件'))

  await page.clickByText('更新登记检查点', { exact: false })
  await page.selectValue('#checkpoint-consent', 'confirmed')
  await page.checkSelector('[role="dialog"] input[type="checkbox"]')
  await page.setValue('#checkpoint-note', '虚构回归：登记检查点已确认')
  await page.clickByText('保存检查点', { selector: '[role="dialog"] button', exact: true })
  await sleep(120)
  const checkpointReady = await page.eval(() => document.body.innerText.includes('登记检查点：已完成'))
  step('PI2-checkpoint', '登记检查点完成', String(checkpointReady), checkpointReady)

  async function transition(action, expectedStatus) {
    await page.clickByText('更新登记状态', { exact: false })
    const actionValues = await page.eval(() => Array.from(document.querySelectorAll('#action-select option')).map((option) => option.value))
    const available = actionValues.includes(action)
    step(`${action}-available`, `${action} is offered`, JSON.stringify(actionValues), available)
    await page.selectValue('#action-select', action)
    await sleep(80)
    if (await page.count('#reason-select')) {
      const reasonValues = await page.eval(() => Array.from(document.querySelectorAll('#reason-select option')).map((option) => option.value))
      const reason = reasonValues.includes('INFO_INSUFFICIENT')
        ? 'INFO_INSUFFICIENT'
        : reasonValues.find((value) => value && value !== '请选择原因')
      if (!reason) throw new Error(`${action}: no usable reason option`)
      await page.selectValue('#reason-select', reason)
    }
    if (await page.count('#transition-note')) await page.setValue('#transition-note', `合成回归演练：${action}`)
    if (await page.count('#referral-target')) {
      const referralTarget = await page.eval(() => document.querySelector('#referral-target')?.value ?? '')
      if (!referralTarget) await page.setValue('#referral-target', '演练-社区支持点 A')
    }
    if (await page.count('#transition-owner')) {
      const owner = await page.eval(() => document.querySelector('#transition-owner')?.value ?? '')
      if (!owner) await page.setValue('#transition-owner', '演练-受理席-01')
    }
    if (await page.count('#transition-next')) {
      const nextStep = await page.eval(() => document.querySelector('#transition-next')?.value ?? '')
      if (!nextStep) await page.setValue('#transition-next', '核对已提供信息并完成分诊（合成演练）')
    }
    if (await page.count('#transition-due')) {
      const dueAt = await page.eval(() => document.querySelector('#transition-due')?.value ?? '')
      if (!dueAt) {
        const dueValue = await page.eval(() => {
          const due = new Date(Date.now() + 24 * 60 * 60 * 1000)
          due.setSeconds(0, 0)
          return new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        })
        await page.setValue('#transition-due', dueValue)
      }
    }
    if (await page.count('[role="dialog"] input[type="checkbox"]')) {
      await page.checkSelector('[role="dialog"] input[type="checkbox"]')
    }
    await page.clickByText('确认更新', { selector: '[role="dialog"] button', exact: true })
    await sleep(160)
    snippet = await statusSnippet(page)
    step(`${action}-status`, `${summary} reaches ${expectedStatus}`, snippet, snippet.includes(expectedStatus))
  }

  await transition('BEGIN_SCREENING', '初筛中')
  await transition('REQUEST_INFORMATION', '待补充')
  await transition('PROVIDE_INFORMATION', '已提供信息')
  await transition('ACCEPT_FOR_TRIAGE', '已受理待分诊')
  await transition('REFER', '已转介待确认')
  await transition('CONFIRM_REFERRAL', '已转介已接收')

  const pageErrors = page.pageErrors ?? []
  step('PI5-page-errors', 'no page errors', String(pageErrors.length), pageErrors.length === 0)
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
})
