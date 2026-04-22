# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git workflow

After every meaningful change — completed feature, fix, or significant edit — stage the relevant files, write a clean imperative-mood commit message (subject line ≤72 chars), and push to `origin main`. Do this automatically without waiting to be asked. GitHub Pages auto-deploys on push, so the live app at `https://nicolas-zg.github.io/budget-tracker-pwa/budget/` always reflects the latest commit.

The goal is that no work is ever lost and any state can be reverted via git history.

## Development

No build step — this is a vanilla JS PWA. To run locally:

```bash
cd budget
python3 -m http.server 8765
# open http://localhost:8765
```

Service workers require HTTPS, so PWA install/offline features only work on the deployed GitHub Pages URL:
`https://nicolas-zg.github.io/budget-tracker-pwa/budget/`

## Architecture

The app is entirely client-side — no backend, no build toolchain.

**Five files, each with a single responsibility:**

| File | Role |
|------|------|
| `budget/db.js` | IndexedDB abstraction (`DB` object). All persistence goes through here. |
| `budget/app.js` | Alpine.js component (`budgetApp()`). All UI state and business logic. |
| `budget/charts.js` | Chart.js wrappers (`Charts` object). Renders into canvas elements. |
| `budget/index.html` | All HTML + CSS. Alpine directives bind directly to `budgetApp()`. |
| `budget/sw.js` | Service worker. Cache-first strategy for offline use. |

**IndexedDB stores:** `expenses`, `categories`, `recurring`, `exchangeRates`, `settings`

- `expenses` records store `amountCHF` (converted at entry time) so reports work without live exchange rates.
- `exchangeRates` stores a single record with key `'latest'`; rates are expressed as "X units of foreign currency per 1 CHF".
- `settings` stores a single record with key `'prefs'`, including `defaultCurrency`, `displayCurrency`, and `theme`.
- `DB.seed()` runs at startup and populates default categories and hardcoded exchange rates if the stores are empty.

**Alpine.js component lifecycle:**
- `budgetApp()` returns the component object; `init()` is called automatically by Alpine.
- `_loadMasterData()` populates `categories`, `settings`, and `rates` — call this after any data import or settings change.
- View switching is handled by a `$watch('currentView', ...)` that lazy-loads each view's data.
- Charts must render after the canvas is visible; use `requestAnimationFrame()` before calling `Charts.render*()`.

**Swipe-to-delete:**
- State lives on the parent component: `swipeOffsets` (object keyed by expense id), `swipingId`, `swipeStartX`, `swipeBaseOffset`.
- Touch handlers: `swipeStart(id, e)` / `swipeMove(id, e)` / `swipeEnd(id)` / `resetSwipe(id)`.
- Alpine.js 3 Proxy reactivity handles dynamic property additions on `swipeOffsets`.

**Theme system:**
- CSS custom properties defined on `html[data-theme="dark"]` and `html[data-theme="light"]`.
- `_applyTheme(theme)` sets the attribute and updates `this.settings.theme`; `toggleTheme()` persists to IndexedDB.

**Service worker cache key** is `'budget-v1'` in `sw.js` — bump this string when deploying breaking changes that require users to get a fresh cache.
