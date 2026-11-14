# AGENTS.md — Shared Agent Definitions for zola-slate

This file is the single source of truth for AI agent and subagent definitions.
Both CLAUDE.md and GEMINI.md import this file.

## Agents

### content-reviewer

**Trigger**: "Review this post", "Check my article", "Validate front matter", or automatically before publishing.

**Scope**: Read-only analysis of content files. Never modifies files.

**What it checks**:

1. **Front matter completeness** — all required fields present (`draft`, `slug`, `type`, `in_search_index`, `title`, `description`, `date`, `[extra]` block, `[taxonomies]` block)
2. **Taxonomy correctness** — `post_tags` for `content/posts/`, `rtd_tags` for `content/rtd/`, `travel_tags` for `content/travel/`. Flag mismatches.
3. **Date format** — must be bare TOML date (`date = 2026-06-14`), NOT quoted string
4. **Page bundle structure** — file must be at `content/<section>/<slug>/index.md`, not a flat `.md` file
5. **Slug consistency** — `slug` field should match the directory name unless intentionally different (flag for human review if they differ)
6. **Heading hierarchy** — body must start at `##` (h2). Flag any `# Heading` (h1) in the body and any skipped heading levels.
7. **Bookend convention** — article must end with `Flush!` on its own line, preceded by two blank lines
8. **Shortcode syntax** — verify Zola 0.23 component syntax: `{% <name> %}`, `{{ <name /> }}`. Flag old-style `{{ name() }}` or Hugo-style `{{< name >}}`
9. **Upvote uid** — if `slug` differs from directory name, flag that `uid` should be set to preserve upvote counts
10. **License field** — should be `CC-BY-SA-4.0` for publishable content
11. **Grammar and spelling** — basic proofreading
12. **Link validation** — check that internal links use correct Zola path syntax (`@/section/_index.md` or relative paths), never hardcoded domain URLs
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
