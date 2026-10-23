// Synthetic-only UI regression for field validation, error focus, and ARIA associations.
// Run: node tools/check-publish-field-validation.mjs --base=http://127.0.0.1:5180
import { withBrowser } from './cdp.mjs'

const base = (process.argv.find((arg) => arg.startsWith('--base=')) || '--base=http://127.0.0.1:5180')
  .slice(7)
  .replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, expected, actual, ok) {
  steps.push({ id, expected, actual, ok })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${actual}`)
  if (!ok) throw new Error(`${id}: expected ${expected}; got ${actual}`)
}

async function submitAndWait(page, selector) {
  await page.clickByText('提交审核', { selector: '.submit-button', exact: false })
  await page.waitForExpression(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, {
    timeoutMs: 8000,
    intervalMs: 100,
    label: `field error ${selector}`,
  })
}

await withBrowser({ windowSize: { width: 1280, height: 900 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.setMembership('member')
  await page.clickNav('发布')
  await page.waitForExpression("Boolean(document.querySelector('#publish-title'))", {
    timeoutMs: 10000,
    label: 'publish form mounted',
  })
  await page.clickByText('邻里分享', { selector: '.mode-options button', exact: false })

  const initialGuard = await page.eval(() => ({
    noValidate: document.querySelector('form.publish-form')?.noValidate === true,
    titleRequired: document.querySelector('#publish-title')?.required === true,
    contentRequired: document.querySelector('#publish-content')?.required === true,
    submitDisabled: document.querySelector('.publish-form .submit-button')?.disabled === true,
  }))
  step('PV1-native-validation-bypass', 'custom submit remains available while native required semantics remain',
    JSON.stringify(initialGuard), initialGuard.noValidate && initialGuard.titleRequired
      && initialGuard.contentRequired && !initialGuard.submitDisabled)

  await submitAndWait(page, '#publish-title-error')
  const unconfirmedContract = await page.eval(() => {
    const title = document.querySelector('#publish-title')
    const content = document.querySelector('#publish-content')
    const confirm = document.querySelector('#publish-synthetic-confirm')
    const described = (confirm?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
    return {
      focusId: document.activeElement?.id || '',
      titleInvalid: title?.getAttribute('aria-invalid') === 'true',
      contentInvalid: content?.getAttribute('aria-invalid') === 'true',
      confirmInvalid: confirm?.getAttribute('aria-invalid') === 'true',
      confirmRequired: confirm?.required === true,
      confirmLinked: described.includes('publish-synthetic-confirm-error')
        && Boolean(document.getElementById('publish-synthetic-confirm-error')),
      confirmError: document.getElementById('publish-synthetic-confirm-error')?.textContent?.trim() || '',
      summaryAlert: document.querySelector('#publish-form-error')?.getAttribute('role') === 'alert',
      summaryCount: document.querySelector('#publish-form-error')?.textContent?.includes('3 项') === true,
    }
  })
  step('PV2-unconfirmed-and-required-field-errors', 'title/content/confirmation show errors and the first field receives focus',
    JSON.stringify(unconfirmedContract), unconfirmedContract.focusId === 'publish-title'
      && unconfirmedContract.titleInvalid && unconfirmedContract.contentInvalid
      && unconfirmedContract.confirmInvalid && unconfirmedContract.confirmRequired
      && unconfirmedContract.confirmLinked && unconfirmedContract.confirmError.includes('虚构')
      && unconfirmedContract.summaryAlert && unconfirmedContract.summaryCount)

  await page.setValue('#publish-title', '合成回归：发布字段校验')
  await page.setValue('#publish-content', '虚构演练正文，仅用于发布字段校验，不含个人信息。')
  await submitAndWait(page, '#publish-synthetic-confirm-error')
  const confirmationContract = await page.eval(() => ({
    focusId: document.activeElement?.id || '',
    invalid: document.querySelector('#publish-synthetic-confirm')?.getAttribute('aria-invalid') === 'true',
    linked: (document.querySelector('#publish-synthetic-confirm')?.getAttribute('aria-describedby') || '').split(/\s+/).includes('publish-synthetic-confirm-error'),
    error: document.querySelector('#publish-synthetic-confirm-error')?.textContent?.trim() || '',
    summaryCount: document.querySelector('#publish-form-error')?.textContent?.includes('1 项') === true,
  }))
  step('PV3-confirmation-error-focus', 'when other fields are valid, missing confirmation is announced and focused',
    JSON.stringify(confirmationContract), confirmationContract.focusId === 'publish-synthetic-confirm'
      && confirmationContract.invalid && confirmationContract.linked
      && confirmationContract.error.includes('虚构') && confirmationContract.summaryCount)
  await page.checkSelector('#publish-synthetic-confirm')
  await page.waitForExpression("!document.querySelector('#publish-form-error') && !document.querySelector('#publish-synthetic-confirm-error')", {
    timeoutMs: 8000, label: 'synthetic confirmation correction clears field error',
  })
  step('PV4-confirmation-correction-clears', 'checking the confirmation clears the associated error',
    String(!await page.count('#publish-synthetic-confirm-error')), !await page.count('#publish-synthetic-confirm-error'))

  await page.setValue('#publish-title', '')
  await page.setValue('#publish-content', '')
  await submitAndWait(page, '#publish-title-error')
  const blankContract = await page.eval(() => {
    const title = document.querySelector('#publish-title')
    const content = document.querySelector('#publish-content')
    const titleDescription = title?.getAttribute('aria-describedby') || ''
    const contentDescription = (content?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
    const summary = document.querySelector('#publish-form-error')
    return {
      focusId: document.activeElement?.id || '',
      titleInvalid: title?.getAttribute('aria-invalid') === 'true',
      contentInvalid: content?.getAttribute('aria-invalid') === 'true',
      titleLabelled: document.querySelector('label[for="publish-title"]')?.contains(title) === true,
      titleHelpText: document.getElementById(titleDescription)?.textContent?.trim() || '',
      contentCountLinked: contentDescription.includes('publish-content-count'),
      contentErrorLinked: contentDescription.includes('publish-content-error')
        && Boolean(document.getElementById('publish-content-error')),
      contentHelpText: document.getElementById('publish-content-error')?.textContent?.trim() || '',
      summaryAlert: summary?.getAttribute('role') === 'alert',
      summaryCount: summary?.textContent?.includes('2 项') === true,
      titleBorder: title ? getComputedStyle(title).borderTopColor : '',
    }
  })
  step('PV5-required-field-errors', 'blank title/content show associated errors and focus the first invalid field',
    JSON.stringify(blankContract), blankContract.focusId === 'publish-title'
      && blankContract.titleInvalid && blankContract.contentInvalid && blankContract.titleLabelled
      && blankContract.titleHelpText.includes('标题') && blankContract.contentCountLinked
      && blankContract.contentErrorLinked && blankContract.contentHelpText.includes('正文')
      && blankContract.summaryAlert && blankContract.summaryCount
      && blankContract.titleBorder === 'rgb(143, 61, 51)')

  await page.setValue('#publish-title', '合成回归：字段修复后恢复')
  await page.setValue('#publish-content', '仅用于字段级校验回归的虚构正文。')
  await page.waitForExpression("!document.querySelector('#publish-form-error') && !document.querySelector('#publish-title-error') && !document.querySelector('#publish-content-error')", {
    timeoutMs: 8000, label: 'corrected required field errors cleared',
  })
  const correctedRequired = await page.eval(() => ({
    titleInvalid: document.querySelector('#publish-title')?.getAttribute('aria-invalid') === 'true',
    contentInvalid: document.querySelector('#publish-content')?.getAttribute('aria-invalid') === 'true',
    summaryGone: !document.querySelector('#publish-form-error'),
  }))
  step('PV6-corrected-fields-clear', 'correcting both required fields clears error UI and aria-invalid',
    JSON.stringify(correctedRequired), !correctedRequired.titleInvalid && !correctedRequired.contentInvalid
      && correctedRequired.summaryGone)

  await page.clickByText('求助登记', { selector: '.mode-options button', exact: false })
  await page.waitForExpression("Boolean(document.querySelector('#publish-category'))", {
    timeoutMs: 8000,
    label: 'help fields mounted',
  })
  // The production default is the valid placeholder category; blank it to test the required-field error.
  await page.setValue('#publish-category', '')
  await submitAndWait(page, '#publish-category-error')
  const helpContract = await page.eval(() => {
    const ids = ['publish-category', 'publish-time-window', 'publish-duration']
    const entries = ids.map((id) => {
      const input = document.getElementById(id)
      const described = (input?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      const errorId = `${id}-error`
      return {
        id,
        invalid: input?.getAttribute('aria-invalid') === 'true',
        described: described.includes(errorId),
        text: document.getElementById(errorId)?.textContent?.trim() || '',
      }
    })
    return {
      entries,
      focusId: document.activeElement?.id || '',
      summaryCount: document.querySelector('#publish-form-error')?.textContent?.includes('3 项') === true,
    }
  })
  step('PV7-help-field-errors', 'service category, time window, and duration each have field errors and linked descriptions',
    JSON.stringify(helpContract), helpContract.entries.length === 3
      && helpContract.entries.every((entry) => entry.invalid && entry.described && entry.text.length > 0)
      && helpContract.focusId === 'publish-category' && helpContract.summaryCount)

  await page.setValue('#publish-category', '待分类（合成演练）')
  await page.setValue('#publish-time-window', '周四下午（合成演练）')
  await page.setValue('#publish-duration', '约 1 小时（合成演练）')
  await page.waitForExpression("!document.querySelector('#publish-form-error') && !document.querySelector('#publish-category-error') && !document.querySelector('#publish-time-window-error') && !document.querySelector('#publish-duration-error')", {
    timeoutMs: 8000,
    label: 'corrected help field errors cleared',
  })
  const correctedHelp = await page.eval(() => ({
    ids: ['publish-category', 'publish-time-window', 'publish-duration'],
    invalid: ['publish-category', 'publish-time-window', 'publish-duration']
      .map((id) => document.getElementById(id)?.getAttribute('aria-invalid') === 'true'),
  }))
  step('PV8-help-corrections-clear', 'correcting help fields clears all associated invalid states',
    JSON.stringify(correctedHelp), correctedHelp.invalid.length === 3 && correctedHelp.invalid.every((value) => !value))

  await page.clickByText('志愿发布', { selector: '.mode-options button', exact: false })
  await page.waitForExpression("Boolean(document.querySelector('.submode-row'))", {
    timeoutMs: 8000,
    label: 'volunteer submodes mounted',
  })
  await page.clickByText('活动招募', { selector: '.submode-row button', exact: false })
  await page.waitForExpression("Boolean(document.querySelector('#publish-event-start'))", {
    timeoutMs: 8000,
    label: 'activity fields mounted',
  })
  await page.setValue('#publish-event-capacity', '201')
  await submitAndWait(page, '#publish-event-start-error')
  const activityContract = await page.eval(() => {
    const ids = ['publish-event-start', 'publish-event-capacity']
    const entries = ids.map((id) => {
      const input = document.getElementById(id)
      const errorId = `${id}-error`
      const described = (input?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      return {
        id,
        invalid: input?.getAttribute('aria-invalid') === 'true',
        described: described.includes(errorId) && Boolean(document.getElementById(errorId)),
        text: document.getElementById(errorId)?.textContent?.trim() || '',
      }
    })
    return {
      entries,
      focusId: document.activeElement?.id || '',
      summaryCount: document.querySelector('#publish-form-error')?.textContent?.includes('2 项') === true,
    }
  })
  step('PV9-activity-field-errors', 'invalid activity start and capacity are announced and first error receives focus',
    JSON.stringify(activityContract), activityContract.entries.length === 2
      && activityContract.entries.every((entry) => entry.invalid && entry.described && entry.text.length > 0)
      && activityContract.focusId === 'publish-event-start' && activityContract.summaryCount)

  await page.setValue('#publish-event-start', '2099-12-31T23:59')
  await page.setValue('#publish-event-capacity', '20')
  await page.waitForExpression("!document.querySelector('#publish-form-error') && !document.querySelector('#publish-event-start-error') && !document.querySelector('#publish-event-capacity-error')", {
    timeoutMs: 8000,
    label: 'corrected activity field errors cleared',
  })
  const correctedActivity = await page.eval(() => ({
    startInvalid: document.querySelector('#publish-event-start')?.getAttribute('aria-invalid') === 'true',
    capacityInvalid: document.querySelector('#publish-event-capacity')?.getAttribute('aria-invalid') === 'true',
    summaryGone: !document.querySelector('#publish-form-error'),
  }))
  step('PV10-activity-corrections-clear', 'valid synthetic activity values clear both error associations',
    JSON.stringify(correctedActivity), !correctedActivity.startInvalid && !correctedActivity.capacityInvalid
      && correctedActivity.summaryGone)

  // All entered content is synthetic; remove browser-local test state before closing.
  await page.clearLocalStorage()
})

console.log(`Publish field validation regression: ${steps.length - failures}/${steps.length} passed.`)
if (failures) process.exitCode = 1
