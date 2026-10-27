# git-timesheet

Turn your local git activity into a day-by-day timesheet: how much of each working day went to which project.

It scans every repository under a folder, keeps the commits you authored, scores them, and splits each worked day (1 day) across projects in proportion to that score. The result is a single self-contained HTML page with a weekly and monthly grid you can paste straight into a timesheet tool.

## Why

Filling in a timesheet at the end of the week (or the month) usually means guessing. Your git history already knows where you spent your time: which repos you committed to, how much you changed, which branches you checked out. git-timesheet reads that history and turns it into a reasonable split, rounded to the step your timesheet expects (0.25 day by default).

## Requirements

- Node.js 18 or newer
- `git` available in the `PATH`
- No dependencies, nothing to install

## Quick start

```bash
cp config.example.json config.json
# edit config.json: root folder, your author emails, the remote filter
node scan.mjs
```

The script prints a summary and the path of the generated page:

```
56 repos dans 30 projets, 1258 commits, 183 jours actifs
C:\git\git-timesheet\out\activite.html
```

Open `out/activite.html` in a browser. `out/activite.json` holds the same data in raw form.

## Configuration

Everything lives in `config.json` (ignored by git, so your real paths, emails and client names stay local). Start from `config.example.json`.

| Key | Purpose |
|---|---|
| `root` | Folder scanned for repositories (up to 3 levels deep). |
| `exclude` | Folder names skipped during the scan. |
| `remoteMatch` | Substring that the `origin` URL must contain. A project is kept as soon as one of its repos matches, so this is how you keep work repos and drop personal ones. |
| `authors` | Values passed to `git log --author`: emails, names or logins you commit with. |
| `since` | Start date of the analysis (`YYYY-MM-DD`). |
| `dayStartsAtHour` | Hour at which a day starts. With `5`, a commit at 2am counts for the previous day. |
| `aliases` | Merge several top-level folders into one project, e.g. `"client-azure": "client"`. |
| `ignorePaths` | Regexes (case-insensitive) of files that do not count: lockfiles, build output, minified and generated files. |
| `maxLinesPerFile` | Cap on changed lines counted per file in a commit. |
| `maxLinesPerCommit` | Cap on changed lines counted per commit. |
| `pointsPerEvent` | Points given to a non-commit reflog event (checkout, pull, rebase, reset). |
| `maxEventPointsPerRepoDay` | Cap on those event points per repository and per day. |

A project is the first folder under `root`. All repositories below it (front, back, infra...) are grouped together.

## How the split is computed

1. **Commits.** For every commit you authored since `since`, across all branches:
   - a regular commit is worth `1 + sqrt(lines changed)`, after removing ignored files and applying the caps;
   - a merge commit is worth `1`;
   - a commit reachable from several branches is counted once.
2. **Reflog events.** Checkouts, pulls, rebases and resets on `HEAD` are worth `pointsPerEvent` each, capped at `maxEventPointsPerRepoDay` per repository and per day. They catch days spent reviewing, testing or debugging without committing much.
3. **Days.** Each event is assigned to a day, shifted by `dayStartsAtHour`.
4. **Split.** In the page, each worked day is worth 1 day and is divided between projects proportionally to their points, then rounded to the chosen step with a largest remainder method so the day always sums to exactly 1.

The square root keeps big refactors from swallowing a whole day while small commits still count.

## The page

- **Week / Month** views, navigation with the arrows, the buttons or the keyboard (left and right arrow keys)
- **Step** selector: 0.25, 0.5 or 0.1 day
- **Count weekends** toggle: weekends are excluded from the split by default
- **Copy** button: copies the visible grid as tab-separated values, ready to paste into a spreadsheet or a timesheet tool
- **Tooltip** on each cell: points, commits, changed lines, reflog events and the list of commit subjects
- **Weekly details**: what you committed on each project during the displayed week
- **12-week activity**: a contribution-style heatmap per project

A `·` in a cell means there was activity on that project that day, but not enough to get a share at the chosen step.

The page follows the system light or dark theme and works offline: the data is embedded in the HTML.

## Files

| File | Role |
|---|---|
| `scan.mjs` | Finds the repositories, reads `git log` and the reflog, computes the points and writes `out/`. |
| `template.html` | The page. `scan.mjs` injects the data in place of the `/*DATA*/null` placeholder. |
| `config.example.json` | Configuration template. |
| `config.json` | Your configuration (not versioned). |
| `out/` | Generated files (not versioned). |

## Limits

- Only what reaches git is measured: meetings, calls and reading time are invisible, except through the reflog events.
- The reflog is local and expires (90 days by default), so older checkout and pull events disappear over time.
- Points measure activity, not effort: treat the split as a solid first draft and adjust it before submitting.
