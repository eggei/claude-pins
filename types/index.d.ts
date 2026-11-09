export type Pin = {
  id: string
  title: string
  text: string
  createdAt: number
  source: 'selection' | 'reply'
  sessionId?: string
  sessionName?: string
  projectRoot?: string
}

declare module 'claude-code' {
  interface PluginState {
    pins: {
      pins: Shaped<Pin[]>
      viewing: string
    }
  }
}
