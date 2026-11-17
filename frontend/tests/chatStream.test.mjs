import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function load(file) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { readChatStream } = await load('chatStream.ts')
const { isProjects, isWorkspace } = await load('workspace.ts')
function response(chunks) {
  return new Response(new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close() } }))
}
const encoder = new TextEncoder()
const result = { type: 'result', answer: 'Done ✓', changes: [] }

test('NDJSON survives arbitrary byte boundaries including Unicode and final line without newline', async () => {
  const bytes = encoder.encode(`${JSON.stringify({ type: 'delta', text: 'Hello ✓' })}\n${JSON.stringify(result)}`)
  const events = []
  await readChatStream(response([...bytes].map((byte) => Uint8Array.of(byte))), (event) => events.push(event))
  assert.equal(events[0].text, 'Hello ✓')
  assert.equal(events[1].answer, 'Done ✓')
})

test('interrupted reply cannot be treated as a successful change', async () => {
  await assert.rejects(readChatStream(response([encoder.encode('{"type":"delta","text":"partial"}\n')]), () => {}), /interrupted/)
})

test('error after a result rejects the batch instead of applying it', async () => {
  const text = `${JSON.stringify(result)}\n${JSON.stringify({ type: 'error', message: 'broken' })}\n`
  await assert.rejects(readChatStream(response([encoder.encode(text)]), () => {}), /after the final result/)
})

test('provider error is surfaced as a readable error', async () => {
  await assert.rejects(readChatStream(response([encoder.encode('{"type":"error","message":"Rate limited"}\n')]), () => {}), /Rate limited/)
})

test('malformed action receipts and unknown events are rejected', async () => {
  for (const value of [{ type: 'unknown' }, { ...result, changes: 'not-an-array' }, { ...result, answer: '' }]) {
    await assert.rejects(readChatStream(response([encoder.encode(JSON.stringify(value))]), () => {}))
  }
})

test('corrupt persisted projects and invalid selected project are rejected', () => {
  assert.equal(isProjects([{ name: 'Broken' }]), false)
  assert.equal(isProjects([{ id: 1, name: 'Broken', tasks: [{ id: 2, title: 'Task' }] }]), false)
  assert.equal(isWorkspace({ projects: [], selectedProjectId: 42, reminders: [] }), false)
  assert.equal(isWorkspace({ projects: [], selectedProjectId: null, reminders: [] }), true)
  assert.equal(isProjects([{ id: 1, name: 'A', tasks: [] }, { id: 1, name: 'B', tasks: [] }]), false)
})
