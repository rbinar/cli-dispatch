export type Worker = { id: string; name: string; backend: string; state: string; startedAt: string; verify?: string }

// Booleans and model names only: this state crosses the hook chain, so a key value never lands in it.
export type SetupBackend = {
  id: string
  cliOk: boolean | null // null: could not probe (no sh)
  wrapperOk: boolean | null
  userConfig: boolean // a key is set in the plugin's userConfig
  configFile: boolean | null // a key is set in the config file; null: the file could not be read
  models: Record<string, string>
}
export type SetupState = {
  installable: boolean
  configKnown: boolean
  configPath: string
  configExists: boolean
  selected: string[] // backend ids toggled for install
  backends: SetupBackend[]
}

declare module 'claude-code' {
  interface PluginState {
    'cli-dispatch': { workers: Worker[]; setup: SetupState | null }
  }
}
