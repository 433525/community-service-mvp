import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

/**
 * 首页公告轮播回归（B 社区入口）。
 *
 * 覆盖：APG 结构与实时区、前后/圆点/键盘/滑动切换、自动轮播、
 * 悬停与焦点暂停、减少动态效果、320px 溢出与 44px 触控。
 * 依赖预览服务：npm run preview -- --host 127.0.0.1 --port 5180 --strictPort
 *
 * 用法：node tools/check-home-banner.mjs [--base=http://127.0.0.1:5180]
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-home-banner')
const base = (process.argv.find((arg) => arg.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, expected, actual, ok) {
  steps.push({ id, expected, actual, ok })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${JSON.stringify(actual)}`)
}

async function setViewport(page, width, height) {
  await page.client.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 720,
  })
  await sleep(160)
}

async function openHome(page, width = 1440, height = 1000) {
  await setViewport(page, width, height)
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.home-banner')
  await sleep(260)
}

async function activeSlide(page) {
  return page.eval(() => document.querySelector('.home-banner')?.getAttribute('data-active-slide') ?? null)
}

async function rotationState(page) {
  return page.eval(() => {
    const banner = document.querySelector('.home-banner')
    return {
      rotating: banner?.getAttribute('data-rotating') ?? null,
      live: banner?.querySelector('.banner-track')?.getAttribute('aria-live') ?? null,
      play: banner?.querySelector('.banner-play')?.getAttribute('aria-label') ?? null,
    }
  })
}

async function pressKey(page, key, code, keyCode) {
  await page.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode })
  await page.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode })
  await sleep(140)
}

async function swipe(page, fromX, fromY, toX, toY) {
  return page.eval((startX, startY, endX, endY) => {
    const viewport = document.querySelector('.banner-viewport')
    if (!viewport) return { ok: false, reason: 'missing-viewport' }
    const rect = viewport.getBoundingClientRect()
    const fire = (type, x, y) => viewport.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 71, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: y,
    }))
    fire('pointerdown', startX, startY)
    fire('pointerup', endX, endY)
    return { ok: true, top: Math.round(rect.top) }
  }, fromX, fromY, toX, toY)
}

await mkdir(evidenceDir, { recursive: true })

await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  console.log(`浏览器：${page.browserVersion?.Browser ?? 'unknown'}`)

  // HB1–HB5 结构与 ARIA
  await openHome(page)
  const structure = await page.eval(() => {
    const banner = document.querySelector('.home-banner')
    const labelId = banner?.getAttribute('aria-labelledby')
    const tabs = Array.from(banner?.querySelectorAll('[role="tab"]') ?? [])
    const slides = Array.from(banner?.querySelectorAll('[role="tabpanel"]') ?? [])
    const focusables = Array.from(banner?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])
    return {
      role: banner?.getAttribute('role'),
      roledescription: banner?.getAttribute('aria-roledescription'),
      label: labelId ? document.getElementById(labelId)?.textContent?.trim() ?? '' : '',
      tabs: tabs.map((tab) => ({
        selected: tab.getAttribute('aria-selected'),
        tabindex: tab.tabIndex,
        controls: tab.getAttribute('aria-controls'),
      })),
      slides: slides.map((slide) => ({
        id: slide.id,
        roledescription: slide.getAttribute('aria-roledescription'),
        label: slide.getAttribute('aria-label'),
        hidden: slide.getAttribute('aria-hidden'),
        inert: slide.hasAttribute('inert'),
        visibility: getComputedStyle(slide).visibility,
      })),
      live: banner?.querySelector('.banner-track')?.getAttribute('aria-live'),
      firstFocusable: focusables[0]?.className ?? '',
      playLabel: banner?.querySelector('.banner-play')?.getAttribute('aria-label'),
    }
  })
  step('HB1-region-role', '容器为带名称的 carousel region',
    { role: structure.role, roledescription: structure.roledescription, label: structure.label },
    structure.role === 'region' && structure.roledescription === 'carousel' && structure.label.length > 0)
  step('HB2-slides-structure', '5 张 tabpanel + slide roledescription + 位置名称',
    structure.slides,
    structure.slides.length === 5
      && structure.slides.every((slide) => slide.roledescription === 'slide' && /^第 \d 张，共 5 张$/.test(slide.label ?? '')))
  const activeSlides = structure.slides.filter((slide) => slide.hidden === 'false')
  const hiddenSlides = structure.slides.filter((slide) => slide.hidden === 'true')
  step('HB3-one-visible-slide', '仅当前幻灯片可见、可聚焦；其余 aria-hidden + inert',
    { active: activeSlides.length, hidden: hiddenSlides.length, inert: hiddenSlides.filter((slide) => slide.inert).length },
    activeSlides.length === 1 && activeSlides[0].inert === false && activeSlides[0].visibility === 'visible'
      && hiddenSlides.length === 4 && hiddenSlides.every((slide) => slide.inert && slide.visibility === 'hidden'))
  const selectedTabs = structure.tabs.filter((tab) => tab.selected === 'true')
  step('HB4-tabs-roving', '圆点为 tablist：单选、roving tabindex、aria-controls 指向幻灯片',
    { tabs: structure.tabs.length, selected: selectedTabs.length },
    structure.tabs.length === 5 && selectedTabs.length === 1 && selectedTabs[0].tabindex === 0
      && structure.tabs.filter((tab) => tab.selected === 'false').every((tab) => tab.tabindex === -1)
      && structure.tabs.every((tab) => tab.controls?.startsWith('home-banner-slide-')))
  step('HB5-rotation-first', '旋转控制是容器内第一个可聚焦元素，自动播放中实时区为 off',
    { firstFocusable: structure.firstFocusable, live: structure.live, play: structure.playLabel },
    structure.firstFocusable.includes('banner-play') && structure.live === 'off' && structure.playLabel === '暂停自动播放')
  await page.eval(() => window.scrollTo(0, 0))
  await sleep(200)
  await page.screenshot(join(evidenceDir, 'banner-1440.png'))

  // HB6–HB8 前后按钮与圆点
  await page.clickSelector('[aria-label="下一张公告"]')
  await sleep(320)
  const nextState = { slide: await activeSlide(page), ...(await rotationState(page)) }
  step('HB6-next-button', '“下一张”切到第 2 张并停止自动播放',
    nextState, nextState.slide === 'time-bank' && nextState.rotating === 'false'
      && nextState.live === 'polite' && nextState.play === '播放自动播放')
  await page.clickSelector('[aria-label="上一张公告"]')
  await sleep(220)
  const prevSlide = await activeSlide(page)
  step('HB7-prev-button', '“上一张”回到第 1 张', prevSlide, prevSlide === 'notice')
  await page.clickSelector('#home-banner-tab-recruit')
  await sleep(220)
  const dotState = await page.eval(() => {
    const tab = document.querySelector('#home-banner-tab-recruit')
    return {
      slide: document.querySelector('.home-banner')?.getAttribute('data-active-slide'),
      selected: tab?.getAttribute('aria-selected'),
      tabindex: tab?.tabIndex,
    }
  })
  step('HB8-dot-picker', '圆点直达第 3 张并同步选中态', dotState,
    dotState.slide === 'recruit' && dotState.selected === 'true' && dotState.tabindex === 0)

  // HB9–HB11 键盘
  await page.eval(() => document.querySelector('.banner-slide.is-active .banner-cta')?.focus())
  await pressKey(page, 'ArrowRight', 'ArrowRight', 39)
  const arrowNext = await activeSlide(page)
  step('HB9-arrow-keys', '焦点在幻灯片内时 → 切到下一张', arrowNext, arrowNext === 'elder-care')
  await pressKey(page, 'ArrowLeft', 'ArrowLeft', 37)
  const arrowPrev = await activeSlide(page)
  step('HB10-arrow-back', '← 返回上一张', arrowPrev, arrowPrev === 'recruit')
  await page.eval(() => document.querySelector('#home-banner-tab-notice')?.focus())
  await pressKey(page, 'End', 'End', 35)
  const endState = await page.eval(() => ({
    slide: document.querySelector('.home-banner')?.getAttribute('data-active-slide'),
    selected: document.querySelector('#home-banner-tab-safety')?.getAttribute('aria-selected'),
  }))
  step('HB11-tabs-end-key', '圆点内按 End 跳到第 5 张', endState,
    endState.slide === 'safety' && endState.selected === 'true')

  // HB12 滑动切换
  await openHome(page)
  const beforeSwipe = await activeSlide(page)
  const swipeResult = await swipe(page, 300, 200, 180, 204)
  await sleep(200)
  const afterSwipe = await activeSlide(page)
  step('HB12-swipe-left', '左滑进入下一张', { before: beforeSwipe, after: afterSwipe, swipeResult },
    beforeSwipe === 'notice' && afterSwipe === 'time-bank')

  // HB13 滑动结束后同一任务里的误触 click 必须被拦截
  const guard = await page.eval(() => {
    const viewport = document.querySelector('.banner-viewport')
    const rect = viewport.getBoundingClientRect()
    const fire = (type, clientX) => viewport.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 72, pointerType: 'touch', isPrimary: true,
      clientX, clientY: rect.top + 40,
    }))
    fire('pointerdown', rect.right - 40)
    fire('pointerup', rect.right - 180)
    document.querySelector('.banner-slide.is-active .banner-cta')?.click()
    return { slide: document.querySelector('.home-banner')?.getAttribute('data-active-slide') }
  })
  await sleep(320)
  const guarded = await page.eval(() => ({
    home: Boolean(document.querySelector('.home-banner')) && Boolean(document.querySelector('.page-stack')),
    slide: document.querySelector('.home-banner')?.getAttribute('data-active-slide'),
  }))
  step('HB13-swipe-click-guard', '滑动后的合成 click 不触发按钮动作', { guard, guarded },
    guard.slide === 'time-bank' && guarded.home)

  // HB14 竖向滑动不切换
  await swipe(page, 300, 60, 292, 220)
  await sleep(220)
  const verticalSlide = await activeSlide(page)
  step('HB14-swipe-vertical', '竖向滑动交给页面滚动，不切换幻灯片', verticalSlide, verticalSlide === 'recruit')

  // HB15 CTA 动作仍然可用（等待误触保护窗口结束）
  await page.clickSelector('#home-banner-tab-time-bank')
  await sleep(500)
  const ctaBox = await page.eval(() => {
    const node = document.querySelector('.banner-slide.is-active .banner-cta')
    const rect = node?.getBoundingClientRect()
    return rect ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } : null
  })
  // 必须用真实鼠标事件：合成 .click() 绕过指针捕获，测不出 click 目标被重定向的问题。
  await page.client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ctaBox.x, y: ctaBox.y, button: 'left', clickCount: 1 })
  await page.client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ctaBox.x, y: ctaBox.y, button: 'left', clickCount: 1 })
  await sleep(500)
  const ctaTarget = await page.eval(() => ({
    title: document.title,
    profile: Boolean(document.querySelector('.profile-page')),
    banner: Boolean(document.querySelector('.home-banner')),
  }))
  step('HB15-cta-action', '真实鼠标点击“查看时间账本”能跳到我的页', ctaTarget,
    ctaTarget.profile && !ctaTarget.banner)

  // HB15b 真实鼠标拖动切换，且不触发导航
  await openHome(page)
  const dragStart = await page.eval(() => {
    const rect = document.querySelector('.banner-viewport')?.getBoundingClientRect()
    return rect ? { x: Math.round(rect.left + rect.width * 0.7), y: Math.round(rect.top + 40) } : null
  })
  await page.client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragStart.x, y: dragStart.y, button: 'left', clickCount: 1 })
  for (const dx of [20, 60, 120, 180]) {
    await page.client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x - dx, y: dragStart.y, button: 'left' })
    await sleep(30)
  }
  await page.client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragStart.x - 180, y: dragStart.y, button: 'left', clickCount: 1 })
  await sleep(420)
  const dragState = await page.eval(() => ({
    slide: document.querySelector('.home-banner')?.getAttribute('data-active-slide'),
    home: Boolean(document.querySelector('.home-banner')),
  }))
  step('HB15b-real-drag', '真实鼠标拖动切到下一张且不误触按钮', dragState,
    dragState.slide === 'time-bank' && dragState.home)

  // HB16 自动轮播推进
  await openHome(page)
  const initialAuto = await rotationState(page)
  const startSlide = await activeSlide(page)
  await sleep(7600)
  const afterAuto = { slide: await activeSlide(page), ...(await rotationState(page)) }
  step('HB16-autoplay-advance', '7 秒后自动进入第 2 张，实时区保持 off',
    { startSlide, initialAuto, afterAuto },
    startSlide === 'notice' && afterAuto.slide === 'time-bank' && afterAuto.rotating === 'true' && afterAuto.live === 'off')

  // HB17 暂停按钮
  await openHome(page)
  await page.clickSelector('[aria-label="暂停自动播放"]')
  await sleep(200)
  const paused = { slide: await activeSlide(page), ...(await rotationState(page)) }
  await sleep(7600)
  const stillPaused = { slide: await activeSlide(page), ...(await rotationState(page)) }
  step('HB17-pause-button', '点暂停后不再推进，按钮变为播放',
    { paused, stillPaused },
    paused.rotating === 'false' && paused.play === '播放自动播放'
      && stillPaused.slide === 'notice' && stillPaused.rotating === 'false' && stillPaused.live === 'polite')

  // HB18 悬停暂停与恢复
  await openHome(page)
  const hoverBox = await page.eval(() => {
    const rect = document.querySelector('.banner-viewport')?.getBoundingClientRect()
    return rect ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 40) } : null
  })
  await page.client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverBox.x, y: hoverBox.y, button: 'none' })
  await sleep(300)
  const hovered = await rotationState(page)
  await page.client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, button: 'none' })
  await sleep(300)
  const unhovered = await rotationState(page)
  step('HB18-hover-pause', '悬停暂停、移出恢复（不改变用户开关）',
    { hovered: hovered.rotating, unhovered: unhovered.rotating, label: hovered.play },
    hovered.rotating === 'false' && unhovered.rotating === 'true' && hovered.play === '暂停自动播放')

  // HB19 焦点进入即停止，点播放才恢复
  await openHome(page)
  await page.eval(() => document.querySelector('.banner-slide.is-active .banner-cta')?.focus())
  await sleep(260)
  const focused = await rotationState(page)
  await page.clickSelector('[aria-label="播放自动播放"]')
  await sleep(220)
  const resumed = await rotationState(page)
  step('HB19-focus-stop', '焦点进入后停止且不自动恢复；点播放才继续',
    { focused, resumed },
    focused.rotating === 'false' && focused.live === 'polite'
      && resumed.rotating === 'true' && resumed.play === '暂停自动播放')

  // HB20 减少动态效果
  await page.client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await openHome(page)
  const reduced = await page.eval(() => {
    const banner = document.querySelector('.home-banner')
    return {
      rotating: banner?.getAttribute('data-rotating'),
      play: banner?.querySelector('.banner-play')?.getAttribute('aria-label'),
      live: banner?.querySelector('.banner-track')?.getAttribute('aria-live'),
      transition: getComputedStyle(banner?.querySelector('.banner-slide')).transitionDuration,
    }
  })
  await page.clickSelector('[aria-label="播放自动播放"]')
  await sleep(220)
  const reducedPlay = await rotationState(page)
  step('HB20-reduced-motion', '减少动态效果时默认暂停、动画接近 0，显式播放可覆盖',
    { reduced, reducedPlay },
    reduced.rotating === 'false' && reduced.play === '播放自动播放' && reduced.live === 'polite'
      // 全局减少动态效果规则把过渡压到 .01ms，计算值形如 1e-05s。
      && reduced.transition.split(',').every((value) => Number.parseFloat(value) <= 0.001)
      && reducedPlay.rotating === 'true')
  await page.client.send('Emulation.setEmulatedMedia', { features: [] })

  // HB21 390px 触控尺寸
  await openHome(page, 390, 844)
  const mobile = await page.eval(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector)
      const box = node?.getBoundingClientRect()
      return box ? { w: Math.round(box.width), h: Math.round(box.height) } : null
    }
    return {
      controls: Array.from(document.querySelectorAll('.home-banner button')).map((node) => {
        const box = node.getBoundingClientRect()
        return { label: node.getAttribute('aria-label') ?? node.innerText.trim(), w: Math.round(box.width), h: Math.round(box.height) }
      }),
      dots: rect('.banner-dot'),
      cta: rect('.banner-slide.is-active .banner-cta'),
    }
  })
  step('HB21-mobile-tap-targets', '390px 下轮播按钮与圆点触控高度 ≥44',
    mobile,
    mobile.controls.every((control) => control.h >= 44 && control.w >= 18)
      && (mobile.dots?.h ?? 0) >= 44 && (mobile.cta?.h ?? 0) >= 44)
  await page.eval(() => window.scrollTo(0, 0))
  await sleep(200)
  await page.screenshot(join(evidenceDir, 'banner-390.png'))

  // HB22 320px 无横向溢出
  await openHome(page, 320, 720)
  const narrow = await page.eval(() => {
    const banner = document.querySelector('.home-banner')
    const head = banner?.querySelector('.banner-head')
    const foot = banner?.querySelector('.banner-foot')
    const overflow = (node) => (node ? node.scrollWidth - node.clientWidth : 0)
    return {
      viewport: window.innerWidth,
      documentScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
      bannerRight: Math.round(banner?.getBoundingClientRect().right ?? 0),
      headOverflow: overflow(head),
      footOverflow: overflow(foot),
    }
  })
  step('HB22-320-overflow', '320px 下文档、轮播头尾均无横向溢出',
    narrow,
    narrow.documentScroll <= 321 && narrow.bodyScroll <= 321 && narrow.bannerRight <= 321
      && narrow.headOverflow <= 1 && narrow.footOverflow <= 1)
  await page.eval(() => window.scrollTo(0, 0))
  await sleep(200)
  await page.screenshot(join(evidenceDir, 'banner-320.png'))

  // HB23 运行期错误
  const errors = {
    page: page.pageErrors.slice(),
    console: page.consoleErrors.filter((line) => line.startsWith('error:')),
  }
  step('HB23-no-runtime-errors', '轮播交互不产生页面异常或控制台错误', errors,
    errors.page.length === 0 && errors.console.length === 0)
})

await writeFile(join(evidenceDir, 'home-banner-run-record.json'), JSON.stringify({
  ranAt: new Date().toISOString(),
  base,
  steps,
  failures,
}, null, 2), 'utf8')
console.log(`Home banner regression: ${steps.length - failures}/${steps.length} passed.`)
if (failures) process.exitCode = 1
