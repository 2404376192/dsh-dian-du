/**
 * Host-half self test: registers /dian-du against a fake Cordis context and a
 * fake LLM stream, then checks the command's answer and failure paths.
 *
 * Run: node test/host.test.mjs
 */
import assert from 'node:assert/strict'

const mod = await import('../index.js')

function makeCtx(chunks) {
  const registered = new Map()
  const ctx = {
    effect(fn) {
      return fn()
    },
    commands: {
      register(definition) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
    },
    llm: {
      async *stream(options) {
        for (const chunk of chunks(options)) yield chunk
      },
    },
  }
  return { ctx, registered }
}

async function runHandler(command, payload) {
  return command.handler({ rawInput: typeof payload === 'string' ? payload : JSON.stringify(payload) })
}

// 1. happy path: collects text deltas
{
  const { ctx, registered } = makeCtx(() => [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '位运算符 ' },
    { type: 'text-delta', index: 0, text: '按二进制位计算。' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  mod.apply(ctx, { provider: 'deepseek-official', model: 'deepseek-flash' })
  const command = registered.get('dian-du')
  assert.ok(command, 'command is registered')
  assert.deepEqual(mod.inject, ['commands', 'llm'], 'declares optional services')
  const result = await runHandler(command, { items: [{ text: 'a <<= 2' }], question: '这行干嘛' })
  assert.equal(result.kind, 'success')
  assert.equal(result.text, '位运算符 按二进制位计算。')
}

// 2. provider/model passed through from config
{
  let seen
  const { ctx, registered } = makeCtx((options) => {
    seen = options
    return [{ type: 'text-delta', index: 0, text: 'ok' }, { type: 'finish', reason: { kind: 'stop' } }]
  })
  mod.apply(ctx, { provider: 'p', model: 'm' })
  await runHandler(registered.get('dian-du'), { items: [{ text: 'x' }], question: '' })
  assert.equal(seen.provider, 'p')
  assert.equal(seen.model, 'm')
  assert.equal(seen.messages.length, 1)
  assert.equal(seen.messages[0].role, 'user')
  assert.ok(seen.messages[0].content[0].text.includes('x'))
  assert.ok(seen.messages[0].content[0].text.includes('请用更简单的方式解释'), 'default question is appended')
}

// 3. empty input fails without calling the model
{
  let called = false
  const { ctx, registered } = makeCtx(() => {
    called = true
    return []
  })
  mod.apply(ctx, {})
  const result = await runHandler(registered.get('dian-du'), { items: [], question: '   ' })
  assert.equal(result.kind, 'error')
  assert.equal(called, false)
}

// 4. a throwing stream becomes a command error, not an unhandled rejection
{
  const ctx = {
    effect: (fn) => fn(),
    commands: { register: (definition) => { ctx.command = definition; return () => {} } },
    llm: {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('boom')
      },
    },
  }
  mod.apply(ctx, {})
  const result = await runHandler(ctx.command, { items: [{ text: 'x' }], question: '?' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /模型调用失败.*boom/)
}

// 5. plain text input (no JSON) is treated as the question
{
  const { ctx, registered } = makeCtx(() => [
    { type: 'text-delta', index: 0, text: '好的' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  mod.apply(ctx, {})
  const result = await runHandler(registered.get('dian-du'), '这段什么意思')
  assert.equal(result.kind, 'success')
  assert.equal(result.text, '好的')
}

console.log('host tests: all passed')
