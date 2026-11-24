---
name: new-post
description: "Use when creating a new blog post, RTD article, or travel entry, OR when editing existing content files. Covers front matter schema, taxonomy rules, page bundle structure, shortcode syntax, and the Flush! bookend convention."
---

# New Post / Content Authoring

## When to Use

- Creating a new post, RTD article, or travel log entry
- Editing existing content under `content/`
- Fixing front matter issues flagged by the content-reviewer agent

## Scaffolding Commands

Use the existing `make` commands to create new content with correct front matter:

```bash
make post Title Here, Optional description    # → content/posts/<slug>/index.md
make rtd Title Here, Optional description     # → content/rtd/<slug>/index.md
make travel Title Here, Optional description  # → content/travel/<slug>/index.md
```

The slug is auto-derived: lowercase, spaces → hyphens, non-alphanumeric stripped.

If creating manually (not via `make`), follow the template below exactly.

## Front Matter Template

```toml
+++
draft = true
slug = "my-slug"
type = "post"                # "post" | "rtd" | "travel"
in_search_index = true
title = "My Title"
description = "A short description."
date = 2026-06-14            # BARE TOML date — no quotes!
# updated = 2026-06-14       # Uncomment when updating a published post

[extra]
toc = true
featured = false
license = "CC-BY-SA-4.0"
wrap_code = false
katex = false                # Set true if post uses LaTeX math
mermaid = false              # Set true if post uses Mermaid diagrams
upvote = true
# uid = "posts/my-slug"      # Set to original path if slug is ever renamed
# og_preview_img = "/images/sample-image.jpeg"  # Custom OG image
# cover_image = "/images/sample-image.jpeg"     # Cover image

[taxonomies]
post_tags = ["post", "tag1", "tag2"]    # For content/posts/
# rtd_tags = ["rtd", "tag1"]            # For content/rtd/
# travel_tags = ["travel", "tag1"]      # For content/travel/
+++
```

## Taxonomy Rules

Each content section has its own taxonomy. **Never mix them.**

| Section directory | Taxonomy key | Example |
|---|---|---|
| `content/posts/` | `post_tags` | `post_tags = ["post", "linux"]` |
| `content/rtd/` | `rtd_tags` | `rtd_tags = ["rtd", "nginx"]` |
| `content/travel/` | `travel_tags` | `travel_tags = ["travel", "tokyo"]` |

The first tag should always be the section name (`"post"`, `"rtd"`, or `"travel"`).

## Page Bundle Structure

Articles MUST use page bundles (directory-based):

```
content/posts/my-post/
├── index.md          ← The article
├── screenshot.png    ← Co-located assets (optional)
└── data.csv          ← Any supporting files (optional)
```

**Never** create flat files like `content/posts/my-post.md`.

## Body Conventions

1. **Start headings at `##` (h2)** — the `<h1>` is auto-rendered from the `title` field. Do not skip heading levels (e.g. h2 to h4).
2. **End every article with `Flush!`** — on its own line, preceded by two blank lines:

```markdown
...last paragraph of your article.


Flush!
```

3. **Shortcodes** use Zola 0.23 component syntax:

| Shortcode | Syntax |
|---|---|
| Admonition | `{% <admonition kind="note"> %}Your text{% </admonition> %}` |
| Image | `{{ <img path="images/photo.jpg" alt="Description" loading="lazy" /> }}` |
| Image+caption | `{{ <img_caption path="images/photo.jpg" caption="My caption" /> }}` |
| YouTube | `{{ <youtube id="dQw4w9WgXcQ" /> }}` |

Available admonition kinds: `note`, `tip`, `important`, `warning`, `caution`.

4. **Code block languages**: Every fenced code block must declare a language (e.g. ` ```bash `, ` ```rust `). Never leave fenced code blocks unlabelled.
5. **Escape template syntax**: Literal `{{` or `{%` in Markdown code samples or prose MUST be wrapped in `{% raw %}...{% endraw %}` to prevent Tera template parse errors.
6. **No raw HTML or inline styles**: Avoid raw HTML in Markdown. Never use `style="..."` or `<style>` tags. Use shortcodes or CSS classes when styling is needed.
7. **Smart punctuation**: `smart_punctuation = true` is enabled in config. Always type plain straight quotes (`"`, `'`) and plain hyphens (`--`, `---`). Do not hand-insert curly quotes or em dashes.
8. **Internal links**: Use Zola `@/section/slug/index.md` or relative syntax, never hardcoded domain URLs.

## Pre-Publish Checklist

Before setting `draft = false`:

- [ ] `title` and `description` are filled in
- [ ] `date` is a bare TOML date (no quotes)
- [ ] Correct taxonomy key for the section (`post_tags` / `rtd_tags` / `travel_tags`)
- [ ] Body starts at `##`, not `#`
- [ ] All code blocks declare a language identifier
- [ ] All images have meaningful `alt` text
- [ ] No inline styles (`style="..."`) or raw HTML
- [ ] Any literal `{{` or `{%` escaped with `{% raw %}`
- [ ] Article ends with `Flush!` preceded by two blank lines
- [ ] If slug differs from directory name, `uid` is set
- [ ] If using math, `katex = true` in `[extra]`
- [ ] If using diagrams, `mermaid = true` in `[extra]`
- [ ] Run `zola check` to verify no errors

