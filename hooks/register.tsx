import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const PANE = 'git-graph'
const MAX = 120 // commits drawn; keeps the SVG under the 131072-char limit
// Bumped to redraw the pane after git changes or a press of Refresh.
const tick = atom({ plugin: 'git-graph', key: 'tick' } as const, 0, { shape: 'tick-1' })

type Commit = { h: string; p: string[]; a: string; t: string; d: string; s: string }
type Row = { c: Commit; col: number; incoming: number[]; parents: number[]; through: number[] }

const COLORS = ['#6b96e8', '#e07a73', '#5fb27a', '#cba35a', '#a590e0', '#5fb9c4', '#e08cb8', '#dc8f5e']
const color = (i: number) => COLORS[i % COLORS.length]
const RH = 34
const LW = 16
const PAD = 12
const WIDTH = 760

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

export function draw(commits: Commit[]): string {
  const { rows, lanes } = layout(commits)
  const X = (i: number) => PAD + i * LW
  const textX = PAD + lanes * LW + 12
  const height = rows.length * RH + 8
  const parts: string[] = []
  rows.forEach((r, n) => {
    const y0 = n * RH + 4
    const mid = y0 + RH / 2
    const y1 = y0 + RH
    const xc = X(r.col)
    const g: string[] = []
    for (const i of r.through) g.push(`<path d="M${X(i)} ${y0}V${y1}" stroke="${color(i)}"/>`)
    for (const i of r.incoming)
      g.push(`<path d="M${X(i)} ${y0}${i === r.col ? `V${mid}` : `C${X(i)} ${mid} ${xc} ${y0} ${xc} ${mid}`}" stroke="${color(i)}"/>`)
    for (const j of r.parents)
      g.push(`<path d="M${xc} ${mid}${j === r.col ? `V${y1}` : `C${xc} ${y1} ${X(j)} ${mid} ${X(j)} ${y1}`}" stroke="${color(j === r.col ? r.col : j)}"/>`)
    const isMerge = r.c.p.length > 1
    g.push(
      isMerge
        ? `<circle cx="${xc}" cy="${mid}" r="3.5" fill="var(--bg)" stroke="${color(r.col)}" stroke-width="1.5"/>`
        : `<circle cx="${xc}" cy="${mid}" r="3.5" fill="${color(r.col)}"/>`,
    )
    // right side: author + age, then ref pills, then the message in the space left
    const right = r.c.t.replace(' ago', '')
    let x = textX
    for (const ref of refs(r.c.d)) {
      const w = ref.name.length * 6 + 14
      g.push(`<rect x="${x + 0.5}" y="${mid - 8.5}" width="${w}" height="17" rx="8.5" fill="${ref.fill}" fill-opacity="0.1" stroke="${ref.fill}" stroke-opacity="0.55"/><text x="${x + 7.5}" y="${mid + 3.8}" fill="${ref.fill}" font-size="10.5">${esc(ref.name)}</text>`)
      x += w + 8
    }
    const room = Math.max(8, Math.floor((WIDTH - x - right.length * 6 - 28) / 6.3))
    const msg = r.c.s.length > room ? r.c.s.slice(0, room - 1) + '…' : r.c.s
    g.push(`<text x="${x}" y="${mid + 4}" class="t">${esc(msg)}</text><text x="${WIDTH - 8}" y="${mid + 4}" text-anchor="end" class="m">${esc(right)}</text>`)
    parts.push(`<g><title>${esc(`${r.c.h.slice(0, 8)}  ${r.c.a}  ${r.c.t}\n${r.c.s}`)}</title>${g.join('')}</g>`)
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="-apple-system, system-ui, sans-serif" font-size="12">` +
    `<style>:root{--bg:#fff;--fg:#1f2328;--mut:#9aa1a9}@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#e6e8eb;--mut:#6f767e}}` +
    `.t{fill:var(--fg)}.m{fill:var(--mut);font-size:11px}path{fill:none;stroke-width:1.5;stroke-linecap:round;stroke-opacity:.85}</style>` +
    parts.join('') +
    `</svg>`
  )
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
    const { Box, Text, Svg, Button } = $.ui.resolve(e) as any
    await read($, tick)
    const refresh = (
      <Button key="refresh" onPress={() => void update($, tick, n => n + 1)}>
        Refresh
      </Button>
    )
    const log = await $.process
      .run(['git', 'log', '--all', '--date-order', '-n', String(MAX), '--format=%H%x09%P%x09%an%x09%ar%x09%D%x09%s'])
      .catch(() => null)
    if (!log || log.exitCode !== 0)
      return (
        <Box flexDirection="column">
          <Text dimColor>This folder is not a git repository (or has no commits yet).</Text>
          {refresh}
        </Box>
      )
    const commits = parse(log.stdout)
    return (
      <Box flexDirection="column">
        {refresh}
        <Svg source={draw(commits)} alt={`Git graph of ${commits.length} commits`} isInteractive />
      </Box>
    )
  })
}
