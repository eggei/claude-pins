import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const paneProps = (title: string) => ({
  title,
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
})

const LIST = { plugin: 'pins', component: 'Pane', requestId: 'pins', props: paneProps('Pins') } as const
const typedFrom = {
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: true, columns: 160 },
}

const storedPin = {
  id: 'a1',
  title: 'Deploy checklist',
  text: '## Deploy checklist\n\n- run migrations',
  createdAt: 1,
  source: 'reply',
}

const toasts: string[] = []

const registered: { name: string; immediate?: true }[] = []
const openPanes = new Set<string>()
const paneFocus = { isFocused: false, canTakeFocus: true }

const engineBeneath = (on: On) => {
  toasts.length = 0
  registered.length = 0
  openPanes.clear()
  paneFocus.isFocused = false
  paneFocus.canTakeFocus = true
  on('command.register', (_, e) => {
    registered.push({ name: e.name, immediate: e.immediate })

    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    openPanes.add(e.id)
    if (e.focus && paneFocus.canTakeFocus) paneFocus.isFocused = true

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    openPanes.delete(e.id)
    paneFocus.isFocused = false

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...openPanes].map(id => ({ id, title: id, isShown: true, isFocused: paneFocus.isFocused, isPlaced: true })),
  }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'current-session' }))
  on('session.root', () => ({ value: '/work/app' }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.scroll', () => ({}))
  on('ui.focus', () => ({}))
}

const memoryStore = (on: On, entries: Record<string, unknown>) => {
  on('store.get', (_, e) => ({ value: entries[e.key] }))
  on('store.set', (_, e) => {
    entries[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })

  return entries
}

test('pressing a pin shows it in the same pane, and unpin removes it', async ($, on) => {
  engineBeneath(on)
  const store = memoryStore(on, { pins: [storedPin] })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await $.ui.mount({ ...LIST, surface: 'terminal' })
  expect((await pane.find({ key: 'a1' }))?.text).toMatch(/Deploy checklist/)
  await pane.press({ key: 'a1' })
  expect((await pane.find({ type: 'Markdown' }))?.text).toMatch(/run migrations/)

  await pane.press({ key: 'back' })
  expect(await pane.find({ type: 'Markdown' })).toBeUndefined()

  await pane.press({ key: 'a1' })
  await pane.press({ key: 'unpin' })
  expect(store.pins).toEqual([])
  expect((await pane.find({ type: 'Text', text: /nothing pinned yet/ }))?.text).toBe('⁂ nothing pinned yet')
  await pane.unmount()
})

test('commands run at once mid-turn and print nothing to the thread', async ($, on) => {
  engineBeneath(on)
  memoryStore(on, { pins: [storedPin] })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(registered).toEqual([
    { name: 'pin', immediate: true },
    { name: 'pins', immediate: true },
    { name: 'unpin', immediate: true },
  ])
  expect((await $.command.run({ command: 'pins', args: '', ...typedFrom })).text).toBeUndefined()
})

test('r in the pane, /pins and focusing the pane pick up pins saved by another session', async ($, on) => {
  engineBeneath(on)
  const store = memoryStore(on, {})

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...LIST, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /nothing pinned yet/ })).toBeDefined()

  store.pins = [{ ...storedPin, id: 'c3', title: 'From elsewhere' }]
  await pane.press({ key: 'refresh' })
  expect((await pane.find({ key: 'c3' }))?.text).toMatch(/From elsewhere/)
  expect(toasts.at(-1)).toBe('refreshed (1 saved)')

  store.pins = [storedPin]
  await $.command.run({ command: 'pins', args: '', ...typedFrom })
  expect(await pane.find({ key: 'c3' })).toBeUndefined()

  store.pins = [{ ...storedPin, id: 'd4', title: 'Later' }, storedPin]
  await $.ui.focus({ component: 'Pane', requestId: 'pins', plugin: 'pins', element: 'a1', origin: { kind: 'person' } })
  expect((await pane.find({ key: 'd4' }))?.text).toMatch(/Later/)
  await pane.unmount()
})

test('/unpin removes by number or all', async ($, on) => {
  engineBeneath(on)
  const second = { ...storedPin, id: 'b2', title: 'Second' }
  const store = memoryStore(on, { pins: [storedPin, second] })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ command: 'unpin', args: '5', ...typedFrom })).text).toBeUndefined()
  expect(toasts.at(-1)).toMatch(/No pin #5/)
  await $.command.run({ command: 'unpin', args: '', ...typedFrom })
  expect(toasts.at(-1)).toMatch(/Usage/)
  await $.command.run({ command: 'unpin', args: '1', ...typedFrom })
  expect(toasts.at(-1)).toMatch(/Deploy checklist/)
  expect(store.pins).toEqual([second])
  await $.command.run({ command: 'unpin', args: 'all', ...typedFrom })
  expect(store.pins).toEqual([])
})

test('/pin saves the last reply when nothing is selected', async ($, on) => {
  engineBeneath(on)
  const store = memoryStore(on, {})
  mock.clock(on, { now: 1000 })
  on('ui.selection', () => ({ value: undefined }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'how do I deploy?', toolUses: [] },
      { role: 'assistant', text: '**Step one:** run migrations', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [] },
    ],
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run({ command: 'pin', args: '', ...typedFrom })

  expect(text).toBeUndefined()
  expect(toasts.at(-1)).toBe('pinned ¶ "Step one: run migrations" (1)')
  const pins = store.pins as { text: string; source: string }[]
  expect(pins[0]?.text).toBe('**Step one:** run migrations')
  expect(pins[0]?.source).toBe('reply')
})

test('/pin prefers the selection and takes a title', async ($, on) => {
  engineBeneath(on)
  const store = memoryStore(on, { pins: [storedPin] })
  mock.clock(on, { now: 2000 })
  on('ui.selection', () => ({ value: { text: 'bundle exec rspec spec/models' } }))
  on('session.messages', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'pin', args: 'spec cmd', ...typedFrom })

  const pins = store.pins as { title: string; source: string }[]
  expect(pins.map(pin => pin.title)).toEqual(['spec cmd', 'Deploy checklist'])
  expect(pins[0]?.source).toBe('selection')
})

test('/pin keeps the markdown and links behind a selection', async ($, on) => {
  engineBeneath(on)
  const store = memoryStore(on, {})
  mock.clock(on, { now: 3000 })
  on('ui.selection', () => ({
    value: { text: 'Existing options:\n• claude-pin pins whole sessions.\n• Bookmarks app' },
  }))
  on('session.messages', () => ({
    value: [
      {
        role: 'assistant',
        text: 'Intro line\n\n**Existing options:**\n- [claude-pin](https://example.com/pin) pins whole sessions.\n- [Bookmarks](https://example.com/b) app\n\nOutro',
        toolUses: [],
      },
    ],
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'pin', args: '', ...typedFrom })

  const pins = store.pins as { text: string }[]
  expect(pins[0]?.text).toBe(
    '**Existing options:**\n- [claude-pin](https://example.com/pin) pins whole sessions.\n- [Bookmarks](https://example.com/b) app',
  )
})

test('a link press in a pin opens it in the browser', async ($, on) => {
  engineBeneath(on)
  memoryStore(on, { pins: [{ ...storedPin, text: 'See [docs](https://example.com/docs)' }] })
  const opened: string[][] = []
  on('process.run', (_, e) => {
    opened.push([...e.argv])

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...LIST, surface: 'terminal' })
  await pane.press({ key: 'a1' })
  await pane.press({ key: 'body', link: { href: 'https://example.com/docs' } })
  await pane.unmount()

  expect(opened).toEqual([['open', 'https://example.com/docs']])
})

test('d removes the focused pin from the list', async ($, on) => {
  engineBeneath(on)
  const second = { ...storedPin, id: 'b2', title: 'Second' }
  const store = memoryStore(on, { pins: [storedPin, second] })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...LIST, surface: 'terminal' })

  await $.ui.focus({
    component: 'Pane',
    requestId: 'pins',
    plugin: 'pins',
    element: 'b2',
    origin: { kind: 'person' },
  })
  await pane.press({ key: 'remove-focused' })
  expect(store.pins).toEqual([storedPin])
  expect(await pane.find({ key: 'b2' })).toBeUndefined()
  await pane.unmount()
})

test('/pin records the session, its name and the project it came from', async ($, on) => {
  engineBeneath(on)
  const store = memoryStore(on, {})
  mock.clock(on, { now: 4000 })
  on('ui.selection', () => ({ value: undefined }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'hello', toolUses: [] }] }))
  const transcriptPath = '/home/me/.claude/projects/-work-app/current-session.jsonl'
  const titleLines = [
    '{"type":"ai-title","aiTitle":"auto title","sessionId":"current-session"}',
    '{"type":"custom-title","customTitle":"Old name","sessionId":"current-session"}',
    '{"type":"custom-title","customTitle":"Deploy work","sessionId":"current-session"}',
  ]
    .map(line => `${transcriptPath}:${line}`)
    .join('\n')
  on('process.run', (_, e) => {
    const stdout = e.argv[0] === 'find' ? `${transcriptPath}\n` : e.argv.includes(transcriptPath) ? titleLines : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'pin', args: '', ...typedFrom })

  const pins = store.pins as { id: string; sessionId: string; sessionName: string; projectRoot: string }[]
  expect(pins[0]?.sessionId).toBe('current-session')
  expect(pins[0]?.sessionName).toBe('Deploy work')
  expect(pins[0]?.projectRoot).toBe('/work/app')

  const pane = await $.ui.mount({ ...LIST, surface: 'terminal' })
  await pane.press({ key: pins[0]?.id ?? '' })
  expect(await pane.find({ type: 'Text', text: /Deploy work · app/ })).toBeDefined()
  expect(await pane.find({ key: 'session' })).toBeUndefined()
  await pane.unmount()
})

test('/pins only opens and focuses the pane, and a closed pane stays closed', async ($, on) => {
  engineBeneath(on)
  const store = memoryStore(on, { pins: [storedPin] })
  mock.clock(on, { now: 5000 })
  on('ui.selection', () => ({ value: undefined }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'hello', toolUses: [] }] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(openPanes.has('pins')).toBe(true)
  expect(paneFocus.isFocused).toBe(false)

  paneFocus.canTakeFocus = false
  await $.command.run({ command: 'pins', args: '', ...typedFrom })
  expect(openPanes.has('pins')).toBe(true)
  expect(toasts.at(-1)).toMatch(/Clear the input/)

  paneFocus.canTakeFocus = true
  await $.command.run({ command: 'pins', args: '', ...typedFrom })
  expect(openPanes.has('pins')).toBe(true)
  expect(paneFocus.isFocused).toBe(true)

  await $.command.run({ command: 'pins', args: '', ...typedFrom })
  expect(openPanes.has('pins')).toBe(true)
  expect(paneFocus.isFocused).toBe(true)

  const pane = await $.ui.mount({ ...LIST, surface: 'terminal' })
  await pane.press({ key: 'close' })
  expect(openPanes.has('pins')).toBe(false)
  expect(store.paneHidden).toBe(true)
  await pane.unmount()

  await $.command.run({ command: 'pin', args: '', ...typedFrom })
  expect(openPanes.has('pins')).toBe(false)

  await $.command.run({ command: 'pins', args: '', ...typedFrom })
  expect(openPanes.has('pins')).toBe(true)
  expect(store.paneHidden).toBe(false)
})

test('r picks up a session renamed after pinning, and names older pins', async ($, on) => {
  engineBeneath(on)
  const store = memoryStore(on, {
    pins: [
      { ...storedPin, id: 'a1', sessionId: 'first', sessionName: 'Old name' },
      { ...storedPin, id: 'b2', sessionId: 'second' },
      { ...storedPin, id: 'c3' },
    ],
  })
  const transcripts: Record<string, string[]> = {
    '/home/me/.claude/projects/-work-app/first.jsonl': [
      '{"type":"ai-title","aiTitle":"auto","sessionId":"first"}',
      '{"type":"custom-title","customTitle":"Renamed","sessionId":"first"}',
    ],
    '/home/me/.claude/projects/-work-other/second.jsonl': ['{"type":"agent-name","agentName":"job name","sessionId":"second"}'],
  }
  const runs: string[][] = []
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const stdout =
      e.argv[0] === 'find'
        ? Object.keys(transcripts).join('\n')
        : Object.entries(transcripts)
            .filter(([path]) => e.argv.includes(path))
            .flatMap(([path, lines]) => lines.map(line => `${path}:${line}`))
            .join('\n')

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...LIST, surface: 'terminal' })
  await pane.press({ key: 'refresh' })
  await pane.unmount()

  const pins = store.pins as { id: string; sessionName?: string }[]
  expect(pins.map(pin => pin.sessionName)).toEqual(['Renamed', 'job name', undefined])
  expect(toasts.at(-1)).toBe('refreshed (3 saved, 2 session names updated)')
  expect(runs.map(argv => argv[0])).toEqual(['find', 'grep'])
})
