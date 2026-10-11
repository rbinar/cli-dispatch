export type Worker = { id: string; backend: string; state: string; startedAt: string; verify?: string }

declare module 'claude-code' {
  interface PluginState {
    'cli-dispatch': { workers: Worker[] }
  }
}
