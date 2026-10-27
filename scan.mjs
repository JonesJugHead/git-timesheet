import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const configPath = join(here, 'config.json')
if (!existsSync(configPath)) {
  console.error('config.json not found: copy config.example.json to config.json and edit it')
  process.exit(1)
}
const cfg = JSON.parse(readFileSync(configPath, 'utf8'))
const ignore = cfg.ignorePaths.map((p) => new RegExp(p, 'i'))

const git = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

function findRepos(dir, depth = 0) {
  if (depth > 3) return []
  if (existsSync(join(dir, '.git'))) return [dir]
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !cfg.exclude.includes(e.name))
    .flatMap((e) => findRepos(join(dir, e.name), depth + 1))
}

const pad = (n) => String(n).padStart(2, '0')
const dayOf = (unix) => {
  const d = new Date((unix - cfg.dayStartsAtHour * 3600) * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const projectKey = (folder) => {
  const k = folder.toLowerCase()
  return cfg.aliases[k] ?? k
}
const label = (k) => k.charAt(0).toUpperCase() + k.slice(1)

const repos = findRepos(cfg.root).map((path) => {
  const top = relative(cfg.root, path).split(/[\\/]/)[0]
  return { path, name: relative(cfg.root, path).replace(/\\/g, '/'), project: projectKey(top), remote: git(path, ['remote', 'get-url', 'origin']).trim() }
})
const matchedProjects = new Set(repos.filter((r) => r.remote.toLowerCase().includes(cfg.remoteMatch)).map((r) => r.project))
const selected = repos.filter((r) => matchedProjects.has(r.project))

const days = {}
const seen = new Set()
const bucket = (day, project) => {
  days[day] ??= {}
  return (days[day][project] ??= { points: 0, commits: 0, lines: 0, events: 0, eventPoints: {}, items: [] })
}

for (const repo of selected) {
  const authorArgs = cfg.authors.map((a) => `--author=${a}`)
  const log = git(repo.path, ['log', '--all', `--since=${cfg.since}`, ...authorArgs, '--numstat', '--format=%x1e%H%x1f%at%x1f%P%x1f%s'])
  for (const block of log.split('\x1e').slice(1)) {
    const [head, ...stat] = block.split('\n')
    const [hash, at, parents, subject] = head.split('\x1f')
    if (seen.has(hash)) continue
    seen.add(hash)
    const merge = parents.trim().split(' ').length > 1
    let lines = 0
    for (const row of stat) {
      const [add, del, file] = row.split('\t')
      if (!file || add === '-' || ignore.some((re) => re.test(file))) continue
      lines += Math.min(Number(add) + Number(del), cfg.maxLinesPerFile)
    }
    lines = Math.min(lines, cfg.maxLinesPerCommit)
    const points = merge ? 1 : 1 + Math.sqrt(lines)
    const b = bucket(dayOf(Number(at)), repo.project)
    b.points += points
    b.commits += 1
    b.lines += lines
    b.items.push({ repo: repo.name, subject, lines, merge, t: Number(at) })
  }

  const sinceUnix = Date.parse(cfg.since) / 1000
  const reflog = git(repo.path, ['reflog', 'show', 'HEAD', '--date=unix', '--format=%gd%x09%gs'])
  for (const row of reflog.split('\n')) {
    const m = row.match(/@\{(\d+)\}\t(.*)/)
    if (!m || Number(m[1]) < sinceUnix || /^commit/.test(m[2])) continue
    const b = bucket(dayOf(Number(m[1])), repo.project)
    const used = b.eventPoints[repo.name] ?? 0
    const add = Math.min(cfg.pointsPerEvent, cfg.maxEventPointsPerRepoDay - used)
    b.events += 1
    if (add <= 0) continue
    b.eventPoints[repo.name] = used + add
    b.points += add
  }
}

for (const day of Object.values(days)) for (const b of Object.values(day)) delete b.eventPoints

const data = {
  generatedAt: new Date().toISOString(),
  dayStartsAtHour: cfg.dayStartsAtHour,
  projects: Object.fromEntries([...matchedProjects].sort().map((k) => [k, { label: label(k), repos: selected.filter((r) => r.project === k).map((r) => r.name) }])),
  days,
}

const outDir = join(here, 'out')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'activite.json'), JSON.stringify(data, null, 1))
const template = readFileSync(join(here, 'template.html'), 'utf8')
writeFileSync(join(outDir, 'activite.html'), template.replace('/*DATA*/null', JSON.stringify(data).replace(/</g, '\\u003c')))

const active = Object.keys(days).length
console.log(`${selected.length} repos dans ${matchedProjects.size} projets, ${seen.size} commits, ${active} jours actifs`)
console.log(join(outDir, 'activite.html'))
