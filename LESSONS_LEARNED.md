# Lessons Learned

## 2026-03-29 — Multi-market support, inline editing, tests, cron fix

### 1. Vercel production branch must be set explicitly

**What happened:** Pushed to `main` but Vercel was still treating the old feature branch
(`claude/copy-portfolio-files-opLl5`) as the production branch. Every push to `main` deployed
as a *Preview* — not to the production URL. The app at `portfolio-briefing-app.vercel.app`
stayed on a 4-hour-old build.

**Fix:** Vercel → Project Settings → Git → Production Branch → change to `main`. Then promote
the latest preview to production manually (or just push again).

**Rule:** After merging a feature branch that was previously set as production, always verify
the production branch setting in Vercel.

---

### 2. Use `onClick` not `onMouseDown` for triggering inline inputs

**What happened:** Inline editing used `onMouseDown` to call `startEdit()`, which set state
and rendered an `<input autoFocus>`. But `onMouseDown` fires before the render cycle completes —
the input appeared and immediately received a blur event, committing an empty value and writing
spurious history entries.

**Fix:** Switch to `onClick`. The click event fires after mousedown + mouseup, giving React
time to render the input before any other events can fire.

---

### 3. Next.js route files cannot export non-handler functions

**What happened:** `toYahooSymbol()` was defined and exported from `app/api/prices/route.ts`
so tests could import it. Next.js generates `.next/types` stubs for route files that only
permit specific exports (`GET`, `POST`, `revalidate`, `maxDuration`, etc.). The extra export
caused a TypeScript error: `Type '(ticker: string, market: string) => string' is not assignable
to type 'never'`.

**Fix:** Move shared logic to `lib/` (e.g. `lib/yahoo-symbol.ts`) and import it in both the
route file and the test file.

**Rule:** Route files in `app/api/` are for handlers only. Anything that needs to be tested
or reused goes in `lib/`.

---

### 4. ts-jest `globals` config is deprecated — use `transform` syntax

**What happened:** Jest config used the old `globals: { 'ts-jest': { tsconfig: ... } }` format,
which produced deprecation warnings in ts-jest v29+.

**Fix:**
```js
// jest.config.js
transform: {
  '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: false } }],
}
```

---

### 5. `gh` CLI may not be in the bash PATH on Windows

**What happened:** `gh pr create` failed with "command not found" even though GitHub CLI was
installed, because the bash shell used by Claude Code didn't have it on PATH.

**Fix:** Fall back to native git: `git checkout main && git merge origin/<branch> && git push`.
For PR creation, open the compare URL manually:
`https://github.com/<owner>/<repo>/compare/main...<branch>`

---

### 6. `.env.local` merge conflicts: backup, remove, restore

**What happened:** When merging `origin/main` into the feature branch, `.env.local` had been
deleted on main but modified in the working tree, causing a modify/delete conflict that blocked
the merge.

**Fix:**
```bash
cp .env.local /tmp/env_backup
git rm .env.local
git merge --continue   # or resolve and commit
cp /tmp/env_backup .env.local  # restore as untracked (gitignored)
```

**Rule:** `.env.local` is gitignored — never commit it, and always treat it as external to
the merge process.
