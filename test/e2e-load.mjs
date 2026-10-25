/**
 * Headless end-to-end check against an isolated DSH web instance.
 * Launches Chrome headless, loads the page, and reports whether the plugin's
 * client half applies (its style tag exists) plus any console errors it logged.
 *
 * Usage: node e2e-load.mjs <page-url> <chrome-path>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2]
const chrome = process.argv[3]
if (!url || !chrome) {
  console.error('usage: node e2e-load.mjs <url> <chrome>')
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'dsh-e2e-'))
const port = 9333
const child = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    url,
  ],
  { stdio: 'ignore', windowsHide: true },
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function targets() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    return await response.json()
  } catch {
    return []
  }
}

let page
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  const list = await targets()
  page = list.find((target) => target.type === 'page' && target.url.startsWith('http'))
  if (page) break
}
if (!page) {
  console.error('no page target')
  child.kill()
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const logs = []
const errors = []

function send(method, params = {}) {
  const id = nextId
  nextId += 1
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve) => pending.set(id, resolve))
}

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result)
    pending.delete(message.id)
    return
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args || [])
      .map((arg) => arg.value ?? arg.description ?? arg.type)
      .join(' ')
    logs.push(`[${message.params.type}] ${text}`)
  }
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails?.exception?.description ?? 'exception')
  }
})

await new Promise((resolve) => ws.addEventListener('open', resolve))
await send('Runtime.enable')
await send('Page.enable')
await sleep(9000)

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true })
  return result?.result?.value
}

const state = {
  url: page.url,
  styleInjected: await evaluate("!!document.querySelector('style[data-dian-du]')"),
  styleCount: await evaluate("document.querySelectorAll('style').length"),
  bodyText: await evaluate('document.body.innerText.slice(0, 120)'),
  moduleLoaded: await evaluate("!!document.querySelector('script[src*=\"dsh-dian-du\"]') || performance.getEntriesByType('resource').some((e) => e.name.includes('dsh-dian-du'))"),
}

console.log(JSON.stringify({ state, logs: logs.filter((line) => line.includes('dian-du')), errors: errors.slice(0, 5) }, null, 2))

ws.close()
child.kill()
await sleep(500)
