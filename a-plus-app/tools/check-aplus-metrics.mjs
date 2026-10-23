// A+ metric cards are clickable queue filters.
// Run: node tools/check-aplus-metrics.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-aplus-metrics')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `aplus-metrics-${name}.png`)
  await page.screenshot(file)
  return file
}
async function clickMetric(page, label) {
  await page.clickByText(label, { selector: '.metric-card', exact: false })
  await sleep(300)
  return page.eval(() => ({
    selected: document.querySelector('.metric-card.selected .metric-label')?.innerText ?? '',
    filter: document.querySelector('.filters .filter.active')?.innerText ?? '',
    pressed: document.querySelector('.metric-card[aria-pressed="true"] .metric-label')?.innerText ?? '',
  }))
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/`)
  await page.waitForSelector('#app')
  await page.waitForText('待分诊记录')
  const initial = await page.eval(() => ({
    cards: document.querySelectorAll('.metric-card').length,
    buttons: document.querySelectorAll('button.metric-card').length,
    filters: Array.from(document.querySelectorAll('.filters .filter')).map((node) => node.innerText.replace(/\s+/g, ' ').trim()),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))
  step('D1', 'A+ 统计卡可点击', '4 张按钮卡、筛选含待分诊/初筛中、无横向溢出',
    `cards=${initial.cards} buttons=${initial.buttons} filters=${initial.filters.join('|')} overflow=${initial.overflow}`,
    initial.cards === 4 && initial.buttons === 4 && initial.filters.some((text) => text.includes('待分诊'))
    && initial.filters.some((text) => text.includes('初筛中')) && initial.overflow <= 1,
    await shot(page, 'd1-initial'))

  const triage = await clickMetric(page, '待分诊记录')
  step('D2', '点击待分诊卡', '卡片选中，队列筛选切到“待分诊”',
    `selected=${triage.selected} filter=${triage.filter} pressed=${triage.pressed}`,
    triage.selected.includes('待分诊') && triage.filter.includes('待分诊') && triage.pressed.includes('待分诊'),
    await shot(page, 'd2-triage'))

  const screening = await clickMetric(page, '常规初筛中')
  step('D3', '点击初筛中卡', '卡片选中，队列筛选切到“初筛中”',
    `selected=${screening.selected} filter=${screening.filter}`,
    screening.selected.includes('常规初筛') && screening.filter.includes('初筛中'),
    await shot(page, 'd3-screening'))

  const overdue = await clickMetric(page, '逾期演练待办')
  step('D4', '点击逾期卡', '卡片选中，队列筛选切到“演练逾期”',
    `selected=${overdue.selected} filter=${overdue.filter}`,
    overdue.selected.includes('逾期') && overdue.filter.includes('演练逾期'),
    await shot(page, 'd4-overdue'))

  const risk = await clickMetric(page, '高风险停止标记')
  step('D5', '点击高风险卡', '卡片选中，队列筛选切到“高风险”',
    `selected=${risk.selected} filter=${risk.filter}`,
    risk.selected.includes('高风险') && risk.filter.includes('高风险'),
    await shot(page, 'd5-risk'))

  const storedFilter = await page.eval(() => localStorage.getItem('a-plus.intake-filter.v1'))
  await page.reload()
  await page.waitForSelector('#app')
  await page.waitForText('待分诊记录')
  const restoredFilter = await page.eval(() => ({
    filter: document.querySelector('.filters .filter.active')?.innerText ?? '',
    metric: document.querySelector('.metric-card.selected .metric-label')?.innerText ?? '',
  }))
  step('D7', 'A+ 筛选跨刷新保留', '高风险筛选与选中卡在刷新后保留',
    `stored=${storedFilter} filter=${restoredFilter.filter} metric=${restoredFilter.metric}`,
    storedFilter === '高风险' && restoredFilter.filter.includes('高风险') && restoredFilter.metric.includes('高风险'),
    await shot(page, 'd7-persisted'))

  await page.eval(() => localStorage.setItem('a-plus.intake-filter.v1', '不存在的筛选'))
  await page.reload()
  await page.waitForSelector('#app')
  await page.waitForText('待分诊记录')
  const fallbackFilter = await page.eval(() => document.querySelector('.filters .filter.active')?.innerText ?? '')
  step('D8', '非法筛选值回退默认', '损坏偏好回退“全部记录”',
    `filter=${fallbackFilter}`, fallbackFilter.includes('全部记录'),
    await shot(page, 'd8-fallback'))

  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(400)
  const mobile = await page.eval(() => ({
    columns: getComputedStyle(document.querySelector('.metric-grid')).gridTemplateColumns.split(' ').filter(Boolean).length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))
  step('D6', 'A+ 移动端统计卡', '390px 下两列、无横向溢出',
    `columns=${mobile.columns} overflow=${mobile.overflow}`,
    mobile.columns === 2 && mobile.overflow <= 1,
    await shot(page, 'd6-mobile'))
  await page.client.send('Emulation.clearDeviceMetricsOverride')

  await writeFile(join(evidenceDir, 'aplus-metrics-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
