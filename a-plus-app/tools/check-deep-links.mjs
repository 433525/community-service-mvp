import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

/**
 * 深链与历史导航回归（B 社区入口 + A+ 工作台）。
 * 覆盖：页签直达、刷新还原、前进/后退、帖子深链、失效参数回收、
 * 屏幕阅读器播报、复制链接、五档宽度无横向溢出。
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-deep-links')
const base = (process.argv.find((arg) => arg.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, expected, actual, ok) {
  steps.push({ id, expected, actual, ok })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${JSON.stringify(actual)}`)
}

function queryOf(url) {
  try {
    return Object.fromEntries(new URL(url).searchParams.entries())
  } catch {
    return {}
  }
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  // DL1 默认地址保持干净
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  const initial = await page.eval(() => ({
    query: location.search,
    tab: document.querySelector('.side-nav button[aria-current="page"]')?.innerText?.trim() ?? '',
    title: document.title,
  }))
  step('DL1-default-clean-url', '无参数进入首页，地址不带 tab，标题为首页',
    initial, initial.query === '' && initial.tab.includes('首页') && initial.title.startsWith('首页'))

  // DL2 页签直达
  await page.navigate(`${base}/community.html?tab=messages`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.messages-page')
  await page.waitForText('系统通知')
  const direct = await page.eval(() => ({
    tab: document.querySelector('.side-nav button[aria-current="page"]')?.innerText?.trim() ?? '',
    title: document.title,
    navCount: document.querySelectorAll('.mobile-nav button[aria-current="page"]').length,
  }))
  step('DL2-tab-deep-link', '?tab=messages 直达消息页，导航与移动底栏同步',
    direct, direct.tab.includes('消息') && direct.title.includes('消息') && direct.navCount === 1)

  // DL3 刷新还原
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.messages-page')
  const reloaded = await page.eval(() => ({
    query: location.search,
    tab: document.querySelector('.side-nav button[aria-current="page"]')?.innerText?.trim() ?? '',
  }))
  step('DL3-reload-keeps-tab', '刷新后仍停留在消息页', reloaded,
    queryOf(`${base}${reloaded.query}`).tab === 'messages' && reloaded.tab.includes('消息'))

  // DL4 切换页签写历史，后退回到上一页签
  await page.clickNav('社区')
  await page.waitForSelector('.feed-list, .empty-state')
  const afterNav = await page.url()
  await page.eval(() => history.back())
  await sleep(500)
  await page.waitForSelector('.messages-page')
  const backState = await page.eval(() => ({
    tab: document.querySelector('.side-nav button[aria-current="page"]')?.innerText?.trim() ?? '',
    focused: document.activeElement?.id ?? '',
  }))
  step('DL4-back-restores-tab', '后台切换页签写入历史，后退回到消息页并把焦点移入主内容',
    { url: afterNav, ...backState },
    queryOf(afterNav).tab === 'community' && backState.tab.includes('消息') && backState.focused === 'community-main')

  // DL5 帖子深链：直达并聚焦目标卡片
  await page.navigate(`${base}/community.html?tab=community`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.post-card')
  const postId = await page.eval(() => document.querySelector('.post-card')?.dataset.postId ?? '')
  await page.navigate(`${base}/community.html?tab=community&post=${encodeURIComponent(postId)}`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector(`[data-post-id="${postId}"]`)
  await sleep(350)
  const postLink = await page.eval(() => ({
    focused: document.activeElement?.dataset?.postId ?? '',
    tab: document.querySelector('.side-nav button[aria-current="page"]')?.innerText?.trim() ?? '',
    title: document.title,
  }))
  step('DL5-post-deep-link', '帖子深链进入社区、聚焦并定位到目标动态',
    postLink, !!postId && postLink.focused === postId && postLink.tab.includes('社区'))

  // DL5b 只带 post、不带 tab 的短链也能还原到社区
  await page.navigate(`${base}/community.html?post=${encodeURIComponent(postId)}`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector(`[data-post-id="${postId}"]`)
  await sleep(300)
  const shortLink = await page.eval(() => ({
    tab: document.querySelector('.side-nav button[aria-current="page"]')?.innerText?.trim() ?? '',
    focused: document.activeElement?.dataset?.postId ?? '',
  }))
  step('DL5b-post-only-link', '仅含 post 的短链推断为社区页并聚焦目标',
    shortLink, shortLink.tab.includes('社区') && shortLink.focused === postId)

  // DL6 失效帖子：说明原因并清理参数
  await page.navigate(`${base}/community.html?tab=community&post=missing-post-id`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForText('该链接指向的动态不存在')
  const missingPost = await page.eval(() => ({
    query: location.search,
    toast: document.querySelector('.toast-message')?.innerText?.trim() ?? '',
    community: !!document.querySelector('.feed-toolbar'),
  }))
  step('DL6-missing-post-falls-back', '失效帖子提示原因、移除 post 参数并留在社区',
    missingPost,
    !queryOf(`${base}${missingPost.query}`).post && missingPost.toast.includes('不存在') && missingPost.community)

  // DL7 非法页签：回首页并清理参数
  await page.navigate(`${base}/community.html?tab=not-a-tab`)
  await page.waitForSelector('.community-app')
  await page.waitForText('链接中的页签不存在')
  const badTab = await page.eval(() => ({
    query: location.search,
    tab: document.querySelector('.side-nav button[aria-current="page"]')?.innerText?.trim() ?? '',
    toast: document.querySelector('.toast-message')?.innerText?.trim() ?? '',
  }))
  step('DL7-invalid-tab-falls-back', '非法 tab 回首页、提示并清理参数',
    badTab, !queryOf(`${base}${badTab.query}`).tab && badTab.tab.includes('首页') && badTab.toast.includes('不存在'))

  // DL8 页签切换的屏幕阅读器播报
  await page.setMembership('member')
  await page.clickNav('消息')
  await page.waitForSelector('.messages-page')
  await sleep(200)
  const announcement = await page.eval(() => document.querySelector('.community-app > .sr-only[role="status"]')?.innerText?.trim() ?? '')
  step('DL8-route-announcement', '页签切换写入 polite 状态区，供读屏器播报',
    announcement, announcement === '已切换到消息页')

  // DL8b 页内锚点与查询串路由互不干扰
  await page.clickByText('订单留言', { selector: '.section-jump a', exact: true })
  await sleep(300)
  const anchorState = await page.eval(() => ({ hash: location.hash, query: location.search }))
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.messages-page')
  const anchorReload = await page.eval(() => ({
    tab: document.querySelector('.side-nav button[aria-current="page"]')?.innerText?.trim() ?? '',
    hash: location.hash,
  }))
  step('DL8b-anchor-keeps-route', '分区锚点只改 hash，刷新后页签仍为消息页',
    { ...anchorState, ...anchorReload },
    anchorState.hash === '#messages-orders' && queryOf(`${base}${anchorState.query}`).tab === 'messages'
      && anchorReload.tab.includes('消息') && anchorReload.hash === '#messages-orders')

  // DL9 复制链接：只含页签与帖子 id
  await page.clickNav('社区')
  await page.waitForSelector('.post-card')
  const linkedPostId = await page.eval(() => document.querySelector('.post-card')?.dataset.postId ?? '')
  const stub = await page.eval(() => {
    window.__copiedLink = ''
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { window.__copiedLink = text } },
      })
      return true
    } catch {
      return false
    }
  })
  await page.clickByText('复制链接', { selector: '.post-actions button', exact: true })
  await sleep(250)
  const copied = await page.eval(() => ({
    link: window.__copiedLink || '',
    toast: document.querySelector('.toast-message')?.innerText?.trim() ?? '',
  }))
  const copiedQuery = queryOf(copied.link)
  step('DL9-copy-post-link', '复制按钮产出可分享深链，且不带搜索与身份信息',
    { stub, link: copied.link, toast: copied.toast },
    stub && copiedQuery.tab === 'community' && copiedQuery.post === linkedPostId
      && !('q' in copiedQuery) && copied.toast.includes('已复制'))

  // DL9b 筛选写入地址（replace），列表与选中态同步
  await page.clickByText('互助求助', { selector: '.filter-row button', exact: false })
  await sleep(280)
  const filterState = await page.eval(() => ({
    query: location.search,
    selected: document.querySelector('.filter-row button[aria-selected="true"]')?.innerText?.trim() ?? '',
    kinds: Array.from(document.querySelectorAll('.post-card .post-kind')).map((node) => node.innerText.trim()),
    count: document.querySelectorAll('.post-card').length,
  }))
  step('DL9b-filter-syncs-url', '选择类型后地址带 filter，列表只剩该类型',
    filterState,
    queryOf(`${base}${filterState.query}`).filter === 'help'
      && filterState.selected.includes('互助求助') && filterState.count > 0
      && filterState.kinds.every((kind) => kind === '互助求助'))

  // DL9c 刷新还原筛选
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.feed-list')
  await sleep(280)
  const filterReload = await page.eval(() => ({
    query: location.search,
    selected: document.querySelector('.filter-row button[aria-selected="true"]')?.innerText?.trim() ?? '',
    kinds: Array.from(document.querySelectorAll('.post-card .post-kind')).map((node) => node.innerText.trim()),
  }))
  step('DL9c-filter-reload', '刷新后筛选与地址保持，列表仍是同一类型',
    filterReload,
    queryOf(`${base}${filterReload.query}`).filter === 'help'
      && filterReload.selected.includes('互助求助')
      && filterReload.kinds.length > 0 && filterReload.kinds.every((kind) => kind === '互助求助'))

  // DL9d 复制筛选视图链接：只含 tab + filter
  const viewStub = await page.eval(() => {
    window.__copiedLink = ''
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { window.__copiedLink = text } },
      })
      return true
    } catch {
      return false
    }
  })
  await page.clickByText('复制视图链接', { selector: '.copy-view-link', exact: true })
  await sleep(250)
  const viewLink = await page.eval(() => ({
    link: window.__copiedLink || '',
    toast: document.querySelector('.toast-message')?.innerText?.trim() ?? '',
    status: document.querySelector('.result-status')?.innerText?.trim() ?? '',
  }))
  const viewQuery = queryOf(viewLink.link)
  step('DL9d-copy-view-link', '复制视图链接只带 tab 与 filter，不带搜索词/身份，且不进入 live region',
    { stub: viewStub, link: viewLink.link, toast: viewLink.toast, status: viewLink.status },
    viewStub && viewQuery.tab === 'community' && viewQuery.filter === 'help'
      && !('post' in viewQuery) && !('q' in viewQuery) && !('membership' in viewQuery)
      && viewLink.toast.includes('已复制') && !viewLink.status.includes('复制'))

  // DL9e 失效筛选参数：清理地址并提示
  await page.navigate(`${base}/community.html?tab=community&filter=bogus`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForText('筛选条件不存在')
  const invalidFilter = await page.eval(() => ({
    query: location.search,
    toast: document.querySelector('.toast-message')?.innerText?.trim() ?? '',
    selected: document.querySelector('.filter-row button[aria-selected="true"]')?.innerText?.trim() ?? '',
  }))
  step('DL9e-filter-invalid', '未知 filter 被清除并提示，页面回落全部动态',
    invalidFilter,
    !queryOf(`${base}${invalidFilter.query}`).filter
      && invalidFilter.toast.includes('筛选条件不存在') && invalidFilter.selected.includes('全部动态'))

  // DL9f 只有 filter 的链接也能还原到社区页
  await page.navigate(`${base}/community.html?filter=volunteer`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.feed-list')
  await sleep(320)
  const onlyFilter = await page.eval(() => ({
    query: location.search,
    selected: document.querySelector('.filter-row button[aria-selected="true"]')?.innerText?.trim() ?? '',
    kinds: Array.from(document.querySelectorAll('.post-card .post-kind')).map((node) => node.innerText.trim()),
  }))
  step('DL9f-filter-only-link', '只有 filter 的链接补全 tab 并直达对应筛选',
    onlyFilter,
    queryOf(`${base}${onlyFilter.query}`).tab === 'community'
      && queryOf(`${base}${onlyFilter.query}`).filter === 'volunteer'
      && onlyFilter.selected.includes('志愿动态')
      && onlyFilter.kinds.length > 0 && onlyFilter.kinds.every((kind) => kind === '志愿动态'))

  // DL9g 切回全部动态会移除 filter，地址不残留旧值
  await page.navigate(`${base}/community.html?tab=community&filter=help`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.feed-list')
  await sleep(280)
  await page.clickByText('全部动态', { selector: '.filter-row button', exact: false })
  await sleep(280)
  const clearedFilter = await page.eval(() => ({
    query: location.search,
    count: document.querySelectorAll('.post-card').length,
    selected: document.querySelector('.filter-row button[aria-selected="true"]')?.innerText?.trim() ?? '',
  }))
  step('DL9g-filter-clear', '选择全部动态后地址不带 filter，列表恢复全部',
    clearedFilter,
    !queryOf(`${base}${clearedFilter.query}`).filter
      && clearedFilter.count >= 4 && clearedFilter.selected.includes('全部动态'))

  // DL10 A+ 默认地址不带 case
  await page.navigate(`${base}/`)
  await page.waitForSelector('#app')
  const aplusDefault = await page.eval(() => ({
    query: location.search,
    detail: document.querySelector('.detail-id')?.innerText?.trim() ?? '',
  }))
  step('DL10-aplus-default-clean', 'A+ 默认地址不带 case 参数', aplusDefault,
    aplusDefault.query === '' && !!aplusDefault.detail)

  // DL11 A+ 记录深链
  const caseId = await page.eval(() => {
    const target = document.querySelectorAll('.queue-item')[1] ?? document.querySelectorAll('.queue-item')[0]
    const raw = target?.querySelector('.queue-id small')?.innerText?.trim() ?? ''
    return raw.replace(/^[·\s]+/, '')
  })
  await page.navigate(`${base}/?case=${encodeURIComponent(caseId)}`)
  await page.waitForSelector('#app')
  await page.waitForText('登记队列')
  const aplusLink = await page.eval(() => ({
    selected: document.querySelector('.queue-item[aria-current="true"]')?.innerText?.trim() ?? '',
    detail: document.querySelector('.detail-id')?.innerText?.trim() ?? '',
    query: location.search,
  }))
  step('DL11-aplus-case-deep-link', '?case= 直达对应记录，队列选中态与详情一致',
    { caseId, ...aplusLink },
    !!caseId && aplusLink.selected.includes(caseId) && aplusLink.detail.includes(caseId))

  // DL11b 队列内选择同步地址，便于直接复制当前记录链接
  const secondCaseId = await page.eval(() => {
    const target = document.querySelectorAll('.queue-item')[2] ?? document.querySelectorAll('.queue-item')[1]
    const id = (target?.querySelector('.queue-id small')?.innerText ?? '').replace(/^[·\s]+/, '').trim()
    target?.click()
    return id
  })
  await sleep(300)
  const syncedCase = await page.eval(() => ({
    query: location.search,
    detail: document.querySelector('.detail-id')?.innerText?.trim() ?? '',
  }))
  step('DL11b-aplus-selection-syncs-url', '队列选择以 replace 方式同步 case 参数，详情一致',
    { secondCaseId, ...syncedCase },
    !!secondCaseId && queryOf(`${base}${syncedCase.query}`).case === secondCaseId && syncedCase.detail.includes(secondCaseId))

  // DL11c A+ 复制当前记录链接
  const aplusStub = await page.eval(() => {
    window.__copiedLink = ''
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { window.__copiedLink = text } },
      })
      return true
    } catch {
      return false
    }
  })
  await page.clickByText('复制链接', { selector: '.detail-head-side button', exact: true })
  await sleep(200)
  const aplusCopied = await page.eval(() => ({
    link: window.__copiedLink || '',
    toast: document.querySelector('.toast')?.innerText?.trim() ?? '',
  }))
  step('DL11c-aplus-copy-link', '复制当前记录链接，只含 case 参数',
    { aplusStub, ...aplusCopied },
    aplusStub && queryOf(aplusCopied.link).case === secondCaseId && aplusCopied.toast.includes('已复制'))
  await page.screenshot(join(evidenceDir, 'aplus-case-link-1440.png'))

  // DL12 A+ 失效记录
  await page.navigate(`${base}/?case=missing-case-id`)
  await page.waitForSelector('#app')
  await page.waitForText('链接中的演练记录不存在')
  const aplusMissing = await page.eval(() => ({
    query: location.search,
    detail: document.querySelector('.detail-id')?.innerText?.trim() ?? '',
    toast: document.querySelector('.toast')?.innerText?.trim() ?? '',
  }))
  step('DL12-aplus-missing-case', '失效 case 提示并回落到队列首条，参数被清理',
    aplusMissing, !queryOf(`${base}${aplusMissing.query}`).case && !!aplusMissing.detail && aplusMissing.toast.includes('不存在'))

  // DL13 五档宽度：深链页面无横向溢出
  for (const size of [
    { width: 320, height: 844, mobile: true },
    { width: 390, height: 844, mobile: true },
    { width: 720, height: 900, mobile: true },
    { width: 1024, height: 900, mobile: false },
    { width: 1440, height: 1000, mobile: false },
  ]) {
    await page.client.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1 })
    await sleep(120)
    const overflow = await page.eval(() => ({
      innerWidth,
      documentScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
    }))
    step(`DL13-width-${size.width}`, '深链页面在目标宽度无横向溢出', overflow,
      overflow.documentScroll <= size.width + 1 && overflow.bodyScroll <= size.width + 1)
  }
  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await sleep(120)

  // DL13b 320px 下新增的复制链接不能撑破帖子操作区
  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true })
  await page.navigate(`${base}/community.html?tab=community&post=${encodeURIComponent(postId)}`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.post-card .post-actions')
  await sleep(200)
  const narrowActions = await page.eval(() => ({
    scroll: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
    buttons: Array.from(document.querySelectorAll('.post-card .post-actions button'))
      .map((node) => Math.round(node.getBoundingClientRect().right)),
  }))
  step('DL13b-320-post-actions', '320px 下帖子操作区与复制按钮不产生横向溢出',
    narrowActions,
    narrowActions.scroll <= 321 && narrowActions.bodyScroll <= 321
      && narrowActions.buttons.length > 0 && narrowActions.buttons.every((right) => right <= 321))
  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await sleep(120)
  await page.screenshot(join(evidenceDir, 'community-post-link-1440.png'))

  // DL14 运行期错误
  const errors = {
    page: page.pageErrors.slice(),
    console: page.consoleErrors.filter((line) => line.startsWith('error:')),
  }
  step('DL14-no-runtime-errors', '深链与后退流程不产生页面异常或控制台错误', errors,
    errors.page.length === 0 && errors.console.length === 0)
})

await writeFile(join(evidenceDir, 'deep-links-run-record.json'), JSON.stringify({ base, steps, failures }, null, 2))
console.log(`Deep link regression: ${steps.length - failures}/${steps.length} passed.`)
if (failures) process.exitCode = 1
