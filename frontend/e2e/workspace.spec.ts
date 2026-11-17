import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Workspace } from '../src/workspace'

async function setup(page: Page) {
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { authenticated: true, username: 'Asha', isAdmin: false } }))
  await page.route('**/api/models*', (route) => route.fulfill({ json: { providers: [{ provider: 'gemini', label: 'Google Gemini', models: ['gemini-test-lite'], defaultModel: 'gemini-test-lite', status: 'available' }] } }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'AI Chat', exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'AI Chat', exact: false }).click()
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message your project assistant' }).fill(text)
  await page.getByRole('button', { name: 'Send ↑', exact: true }).click()
}

function result(workspace: Workspace, answer: string, changes: string[]) {
  return [
    { type: 'status', message: 'Understanding your request…' },
    { type: 'delta', text: answer },
    { type: 'result', answer, changes, workspace, model: 'gemini-test-lite', durationMs: 800 },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n'
}

test('natural-language project creation applies tasks, calendar dates and supports undo', async ({ page }) => {
  await setup(page)
  await page.route('**/api/chat/stream', async (route) => {
    const input = route.request().postDataJSON()
    expect(input.message).toContain('Please create')
    const workspace: Workspace = input.workspace
    workspace.projects.push({ id: 200, name: 'Customer Portal', tasks: [{ id: 201, title: 'Design screens', assignee: 'Asha', timeline: '2027-01-15', notes: 'Use the brand palette.', createdBy: 'Asha', updatedBy: 'Asha', status: 'Backlog' }] })
    workspace.selectedProjectId = 200
    await route.fulfill({ contentType: 'application/x-ndjson', body: result(workspace, 'Let’s set that up.', ['Created Customer Portal.', 'Added Design screens for Asha.']) })
  })
  await send(page, 'Please create Customer Portal and add Design screens for Asha by January 15')
  await expect(page.getByText('✓ Changes applied')).toBeVisible()
  await page.getByRole('button', { name: 'View updated board ↗' }).click()
  await expect(page.getByRole('heading', { name: 'Design screens', exact: true })).toBeVisible()
  await expect(page.getByLabel('Task deadline')).toHaveAttribute('type', 'date')
  await page.getByRole('button', { name: 'AI Chat', exact: false }).click()
  await page.getByRole('button', { name: 'Undo these changes' }).click()
  await expect(page.getByText('These changes were undone.')).toBeVisible()
  const projects = await page.evaluate(() => JSON.parse(localStorage.getItem('jetson.workspace.projects.v1') || '[]'))
  expect(projects.some((p: { name: string }) => p.name === 'Customer Portal')).toBe(false)
})

test('chat reminder delegates to the agent, persists and is monitored', async ({ page }) => {
  await setup(page)
  await page.route('**/api/chat/stream', async (route) => {
    const workspace: Workspace = route.request().postDataJSON().workspace
    workspace.reminders.push({ id: 300, title: 'Review launch', dueAt: '2099-01-15T10:00:00+05:30', notes: '', status: 'pending' })
    await route.fulfill({ contentType: 'application/x-ndjson', body: result(workspace, 'I’ll send that to the Reminder Agent.', ['Reminder Agent: scheduled Review launch.']) })
  })
  await send(page, 'Remind me to review the launch tomorrow at 10 AM')
  await expect(page.getByText('✓ Changes applied')).toBeVisible()
  await page.getByRole('button', { name: 'Agents', exact: false }).click()
  await page.getByRole('button', { name: 'Follow-up', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Reminder Agent monitor' })).toBeVisible()
  await expect(page.getByText('Review launch', { exact: true })).toBeVisible()
  await expect(page.getByText(/● Monitoring/)).toBeVisible()
  await page.getByRole('button', { name: 'Mark done', exact: true }).click()
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
})

test('clarification has no mutations and next turn carries history', async ({ page }) => {
  await setup(page)
  let turn = 0
  await page.route('**/api/chat/stream', async (route) => {
    const input = route.request().postDataJSON()
    if (turn++) expect(input.history.some((m: { content: string }) => m.content.includes('What should I call'))).toBe(true)
    await route.fulfill({ contentType: 'application/x-ndjson', body: result(input.workspace, 'What should I call the project?', []) })
  })
  await send(page, 'Can you create a project?')
  await expect(page.getByText('What should I call the project?', { exact: true })).toBeVisible()
  await expect(page.getByText('✓ Changes applied')).toHaveCount(0)
  await send(page, 'Call it Inventory')
  await expect(page.getByRole('button', { name: 'Send ↑' })).toBeEnabled()
})

test('an interrupted response does not apply edits and allows retry', async ({ page }) => {
  await setup(page)
  await page.route('**/api/chat/stream', (route) => route.fulfill({ contentType: 'application/x-ndjson', body: '{"type":"delta","text":"Working on it"}\n' }))
  await send(page, 'Add a testing task')
  await expect(page.getByText(/connection was interrupted/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again ↻' })).toBeEnabled()
  await expect(page.getByText('✓ Changes applied')).toHaveCount(0)
})

test('stop cancels a slow request without claiming success', async ({ page }) => {
  await setup(page)
  await page.route('**/api/chat/stream', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await route.fulfill({ contentType: 'application/x-ndjson', body: '{"type":"status","message":"Working"}\n' }).catch(() => {})
  })
  await send(page, 'Add a task')
  await page.getByRole('button', { name: '■ Stop' }).click()
  await expect(page.getByText('Stopped. No project changes were applied.', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send ↑' })).toBeVisible()
})

test('overview removes storage count and layout fits the viewport', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await setup(page)
  await page.getByRole('button', { name: 'Overview', exact: false }).click()
  await expect(page.getByText('Storage items', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Scheduled reminders', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})
