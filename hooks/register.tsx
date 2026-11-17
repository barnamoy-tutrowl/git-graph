import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const PANE = 'git-graph'
const PAGE = 22 // commits per page: the pane does not scroll, so a page must fit it without being scaled down
// Bumped to redraw the pane after git changes or a press of Refresh.
const tick = atom({ plugin: 'git-graph', key: 'tick' } as const, 0, { shape: 'tick-1' })
const offset = atom({ plugin: 'git-graph', key: 'offset' } as const, 0, { shape: 'offset-1' })

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
    ? d.split(', ').filter(r => !/^(origin|upstream)\//.test(r) && r !== 'origin/HEAD').map(r => {
        const head = r.startsWith('HEAD')
        const tag = r.startsWith('tag: ')
        const name = r.replace('HEAD -> ', '').replace('tag: ', '')
        const remote = false
        return { name: head && r === 'HEAD' ? 'HEAD' : name, fill: tag ? '#cba35a' : head ? '#5fb27a' : remote ? '#8b929a' : '#6b96e8' }
      })
    : []

const RH = 26
const LW = 14
const PAD = 12
const WIDTH = 330 // the narrow pane's slot; wider panes just leave room on the right

const short = (t: string) => {
  const m = t.match(/^(\d+) (second|minute|hour|day|week|month|year)/)
  return m ? m[1] + (m[2] === 'month' ? 'mo' : m[2][0]) : t
}

// One SVG for the whole page, so lines run unbroken from row to row and nothing depends on text metrics.
export function draw(commits: Commit[]): string {
  const { rows, lanes } = layout(commits)
  const X = (i: number) => PAD + i * LW
  const textX = PAD + lanes * LW + 6
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
      g.push(`<path d="M${xc} ${mid}${j === r.col ? `V${y1}` : `C${xc} ${y1} ${X(j)} ${mid} ${X(j)} ${y1}`}" stroke="${color(j)}"/>`)
    g.push(
      r.c.p.length > 1
        ? `<circle cx="${xc}" cy="${mid}" r="4" fill="var(--bg)" stroke="${color(r.col)}" stroke-width="1.8"/>`
        : `<circle cx="${xc}" cy="${mid}" r="3.6" fill="${color(r.col)}"/>`,
    )
    const age = short(r.c.t)
    let x = textX
    for (const ref of refs(r.c.d)) {
      const w = ref.name.length * 5.6 + 12
      g.push(`<rect x="${x + 0.5}" y="${mid - 7.5}" width="${w}" height="15" rx="7.5" fill="${ref.fill}" fill-opacity="0.12" stroke="${ref.fill}" stroke-opacity="0.6"/><text x="${x + 6.5}" y="${mid + 3.4}" fill="${ref.fill}" font-size="9.5" font-weight="600">${esc(ref.name)}</text>`)
      x += w + 6
    }
    const room = Math.max(4, Math.floor((WIDTH - x - age.length * 6 - 14) / 5.9))
    const msg = r.c.s.length > room ? r.c.s.slice(0, room - 1) + '…' : r.c.s
    g.push(`<text x="${x}" y="${mid + 4}" class="t">${esc(msg)}</text><text x="${WIDTH - 4}" y="${mid + 4}" text-anchor="end" class="m">${age}</text>`)
    parts.push(`<g>${g.join('')}</g>`)
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="-apple-system, system-ui, sans-serif" font-size="11.5">` +
    `<style>:root{--bg:#1c1c1e;--fg:#d7dbe0;--mut:#7d848c}@media (prefers-color-scheme:light){:root{--bg:#fff;--fg:#1f2328;--mut:#8b929a}}` +
    `.t{fill:var(--fg)}.m{fill:var(--mut);font-size:10.5px}path{fill:none;stroke-width:1.6;stroke-linecap:round}</style>` +
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
    const skip = await read($, offset)
    // local branches, tags and HEAD only: remote-tracking branches (dependabot and friends) are noise here
    const log = await $.process
      .run(['git', 'log', '--branches', '--tags', 'HEAD', '--date-order', '--skip', String(skip), '-n', String(PAGE + 1), '--format=%H%x09%P%x09%an%x09%ar%x09%D%x09%s'])
      .catch(() => null)
    const bar = (older: boolean) => (
      <Box flexDirection="row" gap={1} paddingBottom={1}>
        <Button key="refresh" onPress={() => void update($, tick, n => n + 1)}>
          Refresh
        </Button>
        {skip > 0 && (
          <Button key="newer" onPress={() => void update($, offset, n => Math.max(0, n - PAGE))}>
            Newer
          </Button>
        )}
        {older && (
          <Button key="older" onPress={() => void update($, offset, n => n + PAGE)}>
            Older
          </Button>
        )}
      </Box>
    )
    if (!log || log.exitCode !== 0)
      return (
        <Box flexDirection="column">
          {bar(false)}
          <Text dimColor>This folder is not a git repository (or has no commits yet).</Text>
        </Box>
      )
    const all = parse(log.stdout)
    const commits = all.slice(0, PAGE)
    return (
      <Box flexDirection="column">
        {bar(all.length > PAGE)}
        <Svg source={draw(commits)} alt={`Git graph of ${commits.length} commits`} />
      </Box>
    )
  })
}
