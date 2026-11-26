# AGENTS.md — Shared Agent Definitions for zola-slate

This file is the single source of truth for AI agent and subagent definitions.
Both CLAUDE.md and GEMINI.md import this file.

## Agents

### content-reviewer

**Trigger**: "Review this post", "Check my article", "Validate front matter", or automatically before publishing.

**Scope**: Read-only analysis of content files. Never modifies files.

**What it checks**:

> **Page-Type Awareness**: Articles (`content/posts/<slug>/index.md`, `content/rtd/<slug>/index.md`, `content/travel/<slug>/index.md`) must pass all 17 checks. Section `_index.md` files and standalone utility pages (`_index.md`, `contact`, `sitemap`, `topics`, `talks`, `llms`, `llms-full`) intentionally omit article-only front matter (`slug`, `type`, `in_search_index`, `date`, `toc`, `license`, `[taxonomies]`) and the `Flush!` bookend — skip those article-only checks on them, while still checking raw HTML, body `#`/`<h1>`, placeholder links, alt text, smart punctuation, and internal links.

1. **Front matter completeness** — all required fields present (`draft`, `slug`, `type`, `in_search_index`, `title`, `description`, `date`, `[extra]` block, `[taxonomies]` block)
2. **Taxonomy correctness** — `post_tags` for `content/posts/`, `rtd_tags` for `content/rtd/`, `travel_tags` for `content/travel/`. Flag mismatches.
3. **Date format** — must be bare TOML date (`date = 2026-06-14`), NOT quoted string
4. **Page bundle structure** — file must be at `content/<section>/<slug>/index.md`, not a flat `.md` file
5. **Slug consistency** — `slug` field should match the directory name unless intentionally different (flag for human review if they differ)
6. **Heading hierarchy** — body must start at `##` (h2). Flag any `# Heading` (h1) or raw `<h1>` in the body and any skipped heading levels.
7. **Bookend convention** — article must end with `Flush!` on its own line, preceded by two blank lines
8. **Shortcode syntax** — verify Zola 0.23 component syntax: `{% <name> %}`, `{{ <name /> }}`. Flag old-style `{{ name() }}` or Hugo-style `{{< name >}}`
9. **Upvote uid** — if `slug` differs from directory name, flag that `uid` should be set to preserve upvote counts
10. **License field** — should be `CC-BY-NC-SA-4.0` for publishable content
11. **Grammar and spelling** — basic proofreading
12. **Link validation** — check that internal links use correct Zola path syntax (`@/section/_index.md` or relative paths), never hardcoded domain URLs; flag placeholder `#` links (`[text](#)`) or draft placeholder URLs on published pages
13. **Code block languages** — fenced code blocks MUST declare a language (e.g. ` ```bash `); flag unlabelled code blocks
14. **No raw HTML or inline styles** — flag any `<tag style="...">` or unnecessary raw HTML in Markdown (use shortcodes instead)
15. **Image alt text** — verify all images (`<img>` tags, `img` shortcodes, Markdown `![]()`) have meaningful `alt` text
16. **Template tag escaping** — literal `{{` or `{%` in Markdown code samples MUST be escaped with `{% raw %}...{% endraw %}`
17. **Smart punctuation** — verify plain quotes (`"`, `'`) and hyphens (`--`, `---`) are used; flag hand-inserted curly quotes or em dashes

**Output format**: Structured checklist with ✅ / ❌ for each check, with specific line references for issues found.

**Must NOT do**:
- Modify any file
- Run any shell commands
- Access .env files or secrets
- Make subjective editorial judgments about writing style (only flag objective issues)

**Implementation**: Defined in `.claude/agents/content-reviewer.md` (Claude Code) and available as a read-only subagent in any compatible agent system.

### site-auditor

**Trigger**: "Audit the site", "Check code standards", "Run site audit", or before merging upstream template updates.

**Scope**: Read-only analysis of non-content files (`templates/`, `static/`, `functions/`, `scripts/`, `config.toml`, `bin/`, `.agents/skills/`) and build output (`public/`). Never modifies files.

**What it checks**:

1. **No inline CSS/JS** — zero `style="..."`, `<style>`, `on*=`, `javascript:`, or inline executable `<script>` in `templates/` (except `<script type="application/ld+json">`)
2. **CSS standards** — `@layer` order intact, zero hardcoded hex colors outside `@layer tokens`, WCAG AA contrast (`>= 4.5:1` body/muted text, `>= 3.0:1` UI) in both light and dark themes, `font-display: swap` in `static/styles/fonts.css`, no `!important` outside `@layer utilities`, mobile breakpoints (`1024.98px`, `768px`, `600px`, `480px`) and `>= 44×44px` tap targets
3. **First-party JS standards** — excluding vendor bundles (`mermaid.min.js`, `static/katex/`), zero `var`, `innerHTML`, `eval`, `document.write`, `XMLHttpRequest`, `unload`, or `el.style.x = ...` (only `style.setProperty("--x", ...)`)
4. **Template standards** — `<img>` tags include `alt`, `decoding="async"`, and explicit `width`/`height` for local assets; Zola 0.23 component syntax; `| safe` only with explanatory comments
5. **OG & SEO/LLM output** — every `og:image` / `twitter:image` URL in `public/` resolves to a file under `static/`, `public/llms.txt` and `public/llms-full.txt` are flat files, and `{% raw %}` tags are stripped from `llms-full.txt`
6. **CSP & upvote security** — `static/_headers` CSP is single-line with explicit `https://` prefixes on external origins and matches `csp-headers` skill docs; `functions/api/upvote-server.js` preserves fail-closed env checks, `Origin` check, honeypot, and SQL rate limits
7. **Python & build scripts** — PEP 723 metadata, Python 3.11+ type hints, no `datetime.utcnow()`, bare `except:`, or removed Pillow APIs

**Output format**: Structured checklist with ✅ / ❌ per category and exact file/line references for issues found.

**Must NOT do**:
- Modify any file
- Access `.env*` files or secrets (`DATABASE_URL`, `UPVOTE_SECRET`)
- Edit `content/` (delegate content checks to `content-reviewer`)

**Implementation**: Defined in `.claude/agents/site-auditor.md` and available as a read-only subagent in any compatible agent system.
