import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type ProviderInfo = {
  provider: string
  label: string
  models: string[]
  defaultModel: string
}

type ChatMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
}

type SectionKey = 'Overview' | 'AI Chat' | 'Workbench' | 'Agents' | 'Storage'

type TaskStatus = 'Backlog' | 'Ready' | 'In progress' | 'In review' | 'Done'

type AgentKey = 'documentation' | 'reminders'

type ProjectTask = {
  id: number
  title: string
  assignee: string
  timeline: string
  notes: string
  createdBy: string
  updatedBy: string
  status: TaskStatus
}

type ProjectItem = {
  id: number
  name: string
  tasks: ProjectTask[]
}

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
  const [authenticated, setAuthenticated] = useState(false)
  const [username, setUsername] = useState('admin')
  const [loginForm, setLoginForm] = useState({ username: 'admin', password: '' })
  const [guestName, setGuestName] = useState('')
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [selectedProvider, setSelectedProvider] = useState('gemini')
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [historyItems, setHistoryItems] = useState<ChatMessage[]>([])
  const [activeSection, setActiveSection] = useState<SectionKey>('Overview')
  const [enabledAgents, setEnabledAgents] = useState<Record<AgentKey, boolean>>({
    documentation: false,
    reminders: false,
  })
  const [documentationMessages, setDocumentationMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      content: 'Documentation agent ready. Upload a file or image, choose a skill, and I will draft a document or deck for the workspace storage.',
    },
  ])
  const [documentationInput, setDocumentationInput] = useState('')
  const [documentationSkills, setDocumentationSkills] = useState<Record<string, boolean>>({
    summarize: true,
    'image-analysis': false,
    'deck-builder': false,
    'research-note': true,
  })
  const [documentationFormat, setDocumentationFormat] = useState<'Document' | 'Presentation'>('Document')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [reminderItems, setReminderItems] = useState<Array<{ id: number; title: string; note: string }>>([])
  const [projects, setProjects] = useState<ProjectItem[]>([
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
  ])
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
  const isAdmin = username.toLowerCase() === 'admin'

  useEffect(() => {
    void checkAuth()
  }, [])

  useEffect(() => {
    if (!authenticated) return
    void loadModels()
  }, [authenticated])

  useEffect(() => {
    const provider = providers.find((item) => item.provider === selectedProvider)
    if (!provider || provider.models.length === 0) return
    const fallback = provider.defaultModel || provider.models[0]
    setSelectedModel(fallback)
  }, [selectedProvider, providers])

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' })
      const data = await response.json()
      if (data.authenticated) {
        setAuthenticated(true)
        setUsername(data.username)
        setLoginForm((current) => ({ ...current, username: data.username }))
      } else {
        setAuthenticated(false)
      }
    } catch (error) {
      console.error('Auth check failed', error)
    }
  }

  const loadModels = async () => {
    try {
      const response = await fetch('/api/models', { credentials: 'include' })
      const data = await response.json()
      const list = data.providers ?? []
      setProviders(list)
      if (list.length > 0) {
        setSelectedProvider(list[0].provider)
        setSelectedModel(list[0].defaultModel || list[0].models[0])
      }
    } catch (error) {
      console.error('Model load failed', error)
      setStatusMessage('Model discovery is temporarily unavailable.')
    }
  }

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
      setChatMessages([])
      setStatusMessage(`Welcome, ${data.username || name}.`)
      await loadModels()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Guest sign-in failed.')
    }
  }

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    setStatusMessage('Signing in...')

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
    setChatMessages([])
    setStatusMessage('Logged in successfully.')
    await loadModels()
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
    setAuthenticated(false)
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
    while (cursor) {
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

  useEffect(() => {
    if (!enabledAgents.reminders) {
      setReminderItems([])
      return
    }

    const nextItems = projects.flatMap((project) =>
      project.tasks.map((task) => ({
        id: task.id,
        title: `${project.name}: ${task.title}`,
        note: `${task.assignee} • ${task.timeline} • ${task.status}`,
      })),
    )

    setReminderItems(nextItems.slice(0, 6))
  }, [enabledAgents.reminders, projects])

  const activeProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0]

  const handleCreateProject = () => {
    const trimmed = newProjectName.trim()
    if (!trimmed) return

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
    if (!taskDraft.title.trim() || !taskDraft.assignee.trim()) return

    const newTask: ProjectTask = {
      id: Date.now(),
      title: taskDraft.title.trim(),
      assignee: taskDraft.assignee.trim(),
      timeline: taskDraft.timeline.trim() || 'TBD',
      notes: taskDraft.notes.trim() || 'No notes added.',
      createdBy: username || 'admin',
      updatedBy: username || 'admin',
      status: 'Backlog',
    }

    setProjects((current) =>
      current.map((project) =>
        project.id === selectedProjectId
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

  const handleDocumentationSubmit = () => {
    const prompt = documentationInput.trim()
    if (!prompt && attachedFiles.length === 0) return

    const skillSummary = Object.entries(documentationSkills)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(', ') || 'general drafting'

    const sourceNames = attachedFiles.length > 0 ? attachedFiles.map((file) => file.name).join(', ') : 'no attached source'
    const generatedTitle = documentationFormat === 'Presentation' ? 'Project deck draft' : 'Documentation draft'

    const responseText =
      documentationFormat === 'Presentation'
        ? `# ${generatedTitle}\n\n## Objective\n${prompt || 'Create a presentation based on the attached files.'}\n\n## Source files\n${sourceNames}\n\n## Slide 1: Overview\n- Goal\n- Key stakeholders\n- Workspace context\n\n## Slide 2: Findings\n- Extracted insights from the uploaded material\n- Cross-checks with the project timeline\n\n## Slide 3: Next steps\n- Action items\n- Owners\n- Delivery timeline\n\n## Skills used\n${skillSummary}\n\nThis deck was auto-generated for the ${activeProject?.name ?? 'current project'} workspace.`
        : `# ${generatedTitle}\n\n## Summary\n${prompt || 'Generated document based on uploaded material.'}\n\n## Attached sources\n${sourceNames}\n\n## Details\n- Skill set: ${skillSummary}\n- Project: ${activeProject?.name ?? 'Current workspace'}\n- Format: ${documentationFormat}\n\n## Notes\nThis draft was created automatically by the documentation agent and saved to the shared storage folder.`

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
      [documentationFormat === 'Presentation' ? `<html><body>${responseText.replace(/\n/g, '<br/>')}</body></html>` : responseText],
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

  const handleAiRequest = () => {
    const text = input.trim()
    if (!text) return

    const assistantText = (() => {
      const lower = text.toLowerCase()

      if (/create project|new project|create repo|new repo/.test(lower)) {
        const nameMatch = text.match(/(?:create|new)\s+(?:project|repo)\s+(.+)/i)
        const candidate = nameMatch?.[1]?.trim() || 'New project'
        const projectName = candidate.replace(/^['"]|['"]$/g, '')
        const nextId = Date.now()
        setProjects((current) => [...current, { id: nextId, name: projectName, tasks: [] }])
        setSelectedProjectId(nextId)
        return `I created the project “${projectName}” and selected it for you.`
      }

      if (/edit task|update task|enhance task|improve task|refine task|modify task/.test(lower)) {
        const keyMatch = text.match(/(?:edit|update|enhance|improve|refine|modify)\s+(?:task|ticket)\s+(.+?)(?:\s+(?:to|with|and)|$)/i)
        const taskName = keyMatch?.[1]?.trim() || 'latest task'
        const targetTask = (activeProject?.tasks ?? []).find((task) =>
          task.title.toLowerCase().includes(taskName.toLowerCase()),
        )

        if (targetTask) {
          const nextTitle = text.match(/title\s+(.+?)(?:\s+(?:for|as|and)|$)/i)?.[1]?.trim() || targetTask.title
          const nextAssignee = text.match(/assign(?:ed)?\s+(?:to\s+)?(.+?)(?:\s+(?:for|on|with)|$)/i)?.[1]?.trim() || targetTask.assignee
          const nextTimeline = text.match(/timeline\s+(.+?)(?:\s+(?:for|and)|$)/i)?.[1]?.trim() || targetTask.timeline
          const nextNotes = text.match(/notes?\s+(.+)/i)?.[1]?.trim() || targetTask.notes

          setProjects((current) =>
            current.map((project) => ({
              ...project,
              tasks: project.tasks.map((task) =>
                task.id === targetTask.id
                  ? {
                      ...task,
                      title: nextTitle,
                      assignee: nextAssignee,
                      timeline: nextTimeline,
                      notes: `${task.notes} • ${nextNotes}`.trim(),
                      updatedBy: username || 'admin',
                    }
                  : task,
              ),
            })),
          )
          return `I updated the task “${targetTask.title}” with the new details you requested.`
        }
      }

      if (/add task|create task|new task/.test(lower)) {
        const titleMatch = text.match(/(?:add|create|new)\s+(?:task|ticket)\s+(.+)/i)
        const title = titleMatch?.[1]?.trim() || 'New task'
        const newTask: ProjectTask = {
          id: Date.now(),
          title,
          assignee: 'Unassigned',
          timeline: 'TBD',
          notes: 'Added from AI chat.',
          createdBy: username || 'admin',
          updatedBy: username || 'admin',
          status: 'Backlog',
        }
        setProjects((current) =>
          current.map((project) =>
            project.id === selectedProjectId
              ? { ...project, tasks: [...project.tasks, newTask] }
              : project,
          ),
        )
        return `I added the task “${title}” to the active project in Backlog.`
      }

      if (/move|mark/.test(lower)) {
        const taskMatch = text.match(/(?:move|mark)\s+(.+?)\s+(?:to|as)\s+(.+)/i)
        const taskName = taskMatch?.[1]?.trim() || 'latest task'
        const statusName = taskMatch?.[2]?.trim() || 'Backlog'
        const statusMap: Record<string, ProjectTask['status']> = {
          backlog: 'Backlog',
          ready: 'Ready',
          'in progress': 'In progress',
          'in review': 'In review',
          done: 'Done',
        }
        const mapped = statusMap[statusName.toLowerCase()] || 'Backlog'
        setProjects((current) =>
          current.map((project) => ({
            ...project,
            tasks: project.tasks.map((task) =>
              task.title.toLowerCase().includes(taskName.toLowerCase())
                ? { ...task, status: mapped, updatedBy: username || 'admin' }
                : task,
            ),
          })),
        )
        return `I moved “${taskName}” to ${mapped}.`
      }

      return 'I can create projects, add tasks, assign owners, and update project status from your request.'
    })()

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: text,
    }
    const assistantMessage: ChatMessage = {
      id: Date.now() + 1,
      role: 'assistant',
      content: assistantText,
    }
    setChatMessages((current) => [...current, userMessage, assistantMessage])
    if (isAdmin) {
      setHistoryItems((current) => [...current, userMessage, assistantMessage])
    }
    setInput('')
    setStatusMessage('Project update processed.')
  }

  const handleAiCommand = () => {
    const text = input.trim()
    if (!text || busy) return

    if (/create project|new project|create repo|new repo|add task|create task|new task|edit task|update task|enhance task|improve task|refine task|modify task|move|mark/.test(text)) {
      handleAiRequest()
      return
    }

    void handleSend()
  }

  const handleChatSubmit = () => {
    handleAiCommand()
  }

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || busy) return

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: trimmed,
    }
    setChatMessages((current) => [...current, userMessage])
    if (isAdmin) {
      setHistoryItems((current) => [...current, userMessage])
    }
    setInput('')
    setBusy(true)
    setStatusMessage('Generating response...')

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          model: selectedModel,
          message: trimmed,
        }),
      })

      const data = await response.json().catch(() => ({ answer: 'Unable to reach the model.' }))
      if (!response.ok) {
        throw new Error(data.detail || 'Chat request failed.')
      }

      const assistantMessage: ChatMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: data.answer || 'No answer received from the active model.',
      }
      setChatMessages((current) => [...current, assistantMessage])
      if (isAdmin) {
        setHistoryItems((current) => [...current, assistantMessage])
      }
      setStatusMessage(`Response generated with ${selectedProvider} / ${selectedModel}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chat generation failed.'
      setStatusMessage(`The selected model is unavailable right now. ${message}`)
    } finally {
      setBusy(false)
    }
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
            <div className="brand-orb">P</div>
            <div>
              <p className="eyebrow">Products Team</p>
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
          <div className="brand-mark">P</div>
          <div>
            <p className="eyebrow">Products Team</p>
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
              {section}
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
          <span className="status-pill">System online</span>
        </header>

        {activeSection === 'Overview' && (
          <div className="content-grid">
            <section className="stats-grid">
              <div className="stat-card">
                <span>Open tasks</span>
                <strong>{projects.reduce((sum, project) => sum + project.tasks.length, 0)}</strong>
              </div>
              <div className="stat-card">
                <span>Enabled agents</span>
                <strong>{Object.values(enabledAgents).filter(Boolean).length}</strong>
              </div>
              <div className="stat-card">
                <span>Storage items</span>
                <strong>{storageItems.length}</strong>
              </div>
              <div className="stat-card">
                <span>Priority alerts</span>
                <strong>{reminderItems.length || 2}</strong>
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
              <label>
                Provider
                <select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value)}>
                  {providers.map((provider) => (
                    <option key={provider.provider} value={provider.provider}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Model
                <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                  {providers
                    .find((provider) => provider.provider === selectedProvider)
                    ?.models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    )) ?? <option value={selectedModel}>{selectedModel}</option>}
                </select>
              </label>
            </div>

            <div className="chat-message-list large-list">
              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={message.role === 'user' ? 'chat-bubble user' : 'chat-bubble assistant'}
                >
                  {message.content}
                </div>
              ))}
            </div>

            <div className="composer-box">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    handleChatSubmit()
                  }
                }}
                placeholder="Ask the model to create a task, project, or update the backlog..."
                rows={1}
              />
              <button type="button" className="send-button" onClick={handleChatSubmit} disabled={busy}>
                {busy ? '…' : 'Send'}
              </button>
            </div>

            {statusMessage && <div className="chat-status">{statusMessage}</div>}
          </div>
        )}

        {activeSection === 'Workbench' && (
          <div className="content-grid">
            <section className="panel board-panel">
              <div className="board-header">
                <div className="board-title-wrap">
                  <span className="board-icon">◌</span>
                  <h3>Planner Board</h3>
                </div>
              </div>

              <div className="project-create-box">
                <div className="project-create-tag">Project</div>
                <div className="project-create-row">
                  <input
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                    placeholder="Project name"
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
                      className={`project-tab ${selectedProjectId === project.id ? 'active' : ''}`}
                      onClick={() => setSelectedProjectId(project.id)}
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

              <div className="board-columns">
                {boardColumns.map((column) => {
                  const columnTasks = (activeProject?.tasks ?? []).filter((task) => task.status === column.key)
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
                              <div className="task-labels">
                                <span className="label-pill">{task.assignee}</span>
                                <span className="label-pill">{task.timeline}</span>
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
                  />
                  <input
                    value={taskDraft.assignee}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, assignee: event.target.value }))}
                    placeholder="Allocate to"
                  />
                  <input
                    value={taskDraft.timeline}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, timeline: event.target.value }))}
                    placeholder="Timeline"
                  />
                  <textarea
                    value={taskDraft.notes}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Notes"
                  />
                  <button type="button" className="send-button task-button" onClick={handleAddTask}>
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
                    <p>Generate summaries, release notes, and project docs from natural-language prompts.</p>
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
                      Upload file or image
                      <input
                        type="file"
                        accept="image/*,.pdf,.doc,.docx,.txt,.md,.ppt,.pptx"
                        multiple
                        onChange={(event) => {
                          const files = Array.from(event.target.files ?? [])
                          if (!files.length) return
                          setAttachedFiles((current) => [...current, ...files])
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
                          <button type="button" className="send-button" onClick={handleDocumentationSubmit}>
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
                    <p>Tracks deadlines, owner reminders, and team signals that need attention.</p>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleToggleAgent('reminders')}
                    >
                      {enabledAgents.reminders ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                  <div className="agent-card reminder-card">
                    <h3>Current reminders</h3>
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
                            if (Number.isNaN(draggedId) || draggedId === entry.id) return
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
