/**
 * Client-half smoke test: loads client.js against a fake DOM and a fake Cordis
 * client context, then checks the registrations and the click-to-mark /
 * Ctrl-to-clear behaviour without a browser.
 *
 * Run: node test/client.test.mjs
 */
import assert from 'node:assert/strict'

// ---- fake DOM -----------------------------------------------------------------
class FakeElement {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase()
    this.attrs = new Map()
    this.textContent = ''
  }
  setAttribute(name, value) {
    this.attrs.set(name, value)
  }
  getAttribute(name) {
    return this.attrs.get(name)
  }
  removeAttribute(name) {
    this.attrs.delete(name)
  }
  closest() {
    return null
  }
}
globalThis.Element = FakeElement

const listeners = new Map()
const appended = []

globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  head: { appendChild: (node) => appended.push(node) },
  body: {},
  addEventListener: (type, fn) => listeners.set(type, fn),
  removeEventListener: (type) => listeners.delete(type),
  querySelectorAll: () => [],
  querySelector: () => null,
}
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}

globalThis.window = {
  localStorage: {
    data: new Map(),
    getItem(key) {
      return this.data.has(key) ? this.data.get(key) : null
    },
    setItem(key, value) {
      this.data.set(key, value)
    },
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  getSelection: () => ({ isCollapsed: true, removeAllRanges() {} }),
  addEventListener: () => {},
  removeEventListener: () => {},
  getComputedStyle: () => ({ lineHeight: '18px', paddingTop: '0px', paddingLeft: '0px' }),
  __ModuleLoader__: { load: (definition) => (globalThis.__plugin = definition) },
}

// ---- load the plugin ----------------------------------------------------------
await import(new URL('../client.js', import.meta.url).href)
const plugin = globalThis.__plugin
assert.ok(plugin, 'bundle registers a module factory')
assert.equal(plugin.id, 'dsh-dian-du', 'module id equals the package name')

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
}
const requireStub = (specifier) => {
  if (specifier === 'react') return React
  throw new Error('unexpected require: ' + specifier)
}

const registeredTypes = []
const registeredSlots = []
const openedTabs = []
const remoteCalls = []

function makeCtx() {
  const ctx = {
    effect(fn) {
      return fn()
    },
    slots: {
      inject: (name, install) => install(),
      register: (options, component) => {
        registeredSlots.push({ options, component })
        return () => {}
      },
    },
    sidebarRightTabs: {
      register: (definition) => {
        registeredTypes.push(definition)
        return () => {}
      },
    },
    sidebarRight: {
      openTab: (kind) => openedTabs.push(kind),
      isExpanded: () => true,
    },
    remote: {
      session: {
        create: async () => {
          remoteCalls.push('create')
          return { ok: true, value: { sessionId: 'side-1' } }
        },
      },
      commands: {
        execute: async (sessionId, line) => {
          remoteCalls.push(['execute', sessionId, line])
          return { ok: true, value: { result: { kind: 'success', text: '解释文本' } } }
        },
      },
    },
    inject: (deps, callback) => callback(ctx),
  }
  return ctx
}

const body = plugin.factory(requireStub)
assert.deepEqual(body.inject, ['slots'], 'only slots is required to mount')
body.apply(makeCtx())

// ---- assertions: registrations ------------------------------------------------
assert.equal(registeredTypes.length, 1, 'one tab type registered')
const type = registeredTypes[0]
assert.equal(type.id, 'dsh-dian-du')
assert.equal(type.kind, 'dian-du')
assert.equal(type.guide.length, 1)
assert.equal(typeof type.title, 'function')
assert.equal(type.title(), '点读')
assert.equal(type.guide[0].title(), '点读')

const paneSlot = registeredSlots.find((entry) => entry.options.name === 'sidebar.right.pane.tab')
assert.ok(paneSlot, 'tab body registered into the right sidebar')
assert.equal(paneSlot.options.key, 'dsh-dian-du')
const overlaySlot = registeredSlots.find((entry) => entry.options.name === 'shell.overlay')
assert.ok(overlaySlot, 'overlay fallback registered')

// ---- assertions: click toggles a mark and opens the docked column -------------
const click = listeners.get('click')
assert.ok(click, 'click listener installed')

const row = new FakeElement('div')
row.querySelectorAll = () => [block]
row.closest = (selector) => {
  if (selector === '[data-chat-node-key]') return { dataset: { chatNodeKey: 'node-1' } }
  return null
}
const block = new FakeElement('p')
block.textContent = 'a <<= 2; // 等价 a = a << 2;'
block.closest = (selector) => {
  if (selector.includes(':is(')) return block
  if (selector === '[data-chat-group-part="response"]') return row
  return null
}

function fireClick(options = {}) {
  const event = {
    target: block,
    clientX: 10,
    clientY: 10,
    ctrlKey: Boolean(options.ctrlKey),
    preventDefault() {},
    stopPropagation() {},
  }
  click(event)
}

// pointerdown at the same place so the drag check sees a click, not a drag
listeners.get('pointerdown')({ clientX: 10, clientY: 10 })
fireClick()
assert.ok(block.getAttribute('data-dd-marked') !== undefined, 'click marks the block')
assert.deepEqual(openedTabs, ['dian-du'], 'selecting opens the docked 点读 tab')

// second click removes the mark
listeners.get('pointerdown')({ clientX: 10, clientY: 10 })
fireClick()
assert.equal(block.getAttribute('data-dd-marked'), undefined, 'second click clears the mark')

// Ctrl+click clears everything
listeners.get('pointerdown')({ clientX: 10, clientY: 10 })
fireClick()
assert.ok(block.getAttribute('data-dd-marked') !== undefined, 'marked again')
document.querySelectorAll = (selector) => (selector.includes('pre') ? [] : [block])
listeners.get('pointerdown')({ clientX: 10, clientY: 10 })
fireClick({ ctrlKey: true })
assert.equal(block.getAttribute('data-dd-marked'), undefined, 'Ctrl+click clears the mark')

// a lone Ctrl tap clears too
listeners.get('pointerdown')({ clientX: 10, clientY: 10 })
fireClick()
assert.ok(block.getAttribute('data-dd-marked') !== undefined, 'marked again for the Ctrl tap')
{
  const down = listeners.get('keydown')
  const up = listeners.get('keyup')
  down({ key: 'Control' })
  up({ key: 'Control' })
  assert.equal(block.getAttribute('data-dd-marked'), undefined, 'a lone Ctrl tap clears')
}

console.log('client tests: all passed')
