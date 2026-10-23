/**
 * audit-a11y.mjs — read-only accessibility / responsive audit for the synthetic MVP.
 *
 * Drives an isolated headless Chrome through the existing zero-dependency CDP
 * helper (tools/cdp.mjs), measures real focus behaviour, ARIA state, labels,
 * mobile layout, touch-target sizes and computed colours, then writes
 * screenshots / JSON / text evidence. It never edits application source.
 *
 * Usage:
 *   node tools/audit-a11y.mjs --base=http://127.0.0.1:5180 \
 *     --out=../docs/运营准备/evidence-audit-a11y
 */
import { withBrowser, sleep } from './cdp.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argv = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=')
    return [key, rest.join('=')]
  }),
)
const BASE = (argv.base || 'http://127.0.0.1:5180').replace(/\/$/, '')
const OUT = resolve(argv.out || join(here, '..', '..', 'docs', '运营准备', 'evidence-audit-a11y'))
const COMMUNITY = `${BASE}/community.html`
const APLUS = `${BASE}/`
const checks = []
const raw = { meta: { base: BASE, startedAt: new Date().toISOString(), node: process.version }, groups: {} }
let shotIndex = 0

function record(id, group, item, status, expected, actual, evidence = []) {
  const entry = { id, group, item, status, expected, actual, evidence }
  checks.push(entry)
  if (!raw.groups[group]) raw.groups[group] = []
  raw.groups[group].push(entry)
  const text = typeof actual === 'string' ? actual : JSON.stringify(actual)
  console.log(`[${status}] ${id} ${item} :: ${text}`)
  return entry
}

function safeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '-')
}

async function shot(session, name) {
  shotIndex += 1
  const file = join(OUT, `${safeName(name)}.png`)
  await session.screenshot(file)
  return file
}

async function writeJson(name, value) {
  const file = join(OUT, name)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8')
  return file
}

async function writeText(name, value) {
  const file = join(OUT, name)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, value, 'utf8')
  return file
}

const KEY_CODES = {
  Tab: 9,
  Enter: 13,
  Escape: 27,
  ' ': 32,
  ArrowRight: 39,
  ArrowLeft: 37,
}

async function pressKey(session, key, { shift = false } = {}) {
  const code = key === ' ' ? 'Space' : key
  const vk = KEY_CODES[key] ?? 0
  const modifiers = shift ? 8 : 0
  const base = {
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    modifiers,
    autoRepeat: false,
    isKeypad: false,
    location: 0,
  }
  await session.client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await session.client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(120)
}

async function pressTab(session, { shift = false } = {}) {
  await pressKey(session, 'Tab', { shift })
}

async function activeInfo(session) {
  return session.eval(() => {
    const el = document.activeElement
    if (!el) return null
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim()
    const dialog = el.closest('[role="dialog"]')
    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      tag: el.tagName,
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
      type: el.getAttribute('type') || '',
      text: normalize(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').slice(0, 100),
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('placeholder') || '',
      inDialog: Boolean(dialog),
      dialogTitle: dialog ? normalize(dialog.querySelector('h2, [id]')?.textContent || '').slice(0, 80) : '',
      visible: !(rect.width === 0 && rect.height === 0) && cs.visibility !== 'hidden' && cs.display !== 'none',
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
      focusVisible: el.matches(':focus-visible'),
    }
  })
}

async function focusElement(session, selector) {
  await session.waitForSelector(selector, { timeoutMs: 8000 })
  return session.eval((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { ok: false }
    el.focus()
    return { ok: true, tag: el.tagName, text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 80) }
  }, selector)
}

async function focusClick(session, selector) {
  await session.waitForSelector(selector, { timeoutMs: 8000 })
  return session.eval((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { ok: false }
    el.focus()
    el.click()
    return { ok: true, tag: el.tagName, text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 80) }
  }, selector)
}

async function tabSequence(session, count, { shift = false } = {}) {
  const sequence = []
  for (let index = 0; index < count; index += 1) {
    await pressTab(session, { shift })
    sequence.push(await activeInfo(session))
  }
  return sequence
}

async function waitFor(session, expression, timeoutMs = 12000) {
  return session.waitForExpression(expression, { timeoutMs, intervalMs: 120 })
}

async function waitCommunity(session) {
  await session.waitForSelector('.skip-link', { timeoutMs: 15000 })
  await session.waitForSelector('.main-column', { timeoutMs: 15000 })
  await session.waitForText('本地演练空间', { timeoutMs: 15000 })
}

async function waitAplus(session) {
  await session.waitForSelector('h1', { timeoutMs: 15000 })
  await session.waitForText('受控登记队列', { timeoutMs: 15000 })
}

async function resetCommunity(session, { clear = false } = {}) {
  await session.navigate(COMMUNITY)
  await waitCommunity(session)
  if (clear) {
    await session.clearLocalStorage()
    await session.reload()
    await waitCommunity(session)
  }
}

async function resetAplus(session) {
  await session.navigate(APLUS)
  await waitAplus(session)
}

async function getAxTree(session) {
  await session.client.send('Accessibility.enable').catch(() => {})
  const { nodes } = await session.client.send('Accessibility.getFullAXTree', {}, { timeoutMs: 30000 })
  const wantedRoles = new Set(['dialog', 'textbox', 'searchbox', 'combobox', 'checkbox', 'button', 'link', 'tab', 'tablist', 'status', 'alert', 'navigation', 'main', 'heading'])
  return nodes
    .filter((node) => !node.ignored && node.role && wantedRoles.has(node.role.value))
    .map((node) => {
      const properties = Object.fromEntries(
        (node.properties || []).map((property) => [property.name, property.value?.value]),
      )
      return {
        role: node.role.value,
        name: (node.name?.value || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        value: node.value?.value !== undefined ? String(node.value.value).slice(0, 80) : undefined,
        properties: {
          disabled: properties.disabled,
          required: properties.required,
          checked: properties.checked,
          expanded: properties.expanded,
          pressed: properties.pressed,
          selected: properties.selected,
          modal: properties.modal,
          level: properties.level,
        },
      }
    })
}

function parseCssColor(value) {
  if (!value) return null
  const match = value.match(/rgba?\(([^)]+)\)/i)
  if (!match) return null
  const parts = match[1].split(',').map((part) => Number(part.trim()))
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length >= 4 ? parts[3] : 1 }
}

function composite(fg, bg) {
  const alpha = fg.a + bg.a * (1 - fg.a)
  if (alpha === 0) return { r: 255, g: 255, b: 255, a: 1 }
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / alpha,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / alpha,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / alpha,
    a: alpha,
  }
}

function channelLum(value) {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(color) {
  return 0.2126 * channelLum(color.r) + 0.7152 * channelLum(color.g) + 0.0722 * channelLum(color.b)
}

function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg)
  const b = relativeLuminance(bg)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function contrastThreshold(fontSize, fontWeight) {
  const size = Number.parseFloat(fontSize)
  const weight = Number.parseInt(fontWeight, 10) || 400
  const large = size >= 24 || (size >= 18.66 && weight >= 700)
  return { threshold: large ? 3 : 4.5, large }
}

async function collectSamples(session, specs) {
  const rawSamples = await session.eval((list) => {
    const parse = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/i)
      if (!match) return null
      const parts = match[1].split(',').map((part) => Number(part.trim()))
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length >= 4 ? parts[3] : 1 }
    }
    const blend = (fg, bg) => {
      const alpha = fg.a + bg.a * (1 - fg.a)
      if (alpha === 0) return { r: 255, g: 255, b: 255, a: 1 }
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / alpha,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / alpha,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / alpha,
        a: alpha,
      }
    }
    const resolveBackground = (element) => {
      const layers = []
      let node = element
      while (node) {
        const computed = getComputedStyle(node).backgroundColor
        layers.push(computed)
        node = node.parentElement
      }
      let result = { r: 255, g: 255, b: 255, a: 1 }
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        const layer = parse(layers[index])
        if (layer && layer.a > 0) result = blend(layer, result)
      }
      return result
    }
    return list.map((spec) => {
      const nodes = Array.from(document.querySelectorAll(spec.selector))
      const el = nodes[spec.index ?? 0]
      if (!el) return { label: spec.label, selector: spec.selector, found: false }
      const cs = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      const bg = resolveBackground(el)
      return {
        label: spec.label,
        selector: spec.selector,
        found: true,
        text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        color: cs.color,
        bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
        rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
      }
    })
  }, specs)
  return rawSamples.map((sample) => {
    if (!sample.found) return sample
    const fg = parseCssColor(sample.color)
    const bg = parseCssColor(sample.bg)
    if (!fg || !bg) return { ...sample, ratio: null, note: 'colour-parse-failed' }
    const solidBg = composite(bg, { r: 255, g: 255, b: 255, a: 1 })
    const solidFg = composite(fg, solidBg)
    const ratio = contrastRatio(solidFg, solidBg)
    const { threshold, large } = contrastThreshold(sample.fontSize, sample.fontWeight)
    return {
      ...sample,
      fgLum: round(relativeLuminance(solidFg), 4),
      bgLum: round(relativeLuminance(solidBg), 4),
      ratio: round(ratio),
      threshold,
      large,
      pass: ratio >= threshold,
    }
  })
}

async function collectFocusStyle(session) {
  const info = await session.eval(() => {
    const el = document.activeElement
    if (!el) return null
    const cs = getComputedStyle(el)
    const parse = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/i)
      if (!match) return null
      const parts = match[1].split(',').map((part) => Number(part.trim()))
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length >= 4 ? parts[3] : 1 }
    }
    const blend = (fg, bg) => {
      const alpha = fg.a + bg.a * (1 - fg.a)
      return alpha === 0 ? { r: 255, g: 255, b: 255, a: 1 } : {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / alpha,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / alpha,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / alpha,
        a: alpha,
      }
    }
    const elementBg = parse(getComputedStyle(el).backgroundColor)
    let bg = { r: 255, g: 255, b: 255, a: 1 }
    const layers = []
    // The outline sits outside the element (offset > 0), so judge it against the
    // surrounding page/parent background, not the button/link fill itself.
    let node = el.parentElement || document.body
    while (node) {
      layers.push(getComputedStyle(node).backgroundColor)
      node = node.parentElement
    }
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = parse(layers[index])
      if (layer && layer.a > 0) bg = blend(layer, bg)
    }
    const outline = parse(cs.outlineColor)
    return {
      tag: el.tagName,
      id: el.id,
      className: typeof el.className === 'string' ? el.className.slice(0, 100) : '',
      text: (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset,
      background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      elementBackground: elementBg ? `rgb(${Math.round(elementBg.r)}, ${Math.round(elementBg.g)}, ${Math.round(elementBg.b)})` : null,
      outline,
      bg,
    }
  })
  if (!info || !info.outline) return info
  const bg = { r: info.bg.r, g: info.bg.g, b: info.bg.b, a: 1 }
  const outline = composite(info.outline, bg)
  const ratio = contrastRatio(outline, bg)
  return {
    ...info,
    outline: undefined,
    bg: undefined,
    outlineEffective: `rgb(${Math.round(outline.r)}, ${Math.round(outline.g)}, ${Math.round(outline.b)})`,
    ratio: round(ratio),
    threshold: 3,
    pass: ratio >= 3,
  }
}

async function viewportOverflow(session) {
  return session.eval(() => {
    const vw = window.innerWidth
    const visualWidth = Math.round(window.visualViewport?.width || window.innerWidth)
    const visualHeight = Math.round(window.visualViewport?.height || window.innerHeight)
    const referenceWidth = Math.min(vw, visualWidth)
    const docWidth = document.documentElement.scrollWidth
    const bodyWidth = document.body.scrollWidth
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      if (!(el instanceof HTMLElement)) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.right > referenceWidth + 1 || rect.left < -1) {
        offenders.push({
          tag: el.tagName,
          className: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          position: cs.position,
          text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        })
      }
    }
    return {
      innerWidth: vw,
      visualWidth,
      visualHeight,
      docScrollWidth: docWidth,
      bodyScrollWidth: bodyWidth,
      overflowX: docWidth > referenceWidth + 1 || bodyWidth > referenceWidth + 1,
      offenderCount: offenders.length,
      offenders: offenders.slice(0, 12),
    }
  })
}

async function measureTargets(session, specs) {
  const measured = await session.eval((list) => list.map((spec) => {
    const nodes = Array.from(document.querySelectorAll(spec.selector))
    const el = nodes[spec.index ?? 0]
    if (!el) return { label: spec.label, selector: spec.selector, found: false }
    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      label: spec.label,
      selector: spec.selector,
      found: true,
      text: (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      w: Math.round(rect.width * 10) / 10,
      h: Math.round(rect.height * 10) / 10,
      fontSize: cs.fontSize,
      display: cs.display,
    }
  }), specs)
  return measured.map((item) => ({ ...item, pass: item.found ? item.w >= 44 && item.h >= 44 : false }))
}

async function getMobileNav(session) {
  return session.eval(() => {
    const nav = document.querySelector('.mobile-nav')
    if (!nav) return null
    const cs = getComputedStyle(nav)
    const navRect = nav.getBoundingClientRect()
    const buttons = Array.from(nav.querySelectorAll('button')).map((button) => {
      const rect = button.getBoundingClientRect()
      return {
        text: (button.innerText || '').replace(/\s+/g, ' ').trim(),
        w: Math.round(rect.width * 10) / 10,
        h: Math.round(rect.height * 10) / 10,
        x: Math.round(rect.x * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        disabled: button.disabled,
      }
    })
    const visualHeight = Math.round(window.visualViewport?.height || window.innerHeight)
    return {
      display: cs.display,
      position: cs.position,
      rect: { x: Math.round(navRect.x), y: Math.round(navRect.y), w: Math.round(navRect.width), h: Math.round(navRect.height) },
      visualHeight,
      visibleHeight: Math.round(Math.max(0, Math.min(navRect.bottom, visualHeight) - Math.max(navRect.top, 0)) * 10) / 10,
      columns: cs.gridTemplateColumns,
      buttons,
    }
  })
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const fatal = []
  await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (session) => {
    const client = session.client

    /* ---------------------------------------------------------------- B: desktop */
    await resetCommunity(session, { clear: true })
    await session.setMembership('member')
    raw.meta.communityTitle = await session.title()
    raw.meta.communityLang = await session.eval(() => document.documentElement.lang)
    raw.meta.communityViewport = await session.eval(() => document.querySelector('meta[name="viewport"]')?.content || '')

    // 1. First tab stop + skip link.
    const firstTab = await (async () => {
      await pressTab(session)
      return activeInfo(session)
    })()
    const skipFocusStyle = await collectFocusStyle(session)
    const skipMetrics = await session.eval(() => {
      const link = document.querySelector('.skip-link')
      const rect = link.getBoundingClientRect()
      return {
        text: link.innerText.trim(),
        href: link.getAttribute('href'),
        top: Math.round(rect.top),
        visible: getComputedStyle(link).position === 'absolute' && rect.top >= 0,
        targetExists: Boolean(document.querySelector(link.getAttribute('href'))),
        targetTabIndex: document.querySelector(link.getAttribute('href'))?.getAttribute('tabindex'),
      }
    })
    record(
      'B-01', 'B 键盘与跳过链接', '首个 Tab 停靠“跳到主内容”',
      firstTab?.text === '跳到主内容' && firstTab?.className.includes('skip-link') ? 'pass' : 'risk',
      '第一次 Tab 聚焦跳转链接，且链接在视口内可见',
      { firstTab, skipMetrics, focusStyle: skipFocusStyle },
      ['b-skip-link-focus.png'],
    )
    await shot(session, 'b-skip-link-focus')

    await pressKey(session, 'Enter')
    await sleep(350)
    const afterSkip = await session.eval(() => {
      const active = document.activeElement
      const main = document.querySelector('#community-main')
      const rect = main.getBoundingClientRect()
      const cs = getComputedStyle(main)
      return {
        hash: location.hash,
        activeTag: active?.tagName,
        activeId: active?.id,
        activeIsMain: active === main,
        mainTop: Math.round(rect.top),
        scrollY: Math.round(window.scrollY),
        outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
        mainFocusVisible: main.matches(':focus-visible'),
      }
    })
    const afterSkipTabs = await tabSequence(session, 3)
    record(
      'B-02', 'B 键盘与跳过链接', '激活跳过链接后的焦点落点',
      afterSkip.activeIsMain && afterSkip.hash === '#community-main' ? 'pass' : 'risk',
      'hash=#community-main，焦点落到 main，main 呈现焦点环',
      { afterSkip, afterSkipTabs },
      ['b-skip-link-focus.png'],
    )

    // 2. Help dialog focus / trap / Esc / restore.
    await resetCommunity(session)
    await session.setMembership('member')
    await focusClick(session, '.help-toggle')
    await waitFor(session, "document.querySelector('.help-dialog')")
    await sleep(180)
    const helpOpen = await session.eval(() => {
      const dialog = document.querySelector('.help-dialog')
      const labelledby = dialog.getAttribute('aria-labelledby')
      const close = dialog.querySelector('.dialog-close')
      const main = dialog.querySelector('.button-primary')
      return {
        role: dialog.getAttribute('role'),
        ariaModal: dialog.getAttribute('aria-modal'),
        labelledby,
        labelText: labelledby ? document.getElementById(labelledby)?.innerText.trim() : '',
        activeText: (document.activeElement?.innerText || document.activeElement?.getAttribute('aria-label') || '').trim(),
        activeIsClose: document.activeElement === close,
        activeIsInDialog: dialog.contains(document.activeElement),
        focusableCount: dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])').length,
        toggleExpanded: document.querySelector('.help-toggle').getAttribute('aria-expanded'),
        confirmButtonTag: main?.tagName,
      }
    })
    const helpTabs = await tabSequence(session, 4)
    const helpShiftTabs = await tabSequence(session, 1, { shift: true })
    await shot(session, 'b-help-dialog')
    await pressKey(session, 'Escape')
    await waitFor(session, "!document.querySelector('.help-dialog')")
    const helpClosed = await session.eval(() => ({
      dialogGone: !document.querySelector('.help-dialog'),
      activeText: (document.activeElement?.innerText || document.activeElement?.getAttribute('aria-label') || '').trim(),
      activeIsToggle: document.activeElement === document.querySelector('.help-toggle'),
      toggleExpanded: document.querySelector('.help-toggle').getAttribute('aria-expanded'),
    }))
    const helpTrap = helpTabs.every((entry) => entry?.inDialog)
      && helpTabs.length === 4
      && helpTabs[0]?.text === '我知道了'
      && helpTabs[1]?.text === '×'
      && helpTabs[2]?.text === '我知道了'
      && helpTabs[3]?.text === '×'
    record(
      'B-03', 'B 弹层焦点', '使用说明弹层：进入、Tab 循环、Esc、焦点归还',
      helpOpen.role === 'dialog' && helpOpen.ariaModal === 'true' && helpOpen.labelledby === 'community-help-title'
        && helpOpen.labelText.includes('使用说明') && helpOpen.activeIsClose && helpTrap
        && helpClosed.dialogGone && helpClosed.activeIsToggle && helpClosed.toggleExpanded === 'false' ? 'pass' : 'risk',
      'role=dialog/aria-modal=true/labelledby 指向 h2；焦点先进入关闭按钮；Tab 在 2 个控件内循环；Esc 关闭并回到触发按钮',
      { helpOpen, helpTabs: helpTabs.map((item) => item && { text: item.text, inDialog: item.inDialog }), helpShiftTabs: helpShiftTabs.map((item) => item && { text: item.text, inDialog: item.inDialog }), helpClosed, helpTrap },
      ['b-help-dialog.png'],
    )

    // 3. Home safety dialog.
    await waitCommunity(session)
    await session.setMembership('member')
    await session.scrollToText('查看说明')
    await focusClick(session, '.care-strip > button')
    await waitFor(session, "document.querySelector('#safety-title')")
    await sleep(180)
    const safetyOpen = await session.eval(() => {
      const dialog = document.querySelector('#safety-title')?.closest('[role="dialog"]')
      if (!dialog) return null
      const close = dialog.querySelector('.dialog-close')
      return {
        role: dialog.getAttribute('role'),
        ariaModal: dialog.getAttribute('aria-modal'),
        labelledby: dialog.getAttribute('aria-labelledby'),
        labelText: document.getElementById(dialog.getAttribute('aria-labelledby'))?.innerText.trim(),
        activeIsClose: document.activeElement === close,
        activeIsInDialog: dialog.contains(document.activeElement),
        activeText: (document.activeElement?.innerText || document.activeElement?.getAttribute('aria-label') || '').trim(),
        triggerExpanded: document.querySelector('.care-strip > button').getAttribute('aria-expanded'),
      }
    })
    const safetyTabs = await tabSequence(session, 4)
    await shot(session, 'b-safety-dialog')
    await pressKey(session, 'Escape')
    await waitFor(session, "!document.querySelector('#safety-title')")
    const safetyClosed = await session.eval(() => ({
      dialogGone: !document.querySelector('#safety-title'),
      activeText: (document.activeElement?.innerText || '').replace(/\s+/g, ' ').trim(),
      activeIsTrigger: document.activeElement === document.querySelector('.care-strip > button'),
    }))
    const safetyTrap = safetyTabs.every((entry) => entry?.inDialog)
      && safetyTabs[0]?.text === '我知道了'
      && safetyTabs[1]?.text === '×'
      && safetyTabs[2]?.text === '我知道了'
      && safetyTabs[3]?.text === '×'
    record(
      'B-04', 'B 弹层焦点', '首页安全说明：进入、Tab 循环、Esc、焦点归还',
      safetyOpen?.role === 'dialog' && safetyOpen?.ariaModal === 'true' && safetyOpen?.labelledby === 'safety-title'
        && safetyOpen?.activeIsClose && safetyTrap && safetyClosed.dialogGone && safetyClosed.activeIsTrigger ? 'pass' : 'risk',
      '安全说明 README 为 dialog，焦点进入关闭按钮，Tab 不逃出，Esc 关闭并回到“查看说明”',
      { safetyOpen, safetyTabs: safetyTabs.map((item) => item && { text: item.text, inDialog: item.inDialog }), safetyClosed, safetyTrap },
      ['b-safety-dialog.png'],
    )

    // 4. Reading toggle aria-pressed + aria-label.
    const readingBefore = await session.eval(() => {
      const button = document.querySelector('.reading-toggle')
      return {
        pressed: button.getAttribute('aria-pressed'),
        label: button.getAttribute('aria-label'),
        appClass: document.querySelector('.community-app').className,
      }
    })
    await session.clickSelector('.reading-toggle')
    await sleep(250)
    const readingAfter = await session.eval(() => {
      const button = document.querySelector('.reading-toggle')
      return {
        pressed: button.getAttribute('aria-pressed'),
        label: button.getAttribute('aria-label'),
        appClass: document.querySelector('.community-app').className,
        stored: localStorage.getItem('community-mvp.reading-mode.v1'),
        postTitleSize: document.querySelector('.post-title') ? getComputedStyle(document.querySelector('.post-title')).fontSize : null,
      }
    })
    await session.clickSelector('.reading-toggle')
    await sleep(200)
    const readingReset = await session.eval(() => ({
      pressed: document.querySelector('.reading-toggle').getAttribute('aria-pressed'),
      appClass: document.querySelector('.community-app').className,
    }))
    record(
      'B-05', 'B ARIA 状态', '字号开关 aria-pressed / aria-label 随状态变化',
      readingBefore.pressed === 'false' && readingAfter.pressed === 'true' && readingAfter.appClass.includes('reading-large')
        && readingAfter.label.includes('大字阅读模式') && readingReset.pressed === 'false' ? 'pass' : 'risk',
      'aria-pressed 由 false→true→false，aria-label 描述当前模式，大字 class 同步',
      { readingBefore, readingAfter, readingReset },
      [],
    )

    // 5. Publish a synthetic post, then review it to generate one unread notice.
    await session.setMembership('member')
    await session.clickByText('发布', { selector: '.side-nav button', exact: false })
    await session.waitForText('发布一件小事。')
    await session.fillByLabel('标题', '无障碍复测合成求助')
    await session.fillByLabel('需求说明', '这是一条只用于无障碍复测的合成求助，不含真实姓名、电话或地址。')
    await session.fillByLabel('服务分类', '待分类')
    await session.fillByLabel('希望时段', '周四下午')
    await session.fillByLabel('预计时长', '约 1 小时')
    const publishBefore = await session.eval(() => {
      const submit = document.querySelector('.submit-button')
      const confirm = document.querySelector('.confirm-synthetic input')
      return {
        submitDisabled: submit.disabled,
        ariaDisabled: submit.getAttribute('aria-disabled'),
        confirmChecked: confirm.checked,
        submitText: submit.innerText.trim(),
      }
    })
    await session.checkSelector('.confirm-synthetic input')
    const publishEnabled = await session.eval(() => {
      const submit = document.querySelector('.submit-button')
      return { submitDisabled: submit.disabled, ariaDisabled: submit.getAttribute('aria-disabled') }
    })
    await session.clickSelector('.submit-button')
    await session.waitForText('我的发布', { timeoutMs: 15000 })
    const publishDone = await session.eval(() => ({
      activeHeading: document.querySelector('.page-heading h1')?.innerText.trim(),
      toast: document.querySelector('.toast-message')?.innerText.trim() || '',
    }))
    record(
      'B-06', 'B 表单与禁用按钮', '发布表单：禁用按钮、必填与提交',
      publishBefore.submitDisabled === true && publishEnabled.submitDisabled === false
        && publishBefore.ariaDisabled === null && publishDone.activeHeading === '我的' ? 'pass' : 'risk',
      '未确认时 submit 原生 disabled=true；勾选后 disabled=false；提交后进入“我的”',
      { publishBefore, publishEnabled, publishDone },
      ['b-publish-form.png'],
    )

    // Publish page labels + AX tree (go back to publish as member).
    await session.clickByText('发布', { selector: '.side-nav button', exact: false })
    await session.waitForText('发布一件小事。')
    const publishFields = await session.eval(() => {
      const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim()
      return Array.from(document.querySelectorAll('.publish-form input, .publish-form textarea, .publish-form select'))
        .filter((el) => !['hidden', 'submit'].includes(el.type))
        .map((el) => ({
          tag: el.tagName,
          type: el.type || '',
          name: el.getAttribute('name') || '',
          id: el.id || '',
          labels: Array.from(el.labels || []).map((label) => normalize(label.innerText).slice(0, 90)),
          ariaLabel: el.getAttribute('aria-label'),
          ariaRequired: el.getAttribute('aria-required'),
          required: el.required,
          disabled: el.disabled,
          placeholder: el.getAttribute('placeholder') || '',
        }))
    })
    const publishAx = await getAxTree(session)
    await writeJson('b-publish-ax-tree.json', publishAx)
    const titleField = publishFields.find((field) => field.labels.some((label) => label.startsWith('标题')))
    const contentField = publishFields.find((field) => field.labels.some((label) => label.includes('需求说明')))
    const axTextboxes = publishAx.filter((node) => node.role === 'textbox' || node.role === 'searchbox' || node.role === 'combobox')
    record(
      'B-07', 'B 表单标签', '发布表单 label 关联 / 必填暴露',
      Boolean(titleField && titleField.labels.length && titleField.required)
        && Boolean(contentField && contentField.labels.length && contentField.required) ? 'pass' : 'risk',
      '标题与正文（需求说明）均有原生 label 关联；required=true',
      { publishFields, axTextboxes: axTextboxes.slice(0, 14) },
      ['b-publish-form.png'],
    )
    await shot(session, 'b-publish-form')

    // Moderation: empty reason validation + approve to generate unread.
    await session.setMembership('reviewer')
    await session.clickByText('审核', { selector: '.side-nav button', exact: false })
    await session.waitForText('内容与举报审核')
    const reasonField = await session.eval(() => {
      const textarea = document.querySelector('.moderation-reason textarea')
      const label = textarea?.closest('label')
      const approve = Array.from(document.querySelectorAll('.moderation-actions button')).find((button) => button.innerText.trim() === '通过')
      return {
        labelText: (label?.innerText || '').replace(/\s+/g, ' ').trim(),
        labelFor: textarea?.id || '',
        labelsCount: textarea?.labels?.length || 0,
        wrapped: Boolean(textarea && label?.contains(textarea)),
        required: textarea?.required,
        ariaRequired: textarea?.getAttribute('aria-required'),
        approveDisabled: approve?.disabled,
        approveText: approve?.innerText.trim(),
      }
    })
    await session.clickByText('通过', { selector: '.moderation-actions button', exact: true })
    await waitFor(session, "document.querySelector('.toast-message')")
    await sleep(160)
    const moderationError = await session.eval(() => {
      const toast = document.querySelector('.toast-message')
      return {
        toastText: toast?.innerText.trim() || '',
        toastRole: toast?.getAttribute('role'),
        toastLive: toast?.getAttribute('aria-live'),
        inlineAlerts: Array.from(document.querySelectorAll('.form-error[role="alert"], [role="alert"]')).filter((el) => el.offsetParent !== null).map((el) => el.innerText.trim()).slice(0, 5),
        reasonInvalid: document.querySelector('.moderation-reason textarea')?.getAttribute('aria-invalid'),
        reasonDescribedBy: document.querySelector('.moderation-reason textarea')?.getAttribute('aria-describedby'),
      }
    })
    record(
      'B-08', 'B 错误提示', '审核理由为空时的错误反馈',
      reasonField.required !== true && reasonField.approveDisabled === false
        && moderationError.toastRole === 'status' && moderationError.inlineAlerts.length === 0 ? 'risk' : 'risk',
      '必填理由无 required/aria-required，按钮在空值时仍可点；错误只进 role=status toast，无内联 alert/aria-invalid',
      { reasonField, moderationError },
      ['b-moderation.png'],
    )
    await shot(session, 'b-moderation')

    await session.fillByLabel('本次审核或处理理由', '合成内容审核通过，仅用于无障碍复测。')
    await session.clickByText('通过', { selector: '.moderation-actions button', exact: true })
    await waitFor(session, "document.title.startsWith('(1)')", 15000)
    await session.setMembership('member')
    await session.clickByText('首页', { selector: '.side-nav button', exact: false })
    await session.waitForText('你好，演练居民')
    await sleep(200)

    const unreadState = await session.eval(() => {
      const badges = Array.from(document.querySelectorAll('.nav-badge, .mobile-badge'))
      const messageButton = document.querySelector('.topbar-message')
      const aiBadge = document.querySelector('.ai-badge')
      return {
        title: document.title,
        badgeCount: badges.length,
        badgeTexts: badges.map((badge) => badge.innerText.trim()),
        badgeAriaHidden: badges.map((badge) => badge.getAttribute('aria-hidden')),
        messageAriaLabel: messageButton?.getAttribute('aria-label'),
        sideNavMessagesAriaLabel: Array.from(document.querySelectorAll('.side-nav button')).find((button) => button.innerText.includes('消息'))?.getAttribute('aria-label') || null,
        unreadDots: document.querySelectorAll('.unread-dot').length,
        aiBadge: aiBadge?.innerText || null,
      }
    })
    const unreadTitleExpected = /^\(\d+\)\s/.test(unreadState.title)
    record(
      'B-09', 'B 未读与标题计数', '未读角标、document.title 计数、消息按钮 aria-label',
      unreadTitleExpected && unreadState.badgeCount >= 2 && unreadState.badgeTexts.every((text) => text === '1')
        && unreadState.badgeAriaHidden.every((value) => value === 'true')
        && unreadState.messageAriaLabel?.includes('1 条未读') ? 'pass' : 'risk',
      '标题以 (1) 开头；顶栏与侧栏各 1 个角标，text=1 且 aria-hidden=true；消息按钮 aria-label 含“1 条未读通知”',
      unreadState,
      ['b-unread.png'],
    )
    await shot(session, 'b-unread')
    const contrastBadge = await collectSamples(session, [
      { label: '未读角标数字', selector: '.nav-badge' },
    ])

    await session.clickSelector('.topbar-message')
    await session.waitForText('系统通知（合成示例）')
    const messageUnreadState = await session.eval(() => {
      const dot = document.querySelector('.unread-dot')
      return {
        unreadText: document.querySelector('.notice-unread')?.innerText.trim() || null,
        unreadDots: document.querySelectorAll('.unread-dot').length,
        dotAriaLabel: dot?.getAttribute('aria-label') || null,
        markReadVisible: Boolean(Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('全部标为已读'))),
        noticeMarkReadMinHeight: document.querySelector('.notice-mark-read') ? getComputedStyle(document.querySelector('.notice-mark-read')).minHeight : null,
      }
    })
    await shot(session, 'b-unread-messages')
    const contrastUnreadCapsule = await collectSamples(session, [
      { label: '未读计数胶囊', selector: '.notice-unread' },
      { label: '逐条未读圆点', selector: '.unread-dot' },
    ])
    await session.clickByText('全部标为已读', { selector: 'button', exact: true })
    await waitFor(session, "!document.title.startsWith('(')", 10000)
    await sleep(200)
    const readState = await session.eval(() => ({
      title: document.title,
      badgeCount: document.querySelectorAll('.nav-badge, .mobile-badge').length,
      messageAriaLabel: document.querySelector('.topbar-message')?.getAttribute('aria-label'),
      unreadText: document.querySelector('.notice-unread')?.innerText || null,
      markReadButton: Boolean(Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('全部标为已读'))),
      toast: document.querySelector('.toast-message')?.innerText.trim() || '',
    }))
    record(
      'B-10', 'B 未读与标题计数', '全部标为已读后计数清除',
      readState.title === '邻里 · 社区服务演练版' && readState.badgeCount === 0
        && readState.messageAriaLabel === '消息' && !readState.unreadText ? 'pass' : 'risk',
      '标题不再带 (N)，角标 0，消息按钮 aria-label 恢复“消息”',
      { readState, messageUnreadState },
      ['b-read.png', 'b-unread-messages.png'],
    )
    await shot(session, 'b-read')

    // B desktop contrast samples: home.
    await session.setMembership('member')
    await session.clickByText('首页', { selector: '.side-nav button', exact: false })
    await session.waitForText('你好，演练居民')
    const contrastHome = await collectSamples(session, [
      { label: '品牌副标题', selector: '.brand-copy small' },
      { label: '顶栏演练标记', selector: '.topbar-center' },
      { label: '原型提示横幅', selector: '.prototype-banner' },
      { label: '次要说明（demo-caption）', selector: '.demo-caption' },
      { label: '动态日期', selector: '.post-date' },
      { label: '动态正文', selector: '.post-content' },
      { label: '非选中侧导航', selector: '.nav-item:not(.active)' },
      { label: '文字链接（查看全部）', selector: '.text-link' },
      { label: '安全提示说明', selector: '.care-strip p' },
      { label: '快捷卡片说明', selector: '.quick-card small' },
      { label: 'Hero 说明文字', selector: '.hero-text p' },
      { label: 'Hero 页脚小字', selector: '.hero-foot' },
    ])
    await session.clickByText('发布', { selector: '.side-nav button', exact: false })
    await session.waitForText('发布一件小事。')
    const contrastPublish = await collectSamples(session, [
      { label: '发布字段标签', selector: '.publish-form .field-label' },
      { label: '发布隐私说明', selector: '.form-privacy' },
      { label: '发布类型副说明', selector: '.mode-options button small' },
    ])
    await session.clickByText('我的', { selector: '.side-nav button', exact: false })
    await session.waitForText('我的发布')
    const contrastProfile = await collectSamples(session, [
      { label: '我的 tab 未选中', selector: '.profile-tabs button:not(.selected)' },
      { label: '资料统计标签', selector: '.profile-stat-grid span' },
      { label: '发布行说明', selector: '.profile-post-row p' },
      { label: '个人页帮助说明', selector: '.profile-help-row p' },
    ])
    await session.clickByText('消息', { selector: '.side-nav button', exact: false })
    await session.waitForText('系统通知（合成示例）')
    const contrastMessages = await collectSamples(session, [
      { label: '通知说明', selector: '.notification-caption' },
      { label: '通知时间', selector: '.system-notice small' },
      { label: '消息页警示条', selector: '.message-warning' },
    ])
    const contrastDialog = await (async () => {
      await focusClick(session, '.help-toggle')
      await waitFor(session, "document.querySelector('.help-dialog')")
      return collectSamples(session, [
        { label: '使用说明正文', selector: '.help-grid p' },
        { label: '使用说明页脚', selector: '.help-foot small' },
      ])
    })()
    await pressKey(session, 'Escape')
    const contrastAll = [...contrastBadge, ...contrastUnreadCapsule, ...contrastHome, ...contrastPublish, ...contrastProfile, ...contrastMessages, ...contrastDialog]
    await writeJson('b-contrast-samples.json', contrastAll)
    const contrastFails = contrastAll.filter((sample) => sample.found && sample.pass === false)
    record(
      'B-11', 'B 对比度抽样', '计算样式颜色与 WCAG 对比度',
      contrastFails.length === 0 ? 'pass' : 'risk',
      '抽样文本对比度达到 4.5:1（大字 3:1）',
      { total: contrastAll.length, found: contrastAll.filter((sample) => sample.found).length, fails: contrastFails.map((sample) => ({ label: sample.label, ratio: sample.ratio, threshold: sample.threshold, color: sample.color, bg: sample.bg, fontSize: sample.fontSize })) },
      ['b-contrast.json'],
    )

    /* ---------------------------------------------------------------- B: mobile 390 */
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
    })
    await resetCommunity(session)
    await waitCommunity(session)
    await session.setMembership('member')
    await sleep(250)
    const mobileHomeOverflow = await viewportOverflow(session)
    const mobileNav = await getMobileNav(session)
    const mobileTargets = await measureTargets(session, [
      { label: '使用说明按钮', selector: '.help-toggle' },
      { label: '大字切换按钮', selector: '.reading-toggle' },
      { label: '消息按钮', selector: '.topbar-message' },
      { label: '底部导航“首页”', selector: '.mobile-nav button' },
      { label: '底部导航“发布”', selector: '.mobile-nav button', index: 2 },
      { label: '首页主按钮（发布求助）', selector: '.button-primary' },
    ])
    const mobileTargetFails = mobileTargets.filter((item) => item.found && !item.pass)
    record(
      'B-12', 'B 移动端 390×844', '首页横向溢出与底部导航',
      !mobileHomeOverflow.overflowX && Boolean(mobileNav) && mobileNav.buttons.length === 6
        && mobileNav.buttons.every((button) => button.right <= 391) ? 'pass' : 'risk',
      '无横向溢出；底部导航 6 项（含“审核”），全部在视口内',
      { overflow: mobileHomeOverflow, mobileNav },
      ['b-mobile-home.png'],
    )
    record(
      'B-13', 'B 移动端 390×844', '触控目标尺寸抽样（≥44px）',
      mobileTargetFails.length === 0 ? 'pass' : 'risk',
      '主要触控目标宽高均 ≥44px',
      { targets: mobileTargets, fails: mobileTargetFails },
      ['b-mobile-home.png'],
    )
    await shot(session, 'b-mobile-home')

    // Profile 5 tabs.
    await session.eval(() => {
      const button = Array.from(document.querySelectorAll('.mobile-nav button')).find((item) => item.innerText.includes('我的'))
      button?.click()
    })
    await session.waitForText('我的发布')
    await sleep(250)
    const profileTabs = await session.eval(() => {
      const tabs = Array.from(document.querySelectorAll('.profile-tabs button'))
      return {
        count: tabs.length,
        labels: tabs.map((tab) => tab.innerText.replace(/\s+/g, ' ').trim()),
        selected: tabs.map((tab) => tab.getAttribute('aria-selected')),
        rects: tabs.map((tab) => {
          const rect = tab.getBoundingClientRect()
          return { w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 }
        }),
        fontSizes: tabs.map((tab) => getComputedStyle(tab).fontSize),
        tablist: document.querySelector('.profile-tabs')?.getAttribute('role'),
        ariaLabel: document.querySelector('.profile-tabs')?.getAttribute('aria-label'),
      }
    })
    const profileOverflow = await viewportOverflow(session)
    record(
      'B-14', 'B 移动端 390×844', '“我的”5 个 tab 与横向溢出',
      profileTabs.count === 5 && !profileOverflow.overflowX ? 'pass' : 'risk',
      '“我的”有 5 个 tab，390px 下不横向溢出',
      { profileTabs, overflow: profileOverflow },
      ['b-mobile-profile.png'],
    )
    record(
      'B-15', 'B 移动端 390×844', '“我的”tab 触控高度',
      profileTabs.rects.every((rect) => rect.h >= 44) ? 'pass' : 'risk',
      '5 个 tab 高度 ≥44px',
      { rects: profileTabs.rects, failCount: profileTabs.rects.filter((rect) => rect.h < 44).length },
      ['b-mobile-profile.png'],
    )
    await shot(session, 'b-mobile-profile')

    // Big text mode on mobile.
    const bigBefore = await session.eval(() => {
      const pick = (selector) => {
        const el = document.querySelector(selector)
        return el ? getComputedStyle(el).fontSize : null
      }
      return {
        profileTab: pick('.profile-tabs button'),
        navButton: document.querySelector('.mobile-nav button')?.getBoundingClientRect().height,
        topbarHeight: document.querySelector('.topbar')?.getBoundingClientRect().height,
      }
    })
    await session.clickSelector('.reading-toggle')
    await sleep(350)
    const bigAfter = await session.eval(() => {
      const pick = (selector) => {
        const el = document.querySelector(selector)
        return el ? getComputedStyle(el).fontSize : null
      }
      const navButtons = Array.from(document.querySelectorAll('.mobile-nav button')).map((button) => {
        const rect = button.getBoundingClientRect()
        return { text: button.innerText.trim(), w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 }
      })
      const rectOf = (selector) => {
        const el = document.querySelector(selector)
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), height: Math.round(rect.height) }
      }
      const topbar = document.querySelector('.topbar')
      const brandRect = rectOf('.topbar .brand')
      const centerRect = rectOf('.topbar-center')
      const rightRect = rectOf('.topbar-right')
      const messageRect = rectOf('.topbar-message')
      const messageStyle = document.querySelector('.topbar-message') ? getComputedStyle(document.querySelector('.topbar-message')) : null
      const tabStrip = document.querySelector('.profile-tabs')
      const lastTab = tabStrip?.querySelector('button:last-child')
      const lastTabRect = lastTab?.getBoundingClientRect()
      return {
        appClass: document.querySelector('.community-app').className,
        profileTab: pick('.profile-tabs button'),
        navButtonHeight: document.querySelector('.mobile-nav button')?.getBoundingClientRect().height,
        topbarHeight: document.querySelector('.topbar')?.getBoundingClientRect().height,
        navButtons,
        pressed: document.querySelector('.reading-toggle').getAttribute('aria-pressed'),
        topbarToggleHeight: document.querySelector('.help-toggle')?.getBoundingClientRect().height,
        readingToggleHeight: document.querySelector('.reading-toggle')?.getBoundingClientRect().height,
        topbar: topbar ? { clientWidth: topbar.clientWidth, scrollWidth: topbar.scrollWidth, height: Math.round(topbar.getBoundingClientRect().height) } : null,
        topbarLayout: {
          brandRect,
          centerRect,
          rightRect,
          messageRect,
          messageHeight: messageRect?.height,
          messageLineHeight: messageStyle?.lineHeight,
          brandOverlapsCenter: brandRect && centerRect ? brandRect.right > centerRect.left : null,
          centerOverlapsRight: centerRect && rightRect ? centerRect.right > rightRect.left : null,
        },
        tabStrip: tabStrip ? {
          clientWidth: tabStrip.clientWidth,
          scrollWidth: tabStrip.scrollWidth,
          scrollable: tabStrip.scrollWidth > tabStrip.clientWidth + 1,
          lastTabRight: lastTabRect ? Math.round(lastTabRect.right) : null,
          lastTabVisible: lastTabRect ? lastTabRect.right <= window.innerWidth + 1 : null,
          lastTabText: lastTab?.innerText.trim() || null,
        } : null,
      }
    })
    const bigOverflow = await viewportOverflow(session)
    record(
      'B-16', 'B 移动端大字模式', '大字模式后的字号与页面级横向溢出',
      bigAfter.appClass.includes('reading-large') && Number.parseFloat(bigAfter.profileTab) > Number.parseFloat(bigBefore.profileTab)
        && !bigOverflow.overflowX ? 'pass' : 'risk',
      '字号变大；页面不出现横向溢出；底部导航不越界',
      { bigBefore, bigAfter, overflow: bigOverflow },
      ['b-mobile-large.png'],
    )
    const topbarBroken = bigAfter.topbar?.scrollWidth > bigAfter.topbar?.clientWidth + 1
      || bigAfter.topbarLayout?.brandOverlapsCenter
      || bigAfter.topbarLayout?.centerOverlapsRight
      || bigAfter.topbarLayout?.centerRect?.height > 44
      || bigAfter.topbarLayout?.messageHeight > 34
    record(
      'B-16b', 'B 移动端大字模式', '大字模式顶栏是否挤压/换行/重叠',
      topbarBroken ? 'risk' : 'pass',
      '顶栏品牌、演练标记、说明/大字/消息在 390px 大字模式下不重叠、不竖排换行',
      { topbar: bigAfter.topbar, topbarLayout: bigAfter.topbarLayout, tabStrip: bigAfter.tabStrip },
      ['b-mobile-large.png'],
    )
    record(
      'B-16c', 'B 移动端大字模式', '大字模式“我的”5 个 tab 是否需横向滚动',
      bigAfter.tabStrip?.scrollable && bigAfter.tabStrip?.lastTabVisible === false ? 'risk' : 'pass',
      '5 个 tab 在 390px 大字模式下应完整可见，或提供明显可滚动提示',
      bigAfter.tabStrip,
      ['b-mobile-large-tabs.png'],
    )
    await shot(session, 'b-mobile-large')
    await session.scrollToText('我的发布')
    await sleep(250)
    await shot(session, 'b-mobile-large-tabs')

    // Restore normal reading mode + desktop metrics.
    await session.clickSelector('.reading-toggle')
    await sleep(200)

    // B focus ring contrast + reduced motion.
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1440,
      screenHeight: 1000,
    })
    await resetCommunity(session)
    await session.setMembership('member')
    await pressTab(session)
    const bFocusStyle = await collectFocusStyle(session)
    await writeJson('b-focus-style.json', bFocusStyle)
    record(
      'B-18', 'B 对比度抽样', '键盘焦点环与相邻背景的对比度',
      bFocusStyle?.pass ? 'pass' : 'risk',
      '焦点环 3px 实线 #2a6049 与周围背景对比度 ≥3:1',
      bFocusStyle,
      ['b-focus-style.json'],
    )

    const motionB = await (async () => {
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
      await sleep(220)
      const before = await session.eval(() => ({
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        buttonTransition: getComputedStyle(document.querySelector('.button-primary')).transitionDuration,
        navTransition: getComputedStyle(document.querySelector('.nav-item')).transitionDuration,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      }))
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      await sleep(220)
      const after = await session.eval(() => ({
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        buttonTransition: getComputedStyle(document.querySelector('.button-primary')).transitionDuration,
        navTransition: getComputedStyle(document.querySelector('.nav-item')).transitionDuration,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      }))
      await client.send('Emulation.setEmulatedMedia', { features: [] })
      return { before, after }
    })()
    record(
      'B-17', 'B 减弱动效', 'prefers-reduced-motion 是否存在并生效',
      motionB.after.matches && Number.parseFloat(motionB.after.buttonTransition) < Number.parseFloat(motionB.before.buttonTransition) ? 'pass' : 'risk',
      '媒体查询存在；reduce 下 transition-duration 缩短至 0.01ms',
      motionB,
      ['b-motion.json'],
    )
    await writeJson('b-motion.json', motionB)

    /* ---------------------------------------------------------------- A+ entry */
    await resetAplus(session)
    raw.meta.aplusTitle = await session.title()
    const aplusFirstTabs = await tabSequence(session, 8)
    const aplusSkip = await session.eval(() => ({
      skipLink: Boolean(document.querySelector('.skip-link, a[href="#main"], a[href="#community-main"]')),
      mainId: document.querySelector('main')?.id || '',
      mainTabIndex: document.querySelector('main')?.getAttribute('tabindex'),
      firstTabbables: Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.disabled && el.offsetParent !== null || el.getAttribute('type') === 'file')
        .slice(0, 8)
        .map((el) => ({ tag: el.tagName, cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '', text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40), tabIndex: el.tabIndex })),
    }))
    record(
      'A-01', 'A+ 入口键盘', '首个 Tab 与跳过链接',
      aplusSkip.skipLink || aplusFirstTabs[0]?.text !== '登记队列' ? 'risk' : 'risk',
      '入口应提供“跳到主内容”，首个 Tab 可达；隐藏文件输入不应进入 Tab 序列',
      { firstTabs: aplusFirstTabs, aplusSkip },
      ['a-home.png'],
    )
    await shot(session, 'a-home')

    // A+ create modal: focus, trap, Esc, return.
    await focusClick(session, '.heading-actions .button.primary')
    await waitFor(session, "document.querySelector('#create-title')")
    await sleep(220)
    const aplusModalOpen = await session.eval(() => {
      const dialog = document.querySelector('#create-title')?.closest('[role="dialog"]')
      return {
        role: dialog?.getAttribute('role'),
        ariaModal: dialog?.getAttribute('aria-modal'),
        labelledby: dialog?.getAttribute('aria-labelledby'),
        labelText: document.getElementById('create-title')?.innerText.trim(),
        activeText: (document.activeElement?.innerText || document.activeElement?.getAttribute('aria-label') || '').trim(),
        activeIsInDialog: dialog?.contains(document.activeElement),
        activeIsTrigger: document.activeElement === document.querySelector('.heading-actions .button.primary'),
        focusableCount: dialog?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])').length,
      }
    })
    const aplusModalTabs = await tabSequence(session, 4)
    await shot(session, 'a-create-dialog')
    await pressKey(session, 'Escape')
    await sleep(250)
    const aplusEsc = await session.eval(() => ({
      dialogStillOpen: Boolean(document.querySelector('#create-title')),
      activeText: (document.activeElement?.innerText || document.activeElement?.getAttribute('aria-label') || '').trim(),
    }))
    await focusClick(session, '#create-title ~ * .icon-button, .modal[aria-labelledby="create-title"] .icon-button')
    await sleep(250)
    const aplusClosed = await session.eval(() => ({
      dialogGone: !document.querySelector('#create-title'),
      activeTag: document.activeElement?.tagName,
      activeText: (document.activeElement?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      activeIsTrigger: document.activeElement === document.querySelector('.heading-actions .button.primary'),
    }))
    record(
      'A-02', 'A+ 弹层焦点', '新建记录弹层：焦点进入、Tab 限制、Esc、焦点归还',
      aplusModalOpen?.ariaModal === 'true' && aplusModalOpen?.labelledby === 'create-title'
        && aplusModalOpen?.activeIsInDialog && aplusModalTabs.every((entry) => entry?.inDialog)
        && aplusEsc.dialogStillOpen === false && aplusClosed.activeIsTrigger ? 'pass' : 'missing',
      '打开后焦点进入弹层，Tab 不逃出，Esc 关闭，关闭后焦点回到触发按钮',
      { aplusModalOpen, aplusModalTabs: aplusModalTabs.map((item) => item && { text: item.text, inDialog: item.inDialog }), aplusEsc, aplusClosed },
      ['a-create-dialog.png'],
    )

    // Reopen for labels / error / disabled.
    await focusClick(session, '.heading-actions .button.primary')
    await waitFor(session, "document.querySelector('#create-title')")
    await sleep(200)
    const aplusFields = await session.eval(() => {
      const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim()
      return Array.from(document.querySelectorAll('.modal[aria-labelledby="create-title"] input, .modal[aria-labelledby="create-title"] textarea, .modal[aria-labelledby="create-title"] select'))
        .filter((el) => !['checkbox', 'file'].includes(el.type))
        .map((el) => ({
          tag: el.tagName,
          id: el.id,
          labels: Array.from(el.labels || []).map((label) => normalize(label.innerText).slice(0, 90)),
          ariaLabel: el.getAttribute('aria-label'),
          ariaRequired: el.getAttribute('aria-required'),
          ariaInvalid: el.getAttribute('aria-invalid'),
          ariaDescribedby: el.getAttribute('aria-describedby'),
          required: el.required,
          placeholder: el.getAttribute('placeholder') || '',
        }))
    })
    const aplusCreateButtonBefore = await session.eval(() => {
      const dialog = document.querySelector('.modal[aria-labelledby="create-title"]')
      const button = Array.from(dialog.querySelectorAll('.modal-footer button')).find((item) => item.innerText.includes('创建演练记录'))
      return { disabled: button?.disabled, ariaDisabled: button?.getAttribute('aria-disabled'), text: button?.innerText.trim() }
    })
    await session.checkSelector('.modal[aria-labelledby="create-title"] .synthetic-confirm input')
    const aplusCreateButtonAfter = await session.eval(() => {
      const dialog = document.querySelector('.modal[aria-labelledby="create-title"]')
      const button = Array.from(dialog.querySelectorAll('.modal-footer button')).find((item) => item.innerText.includes('创建演练记录'))
      return { disabled: button?.disabled, ariaDisabled: button?.getAttribute('aria-disabled') }
    })
    await focusClick(session, '.modal[aria-labelledby="create-title"] .modal-footer .button.primary')
    await waitFor(session, "document.querySelector('.modal[aria-labelledby=\"create-title\"] .form-error[role=\"alert\"]')", 8000)
    await sleep(150)
    const aplusFormError = await session.eval(() => {
      const error = document.querySelector('.modal[aria-labelledby="create-title"] .form-error[role="alert"]')
      const dialog = document.querySelector('.modal[aria-labelledby="create-title"]')
      const summary = dialog.querySelector('#record-summary')
      return {
        errorText: error?.innerText.trim(),
        role: error?.getAttribute('role'),
        activeText: (document.activeElement?.innerText || '').trim().slice(0, 60),
        activeInsideDialog: dialog.contains(document.activeElement),
        summaryAriaInvalid: summary?.getAttribute('aria-invalid'),
        summaryAriaDescribedby: summary?.getAttribute('aria-describedby'),
      }
    })
    const aplusAx = await getAxTree(session)
    await writeJson('a-create-ax-tree.json', aplusAx)
    record(
      'A-03', 'A+ 表单标签与错误', '新建表单 label / 禁用按钮 / role=alert',
      aplusFields.some((field) => field.id === 'record-summary' && field.labels.length)
        && aplusCreateButtonBefore.disabled === true && aplusCreateButtonAfter.disabled === false
        && aplusFormError.role === 'alert' ? 'pass' : 'risk',
      '字段有 label；未勾选确认时创建按钮 disabled；提交空摘要后出现 role=alert 错误',
      { aplusFields, aplusCreateButtonBefore, aplusCreateButtonAfter, aplusFormError },
      ['a-create-error.png'],
    )
    const requiredExposed = aplusFields
      .filter((field) => field.labels.some((label) => label.includes('*')))
      .every((field) => field.required === true || field.ariaRequired === 'true')
    record(
      'A-03b', 'A+ 表单标签与错误', '必填状态与错误字段关联是否暴露给辅助技术',
      requiredExposed ? 'pass' : 'risk',
      '视觉必填项应同时暴露 required/aria-required；出错字段应有 aria-invalid/aria-describedby 或焦点提示',
      {
        requiredExposed,
        requiredFields: aplusFields.filter((field) => field.labels.some((label) => label.includes('*'))).map((field) => ({ id: field.id, labels: field.labels, required: field.required, ariaRequired: field.ariaRequired })),
        errorAssociation: { summaryAriaInvalid: aplusFormError.summaryAriaInvalid, summaryAriaDescribedby: aplusFormError.summaryAriaDescribedby, activeText: aplusFormError.activeText },
      },
      ['a-create-error.png'],
    )
    await shot(session, 'a-create-error')

    // A+ contrast samples (modal open state for notice + form error).
    const aplusContrast = await collectSamples(session, [
      { label: '面包屑', selector: '.crumb' },
      { label: '页面副标题', selector: '.page-subtitle' },
      { label: '合成数据横幅', selector: '.synthetic-banner' },
      { label: '存储状态说明', selector: '.storage-status' },
      { label: '主按钮白字', selector: '.button.primary' },
      { label: '角色选择标签', selector: '.role-select' },
      { label: '侧栏分组标签', selector: '.nav-label' },
      { label: '侧栏演练说明', selector: '.pilot-card p' },
      { label: '用户角色说明', selector: '.user-chip small' },
      { label: '指标卡标签', selector: '.metric-label' },
      { label: '指标卡脚注', selector: '.metric-foot' },
      { label: '弹层提示条', selector: '.modal .notice-inline' },
      { label: '表单错误文本', selector: '.modal .form-error' },
      { label: '表单提示 hint', selector: '.modal .hint' },
    ])
    await writeJson('a-contrast-samples.json', aplusContrast)
    const aplusContrastFails = aplusContrast.filter((sample) => sample.found && sample.pass === false)
    record(
      'A-04', 'A+ 对比度抽样', '计算样式颜色与 WCAG 对比度',
      aplusContrastFails.length === 0 ? 'pass' : 'risk',
      '抽样文本对比度达到 4.5:1（大字 3:1）',
      { total: aplusContrast.length, found: aplusContrast.filter((sample) => sample.found).length, fails: aplusContrastFails.map((sample) => ({ label: sample.label, ratio: sample.ratio, threshold: sample.threshold, color: sample.color, bg: sample.bg, fontSize: sample.fontSize })) },
      ['a-contrast.json'],
    )

    // A+ focus ring (keyboard on visible button) + reduced motion.
    await pressKey(session, 'Escape').catch(() => {})
    await session.eval(() => document.querySelector('.modal-backdrop')?.click()).catch(() => {})
    await sleep(150)
    await pressKey(session, 'Tab') // ensure keyboard modality, then focus a known button
    await focusElement(session, '.top-actions .icon-button')
    const aFocusStyle = await collectFocusStyle(session)
    await writeJson('a-focus-style.json', aFocusStyle)
    record(
      'A-08', 'A+ 对比度抽样', '键盘焦点环与相邻背景的对比度',
      aFocusStyle?.pass ? 'pass' : 'risk',
      '焦点环与周围背景对比度 ≥3:1',
      aFocusStyle,
      ['a-focus-style.json'],
    )
    const motionA = await (async () => {
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
      await sleep(200)
      const before = await session.eval(() => ({
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        buttonTransition: getComputedStyle(document.querySelector('.button.primary')).transitionDuration,
        toastAnimation: document.querySelector('.toast') ? getComputedStyle(document.querySelector('.toast')).animationDuration : null,
      }))
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      await sleep(200)
      const after = await session.eval(() => ({
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        buttonTransition: getComputedStyle(document.querySelector('.button.primary')).transitionDuration,
      }))
      await client.send('Emulation.setEmulatedMedia', { features: [] })
      return { before, after }
    })()
    record(
      'A-05', 'A+ 减弱动效', 'prefers-reduced-motion 是否存在并生效',
      motionA.after.matches && Number.parseFloat(motionA.after.buttonTransition) < Number.parseFloat(motionA.before.buttonTransition) ? 'pass' : 'risk',
      '媒体查询存在；reduce 下按钮 transition 缩短至 0.01ms',
      motionA,
      ['a-motion.json'],
    )
    await writeJson('a-motion.json', motionA)

    // A+ mobile 390.
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
    })
    await resetAplus(session)
    await sleep(300)
    const aMobileOverflow = await viewportOverflow(session)
    const aMobileNav = await getMobileNav(session)
    const aMobileTargets = await measureTargets(session, [
      { label: '角色选择', selector: '.role-select select' },
      { label: '演示提示按钮', selector: '.top-actions .icon-button' },
      { label: '移动导航“登记”', selector: '.mobile-nav button' },
      { label: '移动导航“新建”', selector: '.mobile-nav button', index: 1 },
      { label: '移动导航“社区求助”', selector: '.mobile-nav button', index: 2 },
      { label: '存储状态横幅按钮', selector: '.banner-actions .button' },
    ])
    record(
      'A-06', 'A+ 移动端 390×844', '横向溢出、移动导航、触控目标',
      !aMobileOverflow.overflowX && Boolean(aMobileNav) && aMobileNav.buttons.length === 4 ? 'pass' : 'risk',
      '无横向溢出；移动导航 4 项；触控目标抽样记录实际尺寸',
      { overflow: aMobileOverflow, mobileNav: aMobileNav, targets: aMobileTargets, targetFails: aMobileTargets.filter((item) => item.found && !item.pass) },
      ['a-mobile.png'],
    )
    record(
      'A-06b', 'A+ 移动端 390×844', '底部移动导航是否完整落在视觉视口内',
      aMobileNav && aMobileNav.visibleHeight >= aMobileNav.rect.h - 1 ? 'pass' : 'risk',
      '固定底部导航完整可见（visibleHeight ≈ nav.height）',
      aMobileNav ? { rect: aMobileNav.rect, visualHeight: aMobileNav.visualHeight, visibleHeight: aMobileNav.visibleHeight, hiddenHeight: Math.round((aMobileNav.rect.h - aMobileNav.visibleHeight) * 10) / 10 } : null,
      ['a-mobile.png'],
    )
    const aBannerLayout = await session.eval(() => {
      const rectOf = (selector) => {
        const el = document.querySelector(selector)
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
      }
      return {
        banner: rectOf('.synthetic-banner'),
        copy: rectOf('.synthetic-copy'),
        actions: rectOf('.banner-actions'),
        copyText: (document.querySelector('.synthetic-copy')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        viewport: { innerWidth, visualWidth: Math.round(window.visualViewport?.width || innerWidth), visualHeight: Math.round(window.visualViewport?.height || innerHeight) },
      }
    })
    record(
      'A-06c', 'A+ 移动端 390×844', '合成数据横幅在 390px 下是否被按钮列挤成竖排',
      aBannerLayout.copy && aBannerLayout.copy.w >= 180 ? 'pass' : 'risk',
      '横幅正文列保持可读宽度（不被操作按钮挤成逐字竖排）',
      aBannerLayout,
      ['a-mobile.png'],
    )
    await shot(session, 'a-mobile')

    // A+ modal on mobile (bottom sheet) for layout evidence.
    await focusClick(session, '.mobile-nav button:nth-child(2)')
    await waitFor(session, "document.querySelector('#create-title')")
    await sleep(250)
    const aMobileModal = await session.eval(() => {
      const dialog = document.querySelector('#create-title')?.closest('[role="dialog"]')
      const rect = dialog?.getBoundingClientRect()
      const close = dialog?.querySelector('.icon-button')
      const closeRect = close?.getBoundingClientRect()
      return {
        dialogRect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
        viewport: { w: innerWidth, h: innerHeight },
        closeTarget: closeRect ? { w: Math.round(closeRect.width * 10) / 10, h: Math.round(closeRect.height * 10) / 10 } : null,
        focusedInside: dialog?.contains(document.activeElement),
      }
    })
    await shot(session, 'a-mobile-dialog')
    record(
      'A-07', 'A+ 移动端 390×844', '移动端弹层布局与关闭按钮',
      aMobileModal.dialogRect?.w === 390 && aMobileModal.closeTarget?.w >= 44 && aMobileModal.closeTarget?.h >= 44 ? 'pass' : 'risk',
      '底部弹层宽度贴合 390px；关闭按钮触控目标 ≥44px',
      aMobileModal,
      ['a-mobile-dialog.png'],
    )

    // Console / page errors.
    raw.meta.pageErrors = session.pageErrors
    raw.meta.consoleErrors = session.consoleErrors
    record(
      'X-01', '全局', '页面未捕获异常与控制台错误',
      session.pageErrors.length === 0 && session.consoleErrors.length === 0 ? 'pass' : 'risk',
      'pageErrors=0；consoleErrors=0',
      { pageErrors: session.pageErrors, consoleErrors: session.consoleErrors },
      [],
    )
  })

  raw.meta.finishedAt = new Date().toISOString()
  raw.meta.fatal = fatal
  raw.checks = checks
  raw.summary = {
    total: checks.length,
    pass: checks.filter((item) => item.status === 'pass').length,
    risk: checks.filter((item) => item.status === 'risk').length,
    missing: checks.filter((item) => item.status === 'missing').length,
  }
  await writeJson('audit-results.json', raw)
  await writeJson('checks-flat.json', checks)
  await writeText('run-log.txt', checks.map((item) => `[${item.status}] ${item.id} ${item.item}\n  actual: ${typeof item.actual === 'string' ? item.actual : JSON.stringify(item.actual)}\n`).join('\n'))
  console.log('SUMMARY', raw.summary)
}

main().catch(async (error) => {
  console.error('FATAL', error)
  raw.meta.finishedAt = new Date().toISOString()
  raw.meta.fatalError = { message: error.message, stack: error.stack }
  raw.checks = checks
  raw.summary = {
    total: checks.length,
    pass: checks.filter((item) => item.status === 'pass').length,
    risk: checks.filter((item) => item.status === 'risk').length,
    missing: checks.filter((item) => item.status === 'missing').length,
  }
  try {
    await writeJson('audit-results.json', raw)
    await writeText('run-log.txt', checks.map((item) => `[${item.status}] ${item.id} ${item.item}\n`).join('\n') + `\nFATAL: ${error.stack}\n`)
  } catch { /* ignore */ }
  process.exitCode = 1
})
