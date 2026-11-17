export type StreamEvent = {
  type: 'status' | 'delta' | 'result' | 'error'
  message?: string
  text?: string
  answer?: string
  changes?: string[]
  workspace?: unknown
  model?: string
  durationMs?: number
  firstTokenMs?: number
}

export async function readChatStream(response: Response, onEvent: (event: StreamEvent) => void) {
  if (!response.body) throw new Error('Streaming is unavailable. Please reload and try again.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  const consume = (line: string) => {
    if (!line.trim()) return
    const event: StreamEvent = JSON.parse(line)
    if (!event || !['status', 'delta', 'result', 'error'].includes(event.type)) throw new Error('The assistant sent an unreadable response.')
    if (finished) throw new Error('The assistant sent data after the final result. No changes were applied.')
    if (event.type === 'delta' && typeof event.text !== 'string') throw new Error('The reply was incomplete.')
    if (event.type === 'result' && (typeof event.answer !== 'string' || !event.answer.trim()
      || !Array.isArray(event.changes) || !event.changes.every((change) => typeof change === 'string'))) throw new Error('The assistant returned an invalid result. No changes were applied.')
    if (event.type === 'error') throw new Error(event.message || 'The AI request failed.')
    if (event.type === 'result') finished = true
    onEvent(event)
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      if (buffer.length > 128000) throw new Error('The reply was too large. Ask for a shorter response.')
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      lines.forEach(consume)
      if (done) break
    }
    consume(buffer)
    if (!finished) throw new Error('The connection was interrupted. No changes were applied; please try again.')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
