/**
 * cdp.mjs — zero-dependency Chrome DevTools Protocol driver for local browser checks.
 *
 * Runs on Node >= 22 using only built-in `fetch`, `WebSocket` and `node:*` modules.
 * Windows-first: launches a local headless Chrome (falls back to Edge), drives one
 * page target with Runtime.evaluate / Page.navigate / Page.captureScreenshot, and
 * exposes helpers for text-based clicking, form filling, localStorage reads and
 * condition polling.
 *
 * This file is a verification tool: it never ships to the app bundle.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const BROWSER_CANDIDATES = [
  { name: 'Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
  { name: 'Chrome (x86)', path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
  { name: 'Edge (x86)', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
  { name: 'Edge', path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
]

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Pick the first installed local Chromium browser. */
export function findBrowser(explicitPath = '') {
  const candidates = explicitPath
    ? [{ name: 'explicit', path: explicitPath }, ...BROWSER_CANDIDATES]
    : BROWSER_CANDIDATES
  for (const candidate of candidates) {
    if (candidate.path && existsSync(candidate.path)) return candidate
  }
  throw new Error(
    `No local Chrome/Edge executable found. Tried:\n${BROWSER_CANDIDATES.map((item) => item.path).join('\n')}`,
  )
}

/** Reserve an ephemeral TCP port on 127.0.0.1, then release it for the browser. */
export async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('could not allocate a TCP port'))))
    })
  })
}

async function fetchJson(url, { timeoutMs = 1500 } = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.json()
}

export class CdpError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'CdpError'
    this.details = details
  }
}

/** One WebSocket CDP connection (flat protocol; page or browser target). */
export class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    this.handlers = new Map()
    this.closed = false
    this.eventLog = []
    ws.addEventListener('message', (event) => this.#onMessage(event))
    ws.addEventListener('close', () => this.#onClose())
    ws.addEventListener('error', () => {
      /* surfaced by the close/timeout paths */
    })
  }

  static async open(wsUrl, { timeoutMs = 10000 } = {}) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out opening CDP WebSocket ${wsUrl}`)),
        timeoutMs,
      )
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      })
      ws.addEventListener('error', (event) => {
        clearTimeout(timer)
        reject(new Error(`Failed to open CDP WebSocket ${wsUrl}: ${event?.message ?? 'error'}`))
      })
    })
    return new CdpClient(ws)
  }

  #onMessage(event) {
    let message
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    } catch {
      return
    }
    if (typeof message.id === 'number') {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) {
        entry.reject(new CdpError(`CDP ${entry.method} failed: ${message.error.message}`, message.error))
      } else {
        entry.resolve(message.result ?? {})
      }
      return
    }
    if (message.method) {
      this.eventLog.push({ method: message.method, params: message.params, at: Date.now() })
      if (this.eventLog.length > 500) this.eventLog.shift()
      for (const handler of this.handlers.get(message.method) ?? []) {
        try {
          handler(message.params)
        } catch {
          /* handler errors must not break the protocol loop */
        }
      }
    }
  }

  #onClose() {
    this.closed = true
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(`CDP connection closed before ${entry.method} answered`))
    }
    this.pending.clear()
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(handler)
    return () => {
      const list = this.handlers.get(method) ?? []
      const index = list.indexOf(handler)
      if (index >= 0) list.splice(index, 1)
    }
  }

  send(method, params = {}, { timeoutMs = 20000 } = {}) {
    if (this.closed) return Promise.reject(new Error(`CDP connection closed; cannot send ${method}`))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CdpError(`CDP ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, method })
      try {
        this.ws.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  close() {
    this.closed = true
    try {
      this.ws.close()
    } catch {
      /* already closed */
    }
  }
}

const VISIBLE_HELPER = `
  const __norm = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const __visible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  };
  const __label = (el) => __norm(el.innerText || el.textContent);
  const __root = (selector) => document.querySelector(selector) || document;
  const __search = (root, selector) => Array.from(root.querySelectorAll(selector));
  const __pick = (nodes, labels, exact) => {
    const wanted = labels.map(__norm);
    for (const node of nodes) {
      if (!__visible(node)) continue;
      if (node.disabled) continue;
      const text = __label(node);
      if (exact && wanted.includes(text)) return node;
    }
    for (const node of nodes) {
      if (!__visible(node)) continue;
      if (node.disabled) continue;
      const text = __label(node);
      if (!exact && wanted.some((wantedText) => text.includes(wantedText))) return node;
    }
    return null;
  };
`

/** One launched browser with one driven page target. */
export class BrowserSession {
  constructor({ child, browser, port, userDataDir, page, client }) {
    this.child = child
    this.browser = browser
    this.port = port
    this.userDataDir = userDataDir
    this.page = page
    this.client = client
    this.pageErrors = []
    this.consoleErrors = []
  }

  static async launch(options = {}) {
    const {
      browserPath = '',
      headless = true,
      windowSize = { width: 1440, height: 1000 },
      startupTimeoutMs = 25000,
      extraArgs = [],
    } = options
    const browser = findBrowser(browserPath)
    const port = await findFreePort()
    const userDataDir = join(tmpdir(), `dsh-cdp-${process.pid}-${Date.now()}`)
    await mkdir(userDataDir, { recursive: true })
    const args = [
      headless ? '--headless=new' : '',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--hide-scrollbars',
      '--mute-audio',
      `--window-size=${windowSize.width},${windowSize.height}`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      ...extraArgs,
      'about:blank',
    ].filter(Boolean)

    const child = spawn(browser.path, args, { stdio: 'ignore', windowsHide: true })
    const launchState = { exited: false, exitCode: null, spawnError: null }
    child.on('error', (error) => {
      launchState.spawnError = error
    })
    child.on('exit', (code) => {
      launchState.exited = true
      launchState.exitCode = code
    })

    const deadline = Date.now() + startupTimeoutMs
    let version = null
    while (Date.now() < deadline) {
      if (launchState.spawnError) {
        throw new Error(`Browser failed to start: ${launchState.spawnError.message}`)
      }
      if (launchState.exited) {
        throw new Error(
          `Browser process exited before DevTools was ready (code ${launchState.exitCode}) using ${browser.path}`,
        )
      }
      try {
        version = await fetchJson(`http://127.0.0.1:${port}/json/version`, { timeoutMs: 1000 })
        break
      } catch {
        await sleep(120)
      }
    }
    if (!version) {
      await killProcessTree(child)
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
      throw new Error(`Timed out waiting for DevTools endpoint on port ${port}`)
    }

    let page = null
    while (Date.now() < deadline) {
      try {
        const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`, { timeoutMs: 1000 })
        page = (Array.isArray(targets) ? targets : []).find((target) => target.type === 'page' && target.webSocketDebuggerUrl) ?? null
        if (page) break
      } catch {
        /* retry until deadline */
      }
      await sleep(120)
    }
    if (!page) {
      await killProcessTree(child)
      throw new Error(`No page target available on port ${port}`)
    }

    const client = await CdpClient.open(page.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Page.bringToFront').catch(() => {})
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: windowSize.width,
      height: windowSize.height,
      deviceScaleFactor: 1,
      mobile: false,
    })

    const session = new BrowserSession({ child, browser, port, userDataDir, page, client })
    session.browserVersion = version
    client.on('Runtime.exceptionThrown', (params) => {
      const description = params?.exceptionDetails?.exception?.description
        ?? params?.exceptionDetails?.text
        ?? 'unknown page exception'
      session.pageErrors.push(description)
    })
    client.on('Runtime.consoleAPICalled', (params) => {
      if (params?.type !== 'error' && params?.type !== 'warning') return
      const text = (params.args ?? [])
        .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description ?? ''))
        .join(' ')
        .trim()
      if (text) session.consoleErrors.push(`${params.type}: ${text}`)
    })
    return session
  }

  /** Evaluate JS in the page; `fn` may be a function (serialized) or an expression string. */
  async eval(fn, ...args) {
    const expression = typeof fn === 'function'
      ? `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(',')})`
      : String(fn)
    const result = await this.client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    })
    if (result.exceptionDetails) {
      const details = result.exceptionDetails
      const description = details.exception?.description ?? details.text ?? 'unknown evaluation error'
      throw new CdpError(`Page evaluation failed: ${description}`, details)
    }
    return result.result?.value
  }

  async navigate(url, { waitForReady = true, timeoutMs = 30000 } = {}) {
    await this.client.send('Page.navigate', { url })
    if (waitForReady) {
      await this.waitForExpression(
        "document.readyState === 'complete'",
        { timeoutMs, intervalMs: 100, label: `document ready at ${url}` },
      )
    }
    return url
  }

  async reload({ timeoutMs = 30000 } = {}) {
    await this.client.send('Page.reload', { ignoreCache: true })
    await this.waitForExpression(
      "document.readyState === 'complete'",
      { timeoutMs, intervalMs: 100, label: 'document ready after reload' },
    )
  }

  /**
   * 断网 / 恢复网络（CDP Network.emulateNetworkConditions）。
   * 断网会同时影响页面自身的 fetch 与 Service Worker 的 fetch；
   * 已缓存资源仍由 SW 从 Cache Storage 返回，这正是离线门禁要验证的行为。
   */
  async setOffline(offline) {
    await this.client.send('Network.enable')
    await this.client.send('Network.emulateNetworkConditions', {
      offline: Boolean(offline),
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })
  }

  /** Poll a boolean JS expression until it is truthy. */
  async waitForExpression(expression, { timeoutMs = 15000, intervalMs = 120, label = '' } = {}) {
    const started = Date.now()
    let lastError = null
    while (Date.now() - started < timeoutMs) {
      try {
        const value = await this.eval(`Boolean(${expression})`)
        if (value === true) return true
      } catch (error) {
        lastError = error
      }
      await sleep(intervalMs)
    }
    throw new Error(
      `waitForExpression timed out${label ? ` (${label})` : ''} after ${timeoutMs}ms: ${expression}`
      + (lastError ? ` — last error: ${lastError.message}` : ''),
    )
  }

  /** Poll document.body.innerText until it contains every text in `texts`. */
  async waitForText(texts, { timeoutMs = 15000, intervalMs = 150, label = '' } = {}) {
    const wanted = Array.isArray(texts) ? texts : [texts]
    const started = Date.now()
    let lastText = ''
    while (Date.now() - started < timeoutMs) {
      try {
        lastText = await this.bodyText()
        if (wanted.every((text) => lastText.includes(text))) return true
      } catch {
        /* navigation in flight */
      }
      await sleep(intervalMs)
    }
    const missing = wanted.filter((text) => !lastText.includes(text))
    throw new Error(
      `waitForText timed out${label ? ` (${label})` : ''} after ${timeoutMs}ms; missing: ${JSON.stringify(missing)}; body starts: ${JSON.stringify(lastText.slice(0, 300))}`,
    )
  }

  async waitForSelector(selector, { timeoutMs = 15000, intervalMs = 120 } = {}) {
    const safeSelector = JSON.stringify(selector)
    return this.waitForExpression(
      `document.querySelector(${safeSelector})`,
      { timeoutMs, intervalMs, label: selector },
    )
  }

  async bodyText() {
    const text = await this.eval(() => document.body?.innerText ?? '')
    return typeof text === 'string' ? text : ''
  }

  async title() {
    return this.eval(() => document.title)
  }

  async url() {
    return this.eval(() => location.href)
  }

  /** Click the first visible enabled button/link whose normalized text matches `labels`. */
  async clickByText(labels, options = {}) {
    const {
      selector = 'button, a, [role="button"], [role="tab"], input[type="submit"]',
      exact = true,
      withinSelector = '',
      withinText = '',
      timeoutMs = 15000,
    } = options
    const wanted = Array.isArray(labels) ? labels : [labels]
    const findExpression = `
      (() => {
        ${VISIBLE_HELPER}
        let root = document;
        if (${JSON.stringify(withinSelector)}) {
          const containers = __search(document, ${JSON.stringify(withinSelector)})
            .filter((node) => __label(node).includes(${JSON.stringify(withinText)}));
          if (!containers.length) return { found: false, reason: 'container-not-found' };
          root = containers[0];
        }
        const node = __pick(__search(root, ${JSON.stringify(selector)}), ${JSON.stringify(wanted)}, ${exact ? 'true' : 'false'});
        if (!node) return { found: false, reason: 'no-matching-visible-enabled-node' };
        node.scrollIntoView({ block: 'center', inline: 'nearest' });
        node.click();
        return { found: true, text: __label(node), tag: node.tagName };
      })()
    `
    const started = Date.now()
    let lastResult = null
    while (Date.now() - started < timeoutMs) {
      lastResult = await this.eval(findExpression)
      if (lastResult?.found) return lastResult
      await sleep(120)
    }
    throw new Error(
      `clickByText(${JSON.stringify(wanted)}) not found after ${timeoutMs}ms; last attempt: ${JSON.stringify(lastResult)}`,
    )
  }

  async clickSelector(selector, { timeoutMs = 15000 } = {}) {
    const safeSelector = JSON.stringify(selector)
    await this.waitForExpression(`document.querySelector(${safeSelector})`, { timeoutMs, label: selector })
    const result = await this.eval(`
      (() => {
        ${VISIBLE_HELPER}
        const node = document.querySelector(${safeSelector});
        if (!node) return { found: false };
        node.scrollIntoView({ block: 'center', inline: 'nearest' });
        node.click();
        return { found: true, tag: node.tagName, text: __label(node) };
      })()
    `)
    if (!result?.found) throw new Error(`clickSelector(${selector}) could not click the element`)
    return result
  }

  /** Set an input/textarea value through the native prototype setter and fire input/change. */
  async setValue(selector, value, { timeoutMs = 15000 } = {}) {
    const safeSelector = JSON.stringify(selector)
    await this.waitForExpression(`document.querySelector(${safeSelector})`, { timeoutMs, label: selector })
    const result = await this.eval((sel, nextValue) => {
      const node = document.querySelector(sel)
      if (!node) return { ok: false, reason: 'missing' }
      const proto = node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : node instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : node instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : null
      if (!proto) return { ok: false, reason: 'unsupported-element' }
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(node, nextValue)
      else node.value = nextValue
      node.dispatchEvent(new Event('input', { bubbles: true }))
      node.dispatchEvent(new Event('change', { bubbles: true }))
      node.dispatchEvent(new Event('blur', { bubbles: true }))
      return { ok: true, tag: node.tagName, value: node.value }
    }, selector, value)
    if (!result?.ok) throw new Error(`setValue(${selector}) failed: ${JSON.stringify(result)}`)
    return result
  }

  /** Fill the first input/textarea inside a <label> whose normalized text includes `labelText`. */
  async fillByLabel(labelText, value, { exactLabel = false, timeoutMs = 15000 } = {}) {
    const result = await this.eval((text, nextValue, exact) => {
      const normalize = (input) => (input || '').replace(/\s+/g, ' ').trim()
      const wanted = normalize(text)
      const labels = Array.from(document.querySelectorAll('label'))
      const matches = labels.filter((label) => {
        const labelTextValue = normalize(label.innerText || label.textContent)
        return exact ? labelTextValue === wanted : labelTextValue.includes(wanted)
      })
      for (const label of matches) {
        const node = label.querySelector('input, textarea')
        if (!node) continue
        const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        if (setter) setter.call(node, nextValue)
        else node.value = nextValue
        node.dispatchEvent(new Event('input', { bubbles: true }))
        node.dispatchEvent(new Event('change', { bubbles: true }))
        node.scrollIntoView({ block: 'center', inline: 'nearest' })
        return { ok: true, label: normalize(label.innerText || label.textContent).slice(0, 80), tag: node.tagName }
      }
      return {
        ok: false,
        reason: 'label-or-field-not-found',
        labels: labels.map((label) => normalize(label.innerText || label.textContent)).slice(0, 40),
      }
    }, labelText, value, exactLabel)
    if (!result?.ok) {
      throw new Error(`fillByLabel(${JSON.stringify(labelText)}) failed: ${JSON.stringify(result)} (timeoutMs=${timeoutMs})`)
    }
    return result
  }

  /** Set a <select> value and dispatch change (for Vue @change handlers). */
  async selectValue(selector, value) {
    return this.setValue(selector, value)
  }

  async checkSelector(selector) {
    const result = await this.eval((sel) => {
      const node = document.querySelector(sel)
      if (!node) return { ok: false, reason: 'missing' }
      if (node instanceof HTMLInputElement && node.type === 'checkbox') {
        if (!node.checked) node.click()
      } else {
        node.click()
      }
      return { ok: true, checked: node.checked ?? null }
    }, selector)
    if (!result?.ok) throw new Error(`checkSelector(${selector}) failed`)
    return result
  }

  /** Scroll an element containing `text` into view (for readable screenshots). */
  async scrollToText(text, { selector = 'body *', timeoutMs = 5000 } = {}) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const result = await this.eval((wanted, nodeSelector) => {
        const normalize = (input) => (input || '').replace(/\s+/g, ' ').trim()
        const nodes = Array.from(document.querySelectorAll(nodeSelector))
        for (const node of nodes) {
          if (!normalize(node.innerText || node.textContent).includes(wanted)) continue
          node.scrollIntoView({ block: 'center', inline: 'nearest' })
          return { found: true, tag: node.tagName }
        }
        return { found: false }
      }, text, selector)
      if (result?.found) {
        await sleep(120)
        return result
      }
      await sleep(120)
    }
    throw new Error(`scrollToText(${JSON.stringify(text)}) not found`)
  }

  async scrollToTop() {
    await this.eval(() => window.scrollTo(0, 0))
    await sleep(100)
  }

  /** Capture a viewport PNG screenshot. */
  async screenshot(filePath) {
    const { data } = await this.client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    }, { timeoutMs: 30000 })
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, Buffer.from(data, 'base64'))
    return filePath
  }

  async savePageText(filePath) {
    const text = await this.bodyText()
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, text, 'utf8')
    return text
  }

  async readLocalStorage(key) {
    const raw = await this.eval((storageKey) => window.localStorage.getItem(storageKey), key)
    return typeof raw === 'string' ? raw : null
  }

  async readLocalStorageJson(key) {
    const raw = await this.readLocalStorage(key)
    if (raw === null) return null
    try {
      return JSON.parse(raw)
    } catch {
      return { __parseError: true, raw }
    }
  }

  async writeLocalStorage(key, value) {
    await this.eval((storageKey, storageValue) => {
      window.localStorage.setItem(storageKey, storageValue)
    }, key, typeof value === 'string' ? value : JSON.stringify(value))
  }

  async clearLocalStorage() {
    await this.eval(() => window.localStorage.clear())
  }

  async getMembership() {
    const value = await this.eval(() => {
      const select = document.querySelector('.membership-panel select')
      return select ? select.value : null
    })
    return value
  }

  async setMembership(role) {
    await this.setValue('.membership-panel select', role)
    await sleep(250)
    const current = await this.getMembership()
    if (current !== role) throw new Error(`membership did not switch to ${role} (got ${current})`)
    return current
  }

  async clickNav(label) {
    // Nav items include an icon glyph before the label, so match by substring.
    return this.clickByText(label, { selector: '.side-nav button', exact: false })
  }

  async count(selector) {
    return this.eval((sel) => document.querySelectorAll(sel).length, selector)
  }

  async close() {
    try {
      this.client.close()
    } catch {
      /* ignore */
    }
    await killProcessTree(this.child)
    await sleep(300)
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await rm(this.userDataDir, { recursive: true, force: true, maxRetries: 2 })
        break
      } catch {
        await sleep(250)
      }
    }
  }
}

async function killProcessTree(child) {
  if (!child || child.exitCode !== null) return
  const pid = child.pid
  if (!pid) return
  const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve()
    }, 5000)
    killer.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    killer.on('error', () => {
      clearTimeout(timer)
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve()
    })
  })
  await sleep(200)
}

/** Launch a browser, run `fn(session)`, always close the browser afterwards. */
export async function withBrowser(options, fn) {
  const session = await BrowserSession.launch(options)
  try {
    return await fn(session)
  } finally {
    await session.close()
  }
}

export { BROWSER_CANDIDATES }
