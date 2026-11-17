import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { useLocalState } from './useLocalState'
import { readChatStream } from './chatStream'
import { isProjects, isReminders, isWorkspace, statuses, formatTimeline } from './workspace'
import type { ProjectItem, ProjectTask, TaskStatus, Workspace, ReminderItem } from './workspace'

type ProviderInfo = {
  provider: string
  label: string
  models: string[]
  defaultModel: string
  status?: string
}

type ChatMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  changes?: string[]
  error?: boolean
  pending?: boolean
  durationMs?: number
  retryText?: string
}

type SectionKey = 'Overview' | 'AI Chat' | 'Workbench' | 'Agents' | 'Storage'

type AgentKey = 'documentation' | 'reminders'

type StorageEntry = {
  id: number
  name: string
  type: 'folder' | 'file'
  parentId: number | null
  size?: string
  downloadUrl?: string
  lastUpdated?: string
}

function App() {
  const chatEndRef = useRef<HTMLDivElement>(null)
  const messageSequence = useRef(0)
  const followConversationRef = useRef(true)
  const [storageWarning, setStorageWarning] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const workspaceRef = useRef<Workspace>({ projects: [], selectedProjectId: null, reminders: [] })
  const [isAdmin, setIsAdmin] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [chatProgress, setChatProgress] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [lastChange, setLastChange] = useState<{ before: Workspace; after: string; messageId: number } | null>(null)
  const [taskSearch, setTaskSearch] = useState('')
  const [taskOwner, setTaskOwner] = useState('')

  const [authenticated, setAuthenticated] = useState(false)
  const [username, setUsername] = useState('admin')
  const [loginForm, setLoginForm] = useState({ username: 'admin', password: '' })
  const [guestName, setGuestName] = useState('')
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [selectedProvider, setSelectedProvider] = useState('gemini')
  const [selectedModel, setSelectedModel] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [historyItems, setHistoryItems] = useState<ChatMessage[]>([])
  const [activeSection, setActiveSection] = useState<SectionKey>('Overview')
  const [enabledAgents, setEnabledAgents] = useLocalState<Record<AgentKey, boolean>>('jetson.workspace.agents.v1', {
    documentation: false,
    reminders: false,
  }, (value): value is Record<AgentKey, boolean> => !!value && typeof value === 'object' && 'documentation' in value && 'reminders' in value && typeof value.documentation === 'boolean' && typeof value.reminders === 'boolean')
  const [reminders, setReminders] = useLocalState<ReminderItem[]>('jetson.workspace.reminders.v1', [], isReminders)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const notifiedRemindersRef = useRef(new Set<number>())
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const [reminderDraft, setReminderDraft] = useState({ title: '', dueAt: '' })
  const [documentationMessages, setDocumentationMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      content: 'Documentation agent ready. Upload a text source (.txt, .md, .csv, .json) and I will draft a document or an HTML presentation outline.',
    },
  ])
  const [documentationInput, setDocumentationInput] = useState('')
  const [documentationSkills, setDocumentationSkills] = useState<Record<string, boolean>>({
    summarize: true,
    'release-notes': false,
    'deck-outline': false,
    'research-note': true,
  })
  const [documentationFormat, setDocumentationFormat] = useState<'Document' | 'Presentation'>('Document')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [projects, setProjects] = useLocalState<ProjectItem[]>('jetson.workspace.projects.v1', [
    {
      id: 1,
      name: 'Product Launch',
      tasks: [
        {
          id: 101,
          title: 'Landing page copy',
          assignee: 'Asha',
          timeline: 'Dec 18',
          notes: 'Finalize CTA and release notes.',
          createdBy: 'admin',
          updatedBy: 'admin',
          status: 'Backlog',
        },
      ],
    },
    {
      id: 2,
      name: 'AI Sprint',
      tasks: [
        {
          id: 102,
          title: 'Model validation',
          assignee: 'Rahul',
          timeline: 'Dec 21',
          notes: 'Confirm Gemini fallback behavior.',
          createdBy: 'admin',
          updatedBy: 'Nina',
          status: 'Ready',
        },
      ],
    },
  ], isProjects)
  const [selectedProjectId, setSelectedProjectId] = useState<number>(1)
  const [newProjectName, setNewProjectName] = useState('')
  const [taskDraft, setTaskDraft] = useState({
    title: '',
    assignee: '',
    timeline: '',
    notes: '',
  })
  const [activeAgentTab, setActiveAgentTab] = useState<'Documentation' | 'Follow-up'>('Documentation')
  const [newFolderName, setNewFolderName] = useState('')
  const [currentStorageFolderId, setCurrentStorageFolderId] = useState<number>(1)
  const [storageItems, setStorageItems] = useState<StorageEntry[]>([
    { id: 1, name: 'Shared Drive', type: 'folder', parentId: null, lastUpdated: 'Today' },
    { id: 2, name: 'Project Docs', type: 'folder', parentId: 1, lastUpdated: 'Today' },
    {
      id: 3,
      name: 'Roadmap.pdf',
      type: 'file',
      parentId: 1,
      size: '1.4 MB',
      lastUpdated: 'Today',
      downloadUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
    },
    {
      id: 4,
      name: 'Launch brief.md',
      type: 'file',
      parentId: 2,
      size: '238 KB',
      lastUpdated: 'Today',
      downloadUrl: 'data:text/plain;charset=utf-8,Launch%20brief%20for%20the%20product%20team.',
    },
  ])
  useEffect(() => {
    if (followConversationRef.current) chatEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [chatMessages, busy])

  const activeProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0]
  const workspace: Workspace = { projects, selectedProjectId: activeProject?.id ?? null, reminders }
  useEffect(() => { workspaceRef.current = { projects, selectedProjectId: projects.find((p) => p.id === selectedProjectId)?.id ?? projects[0]?.id ?? null, reminders } }, [projects, selectedProjectId, reminders])
  useEffect(() => {
    if (!busy) return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])
  useEffect(() => () => { requestRef.current?.abort() }, [])
  useEffect(() => {
    const onStorageError = () => setStorageWarning('Browser storage is unavailable or full. Your edits work for this session but may not survive a refresh. Export your projects before leaving.')
    window.addEventListener('workspace-storage-error', onStorageError)
    return () => window.removeEventListener('workspace-storage-error', onStorageError)
  }, [])


  const dueReminders = enabledAgents.reminders ? reminders.filter((item) => item.status === 'pending' && Date.parse(item.dueAt) <= nowMs) : []
  const pendingReminders = reminders.filter((item) => item.status === 'pending')
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!authenticated || !enabledAgents.reminders) return
    for (const item of reminders) {
      if (item.status !== 'pending' || Date.parse(item.dueAt) > nowMs || notifiedRemindersRef.current.has(item.id)) continue
      notifiedRemindersRef.current.add(item.id)
      if (notificationPermission === 'granted') {
        try { new Notification(item.title, { body: item.notes || 'Your Jetson reminder is due.', tag: `jetson-reminder-${item.id}` }) } catch { /* Due reminders remain visible in the app. */ }
      }
    }
  }, [authenticated, enabledAgents.reminders, reminders, nowMs, notificationPermission])

  const completeReminder = (id: number) => setReminders((current) => current.map((item) => item.id === id ? { ...item, status: 'done' } : item))
  const createReminder = () => {
    const date = new Date(reminderDraft.dueAt)
    if (!reminderDraft.title.trim() || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      setStatusMessage('Enter a reminder title and a future date and time.'); return
    }
    if (reminders.length >= 200) { setStatusMessage('The reminder list is full. Export or remove completed reminders first.'); return }
    const id = Math.max(0, ...projects.flatMap((p) => [p.id, ...p.tasks.map((t) => t.id)]), ...reminders.map((r) => r.id)) + 1
    setReminders((current) => [...current, { id, title: reminderDraft.title.trim(), dueAt: date.toISOString(), notes: '', status: 'pending' }])
    setEnabledAgents((current) => ({ ...current, reminders: true }))
    setReminderDraft({ title: '', dueAt: '' })
    setStatusMessage('Reminder sent to the Reminder Agent. Monitoring while this app is open.')
  }

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' })
      const data = await response.json()
      if (data.authenticated) {
        setAuthenticated(true)
        setUsername(data.username)
        setIsAdmin(data.isAdmin === true)
        setLoginForm((current) => ({ ...current, username: data.username }))
      } else {
        setAuthenticated(false)
      }
    } catch (error) {
      console.error('Auth check failed', error)
    }
  }

  const loadModels = async (refresh = false) => {
    setModelsLoading(true)
    try {
      const response = await fetch(`/api/models${refresh ? '?refresh=true' : ''}`, { credentials: 'include', signal: AbortSignal.timeout(12000) })
      const data = await response.json()
      if (!response.ok) throw new Error('Model discovery failed.')
      const list: ProviderInfo[] = data.providers ?? []
      setProviders(list)
      if (list.length > 0) {
        const available = list.find((item: ProviderInfo) => item.models.length > 0) ?? list[0]
        setSelectedProvider(available.provider)
        setSelectedModel(available.defaultModel || available.models[0] || '')
      }
    } catch (error) {
      console.error('Model load failed', error)
      setStatusMessage('Could not load models. Check your connection and select Refresh models.')
    } finally {
      setModelsLoading(false)
    }
  }

  useEffect(() => {
    // Fetch remote session state on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkAuth()
  }, [])

  useEffect(() => {
    if (!authenticated) return
    // Synchronize available models with the remote providers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadModels()
  }, [authenticated])

  const getErrorMessage = (payload: unknown, fallback: string) => {
    if (typeof payload === 'string') return payload
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>
      if (typeof record.message === 'string') return record.message
      if (typeof record.detail === 'string') return record.detail
      if (Array.isArray(record.detail)) {
        const first = record.detail[0]
        if (first && typeof first === 'object') {
          const nested = first as Record<string, unknown>
          if (typeof nested.msg === 'string') return nested.msg
          if (typeof nested.message === 'string') return nested.message
        }
      }
    }
    return fallback
  }

  const handleGuestContinue = async (event: FormEvent) => {
    event.preventDefault()
    const name = guestName.trim()
    if (!name) {
      setStatusMessage('Please enter your name.')
      return
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password: '' }),
      })

      const data = await response.json().catch(() => ({ detail: 'Guest sign-in failed.' }))
      if (!response.ok) {
        throw new Error(getErrorMessage(data, 'Guest sign-in failed.'))
      }

      setAuthenticated(true)
      setUsername(data.username || name)
      setIsAdmin(data.isAdmin === true)
      setChatMessages([])
      setStatusMessage(`Welcome, ${data.username || name}.`)

    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Guest sign-in failed.')
    }
  }

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    setStatusMessage('Signing in...')

    try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: loginForm.username || 'admin',
        password: loginForm.password,
      }),
    })

    const data = await response.json().catch(() => ({ message: 'Login failed' }))
    if (!response.ok) {
      setStatusMessage(getErrorMessage(data, 'Unable to sign in.'))
      return
    }

    setAuthenticated(true)
    setUsername(data.username)
    setIsAdmin(data.isAdmin === true)
    setChatMessages([])
    setStatusMessage('Logged in successfully.')
    } catch {
      setStatusMessage('Could not connect. Check that the backend is running and try again.')
    }
  }

  const handleLogout = async () => {
    requestRef.current?.abort()
    try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
    } catch {
      setStatusMessage('Could not sign out. Check your connection and try again.')
      return
    }
    setAuthenticated(false)
    setIsAdmin(false)
    setLastChange(null)
    setUsername('admin')
    setLoginForm({ username: 'admin', password: '' })
    setGuestName('')
    setShowAdminLogin(false)
    setStatusMessage('Signed out.')
    setHistoryItems([])
    setChatMessages([])
  }

  const handleDeleteHistoryItem = (id: number) => {
    setChatMessages((current) => current.filter((message) => message.id !== id))
    setHistoryItems((current) => current.filter((message) => message.id !== id))
  }

  const storageFolderLookup = Object.fromEntries(storageItems.map((item) => [item.id, item]))
  const currentStorageFolder = storageFolderLookup[currentStorageFolderId] ?? storageFolderLookup[1]
  const storageBreadcrumbs = (() => {
    const items: StorageEntry[] = []
    let cursor: StorageEntry | undefined = currentStorageFolder
    const visited = new Set<number>()
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id)
      items.unshift(cursor)
      cursor = cursor.parentId === null ? undefined : storageFolderLookup[cursor.parentId]
    }
    return items
  })()
  const currentStorageChildren = storageItems.filter((item) => item.parentId === currentStorageFolderId)
  const storageFolders = storageItems.filter((item) => item.type === 'folder')

  const addFilesToCurrentFolder = (files: File[]) => {
    const items = files.map((file, index) => ({
      id: Date.now() + index,
      name: file.name,
      type: 'file' as const,
      parentId: currentStorageFolderId,
      size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      lastUpdated: 'Just now',
      downloadUrl: URL.createObjectURL(file),
    }))
    setStorageItems((current) => [...current, ...items])
  }

  const reminderItems = enabledAgents.reminders ? projects.flatMap((project) =>
    project.tasks.filter((task) => task.status !== 'Done').map((task) => ({
      id: task.id, title: `${project.name}: ${task.title}`,
      note: `${task.assignee} • ${task.timeline} • ${task.status}`,
    })),
  ).slice(0, 6) : []

  const handleCreateProject = () => {
    const trimmed = newProjectName.trim()
    if (!trimmed) return
    if (projects.some((project) => project.name.toLowerCase() === trimmed.toLowerCase())) {
      setStatusMessage('A project with this name already exists.')
      return
    }

    const newProject = {
      id: Date.now(),
      name: trimmed,
      tasks: [],
    }

    setProjects((current) => [...current, newProject])
    setSelectedProjectId(newProject.id)
    setNewProjectName('')
  }

  const handleDeleteProject = (projectId: number) => {
    if (!isAdmin) return

    setProjects((current) => {
      const remaining = current.filter((project) => project.id !== projectId)
      if (remaining.length === 0) {
        setSelectedProjectId(0)
        return []
      }

      if (selectedProjectId === projectId) {
        setSelectedProjectId(remaining[0].id)
      }
      return remaining
    })
  }

  const handleAddTask = () => {
    if (!activeProject) { setStatusMessage('Create a project before adding a task.'); return }
    if (!taskDraft.title.trim()) { setStatusMessage('Give your task a name.'); return }
    if (activeProject.tasks.some((task) => task.title.toLowerCase() === taskDraft.title.trim().toLowerCase())) { setStatusMessage('This task already exists in the project.'); return }

    const newTask: ProjectTask = {
      id: Date.now(),
      title: taskDraft.title.trim(),
      assignee: taskDraft.assignee.trim() || 'Unassigned',
      timeline: taskDraft.timeline.trim() || 'TBD',
      notes: taskDraft.notes.trim() || 'No notes added.',
      createdBy: username || 'admin',
      updatedBy: username || 'admin',
      status: 'Backlog',
    }

    setProjects((current) =>
      current.map((project) =>
        project.id === activeProject.id
          ? { ...project, tasks: [...project.tasks, newTask] }
          : project,
      ),
    )

    setTaskDraft({ title: '', assignee: '', timeline: '', notes: '' })
    setStatusMessage(`Task “${newTask.title}” added to Backlog.`)
  }

  const handleTaskMove = (taskId: number, nextStatus: TaskStatus) => {
    setProjects((current) =>
      current.map((project) => ({
        ...project,
        tasks: project.tasks.map((task) =>
          task.id === taskId ? { ...task, status: nextStatus, updatedBy: username || 'admin' } : task,
        ),
      })),
    )
  }

  const handleToggleAgent = (agent: AgentKey) => {
    setEnabledAgents((current) => ({ ...current, [agent]: !current[agent] }))
    if (agent === 'documentation') setActiveSection('Agents')
    if (agent === 'reminders') setActiveSection('Overview')
  }

  const handleDocumentationSubmit = async () => {
    if (requestRef.current || busy || !selectedModel) return
    const prompt = documentationInput.trim()
    if (!prompt && attachedFiles.length === 0) return

    const skillSummary = Object.entries(documentationSkills)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(', ') || 'general drafting'


    let responseText: string

    setBusy(true)
    setStatusMessage('Drafting with your selected model…')
    try {
      const sources = await Promise.all(attachedFiles.map(async (file) => {
        if (!/\.(txt|md|csv|json)$/i.test(file.name)) return `${file.name}: content extraction unavailable; do not infer its contents.`
        return `${file.name}:\n${(await file.text()).slice(0, 12000)}`
      }))
      const result = await fetch('/api/chat', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selectedProvider, model: selectedModel,
          message: `Draft a ${documentationFormat.toLowerCase()} in Markdown. Skills: ${skillSummary}. Request: ${prompt || 'Summarize the sources'}. Sources:\n${sources.join('\n').slice(0, 12000)}. Be explicit about missing source information.` }),
      })
      const data = await result.json()
      if (!result.ok) throw new Error(getErrorMessage(data, 'Draft generation failed.'))
      responseText = data.answer
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Draft generation failed.')
      return
    } finally {
      setBusy(false)
    }

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: prompt || `Uploaded ${attachedFiles.length} source item(s) for ${documentationFormat.toLowerCase()} generation.`,
    }
    const assistantMessage: ChatMessage = {
      id: Date.now() + 1,
      role: 'assistant',
      content: `I created a ${documentationFormat.toLowerCase()} draft from the selected skills and saved it to storage.`,
    }

    setDocumentationMessages((current) => [...current, userMessage, assistantMessage])

    const fileName = `${(activeProject?.name ?? 'workspace').toLowerCase().replace(/\s+/g, '-')}-${documentationFormat.toLowerCase()}-${Date.now()}.${documentationFormat === 'Presentation' ? 'html' : 'md'}`
    const blob = new Blob(
      [documentationFormat === 'Presentation' ? `<html><body>${responseText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</body></html>` : responseText],
      { type: documentationFormat === 'Presentation' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8' },
    )
    const url = URL.createObjectURL(blob)
    setStorageItems((current) => [
      ...current,
      {
        id: Date.now() + 2,
        name: fileName,
        type: 'file',
        parentId: currentStorageFolderId,
        size: `${(blob.size / 1024).toFixed(1)} KB`,
        lastUpdated: 'Just now',
        downloadUrl: url,
      },
    ])
    setDocumentationInput('')
    setAttachedFiles([])
    setStatusMessage(`${documentationFormat} draft saved to storage.`)
  }

  const handleSend = async (retryText?: string) => {
    const text = (retryText ?? input).trim()
    if (!text || busy || requestRef.current || !selectedModel) return
    const controller = new AbortController()
    requestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort('timeout'), 65000)
    const before = structuredClone(workspace)
    const fingerprint = JSON.stringify(before)
    messageSequence.current += 2
    const messageId = messageSequence.current
    const userMessage: ChatMessage = { id: messageId - 1, role: 'user', content: text }
    followConversationRef.current = true
    setChatMessages((current) => [...current, userMessage, { id: messageId, role: 'assistant', content: '', pending: true }])
    setInput('')
    setBusy(true)
    setElapsedSeconds(0)
    setChatProgress('Connecting to your assistant…')
    setStatusMessage('')
    let streamedText = ''
    let completed = false
    const updateMessage = (patch: Partial<ChatMessage>) => setChatMessages((current) => current.map((message) => message.id === messageId ? { ...message, ...patch } : message))
    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST', credentials: 'include', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selectedProvider, model: selectedModel, message: text,
          history: chatMessages.filter((message) => !message.error && !message.pending && message.content.trim()).slice(-10)
            .map(({ role, content, changes }) => ({ role, content: [content, ...(changes ?? [])].join('\n').slice(0, 16000) })),
          workspace: before, timezoneOffsetMinutes: new Date().getTimezoneOffset() }),
      })
      if (!response.ok) {
        if (response.status === 404) throw new Error('The running backend is missing the chat endpoint. Restart the Jetson backend, refresh this page, and sign in again.')
        if (response.status === 401) { setAuthenticated(false); setIsAdmin(false) }
        throw new Error(getErrorMessage(await response.json().catch(() => ({})), 'Could not reach the assistant.'))
      }
      let finalEvent: import('./chatStream').StreamEvent | undefined
      await readChatStream(response, (event) => {
        if (controller.signal.aborted) throw new Error('Request stopped.')
        if (event.type === 'status') setChatProgress(event.message || 'Working…')
        if (event.type === 'delta') {
          streamedText += event.text || ''
          updateMessage({ content: streamedText })
          setChatProgress('Preparing your reply and checking any project changes…')
        }
        if (event.type === 'result') finalEvent = event
      })
      // Apply only a complete validated result, never partial stream data.
      if (!finalEvent || controller.signal.aborted) throw new Error('Request stopped. No changes were applied.')
      const result = finalEvent as import('./chatStream').StreamEvent
      const changes = result.changes ?? []
      if (changes.length > 0) {
        if (!isWorkspace(result.workspace)) throw new Error('The assistant returned invalid workspace data. No changes were applied.')
        if (JSON.stringify(workspaceRef.current) !== fingerprint) throw new Error('Your project changed while the AI was working. No AI edits were applied; please retry with the latest board.')
        setProjects(result.workspace.projects)
        setReminders(result.workspace.reminders)
        if (result.workspace.reminders.some((item) => !before.reminders.some((old) => old.id === item.id))) setEnabledAgents((current) => ({ ...current, reminders: true }))
        setSelectedProjectId(result.workspace.selectedProjectId ?? 0)
        setTaskOwner('')
        setTaskSearch('')
        setLastChange({ before, after: JSON.stringify(result.workspace), messageId })
        workspaceRef.current = result.workspace
      }
      const answer = result.answer || 'Done.'
      updateMessage({ content: answer, changes, pending: false, durationMs: result.durationMs })
      if (isAdmin) setHistoryItems((current) => [...current, userMessage, { id: messageId, role: 'assistant', content: [answer, ...changes].join('\n') }])
      setStatusMessage(`${result.model || selectedModel} · ${((result.durationMs ?? 0) / 1000).toFixed(1)}s${changes.length ? ` · ${changes.length} changes applied` : ''}`)
      completed = true
    } catch (error) {
      const message = controller.signal.aborted
        ? controller.signal.reason === 'timeout' ? 'The model took too long. Try a faster model or a shorter request.' : 'Stopped. No project changes were applied.'
        : error instanceof Error ? error.message : 'The request failed. Please try again.'
      updateMessage({ content: message, error: true, pending: false, retryText: text })
      setStatusMessage(message)
    } finally {
      window.clearTimeout(timeout)
      if (requestRef.current === controller) requestRef.current = null
      setBusy(false)
      setChatProgress('')
      if (completed) composerRef.current?.focus()
    }
  }

  const handleChatSubmit = () => { void handleSend() }

  const undoLastChange = () => {
    if (!lastChange || busy) return
    if (JSON.stringify(workspace) !== lastChange.after) {
      setStatusMessage('The board has changed since that AI update. Ask the assistant to adjust the specific task instead.')
      return
    }
    setProjects(lastChange.before.projects)
    setReminders(lastChange.before.reminders)
    setSelectedProjectId(lastChange.before.selectedProjectId ?? 0)
    workspaceRef.current = lastChange.before
    setChatMessages((current) => current.map((message) => message.id === lastChange.messageId
      ? { ...message, content: 'These changes were undone.', changes: [] } : message))
    setLastChange(null)
    setStatusMessage('AI changes undone. Your previous board is restored.')
  }

  const navigationMap: Record<SectionKey, { title: string; subtitle: string; description: string }> = {
    Overview: {
      title: 'AI product operations',
      subtitle: 'Workspace',
      description: 'Operational view across products, user requests, and active model performance.',
    },
    'AI Chat': {
      title: 'AI chat',
      subtitle: 'Assistant',
      description: 'Talk freely with the model and direct project changes in plain language.',
    },
    Workbench: {
      title: 'Planner Board',
      subtitle: 'Project board',
      description: 'Track work by project, owner, timeline, and status across the board.',
    },
    Agents: {
      title: 'Agents',
      subtitle: 'Automation',
      description: 'Documentation and follow-up automation for product updates and reminders.',
    },
    Storage: {
      title: 'Storage',
      subtitle: 'Shared drive',
      description: 'Browse project files, upload documents, and download work directly from the workspace.',
    },
  }

  const boardColumns: Array<{ key: TaskStatus; label: string }> = [
    { key: 'Backlog', label: 'Backlog' },
    { key: 'Ready', label: 'Ready' },
    { key: 'In progress', label: 'In progress' },
    { key: 'In review', label: 'In review' },
    { key: 'Done', label: 'Done' },
  ]

  if (!authenticated) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="brand-row">
            <div className="brand-orb">J</div>
            <div>
              <p className="eyebrow">Intelligence workspace</p>
              <h1>Welcome</h1>
            </div>
          </div>

          <form onSubmit={showAdminLogin ? handleLogin : handleGuestContinue} className="login-form">
            {showAdminLogin ? (
              <>
                <label>
                  Username
                  <input
                    value={loginForm.username}
                    onChange={(event) =>
                      setLoginForm((current) => ({ ...current, username: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) =>
                      setLoginForm((current) => ({ ...current, password: event.target.value }))
                    }
                  />
                </label>
                <button type="submit">Sign in</button>
              </>
            ) : (
              <>
                <label>
                  What’s your name?
                  <input
                    value={guestName}
                    onChange={(event) => setGuestName(event.target.value)}
                    placeholder="Enter your name"
                  />
                </label>
                <button type="submit">Continue</button>
              </>
            )}
          </form>

          {!showAdminLogin && (
            <button type="button" className="small-link" onClick={() => setShowAdminLogin(true)}>
              Admin access
            </button>
          )}

          {showAdminLogin && (
            <button type="button" className="small-link" onClick={() => setShowAdminLogin(false)}>
              Back to user access
            </button>
          )}

          {statusMessage && <p className="status-message">{statusMessage}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">J</div>
          <div>
            <p className="eyebrow">Intelligence workspace</p>
            <strong>Jetson AI</strong>
          </div>
        </div>

        <nav className="nav-list" aria-label="Sidebar navigation">
          {(['Overview', 'AI Chat', 'Workbench', 'Agents', 'Storage'] as SectionKey[]).map((section) => (
            <button
              key={section}
              type="button"
              className={`nav-item ${activeSection === section ? 'active' : ''}`}
              onClick={() => setActiveSection(section)}
            >
              <span className="nav-symbol" aria-hidden="true">{({ Overview: '◈', 'AI Chat': '✦', Workbench: '▦', Agents: '◎', Storage: '▤' })[section]}</span>{section}
            </button>
          ))}
        </nav>

        <div className="user-card">
          <div>
            <p className="panel-tag">Signed in as</p>
            <strong>{username || 'Admin'}</strong>
          </div>
          <button type="button" className="secondary-button" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="content-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">{navigationMap[activeSection].subtitle}</p>
            <h2>{navigationMap[activeSection].title}</h2>
          </div>
          <span className="status-pill">{providers.filter((item) => item.models.length > 0).length} providers available</span>
        </header>

        {dueReminders.length > 0 && <div className="reminder-alert" role="status"><span>◷ {dueReminders.length} reminder{dueReminders.length > 1 ? 's' : ''} due: {dueReminders.slice(0, 2).map((item) => item.title).join(', ')}</span><button type="button" onClick={() => { setActiveSection('Agents'); setActiveAgentTab('Follow-up') }}>Open Reminder Agent ↗</button></div>}
        {storageWarning && <div className="inline-notice" role="alert">{storageWarning}</div>}
        {statusMessage && activeSection !== 'AI Chat' && <div className="workspace-notice" role="status">{statusMessage}</div>}

        {activeSection === 'Overview' && (
          <div className="content-grid">
            <section className="workspace-hero">
              <div><p className="eyebrow">YOUR WORK, CONNECTED</p><h1>Make room for your next idea.</h1><p>Plan with your team. Think with AI. Keep everything moving.</p>
              <div className="hero-actions"><button className="send-button" onClick={() => setActiveSection('AI Chat')}>Start a conversation ↗</button><button className="secondary-button" onClick={() => setActiveSection('Workbench')}>Open project board</button></div></div>
              <div className="hero-art" aria-hidden="true">✦</div>
            </section>
            <section className="stats-grid">
              <div className="stat-card">
                <span>Open tasks</span>
                <strong>{projects.reduce((sum, project) => sum + project.tasks.filter((task) => task.status !== 'Done').length, 0)}</strong>
              </div>
              <div className="stat-card">
                <span>Enabled agents</span>
                <strong>{Object.values(enabledAgents).filter(Boolean).length}</strong>
              </div>
              <div className="stat-card">
                <span>Scheduled reminders</span>
                <strong>{pendingReminders.length}</strong>
              </div>
              <div className="stat-card">
                <span>Priority alerts</span>
                <strong>{dueReminders.length}</strong>
              </div>
            </section>

            <section className="panel overview-panel">
              <div className="history-header">
                <h3>Auto-updated priorities</h3>
                <span>{reminderItems.length} items</span>
              </div>
              <div className="priority-list">
                {reminderItems.length === 0 ? (
                  <p className="history-empty">No reminder automation is enabled yet.</p>
                ) : (
                  reminderItems.map((item) => (
                    <div key={item.id} className="priority-item">
                      <strong>{item.title}</strong>
                      <span>{item.note}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {isAdmin && (
              <section className="panel history-panel">
                <div className="history-header">
                  <h3>Admin history</h3>
                  <span>{historyItems.length} entries</span>
                </div>
                <div className="history-list">
                  {historyItems.length === 0 ? (
                    <p className="history-empty">No admin history yet.</p>
                  ) : (
                    historyItems.map((message) => (
                      <div key={message.id} className="history-item">
                        <div className="history-message">
                          <span className="history-role">{message.role === 'user' ? 'You' : 'Assistant'}</span>
                          <p>{message.content}</p>
                        </div>
                        <button
                          type="button"
                          className="history-delete"
                          onClick={() => handleDeleteHistoryItem(message.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>
            )}
          </div>
        )}

        {activeSection === 'AI Chat' && (
          <div className="chat-tab-shell panel">
            <div className="chat-toolbar">
              <button className="secondary-button" disabled={busy} onClick={() => { setChatMessages([]); setStatusMessage('New conversation started. Your projects are unchanged.') }}>＋ New chat</button>
              <label>
                Provider
                <select disabled={busy || modelsLoading} value={selectedProvider} onChange={(event) => {
                  const provider = providers.find((item) => item.provider === event.target.value)
                  setSelectedProvider(event.target.value)
                  setSelectedModel(provider?.defaultModel || provider?.models[0] || '')
                }}>
                  {providers.length === 0 && <option value="">{modelsLoading ? 'Finding models…' : 'No providers available'}</option>}
                  {providers.map((provider) => (
                    <option key={provider.provider} value={provider.provider} disabled={!provider.models.length}>
                      {provider.label}{!provider.models.length ? ' (unavailable)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Model
                <select disabled={busy || modelsLoading} value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                  {providers
                    .find((provider) => provider.provider === selectedProvider)
                    ?.models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    )) ?? <option value={selectedModel}>{selectedModel}</option>}
                </select>
              </label>
              <button type="button" className="secondary-button" disabled={busy || modelsLoading} onClick={() => void loadModels(true)}>{modelsLoading ? 'Finding models…' : '↻ Refresh models'}</button>
            </div>
            <div className="chat-context"><span>Working in <strong>{activeProject?.name ?? 'No project selected'}</strong></span><button type="button" onClick={() => setActiveSection('Workbench')}>View board ↗</button></div>
            {!modelsLoading && !providers.some((provider) => provider.models.length > 0) && <div className="inline-notice" role="status">No AI models are available. Check your provider connection or start Ollama, then refresh models.</div>}

            <div className="chat-message-list large-list" onScroll={(event) => { const node = event.currentTarget; followConversationRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100 }} aria-busy={busy} role="log" aria-label="Conversation" aria-live="polite">
              {chatMessages.length === 0 && <div className="chat-welcome"><div className="welcome-spark">✦</div><p className="eyebrow">A LITTLE HELP, A BIG NEXT STEP</p><h2>What are we working on?</h2><p>Explore an idea, untangle a problem, or move your project forward.</p><div className="prompt-grid">{['Create a Website project with design, development and testing tasks', 'Add a task to review the launch copy, assign it to Asha for Friday', 'Remind me to review the launch tomorrow at 10 AM'].map((prompt) => <button key={prompt} onClick={() => setInput(prompt)}>{prompt}<span>↗</span></button>)}</div></div>}

              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`${message.role === 'user' ? 'chat-bubble user' : 'chat-bubble assistant'}${message.error ? ' chat-error' : ''}`}
                  aria-busy={message.pending}
                >
                  <small className="message-author">{message.role === 'user' ? 'You' : 'Jetson assistant'}</small>{message.content || (message.pending ? 'Understanding your request…' : '')}
                  {message.pending && message.content && <small className="message-pending">Checking changes before applying…</small>}
                  {!!message.changes?.length && <div className="change-receipts"><strong>✓ Changes applied</strong><ul>{message.changes.map((change, index) => <li key={index}>{change}</li>)}</ul><div className="receipt-actions"><button type="button" onClick={() => setActiveSection('Workbench')}>View updated board ↗</button>{lastChange?.messageId === message.id && <button type="button" disabled={busy || JSON.stringify(workspace) !== lastChange.after} onClick={undoLastChange}>Undo these changes</button>}</div></div>}
                  {message.error && <button type="button" className="retry-button" disabled={busy || !selectedModel} onClick={() => void handleSend(message.retryText)}>Try again ↻</button>}
                  {message.durationMs !== undefined && <small className="message-timing">{(message.durationMs / 1000).toFixed(1)}s</small>}
                </div>
              ))}
              {busy && <div className="thinking-indicator" role="status">✦ {chatProgress}<span>{elapsedSeconds}s</span>{elapsedSeconds >= 10 && <small>The model is taking a little longer. You can stop and choose another model.</small>}</div>}
              <div ref={chatEndRef} />
            </div>

            <div className="composer-box">
              <textarea
                ref={composerRef}
                aria-label="Message your project assistant"
                maxLength={16000}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    handleChatSubmit()
                  }
                }}
                placeholder="Tell me what to create or change. For example: add a testing task for Asha by Friday…"
                rows={1}
              />
              {busy ? <button type="button" className="stop-button" onClick={() => requestRef.current?.abort()}>■ Stop</button> : <button type="button" className="send-button" onClick={handleChatSubmit} disabled={!input.trim() || !selectedModel || modelsLoading}>Send ↑</button>}
            </div>

            <div className="composer-hint">Enter to send · Shift + Enter for a new line · Project changes happen automatically and can be undone</div>
            {statusMessage && <div className="chat-status" role="status">{statusMessage}</div>}
          </div>
        )}

        {activeSection === 'Workbench' && (
          <div className="content-grid">
            <section className="panel board-panel">
              <div className="board-header">
                <div className="board-title-wrap">
                  <span className="board-icon">◌</span>
                  <h3>Planner Board</h3>
                  <button type="button" className="secondary-button" onClick={() => { setActiveSection('AI Chat'); setInput(`Help me update ${activeProject?.name ?? 'my project'}`) }}>✦ Ask AI to make changes</button>
                </div>
              </div>

              <div className="project-create-box">
                <div className="project-create-tag">Project</div>
                <div className="project-create-row">
                  <input
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                    placeholder="Project name"
                    aria-label="Project name"
                    maxLength={200}
                  />
                  <button type="button" className="secondary-button" onClick={handleCreateProject}>
                    Create project
                  </button>
                </div>
              </div>

              <div className="project-tabs">
                {projects.map((project) => (
                  <div key={project.id} className="project-tab-wrap">
                    <button
                      type="button"
                      className={`project-tab ${activeProject?.id === project.id ? 'active' : ''}`}
                      onClick={() => { setSelectedProjectId(project.id); setTaskOwner(''); setTaskSearch('') }}
                    >
                      {project.name}
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        className="delete-project-btn"
                        onClick={() => handleDeleteProject(project.id)}
                        aria-label={`Delete ${project.name}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="board-filters"><input aria-label="Search tasks" placeholder="Search tasks…" value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} /><select aria-label="Filter by owner" value={taskOwner} onChange={(event) => setTaskOwner(event.target.value)}><option value="">All owners</option>{[...new Set((activeProject?.tasks ?? []).map((task) => task.assignee))].map((owner) => <option key={owner}>{owner}</option>)}</select><span>{activeProject?.tasks.length ?? 0} tasks · {storageWarning ? 'Session only' : 'Saved on this device'}</span><button type="button" className="secondary-button" onClick={() => {
                const url = URL.createObjectURL(new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' }))
                const link = document.createElement('a'); link.href = url; link.download = 'jetson-projects.json'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
              }}>Export projects ↓</button></div>
              {!activeProject && <div className="inline-notice">Create your first project above, or ask the AI to create one with tasks.</div>}
              <div className="board-columns">
                {boardColumns.map((column) => {
                  const columnTasks = (activeProject?.tasks ?? []).filter((task) => task.status === column.key && (!taskOwner || task.assignee === taskOwner) && `${task.title} ${task.notes} ${task.assignee}`.toLowerCase().includes(taskSearch.toLowerCase()))
                  return (
                    <div
                      key={column.key}
                      className="board-column"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault()
                        const taskId = Number(event.dataTransfer.getData('text/plain'))
                        if (!Number.isNaN(taskId)) {
                          handleTaskMove(taskId, column.key)
                        }
                      }}
                    >
                      <div className="column-header">
                        <span className={`status-dot ${column.key.toLowerCase().replace(/\s+/g, '-')}`}></span>
                        <span>{column.label}</span>
                        <span className="count-label">{columnTasks.length}</span>
                      </div>

                      <div className="column-card-list">
                        {columnTasks.length === 0 ? (
                          <div className="empty-card">No tasks yet</div>
                        ) : (
                          columnTasks.map((task) => (
                            <article
                              key={task.id}
                              className="task-card-board"
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData('text/plain', String(task.id))
                                event.dataTransfer.effectAllowed = 'move'
                              }}
                            >
                              <div className="task-card-meta">
                                <span className="task-issue">#{task.id}</span>
                                <span className="task-status-tag">{task.assignee}</span>
                              </div>
                              <h4>{task.title}</h4>
                              {task.notes && <p className="task-notes">{task.notes}</p>}
                              <select className="task-status-select" aria-label={`Status for ${task.title}`} value={task.status} onChange={(event) => handleTaskMove(task.id, event.target.value as TaskStatus)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
                              <div className="task-labels">
                                <span className="label-pill">{task.assignee}</span>
                                <span className="label-pill">{formatTimeline(task.timeline)}</span>
                              </div>
                              <div className="task-footers">
                                <span>Created by {task.createdBy}</span>
                                <span>Updated by {task.updatedBy}</span>
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="task-form-box">
                <div className="task-form-grid">
                  <input
                    value={taskDraft.title}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Task name"
                    aria-label="Task name"
                    maxLength={300}
                  />
                  <input
                    value={taskDraft.assignee}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, assignee: event.target.value }))}
                    placeholder="Owner (optional)"
                    aria-label="Task owner"
                    maxLength={100}
                  />
                  <input
                    type="date"
                    value={taskDraft.timeline}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, timeline: event.target.value }))}
                    placeholder="Timeline"
                    aria-label="Task deadline"
                    maxLength={100}
                  />
                  <textarea
                    value={taskDraft.notes}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Notes"
                    aria-label="Task notes"
                    maxLength={4000}
                  />
                  <button type="button" className="send-button task-button" disabled={!activeProject || !taskDraft.title.trim()} onClick={handleAddTask}>
                    Add task
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeSection === 'Agents' && (
          <div className="content-grid">
            <section className="panel model-panel">
              <div className="model-tabs">
                {(['Documentation', 'Follow-up'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`model-tab ${activeAgentTab === tab ? 'active' : ''}`}
                    onClick={() => setActiveAgentTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {activeAgentTab === 'Documentation' && (
                <div className="agent-workspace">
                  <div className="agent-card agent-chat-panel">
                    <div className="agent-head">
                      <span className="agent-badge">Documentation Agent</span>
                    </div>
                    <h3>Product documentation assistant</h3>
                    <p>Generate summaries, release notes, and HTML presentation outlines from prompts and text sources.</p>
                    <div className="skill-stack">
                      {Object.entries(documentationSkills).map(([skill, enabled]) => (
                        <button
                          key={skill}
                          type="button"
                          className={`skill-pill ${enabled ? 'enabled' : ''}`}
                          onClick={() =>
                            setDocumentationSkills((current) => ({ ...current, [skill]: !current[skill] }))
                          }
                        >
                          {skill.replace('-', ' ')}
                        </button>
                      ))}
                    </div>
                    <div className="format-row">
                      <label>
                        Format
                        <select value={documentationFormat} onChange={(event) => setDocumentationFormat(event.target.value as 'Document' | 'Presentation')}>
                          <option value="Document">Document</option>
                          <option value="Presentation">Presentation</option>
                        </select>
                      </label>
                    </div>
                    <label className="upload-button compact-upload">
                      Upload text sources
                      <input
                        type="file"
                        accept=".txt,.md,.csv,.json"
                        multiple
                        onChange={(event) => {
                          const files = Array.from(event.target.files ?? [])
                          if (!files.length) return
                          const accepted = files.filter((file) => file.size <= 1024 * 1024 && /\.(txt|md|csv|json)$/i.test(file.name))
                          if (accepted.length !== files.length) setStatusMessage('Use text files up to 1 MB each. PDF, Office and image extraction is not supported yet.')
                          setAttachedFiles((current) => [...current, ...accepted].slice(0, 5))
                          event.target.value = ''
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleToggleAgent('documentation')}
                    >
                      {enabledAgents.documentation ? 'Disable' : 'Enable'}
                    </button>
                    {enabledAgents.documentation && (
                      <div className="agent-chat-stream">
                        {documentationMessages.map((message) => (
                          <div
                            key={message.id}
                            className={message.role === 'user' ? 'chat-bubble user' : 'chat-bubble assistant'}
                          >
                            {message.content}
                          </div>
                        ))}
                        {attachedFiles.length > 0 && (
                          <div className="attachment-strip">
                            {attachedFiles.map((file, index) => (
                              <span key={`${file.name}-${index}`} className="attachment-badge">
                                {file.name}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="composer-box compact">
                          <textarea
                            value={documentationInput}
                            onChange={(event) => setDocumentationInput(event.target.value)}
                            placeholder="Picture a launch note, feature summary, or deck outline..."
                            rows={3}
                          />
                          <button type="button" className="send-button" disabled={busy} onClick={() => void handleDocumentationSubmit()}>
                            Save doc
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="agent-preview">
                    <h3>Workspace summary</h3>
                    <ul>
                      <li>{projects.length} active projects</li>
                      <li>{projects.reduce((sum, project) => sum + project.tasks.length, 0)} tasks in progress</li>
                      <li>{storageItems.filter((item) => item.type === 'file').length} saved documents</li>
                    </ul>
                  </div>
                </div>
              )}

              {activeAgentTab === 'Follow-up' && (
                <div className="agent-grid">
                  <div className="agent-card">
                    <div className="agent-head">
                      <span className="agent-badge">Reminder Agent</span>
                    </div>
                    <h3>Follow-up automation</h3>
                    <p>Monitors reminders delegated from AI Chat, checks due times every 15 seconds, and shows alerts while the workspace is open.</p>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleToggleAgent('reminders')}
                    >
                      {enabledAgents.reminders ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                  <div className="agent-card reminder-card">
                    <div className="history-header"><h3>Reminder Agent monitor</h3><span>{enabledAgents.reminders ? '● Monitoring' : 'Paused'} · {pendingReminders.length} scheduled</span></div>
                    <p className="section-description">Reminders stay on this device. Monitoring resumes when you reopen the app; notifications are not sent while it is closed.</p>
                    <div className="reminder-create"><input aria-label="Reminder title" placeholder="What should I remind you about?" maxLength={300} value={reminderDraft.title} onChange={(event) => setReminderDraft((current) => ({ ...current, title: event.target.value }))} /><input type="datetime-local" aria-label="Reminder date and time" value={reminderDraft.dueAt} onChange={(event) => setReminderDraft((current) => ({ ...current, dueAt: event.target.value }))} /><button type="button" className="send-button" disabled={!reminderDraft.title.trim() || !reminderDraft.dueAt} onClick={createReminder}>Schedule reminder</button></div>
                    {notificationPermission !== 'unsupported' && notificationPermission !== 'granted' && <button type="button" className="secondary-button" onClick={async () => { const permission = await Notification.requestPermission(); setNotificationPermission(permission); setStatusMessage(permission === 'granted' ? 'Desktop alerts enabled while this app is open.' : 'Desktop alerts are blocked. Due reminders will still appear inside the app.') }}>Enable desktop alerts</button>}
                    <div className="scheduled-reminders">{reminders.length === 0 ? <p>No reminders yet. Ask AI Chat: “Remind me to check the launch tomorrow at 10 AM.”</p> : reminders.map((item) => <article key={item.id} className={`scheduled-reminder ${item.status === 'done' ? 'complete' : Date.parse(item.dueAt) <= nowMs ? 'due' : ''}`}><div><strong>{item.title}</strong><time dateTime={item.dueAt}>{new Date(item.dueAt).toLocaleString()}</time><small>{item.status === 'done' ? 'Completed' : Date.parse(item.dueAt) <= nowMs ? 'Due now' : 'Scheduled'}{item.notes && ` · ${item.notes}`}</small></div>{item.status === 'pending' && <button type="button" className="secondary-button" onClick={() => completeReminder(item.id)}>Mark done</button>}</article>)}</div>
                    <h3>Task follow-ups</h3>
                    {enabledAgents.reminders && reminderItems.length > 0 ? (
                      <ul>
                        {reminderItems.map((item) => (
                          <li key={item.id}>{item.title} — {item.note}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Enable the reminder agent to show live follow-ups from the project board.</p>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {activeSection === 'Storage' && (
          <div className="content-grid">
            <section className="panel storage-layout">
              <div className="drive-layout">
                <aside className="drive-sidebar">
                  <div className="drive-sidebar-header">
                    <strong>Shared Drive</strong>
                  </div>
                  {storageFolders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      className={`drive-folder ${currentStorageFolderId === folder.id ? 'active' : ''}`}
                      onClick={() => setCurrentStorageFolderId(folder.id)}
                    >
                      <span>📁</span>
                      {folder.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const name = newFolderName.trim() || 'New folder'
                      setStorageItems((current) => [
                        ...current,
                        { id: Date.now(), name, type: 'folder', parentId: currentStorageFolderId, lastUpdated: 'Now' },
                      ])
                      setNewFolderName('')
                    }}
                  >
                    New folder
                  </button>
                </aside>

                <div className="drive-main">
                  <div className="storage-breadcrumbs">
                    {storageBreadcrumbs.map((folder, index) => (
                      <button
                        key={folder.id}
                        type="button"
                        className="crumb-button"
                        onClick={() => setCurrentStorageFolderId(folder.id)}
                      >
                        {index === 0 ? folder.name : ` / ${folder.name}`}
                      </button>
                    ))}
                  </div>

                  <div className="storage-toolbar">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        const parentFolder = currentStorageFolder?.parentId ?? null
                        if (parentFolder === null) return
                        setCurrentStorageFolderId(parentFolder)
                      }}
                      disabled={currentStorageFolderId === 1}
                    >
                      Back
                    </button>
                    <input
                      value={newFolderName}
                      onChange={(event) => setNewFolderName(event.target.value)}
                      placeholder="New folder name"
                    />
                    <label className="upload-button">
                      Upload files
                      <input
                        type="file"
                        multiple
                        onChange={(event) => {
                          const files = Array.from(event.target.files ?? [])
                          if (!files.length) return
                          addFilesToCurrentFolder(files)
                          event.target.value = ''
                        }}
                      />
                    </label>
                  </div>

                  <div
                    className="storage-drop-zone"
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'copy'
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      const files = Array.from(event.dataTransfer.files ?? [])
                      if (files.length > 0) {
                        addFilesToCurrentFolder(files)
                      }
                    }}
                  >
                    <div className="drive-list-header">
                      <span>Name</span>
                      <span>Type</span>
                      <span>Updated</span>
                      <span>Actions</span>
                    </div>

                    {currentStorageChildren.length === 0 ? (
                      <div className="empty-storage">This folder is empty. Drop files here to upload.</div>
                    ) : (
                      currentStorageChildren.map((entry) => (
                        <div
                          key={entry.id}
                          className="drive-row"
                          draggable={entry.type === 'file' || entry.type === 'folder'}
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/storage-entry', String(entry.id))
                            event.dataTransfer.effectAllowed = 'copyMove'
                          }}
                          onDragOver={(event) => {
                            if (entry.type === 'folder') {
                              event.preventDefault()
                            }
                          }}
                          onDrop={(event) => {
                            if (entry.type !== 'folder') return
                            event.preventDefault()
                            const draggedId = Number(event.dataTransfer.getData('text/storage-entry'))
                            if (!draggedId || Number.isNaN(draggedId) || draggedId === entry.id) return
                            let parent: StorageEntry | undefined = entry
                            const visited = new Set<number>()
                            while (parent && !visited.has(parent.id)) {
                              if (parent.id === draggedId) { setStatusMessage('A folder cannot be moved inside itself.'); return }
                              visited.add(parent.id)
                              parent = parent.parentId === null ? undefined : storageFolderLookup[parent.parentId]
                            }
                            setStorageItems((current) =>
                              current.map((item) =>
                                item.id === draggedId ? { ...item, parentId: entry.id, lastUpdated: 'Moved now' } : item,
                              ),
                            )
                          }}
                        >
                          <div
                            className="drive-name"
                            onClick={() => entry.type === 'folder' && setCurrentStorageFolderId(entry.id)}
                          >
                            <span className={`storage-icon ${entry.type}`}>{entry.type === 'folder' ? '📁' : '📄'}</span>
                            <div>
                              <strong>{entry.name}</strong>
                              <small>{entry.type === 'folder' ? 'Folder' : entry.size ?? 'Uploaded file'}</small>
                            </div>
                          </div>
                          <span className="drive-type">{entry.type}</span>
                          <span className="drive-updated">{entry.lastUpdated ?? 'Updated recently'}</span>
                          <div className="storage-actions">
                            {entry.type === 'file' && entry.downloadUrl && (
                              <>
                                <button
                                  type="button"
                                  className="secondary-button small"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    const link = document.createElement('a')
                                    link.href = entry.downloadUrl!
                                    link.download = entry.name
                                    link.click()
                                  }}
                                >
                                  Download
                                </button>
                                <button
                                  type="button"
                                  className="secondary-button small"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    if (entry.downloadUrl) {
                                      window.open(entry.downloadUrl, '_blank', 'noopener,noreferrer')
                                    }
                                  }}
                                >
                                  Open
                                </button>
                              </>
                            )}
                            {entry.type === 'folder' && (
                              <button
                                type="button"
                                className="secondary-button small"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setCurrentStorageFolderId(entry.id)
                                }}
                              >
                                Open
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
