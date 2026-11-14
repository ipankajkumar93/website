# GEMINI.md — Agent Instructions for zola-slate

Read and follow the shared agent definitions in AGENTS.md.

## What This Is

Zola 0.23.6 static site template (personal website & blog) deployed on Cloudflare Pages.
**Upstream template repo** — changes here flow to downstream forks via `git fetch`/`git merge`.
Downstream repos replace `content/` but share everything else, including this front matter schema.
Dual-licensed: GPLv3 (code), CC BY-SA 4.0 (content).

## Architecture

- **SSG**: Zola 0.23.6 — `config.toml` is the single source of truth
- **CSS**: `static/styles/main.css` (4 200 lines, vanilla CSS custom properties, CSS layers) — no Sass
- **JS**: vanilla — `static/js/{theme,main,analytics,upvote-client,search,search-loader}.js`
- **Templates**: Tera — `templates/` (`base.html` → `page.html` / `section.html`)
- **Content**: `content/<section>/<slug>/index.md` (page bundles with TOML front matter)
- **Build**: `make build` or `bin/build.sh` → `zola build` → OG images → copy .md → fix llms.txt
- **Deploy**: Cloudflare Pages (auto-builds from `master` via `bin/build.sh`)
- **Upvotes**: CF Pages Function (`functions/api/upvote-server.js`) → Neon PostgreSQL
- **Search**: elasticlunr.js (Zola-generated index)
- **OG images**: `uv run scripts/generate_og_images.py` (Python + Pillow, cached in `.og_cache.json`)
- **Branches**: `develop` (work here) → merge to `master` (deploys)

## Commands

```
Build (Zola only):    zola build
Full build:           make build          (zola + OG images + copy .md + llms.txt fix)
Serve (with drafts):  zola serve --drafts (or: make preview)
Check:                zola check
OG images:            make og-images      (or: uv run scripts/generate_og_images.py)
New post:             make post Title, Description
New RTD:              make rtd Title, Description
New travel:           make travel Title, Description
Link check:           make check-links    (optional — requires lychee)
```

## 0. Prime Directives
1. **Read before you edit**: Open the file, its neighbours, and the existing pattern first. Match repo conventions.
2. **Smallest correct diff**: Don't reformat, rename, or "tidy" unrelated code.
3. **Never invent**: No guessed commands, config keys, Zola functions, or browser APIs. If unsure, check docs or run it.
4. **Ask before**: adding dependencies, bumping tool versions, modifying `_headers`, editing Pages Functions or DB logic, deploying, committing, or pushing.
5. **No secrets**: Never read, print, or log `.env*`, tokens, API keys, `DATABASE_URL`, or `UPVOTE_SECRET`. Reference by name only.
6. **Git branch protection**: NEVER commit to `master` directly. Work on `develop`.

## 1. No Inline Anything (Hard Rules)
- **No inline CSS, ever**: No `style="..."` attributes and no `<style>` blocks in templates, shortcodes, or Markdown. Put styles in `static/styles/main.css`.
- In JS, never assign `el.style.x = ...` or `setAttribute("style", ...)`. Toggle classes or `data-*` attributes styled in CSS. For dynamic values, set a custom property via `el.style.setProperty("--x", value)` and consume it in CSS.
- **No inline JS**: No `onclick=`-style handlers, no `javascript:` URLs, and no inline executable `<script>` blocks. Use external scripts with `addEventListener`.
- **Exception**: `<script type="application/ld+json">` is a data block, not executed code; it is allowed.
- **External origins**: Any new external script, font, image, or API origin requires an explicit `static/_headers` CSP update proposed and approved first. Prefer self-hosting. Third-party scripts require SRI hashes.

## 2. Content & Front Matter Rules
1. **Content files**: ONLY create/edit under `content/`. Always use page bundles (`<slug>/index.md`).
2. **Dates are bare TOML dates**: `date = 2026-06-14` — never quoted strings.
3. **Headings start at `##` (h2)**: The `<h1>` is auto-rendered from `title`. Do not skip heading levels.
4. **Bookend convention**: Every article MUST end with `Flush!` on its own line, preceded by two blank lines.
5. **Taxonomies are section-specific**: `post_tags` for posts, `rtd_tags` for RTD, `travel_tags` for travel. Never mix them.
6. **Draft by default**: Scaffold with `draft = true`. Set `draft = false` only when explicitly instructed to publish.
7. **Slug & UID stability**: `slug` can differ from directory name. If renaming a slug, set `uid = "<section>/<old-slug>"` to preserve upvotes.
8. **Markdown cleanliness**:
   - Declare a language on every fenced code block (e.g. ` ```bash `).
   - Images always need meaningful `alt` text.
   - Internal links use Zola's `@/section/slug/index.md` or relative syntax, never hardcoded domain URLs.
   - Avoid raw HTML in Markdown. If needed, use a shortcode. Never use inline styles.
   - `smart_punctuation = true` in config: type straight quotes (`"`, `'`) and hyphens (`--`, `---`); do not hand-insert curly quotes or em dashes.
   - Escape literal `{{` or `{%` in Markdown code samples using `{% raw %}...{% endraw %}`.
9. **Shortcodes**: Use Zola 0.23 component syntax (`{% <admonition kind="note"> %}...{% </admonition> %}`, `{{ <img path="..." alt="..." /> }}`).
10. **Do NOT touch auto-generated assets**: Never create/commit files in `static/images/og/` (generated at build time, gitignored).

## 3. Code Standards (When Approved to Edit Non-Content Files)

### CSS (`static/styles/main.css`)
- **Layer order**: `@layer tokens, reset, base, components, utilities;`
- **Design tokens only**: Use existing `--color-*`, `--font-*`, `--space-*`, `--step-*`. No hardcoded hex colors outside token blocks.
- **Both themes**: Every color must work in `:root` (light) and `:root[data-theme="dark"]`.
- **Modern CSS**: Custom properties, logical properties (`margin-inline`, `padding-block`), `clamp()`, container queries, `:is()`/`:where()`/`:has()`, native nesting, `@layer`, `color-mix()`, `gap`, `dvh`, `aspect-ratio`.
- **Mobile mode & responsive discipline**:
  - Primary mobile/tablet mode kicks in at `@media screen and (max-width: 1024.98px)` (desktop starts at `min-width: 1025px`).
  - Narrow breakpoints ladder: `768px`, `600px`, and `480px`.
  - Any UI change or new component MUST work seamlessly on mobile (`<= 1024.98px`) down to `360px`.
  - Zero horizontal overflow: ensure tables, code blocks, and flex containers wrap or scroll internally.
  - Touch accessibility: interactive targets (`button`, `a`, toggles) must maintain minimum 44×44px tap targets.
- **Accessibility**: Maintain WCAG AA contrast ratios (4.5:1 body text, 3:1 large text & UI) across both themes. Keep focus visible with `:focus-visible` (never remove). Respect `prefers-color-scheme` and `prefers-reduced-motion`.
- **Banned CSS**: Float-based layout, clearfix hacks, vendor prefixes without proven need, `!important` (except deliberate utilities), ID selectors for styling, CSS `@import`.
- **Fonts**: Self-hosted, `font-display: swap`, subsets only. No new font family without approval.

### JavaScript (`static/js/`)
- Modern ES6+, zero build tools or frameworks. `const`/`let` only (never `var`), arrow functions, template literals, destructuring, optional chaining, `??`, `async/await`.
- Event delegation and `addEventListener` with passive listeners for scroll/touch. Clean up observers/listeners.
- Deferred/async loading: Non-critical scripts use `defer`. Only `theme.js` runs synchronously in `<head>` (FOUC prevention).
- Progressive enhancement: Core content readable without JS. Feature-detect `startViewTransition`, Clipboard API, etc.
- Network: Use `fetch` with `AbortController`. Never use `XMLHttpRequest`.
- **Banned JS**: `document.write`, `eval`/`new Function`, `substr` (use `slice`), `escape`/`unescape`, `document.execCommand` (use `navigator.clipboard`), `unload` event (use `pagehide`), UA sniffing, `innerHTML` with dynamic data (use `textContent` or `createElement`).

### Tera Templates (`templates/`)
- Semantic landmarks (`<header>`, `<nav>`, `<main>`, `<article>`, `<aside>`, `<footer>`), `<button>` for actions, `<a>` for navigation.
- Images need `alt`, explicit `width`/`height`, `loading="lazy"` below fold, `decoding="async"`. Use `<picture>` for AVIF/WebP.
- Autoescape stays on. `| safe` only for strictly controlled content with an explanatory comment. Build URLs with `get_url(...)`.
- Zola 0.23 syntax only: `{% component %}...{% endcomponent %}` for shortcodes, `{{ <icon name="..." /> }}` for inline components.
- **Banned HTML**: `<center>`, `<font>`, `<marquee>`, `align`/`bgcolor`/`border` attributes, `frameborder`, `type="text/javascript"`, `X-UA-Compatible`, `<b>`/`<i>` used purely for styling.

### Cloudflare Pages Function (`functions/`)
- Web-standard APIs only (`fetch`, `crypto`, `TextEncoder`). Zero Node.js-specific imports (`fs`, `path`, `Buffer`). Zero npm packages.
- Fail closed: 503 if `DATABASE_URL` or `UPVOTE_SECRET` is missing. Validate and rate-limit every input.

### Python Scripts (`scripts/`)
- Python 3.11+, run via `uv run`, PEP 723 inline script metadata.
- Type hints with built-in generics (`list[str]`, `str | None`). `pathlib` over `os.path`, f-strings, context managers, `subprocess.run(..., check=True)` (never `shell=True` with user input).
- **Banned Python**: `datetime.utcnow()` (use `datetime.now(UTC)`), bare `except:`, `print` debugging, mutable default arguments, removed Pillow constants (`Image.ANTIALIAS` → `Image.Resampling.LANCZOS`, `ImageDraw.textsize` → `textbbox`/`textlength`).

## 4. Zola & Tera Version Discipline
- Before building or updating code, verify installed Zola against `bin/build.sh` (`zola --version`).
- Consult [Zola Changelog](https://github.com/getzola/zola/blob/master/CHANGELOG.md) and [Tera Changelog](https://github.com/Keats/tera/blob/master/CHANGELOG.md).
- Never use deprecated Zola/Tera features, filters, or shortcode syntax. Keep code modern and up to date.

## 5. Definition of Done (Verification Checklist)
Before completing any task:
1. Run `zola check` (must pass with 0 errors).
2. Run `zola build` or full build (`make build` / `bash bin/build.sh`) to verify compilation.
3. Grep diff for forbidden patterns:
   ```bash
   git diff | grep -E 'style=|(<style)|on[a-z]+=|javascript:|(\bvar\b)|!important|@import|document\.write'
   ```
4. Confirm no new external origin was added without an approved CSP change in `static/_headers`.
5. If CSS changed, verify WCAG AA contrast in both light and dark themes.
6. If UI or layout changed, verify responsive layout at mobile breakpoint (`<= 1024.98px`) and narrow screens (`<= 480px`), ensuring no horizontal page overflow and touch targets >= 44px.
7. Report summary: files changed, reason, verified commands, and any unverified items.
8. Do NOT commit, push, or deploy unless explicitly instructed.

## Reference Skills

Detailed procedures for specific workflows are documented in `.agents/skills/` (symlinked from `.claude/skills/`). Read the relevant SKILL.md before performing these tasks:

| Skill | When to read | Path |
|---|---|---|
| **new-post** | Creating or editing posts, RTD articles, or travel entries | `.agents/skills/new-post/SKILL.md` |
| **build-and-verify** | Building, checking errors, verifying Zola version compatibility | `.agents/skills/build-and-verify/SKILL.md` |
| **og-images** | Generating or debugging OG social preview images | `.agents/skills/og-images/SKILL.md` |
| **csp-headers** | Adding external scripts/fonts/iframes, modifying CSP (**plan-first**) | `.agents/skills/csp-headers/SKILL.md` |
| **seo-llms** | Updating SEO, JSON-LD, llms.txt, feeds | `.agents/skills/seo-llms/SKILL.md` |
| **upvote-function** | Modifying the upvote system (**plan-first**) | `.agents/skills/upvote-function/SKILL.md` |

## Content Review

Before publishing any content (setting `draft = false`), review it against the checklist defined in AGENTS.md under the `content-reviewer` agent specification.
