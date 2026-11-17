declare module 'claude-code' {
  interface PluginState {
    'git-graph': { tick: Shaped<number>; offset: Shaped<number> }
  }
}
export {}
