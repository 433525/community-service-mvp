// UI hardening verification: section nav, roving tabs, dialog contract, switches,
// aria-current, live regions, error toast, 320px reflow and confirm dialog.
// Run: node tools/check-ui-hardening.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-ui-hardening')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `hardening-${name}.png`)
  await page.screenshot(file)
  return file
}
async function clickText(page, selector, label) {
  const ok = await page.eval((sel, text) => {
    const node = Array.from(document.querySelectorAll(sel)).find((item) => (item.innerText || '').includes(text))
    if (!node) return false
    node.click()
    return true
  }, selector, label)
  if (!ok) throw new Error(`clickText(${selector}, ${label}) failed`)
}

await mkdir(evidenceDir, { recursive: true })

await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  const goTab = async (label) => {
    await clickText(page, '.side-nav button', label)
    await sleep(350)
  }

  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.setMembership('member')

  // H1: messages section nav + anchors + sticky position
  await goTab('消息')
  const messagesNav = await page.eval(() => {
    const nav = document.querySelector('.section-jump')
    const links = nav ? Array.from(nav.querySelectorAll('a')) : []
    return {
      count: links.length,
      missing: links.map((a) => a.getAttribute('href')).filter((href) => !href || !document.querySelector(href)),
      navRest: !!nav && getComputedStyle(nav).position === 'sticky',
    }
  })
  await page.eval(() => window.scrollTo(0, 900))
  await sleep(250)
  const messagesSticky = await page.eval(() => {
    const nav = document.querySelector('.section-jump')
    return nav ? Math.round(nav.getBoundingClientRect().top) : -1
  })
  step('H1', '消息页分区导航', '4 个锚点全部命中、sticky 生效且滚动后停在顶栏下方',
    `links=${messagesNav.count} missing=${JSON.stringify(messagesNav.missing)} sticky=${messagesNav.navRest} top=${messagesSticky}`,
    messagesNav.count === 4 && messagesNav.missing.length === 0 && messagesNav.navRest && messagesSticky === 68,
    await shot(page, 'h1-messages-nav'))
  await page.eval(() => window.scrollTo(0, 0))

  // H2: moderation section nav
  await page.setMembership('reviewer')
  await goTab('审核')
  const moderationNav = await page.eval(() => {
    const nav = document.querySelector('.section-jump')
    const links = nav ? Array.from(nav.querySelectorAll('a')) : []
    return {
      count: links.length,
      missing: links.map((a) => a.getAttribute('href')).filter((href) => !href || !document.querySelector(href)),
    }
  })
  step('H2', '审核页分区导航', '6 个锚点全部命中',
    `links=${moderationNav.count} missing=${JSON.stringify(moderationNav.missing)}`,
    moderationNav.count === 6 && moderationNav.missing.length === 0,
    await shot(page, 'h2-moderation-nav'))

  // H3: roving tabindex + arrow keys on a filter tablist
  await page.setMembership('member')
  await goTab('社区')
  const tabs = await page.eval(() => {
    const list = document.querySelector('.feed-toolbar [role="tablist"]')
    const items = list ? Array.from(list.querySelectorAll('[role="tab"]')) : []
    items[0]?.focus()
    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    return {
      count: items.length,
      selected: items.filter((item) => item.getAttribute('aria-selected') === 'true').map((item) => item.innerText.trim()),
      tabindex: items.map((item) => item.tabIndex),
      focused: document.activeElement?.innerText?.trim() ?? '',
    }
  })
  await sleep(250)
  const filterResult = await page.eval(() => ({
    selected: Array.from(document.querySelectorAll('.feed-toolbar [role="tab"][aria-selected="true"]')).map((item) => item.innerText.trim()),
    status: document.querySelector('.result-status')?.innerText ?? '',
  }))
  step('H3', '筛选组方向键切换', '→ 后选中第二项、焦点跟随、结果区播报更新',
    `count=${tabs.count} selected=${JSON.stringify(filterResult.selected)} focus=${tabs.focused} status=${filterResult.status}`,
    tabs.count >= 2 && filterResult.selected.length === 1 && filterResult.selected[0].includes('互助求助')
      && tabs.focused.includes('互助求助') && /当前显示 \d+ 条动态/.test(filterResult.status),
    await shot(page, 'h3-tabs-keyboard'))

  // H4: help dialog describedby + Esc focus return
  await goTab('首页')
  await page.eval(() => document.querySelector('.help-toggle')?.focus())
  await page.eval(() => document.querySelector('.help-toggle')?.click())
  await sleep(350)
  const dialogContract = await page.eval(() => {
    const dialog = document.querySelector('.help-dialog')
    const described = dialog?.getAttribute('aria-describedby') ?? ''
    const target = described ? document.getElementById(described) : null
    return {
      open: !!dialog,
      described,
      targetText: target?.innerText?.trim().slice(0, 20) ?? '',
      focusText: document.activeElement?.innerText?.trim() ?? '',
    }
  })
  await page.eval(() => document.querySelector('.help-dialog')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await sleep(250)
  const dialogState = await page.eval(() => ({
    open: !!document.querySelector('.help-dialog'),
    focusReturned: document.activeElement?.classList?.contains('help-toggle') ?? false,
  }))
  step('H4', '使用说明弹层契约', '有 aria-describedby、初始焦点在“我知道了”；Esc 关闭并归还焦点',
    `open=${dialogContract.open} described=${dialogContract.described} target=${JSON.stringify(dialogContract.targetText)} initial=${JSON.stringify(dialogContract.focusText)} closed=${!dialogState.open} focusBack=${dialogState.focusReturned}`,
    dialogContract.open && !!dialogContract.targetText && dialogContract.focusText.includes('我知道了') && !dialogState.open && dialogState.focusReturned,
    await shot(page, 'h4-dialog-contract'))

  // H5: publish switches expose role/aria-checked and toggle
  await goTab('发布')
  await clickText(page, '.mode-options button', '志愿发布')
  await sleep(250)
  const switchBefore = await page.eval(() => {
    const input = document.querySelector('.toggle-list input[role="switch"]')
    return input ? { count: document.querySelectorAll('.toggle-list input[role="switch"]').length, checked: input.getAttribute('aria-checked') } : null
  })
  await page.eval(() => document.querySelector('.toggle-list input[role="switch"]')?.click())
  await sleep(200)
  const switchAfter = await page.eval(() => document.querySelector('.toggle-list input[role="switch"]')?.getAttribute('aria-checked') ?? '')
  step('H5', '发布开关语义与状态', '两个 role=switch，点击后 aria-checked 翻转',
    `count=${switchBefore?.count} before=${switchBefore?.checked} after=${switchAfter}`,
    switchBefore?.count === 2 && switchAfter !== switchBefore?.checked,
    await shot(page, 'h5-switches'))

  // H6: active navigation exposes aria-current
  const current = await page.eval(() => ({
    current: Array.from(document.querySelectorAll('.side-nav button[aria-current="page"]')).map((item) => item.innerText.trim()),
    total: document.querySelectorAll('.side-nav button').length,
  }))
  step('H6', '当前导航可感知', '仅发布项 aria-current=page',
    `current=${JSON.stringify(current.current)} total=${current.total}`,
    current.current.length === 1 && current.current[0].includes('发布'),
    await shot(page, 'h6-aria-current'))

  // H7: error event surfaces as a toast instead of a white screen
  await page.eval(() => window.dispatchEvent(new CustomEvent('app:error', { detail: { message: '界面异常兜底提示（测试）' } })))
  await sleep(250)
  const toast = await page.eval(() => {
    const node = document.querySelector('.toast-message')
    return node ? { text: node.innerText.trim(), role: node.getAttribute('role') } : null
  })
  step('H7', '全局异常兜底提示', '错误事件转为可见 toast',
    `toast=${JSON.stringify(toast?.text)} role=${toast?.role}`,
    !!toast && toast.text.includes('界面异常兜底提示'),
    await shot(page, 'h7-error-toast'))
})

// H8: 320px reflow (both entries) and confirm dialog contract (mobile)
await withBrowser({ windowSize: { width: 320, height: 720 } }, async (page) => {
  const widths = {}
  for (const name of ['index', 'community']) {
    await page.navigate(`${base}/${name}.html`)
    await page.clearLocalStorage()
    await page.reload()
    if (name === 'community') await page.setMembership('member')
    await sleep(400)
    widths[name] = await page.eval(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }))
  }
  step('H8', '320px 最小宽度回流', '两个入口 scrollWidth 均等于视口宽度',
    JSON.stringify(widths),
    widths.index.scroll <= widths.index.inner && widths.community.scroll <= widths.community.inner,
    await shot(page, 'h8-320-index'))

  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await clickText(page, '.mobile-nav button', '我的')
  await sleep(400)
  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('button')).find((item) => (item.innerText || '').includes('重置演练数据'))
    node?.focus()
    node?.click()
  })
  await sleep(350)
  const confirmOpen = await page.eval(() => {
    const dialog = document.querySelector('.confirm-card')
    return dialog ? {
      role: dialog.getAttribute('role'),
      modal: dialog.getAttribute('aria-modal'),
      inside: dialog.contains(document.activeElement),
      title: dialog.querySelector('h2')?.innerText ?? '',
    } : null
  })
  await page.eval(() => document.querySelector('.confirm-card')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await sleep(300)
  const confirmClosed = await page.eval(() => ({
    open: !!document.querySelector('.confirm-card'),
    focusText: document.activeElement?.innerText?.trim() ?? '',
  }))
  step('H9', '危险操作确认弹层', 'role=dialog/aria-modal、焦点进入、Esc 关闭并归还焦点',
    `open=${!!confirmOpen} role=${confirmOpen?.role} modal=${confirmOpen?.modal} inside=${confirmOpen?.inside} closed=${!confirmClosed.open} focus=${JSON.stringify(confirmClosed.focusText)}`,
    !!confirmOpen && confirmOpen.role === 'dialog' && confirmOpen.modal === 'true' && confirmOpen.inside
      && !confirmClosed.open && confirmClosed.focusText.includes('重置演练数据'),
    await shot(page, 'h9-confirm-dialog'))

  // H10: mobile master-detail jump and back
  await page.navigate(`${base}/`)
  await page.waitForSelector('.queue-item')
  await page.eval(() => document.querySelectorAll('.queue-item')[2]?.click())
  await sleep(900)
  const jump = await page.eval(() => ({
    active: document.activeElement?.classList?.contains('detail-panel') ?? false,
    top: Math.round(document.querySelector('.detail-panel').getBoundingClientRect().top),
    backVisible: !!document.querySelector('.detail-back') && getComputedStyle(document.querySelector('.detail-back')).display !== 'none',
  }))
  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('button')).find((item) => (item.innerText || '').includes('返回队列'))
    node?.click()
  })
  await sleep(900)
  const backState = await page.eval(() => ({
    focusedQueue: document.activeElement?.classList?.contains('queue-item') ?? false,
    queueTop: Math.round(document.querySelector('.queue-panel').getBoundingClientRect().top),
  }))
  step('H10', '移动端队列↔详情跳转', '选中后详情进入视口并聚焦；返回后队列进入视口且焦点回到选中项',
    `detailFocus=${jump.active} detailTop=${jump.top} backVisible=${jump.backVisible} queueFocus=${backState.focusedQueue} queueTop=${backState.queueTop}`,
    jump.active && jump.top <= 80 && jump.backVisible && backState.focusedQueue && backState.queueTop <= 80,
    await shot(page, 'h10-master-detail'))
})

// H11 / H12: desktop sticky queue panel + per-tab document title
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/`)
  await page.waitForSelector('.queue-item')
  await sleep(400)
  const queueBefore = await page.eval(() => {
    const panel = document.querySelector('.queue-panel')
    return {
      top: Math.round(panel.getBoundingClientRect().top),
      position: getComputedStyle(panel).position,
      scrollable: panel.scrollHeight > panel.clientHeight,
      pageHeight: document.documentElement.scrollHeight,
    }
  })
  await page.eval(() => window.scrollTo(0, 600))
  await sleep(400)
  const stickyState = await page.eval(() => {
    const panel = document.querySelector('.queue-panel')
    const detail = document.querySelector('.detail-panel')
    const rect = panel.getBoundingClientRect()
    const overflows = panel.scrollHeight > panel.clientHeight + 1
    return {
      top: Math.round(rect.top),
      height: Math.round(rect.height),
      heightCap: innerHeight - 32,
      cappedByViewport: Math.round(rect.height) <= innerHeight - 32 + 1,
      bottomInView: Math.round(rect.bottom) <= innerHeight,
      // 内容未超过高度上限时不出现内部滚动是正确的，只在溢出时要求 overflow-y 可滚。
      overflows,
      innerOverflow: getComputedStyle(panel).overflowY,
      overflowOk: !overflows || ['auto', 'scroll'].includes(getComputedStyle(panel).overflowY),
      detailTop: detail ? Math.round(detail.getBoundingClientRect().top) : null,
      scrollY: Math.round(scrollY),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: innerWidth,
    }
  })
  step('H11', '桌面端队列吸顶', '1440×1000 滚动 600 后队列面板 position=sticky、top 停在 12–24 之间；溢出时才要求在面板内滚动；详情随页面滚动；无横向溢出',
    `before=${queueBefore.top}/${queueBefore.position} scrollY=${stickyState.scrollY} top=${stickyState.top} h=${stickyState.height}<=${stickyState.heightCap} overflowY=${stickyState.innerOverflow} overflows=${stickyState.overflows} detailTop=${stickyState.detailTop} scrollWidth=${stickyState.scrollWidth}/${stickyState.innerWidth}`,
    queueBefore.position === 'sticky' && stickyState.scrollY === 600
      && stickyState.top >= 12 && stickyState.top <= 24
      && stickyState.cappedByViewport && stickyState.bottomInView && stickyState.overflowOk
      && typeof stickyState.detailTop === 'number' && stickyState.detailTop < queueBefore.top
      && stickyState.scrollWidth <= stickyState.innerWidth,
    await shot(page, 'h11-sticky-queue'))

  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  const titleHome = await page.eval(() => document.title)
  await clickText(page, '.side-nav button', '消息')
  await sleep(400)
  const titleState = await page.eval(() => ({
    title: document.title,
    breadcrumb: document.querySelector('.breadcrumb')?.innerText?.trim() ?? '',
  }))
  step('H12', '页签标题随页面变化', '点击「消息」后 document.title 同时包含页签名与演练版名称',
    `home=${JSON.stringify(titleHome)} messages=${JSON.stringify(titleState.title)} crumb=${JSON.stringify(titleState.breadcrumb)}`,
    titleState.title.includes('消息') && titleState.title.includes('社区服务演练版')
      && titleState.title !== titleHome,
    await shot(page, 'h12-document-title'))

  // H13: complaint queue shortcut in the A+ page header
  await page.navigate(`${base}/`)
  await page.waitForSelector('.complaint-panel')
  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('.heading-actions button')).find((item) => (item.innerText || '').includes('投诉复核'))
    node?.click()
  })
  await sleep(900)
  const complaintJump = await page.eval(() => ({
    scrolled: Math.round(scrollY),
    top: Math.round(document.querySelector('.complaint-panel').getBoundingClientRect().top),
    focused: document.activeElement?.classList?.contains('complaint-panel') ?? false,
    actions: document.querySelectorAll('.heading-actions button').length,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }))
  step('H13', '投诉复核队列直达', '页头入口可跳到页面底部投诉队列、面板聚焦且可见、无横向溢出',
    `y=${complaintJump.scrolled} top=${complaintJump.top} focused=${complaintJump.focused} actions=${complaintJump.actions} overflow=${complaintJump.overflow}`,
    complaintJump.scrolled > 0 && complaintJump.top >= 0 && complaintJump.top <= 420
      && complaintJump.focused && complaintJump.actions >= 3 && complaintJump.overflow <= 0,
    await shot(page, 'h13-complaint-jump'))
})

// H14: large-reading mode must lift the sticky section nav by the taller topbar
await withBrowser({ windowSize: { width: 390, height: 844 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.setMembership('member')
  await page.clickSelector('.reading-toggle')
  await sleep(350)
  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('.mobile-nav button')).find((item) => (item.innerText || '').includes('消息'))
    node?.click()
  })
  await sleep(400)
  await page.eval(() => window.scrollTo(0, 700))
  await sleep(350)
  const largeNav = await page.eval(() => {
    const topbar = document.querySelector('.topbar').getBoundingClientRect()
    const nav = document.querySelector('.section-jump').getBoundingClientRect()
    return {
      topbarBottom: Math.round(topbar.bottom),
      navTop: Math.round(nav.top),
      overlap: Math.round(topbar.bottom - nav.top),
      large: document.querySelector('.community-app')?.classList.contains('reading-large') ?? false,
    }
  })
  step('H14', '大字模式分区导航不压顶栏', '390px 大字模式下吸顶导航顶边不低于顶栏底边',
    `large=${largeNav.large} topbarBottom=${largeNav.topbarBottom} navTop=${largeNav.navTop} overlap=${largeNav.overlap}`,
    largeNav.large && largeNav.navTop >= largeNav.topbarBottom && largeNav.overlap <= 0,
    await shot(page, 'h14-large-nav'))
})

// H15: A+ help dialog contract
await withBrowser({ windowSize: { width: 390, height: 844 } }, async (page) => {
  await page.navigate(`${base}/`)
  await page.waitForSelector('.topbar .icon-button')
  await page.eval(() => document.querySelector('.topbar .icon-button')?.focus())
  await page.eval(() => document.querySelector('.topbar .icon-button')?.click())
  await sleep(400)
  const helpOpen = await page.eval(() => {
    const dialog = document.querySelector('.help-modal')
    const described = dialog?.getAttribute('aria-describedby') ?? ''
    return {
      open: !!dialog,
      sections: dialog?.querySelectorAll('.help-section').length ?? 0,
      described: !!document.getElementById(described),
      focusText: document.activeElement?.innerText?.trim() ?? '',
      inert: document.querySelector('.main-area')?.inert === true,
      overflow: document.documentElement.scrollWidth - innerWidth,
    }
  })
  await page.eval(() => document.querySelector('.help-modal')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await sleep(300)
  const helpClosed = await page.eval(() => ({
    open: !!document.querySelector('.help-modal'),
    focusBack: document.activeElement?.getAttribute('aria-label') === '打开使用说明',
  }))
  step('H15', 'A+ 使用说明弹层', '6 个说明分区、描述关联有效、焦点落在“知道了”、背景 inert、Esc 关闭并归还焦点',
    `open=${helpOpen.open} sections=${helpOpen.sections} desc=${helpOpen.described} focus=${JSON.stringify(helpOpen.focusText)} inert=${helpOpen.inert} closed=${!helpClosed.open} focusBack=${helpClosed.focusBack} overflow=${helpOpen.overflow}`,
    helpOpen.open && helpOpen.sections === 6 && helpOpen.described && helpOpen.focusText.includes('知道了')
      && helpOpen.inert && !helpClosed.open && helpClosed.focusBack && helpOpen.overflow <= 0,
    await shot(page, 'h15-aplus-help'))
})

// H16/H17: cross-entry links and the messages empty-state action
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/`)
  await sleep(300)
  const aplusLink = await page.eval(() => ({
    rail: document.querySelectorAll('.side-rail a[href="/community.html"]').length,
    mobile: document.querySelectorAll('.mobile-nav a[href="/community.html"]').length,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }))
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.setMembership('member')
  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('.side-nav button')).find((item) => (item.innerText || '').includes('我的'))
    node?.click()
  })
  await sleep(400)
  const communityLinks = await page.eval(() => ({
    sidebar: document.querySelectorAll('.sidebar-entry[href="/"]').length,
    profile: document.querySelectorAll('.profile-workspace-link[href="/"]').length,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }))
  step('H16', '双入口互链', 'A+ 侧栏与移动底栏可到社区，社区侧栏与“我的”可到工作台，无横向溢出',
    `aplusRail=${aplusLink.rail} aplusMobile=${aplusLink.mobile} bSidebar=${communityLinks.sidebar} bProfile=${communityLinks.profile}`,
    aplusLink.rail >= 1 && aplusLink.mobile >= 1 && communityLinks.sidebar >= 1 && communityLinks.profile >= 1
      && aplusLink.overflow <= 0 && communityLinks.overflow <= 0,
    await shot(page, 'h16-cross-entry'))

  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('.side-nav button')).find((item) => (item.innerText || '').includes('消息'))
    node?.click()
  })
  await sleep(350)
  const emptyAction = await page.eval(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => (item.innerText || '').includes('去看待接单求助'))
    if (!button) return { found: false }
    button.click()
    return { found: true }
  })
  await sleep(500)
  const browseState = await page.eval(() => ({
    note: document.querySelector('.open-help-note')?.innerText?.trim() ?? '',
    crumb: document.querySelector('.breadcrumb')?.innerText?.trim() ?? '',
    cards: document.querySelectorAll('.post-card').length,
  }))
  step('H17', '消息空态可行动', '无订单时可一键切到“只显示待接单求助”的社区视图',
    `found=${emptyAction.found} crumb=${JSON.stringify(browseState.crumb)} note=${JSON.stringify(browseState.note.slice(0, 12))} cards=${browseState.cards}`,
    emptyAction.found && browseState.crumb.includes('社区') && browseState.note.includes('只显示尚未接单的求助')
      && browseState.cards >= 1,
    await shot(page, 'h17-messages-empty-action'))

  // H18: A+ queue empty-state recovery
  await page.navigate(`${base}/`)
  await page.waitForSelector('.queue-item')
  await page.setValue('.search-wrap input', 'zzzz-no-match')
  await sleep(350)
  const queueEmpty = await page.eval(() => ({
    empty: !!document.querySelector('.empty-state'),
    hasReset: Array.from(document.querySelectorAll('.empty-state button')).some((item) => (item.innerText || '').includes('清除筛选')),
  }))
  await clickText(page, '.empty-state button', '清除筛选')
  await sleep(300)
  const queueRecovered = await page.eval(() => ({
    items: document.querySelectorAll('.queue-item').length,
    search: document.querySelector('.search-wrap input')?.value ?? '',
  }))
  step('H18', 'A+ 队列空态恢复', '无匹配时提供“清除筛选”，点击后队列恢复且搜索清空',
    `empty=${queueEmpty.empty} reset=${queueEmpty.hasReset} items=${queueRecovered.items} search=${JSON.stringify(queueRecovered.search)}`,
    queueEmpty.empty && queueEmpty.hasReset && queueRecovered.items > 0 && queueRecovered.search === '',
    await shot(page, 'h18-queue-empty-recovery'))

  // H19: community empty-state recovery
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.setMembership('member')
  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('.side-nav button')).find((item) => (item.innerText || '').includes('社区'))
    node?.click()
  })
  await sleep(350)
  await page.setValue('.feed-toolbar .search-box input', 'zzzz-no-match')
  await sleep(350)
  const feedEmpty = await page.eval(() => ({
    empty: !!document.querySelector('.empty-state'),
    hasReset: Array.from(document.querySelectorAll('.empty-state button')).some((item) => (item.innerText || '').includes('显示全部动态')),
  }))
  await clickText(page, '.empty-state button', '显示全部动态')
  await sleep(300)
  const feedRecovered = await page.eval(() => ({
    cards: document.querySelectorAll('.post-card').length,
    selected: document.querySelector('.feed-toolbar [role="tab"][aria-selected="true"]')?.innerText?.trim() ?? '',
    search: document.querySelector('.feed-toolbar .search-box input')?.value ?? '',
  }))
  step('H19', '社区空态恢复', '搜索无结果时提供“显示全部动态”，点击后恢复列表与默认筛选',
    `empty=${feedEmpty.empty} reset=${feedEmpty.hasReset} cards=${feedRecovered.cards} selected=${JSON.stringify(feedRecovered.selected)} search=${JSON.stringify(feedRecovered.search)}`,
    feedEmpty.empty && feedEmpty.hasReset && feedRecovered.cards > 0
      && feedRecovered.selected.includes('全部动态') && feedRecovered.search === '',
    await shot(page, 'h19-community-empty-recovery'))

  // H20: section navigation highlights the section in view
  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('.side-nav button')).find((item) => (item.innerText || '').includes('消息'))
    node?.click()
  })
  await sleep(400)
  await page.eval(() => document.getElementById('messages-reports')?.scrollIntoView())
  await sleep(1000)
  const messageActive = await page.eval(() => {
    const items = Array.from(document.querySelectorAll('.section-jump a'))
    const active = items.filter((item) => item.classList.contains('active'))
    return { count: active.length, text: active[0]?.innerText?.trim() ?? '', current: active[0]?.getAttribute('aria-current') ?? '' }
  })
  await page.setMembership('reviewer')
  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('.side-nav button')).find((item) => (item.innerText || '').includes('审核'))
    node?.click()
  })
  await sleep(500)
  await page.eval(() => document.getElementById('moderation-audit')?.scrollIntoView())
  await sleep(1000)
  const moderationActive = await page.eval(() => {
    const items = Array.from(document.querySelectorAll('.section-jump a'))
    const active = items.filter((item) => item.classList.contains('active'))
    return { count: active.length, text: active[0]?.innerText?.trim() ?? '', current: active[0]?.getAttribute('aria-current') ?? '' }
  })
  step('H20', '分区导航滚动高亮', '滚到“我的举报”与“审核日志”时对应 chip 高亮且 aria-current=true',
    `msg=${JSON.stringify(messageActive.text)}/${messageActive.current} mod=${JSON.stringify(moderationActive.text)}/${moderationActive.current}`,
    messageActive.count === 1 && messageActive.text.includes('我的举报') && messageActive.current === 'true'
      && moderationActive.count === 1 && moderationActive.text.includes('审核日志') && moderationActive.current === 'true',
    await shot(page, 'h20-section-spy'))

  // H21: queue panel header stays pinned when the panel scrolls internally
  await page.navigate(`${base}/`)
  await page.waitForSelector('.queue-panel')
  const queueSticky = await page.eval(async () => {
    const panel = document.querySelector('.queue-panel')
    const original = panel.style.maxHeight
    panel.style.maxHeight = '320px'
    panel.scrollTop = 240
    await new Promise((resolve) => setTimeout(resolve, 250))
    const p = panel.getBoundingClientRect()
    const head = document.querySelector('.panel-head').getBoundingClientRect()
    const filters = document.querySelector('.filters').getBoundingClientRect()
    const state = {
      panelTop: Math.round(p.top),
      headTop: Math.round(head.top),
      filterTop: Math.round(filters.top),
      scrollTop: panel.scrollTop,
    }
    panel.style.maxHeight = original
    panel.scrollTop = 0
    return state
  })
  step('H21', '队列面板头吸顶', '面板内滚动 240 后标题/搜索仍在面板顶部，筛选条紧随其后',
    `panelTop=${queueSticky.panelTop} headTop=${queueSticky.headTop} filterTop=${queueSticky.filterTop} scrollTop=${queueSticky.scrollTop}`,
    queueSticky.scrollTop >= 200 && Math.abs(queueSticky.headTop - queueSticky.panelTop) <= 3
      && queueSticky.filterTop > queueSticky.headTop,
    await shot(page, 'h21-queue-sticky-head'))

  // H22: home search result opens the specific post (not just a filtered feed)
  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await sleep(300)
  await page.setValue('.home-search-form input', '共享书架')
  await sleep(350)
  const homeResult = await page.eval(() => ({
    count: document.querySelectorAll('.home-search-result').length,
    title: document.querySelector('.home-search-result strong')?.innerText ?? '',
  }))
  await page.eval(() => document.querySelector('.home-search-result')?.click())
  await sleep(900)
  const postFocus = await page.eval(() => ({
    crumb: document.querySelector('.breadcrumb')?.innerText?.trim() ?? '',
    activeClass: document.activeElement?.className?.toString?.() ?? '',
    highlightId: document.querySelector('.post-jump-highlight')?.getAttribute('data-post-id') ?? '',
    query: document.querySelector('.feed-toolbar .search-box input')?.value ?? '',
  }))
  step('H22', '首页搜索结果直达帖子', '点击结果进入社区、聚焦并高亮对应帖子、清空社区搜索',
    `results=${homeResult.count} title=${JSON.stringify(homeResult.title)} crumb=${JSON.stringify(postFocus.crumb)} active=${JSON.stringify(postFocus.activeClass)} id=${postFocus.highlightId} query=${JSON.stringify(postFocus.query)}`,
    homeResult.count >= 1 && postFocus.crumb.includes('社区')
      && postFocus.activeClass.includes('post-card') && postFocus.activeClass.includes('post-jump-highlight')
      && !!postFocus.highlightId && postFocus.query === '',
    await shot(page, 'h22-home-search-post'))

  // H23: switching tabs resets the page scroll
  const goTabAt = async (label) => {
    await page.eval((text) => {
      const node = Array.from(document.querySelectorAll('.side-nav button')).find((item) => (item.innerText || '').includes(text))
      node?.click()
    }, label)
    await sleep(350)
  }
  await goTabAt('社区')
  await page.eval(() => window.scrollTo(0, 900))
  await sleep(250)
  const scrollBefore = await page.eval(() => Math.round(scrollY))
  await goTabAt('我的')
  const profileScroll = await page.eval(() => Math.round(scrollY))
  await page.eval(() => window.scrollTo(0, 600))
  await sleep(250)
  await goTabAt('首页')
  const homeScroll = await page.eval(() => Math.round(scrollY))
  step('H23', '切换页签回到顶部', '从社区深滚动切到“我的”“首页”后 scrollY 归零',
    `before=${scrollBefore} profile=${profileScroll} home=${homeScroll}`,
    scrollBefore >= 800 && profileScroll === 0 && homeScroll === 0,
    await shot(page, 'h23-tab-scroll'))

  // H24: heavy tabs are fetched on demand, not with the first screen
  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await sleep(400)
  const chunksBefore = await page.eval(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => /(ModerationView|ProfileView|MessagesView|PublishView)-/.test(name)))
  await page.setMembership('reviewer')
  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('.side-nav button')).find((item) => (item.innerText || '').includes('审核'))
    node?.click()
  })
  await sleep(700)
  const chunksAfter = await page.eval(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => /(ModerationView|ProfileView|MessagesView|PublishView)-/.test(name)))
  step('H24', '页签级按需加载', '首屏不请求重页签分块，进入审核后才请求 ModerationView',
    `before=${chunksBefore.length} after=${chunksAfter.length} names=${JSON.stringify(chunksAfter.map((name) => name.split('/').pop()))}`,
    chunksBefore.length === 0 && chunksAfter.some((name) => name.includes('ModerationView')),
    await shot(page, 'h24-lazy-views'))

  // H25: print layout outputs only the case record
  await page.navigate(`${base}/`)
  await page.waitForSelector('.detail-panel')
  await sleep(350)
  await page.client.send('Emulation.setEmulatedMedia', { media: 'print', features: [] })
  await sleep(400)
  const printState = await page.eval(() => {
    const display = (selector) => {
      const element = document.querySelector(selector)
      return element ? getComputedStyle(element).display : 'missing'
    }
    const button = document.querySelector('.detail-content button')
    return {
      queue: display('.queue-panel'),
      topbar: display('.topbar'),
      header: display('.print-header'),
      detail: display('.detail-panel'),
      actions: display('.detail-actions'),
      button: button ? getComputedStyle(button).display : 'none',
    }
  })
  const pdf = await page.client.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
  const pdfBuffer = Buffer.from(pdf.data, 'base64')
  const pdfPath = join(evidenceDir, 'aplus-case-print.pdf')
  await writeFile(pdfPath, pdfBuffer)
  await page.client.send('Emulation.setEmulatedMedia', { media: 'screen', features: [] })
  await sleep(250)
  step('H25', 'A+ 打印版式', '打印时隐藏队列/顶栏/操作按钮，只保留记录详情与打印抬头，并生成 PDF',
    `queue=${printState.queue} topbar=${printState.topbar} header=${printState.header} detail=${printState.detail} actions=${printState.actions} button=${printState.button} pdf=${pdfBuffer.length}B`,
    printState.queue === 'none' && printState.topbar === 'none' && printState.header === 'flex'
      && printState.detail === 'block' && printState.actions === 'none' && printState.button === 'none'
      && pdfBuffer.length > 10000,
    pdfPath)

  // H26: forced-colors keeps borders and active states
  await page.navigate(`${base}/community.html`)
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.client.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'forced-colors', value: 'active' }] })
  await sleep(400)
  const forcedState = await page.eval(() => {
    const card = document.querySelector('.post-card')
    const active = document.querySelector('.nav-item.active')
    return {
      matches: matchMedia('(forced-colors: active)').matches,
      cardBorder: card ? `${getComputedStyle(card).borderTopWidth} ${getComputedStyle(card).borderTopStyle}` : 'none',
      activeOutline: active ? `${getComputedStyle(active).outlineStyle} ${getComputedStyle(active).outlineWidth}` : 'none',
    }
  })
  await page.screenshot(join(evidenceDir, 'hardening-h26-forced-colors.png'))
  await page.client.send('Emulation.setEmulatedMedia', { media: 'screen', features: [] })
  step('H26', '强制配色可用', 'forced-colors 生效时卡片仍有边框、当前导航仍有轮廓',
    `match=${forcedState.matches} card=${forcedState.cardBorder} active=${forcedState.activeOutline}`,
    forcedState.matches && forcedState.cardBorder.includes('solid') && forcedState.activeOutline.includes('solid'),
    join(evidenceDir, 'hardening-h26-forced-colors.png'))

  // H27: safety dialog uses the same initial-focus contract
  await page.setMembership('member')
  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('.side-nav button')).find((item) => (item.innerText || '').includes('首页'))
    node?.click()
  })
  await sleep(400)
  await page.eval(() => {
    const node = Array.from(document.querySelectorAll('button')).find((item) => (item.innerText || '').includes('查看说明'))
    node?.focus()
    node?.click()
  })
  await sleep(350)
  const safetyOpen = await page.eval(() => {
    const dialog = document.querySelector('[aria-labelledby="safety-title"]')
    const described = dialog?.getAttribute('aria-describedby') ?? ''
    return {
      open: !!dialog,
      described: !!document.getElementById(described),
      focusText: document.activeElement?.innerText?.trim() ?? '',
    }
  })
  await page.eval(() => document.querySelector('[aria-labelledby="safety-title"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await sleep(300)
  const safetyClosed = await page.eval(() => ({
    open: !!document.querySelector('[aria-labelledby="safety-title"]'),
    focusBack: (document.activeElement?.innerText || '').includes('查看说明'),
  }))
  step('H27', '安全说明弹层焦点', '初始焦点在“我知道了”、描述关联有效、Esc 关闭并归还“查看说明”',
    `open=${safetyOpen.open} desc=${safetyOpen.described} focus=${JSON.stringify(safetyOpen.focusText)} closed=${!safetyClosed.open} back=${safetyClosed.focusBack}`,
    safetyOpen.open && safetyOpen.described && safetyOpen.focusText.includes('我知道了')
      && !safetyClosed.open && safetyClosed.focusBack,
    await shot(page, 'h27-safety-focus'))
})

await writeFile(join(evidenceDir, 'ui-hardening-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures }, null, 2), 'utf8')
console.log(`\n${steps.length - failures}/${steps.length} passed`)
if (failures) process.exitCode = 1
