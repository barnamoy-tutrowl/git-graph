declare module 'claude-code' {
  interface PluginState {
    'git-graph': { tick: Shaped<number>; count: Shaped<number> }
  }
}
export {}
