// UI audit: contrast, tap targets, overflow, heading/landmark structure, accessible names.
// Run: node tools/audit-ui.mjs --base=http://127.0.0.1:5180
// Writes JSON evidence to docs/运营准备/evidence-audit-ui-<timestamp>/report.json
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const args = new Map(process.argv.slice(2).map((raw) => {
  const [key, ...rest] = raw.replace(/^--/, '').split('=')
  return [key, rest.join('=')]
}))
const base = (args.get('base') || 'http://127.0.0.1:5180').replace(/\/$/, '')
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = resolve(__dirname, '..', '..', 'docs', '运营准备', `evidence-audit-ui-${stamp}`)

const AUDIT = () => {
  const norm = (v) => (v || '').replace(/\s+/g, ' ').trim()
  const parse = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value || '')
    if (!m) return null
    const parts = m[1].split(/[,/ ]+/).map(Number)
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
  }
  const lum = (c) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const blend = (fg, bg) => ({
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    a: 1,
  })
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  const backgroundOf = (node) => {
    let current = node
    let result = { r: 255, g: 255, b: 255, a: 1 }
    const stack = []
    while (current && current !== document.documentElement) {
      const bg = parse(getComputedStyle(current).backgroundColor)
      if (bg && bg.a > 0) stack.push(bg)
      current = current.parentElement
    }
    const htmlBg = parse(getComputedStyle(document.documentElement).backgroundColor)
    if (htmlBg && htmlBg.a > 0) stack.push(htmlBg)
    for (let i = stack.length - 1; i >= 0; i -= 1) result = blend(stack[i], result)
    return result
  }
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return false
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05
  }

  const contrast = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  let node = document.body
  while (node) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)) {
      node = walker.nextNode()
      continue
    }
    const own = Array.from(node.childNodes).filter((child) => child.nodeType === 3 && norm(child.textContent)).map((child) => child.textContent).join(' ')
    if (own && visible(node) && !node.closest('[aria-hidden="true"]')) {
      const style = getComputedStyle(node)
      const fg = parse(style.color)
      const bg = backgroundOf(node)
      if (fg && bg) {
        const composed = fg.a < 1 ? blend(fg, bg) : fg
        const cr = ratio(composed, bg)
        const size = parseFloat(style.fontSize)
        const bold = Number(style.fontWeight) >= 700
        const large = size >= 24 || (size >= 18.66 && bold)
        const required = large ? 3 : 4.5
        if (cr + 0.05 < required) {
          contrast.push({
            text: norm(own).slice(0, 60),
            tag: node.tagName.toLowerCase(),
            className: typeof node.className === 'string' ? node.className.slice(0, 80) : '',
            ratio: Number(cr.toFixed(2)),
            required,
            fontSize: size,
            color: style.color,
            background: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
          })
        }
      }
    }
    node = walker.nextNode()
  }

  const smallTargets = []
  for (const el of document.querySelectorAll('button, a[href], select, input[type="checkbox"], input[type="radio"]')) {
    if (!visible(el)) continue
    if (el.closest('.skip-link') || el.closest('[aria-hidden="true"]')) continue
    const rect = el.getBoundingClientRect()
    const minEdge = window.innerWidth <= 720 ? 44 : 24
    const label = el.closest('label')
    const box = label && (el.type === 'checkbox' || el.type === 'radio') ? label.getBoundingClientRect() : rect
    if (box.height < minEdge || rect.width < 18) {
      smallTargets.push({
        text: norm(el.innerText || el.getAttribute('aria-label') || el.id || el.tagName).slice(0, 40),
        className: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      })
    }
  }

  const unlabeled = []
  for (const el of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
    if (!visible(el)) continue
    const id = el.id
    const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null
    const wrapped = el.closest('label')
    const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
    if (!label && !wrapped && !aria) {
      unlabeled.push({ tag: el.tagName.toLowerCase(), id, type: el.getAttribute('type') || '' })
    }
  }

  const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id)
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    h1: Array.from(document.querySelectorAll('h1')).map((el) => norm(el.innerText)),
    contrast,
    smallTargets,
    unlabeled,
    duplicateIds,
    liveRegions: document.querySelectorAll('[aria-live], [role="status"], [role="alert"]').length,
    imagesWithoutAlt: Array.from(document.querySelectorAll('img')).filter((img) => !img.hasAttribute('alt')).length,
  }
}

await mkdir(outDir, { recursive: true })
const report = []

async function auditEntry(pageName, role, tabs = [{ label: '', slug: 'default' }]) {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    await withBrowser({ windowSize: { width: viewport.width, height: viewport.height } }, async (page) => {
      await page.navigate(`${base}/${pageName}.html`)
      await page.clearLocalStorage()
      await page.reload()
      if (pageName === 'community') await page.setMembership(role)
      for (const tab of tabs) {
        if (tab.label) {
          if (pageName === 'community') await page.setMembership(tab.slug === 'moderation' ? 'reviewer' : role)
          const selector = viewport.name === 'mobile' ? '.mobile-nav button' : '.side-nav button'
          const clicked = await page.eval((sel, label) => {
            const node = Array.from(document.querySelectorAll(sel)).find((item) => (item.innerText || '').includes(label))
            if (!node) return false
            node.click()
            return true
          }, selector, tab.label)
          if (!clicked) {
            console.log(`[skip] ${pageName}/${tab.slug}/${viewport.name}: nav not found`)
            continue
          }
        }
        await sleep(450)
        const result = await page.eval(AUDIT)
        result.entry = pageName
        result.role = pageName === 'community' ? role : 'intake'
        result.tab = tab.slug
        result.viewportName = viewport.name
        report.push(result)
        console.log(`[${pageName}/${result.role}/${tab.slug}/${viewport.name}] overflow=${result.overflow} contrast=${result.contrast.length} smallTargets=${result.smallTargets.length} unlabeled=${result.unlabeled.length} h1=${JSON.stringify(result.h1)}`)
        if (result.contrast.length) console.log('  contrast:', JSON.stringify(result.contrast.slice(0, 8)))
        if (result.smallTargets.length) console.log('  targets:', JSON.stringify(result.smallTargets.slice(0, 8)))
      }
    })
  }
}

const tabs = [
  { label: '首页', slug: 'home' },
  { label: '社区', slug: 'community' },
  { label: '发布', slug: 'publish' },
  { label: '消息', slug: 'messages' },
  { label: '我的', slug: 'profile' },
  { label: '审核', slug: 'moderation' },
]
await auditEntry('index', 'member')
await auditEntry('community', 'member', tabs)

await writeFile(join(outDir, 'report.json'), JSON.stringify({ base, generatedAt: new Date().toISOString(), report }, null, 2), 'utf8')
console.log(`\nReport: ${join(outDir, 'report.json')}`)
