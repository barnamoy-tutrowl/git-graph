import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const PANE = 'git-graph'
const STEP = 25 // commits per page; the pane does not scroll, so show a page and let the person ask for more
// Bumped to redraw the pane after git changes or a press of Refresh.
const tick = atom({ plugin: 'git-graph', key: 'tick' } as const, 0, { shape: 'tick-1' })
const count = atom({ plugin: 'git-graph', key: 'count' } as const, STEP, { shape: 'count-1' })

type Commit = { h: string; p: string[]; a: string; t: string; d: string; s: string }
type Row = { c: Commit; col: number; incoming: number[]; parents: number[]; through: number[] }

const COLORS = ['#6b96e8', '#e07a73', '#5fb27a', '#cba35a', '#a590e0', '#5fb9c4', '#e08cb8', '#dc8f5e']
const color = (i: number) => COLORS[i % COLORS.length]

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Classic lane assignment: each lane waits for the commit hash it expects next.
export function layout(commits: Commit[]): { rows: Row[]; lanes: number } {
  let lanes: (string | null)[] = []
  let most = 1
  const rows: Row[] = []
  for (const c of commits) {
    const before = lanes.slice()
    const incoming = before.flatMap((h, i) => (h === c.h ? [i] : []))
    let col = incoming.length ? incoming[0] : lanes.indexOf(null)
    if (col < 0) col = lanes.length
    lanes = lanes.map(h => (h === c.h ? null : h))
    const parents: number[] = []
    c.p.forEach((p, k) => {
      let j = lanes.indexOf(p)
      if (j < 0) {
        j = k === 0 ? col : lanes.indexOf(null)
        if (j < 0) j = lanes.length
        lanes[j] = p
      }
      parents.push(j)
    })
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    const through = before.flatMap((h, i) => (h && h !== c.h && lanes[i] === h ? [i] : []))
    most = Math.max(most, before.length, lanes.length, col + 1)
    rows.push({ c, col, incoming, parents, through })
  }
  return { rows, lanes: most }
}

function parse(out: string): Commit[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [h, p, a, t, d, ...s] = line.split('\t')
      return { h, p: p ? p.split(' ') : [], a, t, d, s: s.join('\t') }
    })
}

const refs = (d: string) =>
  d
    ? d.split(', ').map(r => {
        const head = r.startsWith('HEAD')
        const tag = r.startsWith('tag: ')
        const name = r.replace('HEAD -> ', '').replace('tag: ', '')
        const remote = !head && !tag && /^(origin|upstream)\//.test(name)
        return { name: head && r === 'HEAD' ? 'HEAD' : name, fill: tag ? '#cba35a' : head ? '#5fb27a' : remote ? '#8b929a' : '#6b96e8' }
      })
    : []

// The graph as text cells (like `git log --graph`): no fixed heights or images, so it lays out the same in any pane.
type Cell = { ch: string; c: string }
export function cells(r: Row, lanes: number): Cell[] {
  const out: Cell[] = Array.from({ length: Math.max(1, lanes * 2 - 1) }, () => ({ ch: ' ', c: '' }))
  const pri: number[] = out.map(() => 0)
  const put = (p: number, ch: string, c: string, level: number) => {
    if (level >= pri[p]) {
      out[p] = { ch, c }
      pri[p] = level
    }
  }
  const across = (a: number, b: number, c: string) => {
    for (let p = 2 * Math.min(a, b) + 1; p < 2 * Math.max(a, b); p++) put(p, '─', c, 2)
  }
  for (const i of r.through) put(2 * i, '│', color(i), 1)
  for (const i of r.incoming)
    if (i !== r.col) {
      put(2 * i, i > r.col ? '╯' : '╰', color(i), 3)
      across(i, r.col, color(i))
    }
  for (const j of r.parents)
    if (j !== r.col) {
      put(2 * j, j > r.col ? '╮' : '╭', color(j), 3)
      across(j, r.col, color(j))
    }
  put(2 * r.col, r.c.p.length > 1 ? '○' : '●', color(r.col), 4)
  return out
}

const short = (t: string) => {
  const m = t.match(/^(\d+) (second|minute|hour|day|week|month|year)/)
  return m ? m[1] + (m[2] === 'month' ? 'mo' : m[2][0]) : t
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'git-graph', description: 'Show the git commit graph in a pane' })
    void $.ui.open({ id: PANE, title: 'Git graph' })
    return next(e)
  })

  on('command.run', { command: 'git-graph' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Git graph' })
    return { text: 'Git graph pane opened.' }
  })

  // A git command (commit, merge, checkout...) changes the graph: redraw after it ran.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    await update($, tick, n => n + 1)
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e) as any
    await read($, tick)
    const shown = await read($, count)
    const log = await $.process
      .run(['git', 'log', '--all', '--date-order', '-n', String(shown + 1), '--format=%H%x09%P%x09%an%x09%ar%x09%D%x09%s'])
      .catch(() => null)
    const bar = (more: boolean, fewer: boolean) => (
      <Box flexDirection="row" gap={1} paddingBottom={1}>
        <Button key="refresh" onPress={() => void update($, tick, n => n + 1)}>
          Refresh
        </Button>
        {more && (
          <Button key="more" onPress={() => void update($, count, n => n + STEP)}>
            Show more
          </Button>
        )}
        {fewer && (
          <Button key="fewer" onPress={() => void update($, count, () => STEP)}>
            Fewer
          </Button>
        )}
      </Box>
    )
    if (!log || log.exitCode !== 0)
      return (
        <Box flexDirection="column">
          {bar(false, false)}
          <Text dimColor>This folder is not a git repository (or has no commits yet).</Text>
        </Box>
      )
    const all = parse(log.stdout)
    const more = all.length > shown
    const commits = all.slice(0, shown)
    const { rows, lanes } = layout(commits)
    return (
      <Box flexDirection="column">
        {bar(more, shown > STEP && commits.length > STEP)}
        {rows.map(r => (
          <Text key={r.c.h} wrap="truncate-end">
            <Text mono>
              {cells(r, lanes).map(x => (x.c ? <Text color={x.c}>{x.ch}</Text> : x.ch))}
            </Text>
            {'  '}
            <Text dimColor>{short(r.c.t)}</Text>
            {'  '}
            {refs(r.c.d).map(ref => (
              <Text color={ref.fill} bold>
                {ref.name + ' '}
              </Text>
            ))}
            {r.c.s}
          </Text>
        ))}
      </Box>
    )
  })
}
