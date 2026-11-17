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
const RH = 30
const LW = 16
const PAD = 10

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

// One row's lane graph as its own small SVG, so the pane never has to scale a tall drawing down.
export function rowSvg(r: Row, lanes: number): string {
  const X = (i: number) => PAD + i * LW
  const w = PAD * 2 + (lanes - 1) * LW
  const mid = RH / 2
  const xc = X(r.col)
  const g: string[] = []
  for (const i of r.through) g.push(`<path d="M${X(i)} 0V${RH}" stroke="${color(i)}"/>`)
  for (const i of r.incoming)
    g.push(`<path d="M${X(i)} 0${i === r.col ? `V${mid}` : `C${X(i)} ${mid} ${xc} 0 ${xc} ${mid}`}" stroke="${color(i)}"/>`)
  for (const j of r.parents)
    g.push(`<path d="M${xc} ${mid}${j === r.col ? `V${RH}` : `C${xc} ${RH} ${X(j)} ${mid} ${X(j)} ${RH}`}" stroke="${color(j)}"/>`)
  g.push(
    r.c.p.length > 1
      ? `<circle cx="${xc}" cy="${mid}" r="4.5" fill="var(--bg)" stroke="${color(r.col)}" stroke-width="2"/>`
      : `<circle cx="${xc}" cy="${mid}" r="4.5" fill="${color(r.col)}"/>`,
  )
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${RH}" viewBox="0 0 ${w} ${RH}">` +
    `<style>:root{--bg:#fff}@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e}}path{fill:none;stroke-width:2;stroke-linecap:round}</style>` +
    g.join('') +
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
    const shown = await read($, count)
    const log = await $.process
      .run(['git', 'log', '--all', '--date-order', '-n', String(shown + 1), '--format=%H%x09%P%x09%an%x09%ar%x09%D%x09%s'])
      .catch(() => null)
    const bar = (more: boolean) => (
      <Box flexDirection="row" gap={1} paddingBottom={1}>
        <Button key="refresh" onPress={() => void update($, tick, n => n + 1)}>
          Refresh
        </Button>
        {more && (
          <Button key="more" onPress={() => void update($, count, n => n + STEP)}>
            Show more
          </Button>
        )}
        {shown > STEP && (
          <Button key="fewer" onPress={() => void update($, count, () => STEP)}>
            Fewer
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
    const more = all.length > shown
    const commits = all.slice(0, shown)
    const { rows, lanes } = layout(commits)
    return (
      <Box flexDirection="column">
        {bar(more)}
        {rows.map(r => (
          <Box flexDirection="row" alignItems="center" height={RH} key={r.c.h}>
            <Svg source={rowSvg(r, lanes)} alt="" />
            <Box flexDirection="row" gap={1} flexGrow={1} overflow="hidden">
              {refs(r.c.d).map(ref => (
                <Text color={ref.fill} bold size="caption">
                  {ref.name}
                </Text>
              ))}
              <Text>{r.c.s}</Text>
            </Box>
            <Text dimColor size="caption">
              {r.c.t.replace(' ago', '')}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
