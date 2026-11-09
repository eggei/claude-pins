import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pin } from '../types'

const LIST_PANE = 'pins'
const STORE_KEY = 'pins'
const HIDDEN_KEY = 'paneHidden'
const TITLE_LENGTH = 60
const HEADER_BACKGROUND = 'subtle'
const ACCENT = 'claude'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const formatDay = (timestamp: number) => {
  const day = new Date(timestamp)

  return `${MONTHS[day.getMonth()]} ${day.getDate()}`
}

const folderName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

const TITLE_ENTRY = /^\{"type":"(custom-title|agent-name|ai-title)"/
const TITLE_FIELDS = [
  ['custom-title', 'customTitle'],
  ['agent-name', 'agentName'],
  ['ai-title', 'aiTitle'],
] as const

const findSessionNames = async ($: EngineInterface, sessionIds: readonly string[]) => {
  const names = new Map<string, string>()
  if (sessionIds.length === 0) return names

  const configDirectory = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`
  const nameMatchers = sessionIds.flatMap((sessionId, index) => [
    ...(index > 0 ? ['-o'] : []),
    '-name',
    `${sessionId}.jsonl`,
  ])
  const located = await $.process
    .run(['find', `${configDirectory}/projects`, '-maxdepth', '2', '(', ...nameMatchers, ')'])
    .catch(() => undefined)
  const transcriptPaths = located?.stdout.split('\n').filter(line => line.trim().length > 0) ?? []
  if (transcriptPaths.length === 0) return names

  const matched = await $.process
    .run(['grep', '-H', '-E', TITLE_ENTRY.source, ...transcriptPaths])
    .catch(() => undefined)
  const latestBySession = new Map<string, Map<string, string>>()
  for (const line of matched?.stdout.split('\n') ?? []) {
    const separator = line.indexOf(':{')
    if (separator === -1) continue

    const sessionId = line.slice(0, separator).split('/').at(-1)?.replace(/\.jsonl$/, '') ?? ''
    try {
      const entry = JSON.parse(line.slice(separator + 1)) as Record<string, unknown>
      const field = TITLE_FIELDS.find(([type]) => type === entry.type)?.[1]
      const value = field ? entry[field] : undefined
      if (typeof value !== 'string' || !value.trim()) continue

      const latestByType = latestBySession.get(sessionId) ?? new Map<string, string>()
      latestByType.set(String(entry.type), value.trim())
      latestBySession.set(sessionId, latestByType)
    } catch {
      continue
    }
  }

  for (const [sessionId, latestByType] of latestBySession) {
    const name = TITLE_FIELDS.map(([type]) => latestByType.get(type)).find(Boolean)
    if (name) names.set(sessionId, name)
  }

  return names
}

const pinsAtom = atom({ plugin: 'pins', key: 'pins' } as const, [], { shape: 'pins-1' })
const viewingAtom = atom({ plugin: 'pins', key: 'viewing' } as const, '')

const loadStoredPins = async ($: EngineInterface): Promise<Pin[]> => {
  const stored = await $.store.get(STORE_KEY)

  return Array.isArray(stored) ? (stored as Pin[]) : []
}

const syncPins = async ($: EngineInterface) => {
  const storedPins = await loadStoredPins($)
  const shownPins = await read($, pinsAtom)
  if (JSON.stringify(storedPins) !== JSON.stringify(shownPins)) await update($, pinsAtom, () => storedPins)

  return storedPins
}

const refreshSessionNames = async ($: EngineInterface) => {
  const storedPins = await loadStoredPins($)
  const sessionIds = [...new Set(storedPins.flatMap(pin => (pin.sessionId ? [pin.sessionId] : [])))]
  const names = await findSessionNames($, sessionIds).catch(() => new Map<string, string>())
  const isRenamed = (pin: Pin) => !!pin.sessionId && !!names.get(pin.sessionId) && names.get(pin.sessionId) !== pin.sessionName
  if (!storedPins.some(isRenamed)) return 0

  const renamedSessions = new Set(storedPins.filter(isRenamed).map(pin => pin.sessionId))
  await changePins($, current =>
    current.map(pin => (isRenamed(pin) ? { ...pin, sessionName: names.get(pin.sessionId ?? '') } : pin)),
  )

  return renamedSessions.size
}

const changePins = async ($: EngineInterface, change: (pins: Pin[]) => Pin[]) => {
  const nextPins = change(await loadStoredPins($))
  await $.store.set(STORE_KEY, nextPins)
  await update($, pinsAtom, () => nextPins)

  return nextPins
}

const deriveTitle = (text: string) => {
  const firstLine =
    text
      .split('\n')
      .map(line => line.replace(/^[\s#>*\-`|]+/, '').replace(/[*`_]/g, '').trim())
      .find(line => line.length > 0) ?? 'Untitled'

  return firstLine.length > TITLE_LENGTH ? `${firstLine.slice(0, TITLE_LENGTH - 1)}…` : firstLine
}

const isHidden = async ($: EngineInterface) => (await $.store.get(HIDDEN_KEY)) === true

const openList = async ($: EngineInterface, focus: boolean) => {
  if (focus) {
    await $.store.set(HIDDEN_KEY, false)
    return $.ui.open({ id: LIST_PANE, title: 'Pins', focus: true })
  }

  if (await isHidden($)) return undefined

  return $.ui.open({ id: LIST_PANE, title: 'Pins' })
}

const hideList = async ($: EngineInterface) => {
  await $.store.set(HIDDEN_KEY, true)
  await update($, viewingAtom, () => '')
  await $.ui.close({ id: LIST_PANE }).catch(() => undefined)
}

const showPin = async ($: EngineInterface, pinId: string) => {
  await update($, viewingAtom, () => pinId)
  await $.ui.scroll({ in: LIST_PANE, to: 'start' }).catch(() => undefined)
}

const comparable = (line: string) => line.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

const findMarkdownSource = (selectedText: string, replies: string[]) => {
  const selectedLines = selectedText.split('\n').map(comparable).filter(line => line.length >= 3)
  const firstSelected = selectedLines[0]
  const lastSelected = selectedLines.at(-1)
  if (!firstSelected || !lastSelected) return undefined

  for (const reply of replies) {
    const sourceLines = reply.split('\n')
    const comparableSource = sourceLines.map(line => [
      comparable(line),
      comparable(line.replace(/\]\([^)]*\)/g, ']')),
    ])
    const holds = (forms: string[], wanted: string) => forms.some(form => form.length > 0 && form.includes(wanted))
    const start = comparableSource.findIndex(forms => holds(forms, firstSelected))
    if (start === -1) continue

    const endOffset = comparableSource.slice(start).findIndex(forms => holds(forms, lastSelected))
    if (endOffset === -1) continue

    return sourceLines.slice(start, start + endOffset + 1).join('\n').trim()
  }

  return undefined
}

const openLink = async ($: EngineInterface, href: string) => {
  if (!/^https?:\/\//i.test(href)) return

  const opened = await $.process.run(['open', href]).catch(() => undefined)
  if (opened?.exitCode === 0) return

  const fallback = await $.process.run(['xdg-open', href]).catch(() => undefined)
  if (fallback?.exitCode !== 0) $.ui.toast(`Could not open ${href}`)
}

const unpinUsage = 'Usage: /unpin <number> (as listed in /pins) or /unpin all.'

const quietly = async ($: EngineInterface, message: string) => {
  await $.ui.toast(message)

  return {}
}

const removePin = async ($: EngineInterface, pinId: string) => {
  const before = await loadStoredPins($)
  const index = before.findIndex(candidate => candidate.id === pinId)
  const removed = before[index]
  if (!removed) return undefined

  const after = await changePins($, current => current.filter(candidate => candidate.id !== pinId))
  const neighbor = after[Math.min(index, after.length - 1)]
  if (neighbor) await $.ui.focus({ requestId: LIST_PANE, key: neighbor.id }).catch(() => undefined)
  $.ui.toast(`unpinned ⌫ "${removed.title}"`)

  return removed
}

export const register: Register = on => {
  let focusedPinId = ''

  on('ui.focus', { component: 'Pane', requestId: LIST_PANE }, async ($, e, next) => {
    const pins = await syncPins($).catch(() => [] as Pin[])
    if (e.element && pins.some(candidate => candidate.id === e.element)) focusedPinId = e.element

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pin',
      description: 'Pin the selected text, or the last reply, to the Pins pane',
      argumentHint: '[title]',
      immediate: true,
    })
    await $.command.register({ name: 'pins', description: 'Show the Pins pane and jump into it', immediate: true })
    await $.command.register({
      name: 'unpin',
      description: 'Remove a pin by its number in the Pins pane, or all of them',
      argumentHint: '<number|all>',
      immediate: true,
    })

    const storedPins = await syncPins($)
    if (storedPins.length > 0) void openList($, false)

    return next(e)
  })

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await syncPins($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'pins' }, async $ => {
    const listPane = (await $.ui.panes()).find(pane => pane.id === LIST_PANE && pane.isShown)
    if (!listPane) await update($, viewingAtom, () => '')
    await syncPins($)
    await openList($, true)

    const isFocused = (await $.ui.panes()).some(pane => pane.id === LIST_PANE && pane.isFocused)
    if (listPane && !isFocused) return quietly($, 'Clear the input to jump into Pins, or press ctrl+x tab')

    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === LIST_PANE && e.origin.kind === 'person') await $.store.set(HIDDEN_KEY, true).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'unpin' }, async ($, e) => {
    const target = e.args.trim().toLowerCase()

    if (target === 'all') {
      const removed = (await loadStoredPins($)).length
      await changePins($, () => [])

      return quietly($, `unpinned all ${removed}`)
    }

    const position = Number(target)
    if (!target || !Number.isInteger(position) || position < 1) return quietly($, unpinUsage)

    const pins = await loadStoredPins($)
    const pin = pins[position - 1]
    if (!pin) return quietly($, `No pin #${position}; there are ${pins.length}. ${unpinUsage}`)

    await changePins($, current => current.filter(candidate => candidate.id !== pin.id))

    return quietly($, `unpinned ⌫ "${pin.title}"`)
  })

  on('command.run', { command: 'pin' }, async ($, e) => {
    const selection = await $.ui.selection()
    const selectedText = selection?.text.trim() ?? ''
    const replies = (await $.session.messages())
      .filter(message => message.role === 'assistant' && message.text.trim().length > 0)
      .map(message => message.text.trim())
      .reverse()
    let text = selectedText
    let source: Pin['source'] = 'selection'

    if (selectedText) {
      text = findMarkdownSource(selectedText, replies) ?? selectedText
    } else {
      text = replies[0] ?? ''
      source = 'reply'
    }

    if (!text) return quietly($, 'Nothing to pin: select some text or wait for a reply.')

    const createdAt = await $.clock.now()
    const sessionId = await $.session.id()
    const sessionName = (await findSessionNames($, [sessionId]).catch(() => undefined))?.get(sessionId)
    const pin: Pin = {
      id: `${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: e.args.trim() || deriveTitle(text),
      text,
      createdAt,
      source,
      sessionId,
      ...(sessionName ? { sessionName } : {}),
      projectRoot: await $.session.root(),
    }
    const savedPins = await changePins($, pins => [pin, ...pins])
    await openList($, false)

    return quietly($, `pinned ¶ "${pin.title}" (${savedPins.length})`)
  })

  on('ui.render', { component: 'Pane', requestId: LIST_PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const pins = await read($, pinsAtom)
    const viewingId = await read($, viewingAtom)
    const viewedIndex = pins.findIndex(candidate => candidate.id === viewingId)
    const viewed = pins[viewedIndex]
    const closeButton = (
      <Button key="close" plain dimColor hotkey="x" onPress={() => hideList($)}>
        close
      </Button>
    )

    if (viewed) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="column" backgroundColor={HEADER_BACKGROUND} paddingX={1}>
            <Box flexDirection="row" justifyContent="space-between" gap={1}>
              <Text bold color={ACCENT} wrap="truncate-end">
                ¶ {viewed.title}
              </Text>
              <Text dimColor>#{viewedIndex + 1}</Text>
            </Box>
            <Box flexDirection="row" gap={2}>
              <Button key="back" plain dimColor hotkey="b" autoFocus onPress={() => showPin($, '')}>
                back
              </Button>
              <Button
                key="copy"
                plain
                dimColor
                hotkey="c"
                onPress={async press => {
                  const copied = await $.ui.copy({ text: viewed.text, surface: press.surface })
                  $.ui.toast(copied.isCopied ? 'copied ↗' : `Copy failed: ${copied.reason}`)
                }}
              >
                copy
              </Button>
              <Button
                key="unpin"
                plain
                dimColor
                hotkey="d"
                onPress={async () => {
                  await update($, viewingAtom, () => '')
                  await removePin($, viewed.id)
                }}
              >
                unpin
              </Button>
              {closeButton}
            </Box>
            <Text dimColor wrap="truncate-end">
              {[
                formatDay(viewed.createdAt),
                viewed.sessionName,
                viewed.projectRoot ? folderName(viewed.projectRoot) : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Box>
          <Box paddingX={1} paddingTop={1}>
            <Markdown key="body" text={viewed.text} onLinkPress={link => void openLink($, link.href)} />
          </Box>
        </Box>
      )
    }

    const header = (
      <Box flexDirection="row" justifyContent="space-between" backgroundColor={HEADER_BACKGROUND} paddingX={1}>
        <Text bold color={ACCENT}>
          ¶ Pins
        </Text>
        <Text dimColor>{pins.length === 1 ? '1 saved' : `${pins.length} saved`}</Text>
      </Box>
    )

    const refreshButton = (
      <Button
        key="refresh"
        plain
        dimColor
        hotkey="r"
        onPress={async () => {
          const refreshed = await syncPins($)
          const renamedCount = await refreshSessionNames($)
          $.ui.toast(
            renamedCount > 0
              ? `refreshed (${refreshed.length} saved, ${renamedCount} session ${renamedCount === 1 ? 'name' : 'names'} updated)`
              : `refreshed (${refreshed.length} saved)`,
          )
        }}
      >
        refresh
      </Button>
    )

    if (pins.length === 0) {
      return (
        <Box flexDirection="column">
          {header}
          <Box flexDirection="column" paddingX={1} paddingTop={1}>
            <Text>⁂ nothing pinned yet</Text>
            <Text dimColor>/pin saves your selection, or the last reply.</Text>
          </Box>
          <Box flexDirection="row" gap={2} paddingX={1} paddingTop={1}>
            {refreshButton}
            {closeButton}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          {pins.map((pin, index) => (
            <Button
              key={pin.id}
              plain
              hotkey={index < 9 ? String(index + 1) : undefined}
              autoFocus={index === 0 ? true : undefined}
              onPress={() => showPin($, pin.id)}
            >
              {index >= 9 ? `${index + 1}. ` : ''}
              {pin.title}
            </Button>
          ))}
        </Box>
        <Box flexDirection="row" gap={2} paddingX={1} paddingTop={1}>
          <Text dimColor>⏎ open</Text>
          <Button
            key="remove-focused"
            plain
            dimColor
            hotkey="d"
            onPress={async () => {
              const target = pins.find(candidate => candidate.id === focusedPinId)
              if (target) await removePin($, target.id)
              else $.ui.toast('Move to a pin with the arrow keys first.')
            }}
          >
            remove
          </Button>
          {refreshButton}
          {closeButton}
        </Box>
      </Box>
    )
  })
}
