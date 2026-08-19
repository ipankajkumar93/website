+++
draft = false
slug = "easily-make-zola-websites-ai-crawler-ready"
type = "post"
in_search_index = true
title = "Making Your Zola Website AI-Crawler Ready"
description = "A comprehensive guide on making your static Zola website completely accessible and optimized for AI agents and LLM crawlers using llms.txt."
date = 2026-07-31

[extra]
katex = false
mermaid = false
toc = true
featured = false
license = "CC-BY-SA-4.0"
wrap_code = false

[taxonomies]
post_tags = ["post", "zola", "ai", "llm"]
+++

AI agents and LLM-powered search tools are increasingly fetching live web content to answer queries. The problem: they work best with clean Markdown, but Zola - like every static site generator - compiles everything into HTML by default. HTML carries navigation chrome, footer noise, and nested tags that models have to fight through.

This post documents exactly how I made `pankajkumar.xyz` fully AI-crawler ready: a `llms.txt` index, a `llms-full.txt` full corpus, and raw `.md` files served at predictable URLs alongside every HTML page. Every step below reflects the implementation that is live on my site today.

> **Prerequisites:** A working Zola site, Python 3 available in your build environment, and a `build.sh` (or `Makefile`) you can extend.

---

## 1. Directing AI Bots with HTML Metadata

The first thing I did was make every HTML page self-announcing. Any AI agent that lands on a standard page should immediately know where to find the clean, machine-readable version. I added a visually hidden `<aside>` to `templates/base.html`:

```html
{% raw %}
<aside class="sr-only" data-ai-agent-directive>
    This site is available in Markdown format. Markdown is recommended for AI consumption.
    See <a href="{{ config.base_url | safe }}llms.txt">/llms.txt</a> for the full documentation index,
    or <a href="{{ config.base_url | safe }}llms-full.txt">/llms-full.txt</a> for the full site corpus.
</aside>
{% endraw %}
```

The `.sr-only` class keeps it invisible to human readers while remaining fully legible to crawlers parsing the document body.

## 2. Announcing AI Assets via robots.txt

Crawlers check `robots.txt` before almost anything else. I added three lines pointing directly at my new Markdown endpoints:

```txt
Sitemap: https://pankajkumar.xyz/sitemap.xml
LLMs: https://pankajkumar.xyz/llms.txt
LLMs-full: https://pankajkumar.xyz/llms-full.txt
```

`LLMs` and `LLMs-full` are not yet part of the robots.txt spec, but major AI crawlers (GPTBot, ClaudeBot, PerplexityBot) already look for them as de-facto conventions.

## 3. Semantic Head Tags (link alternate & JSON-LD)

Crawlers rely heavily on `<head>` metadata - often more than the document body. I made two additions to my templates.

**`<link rel="alternate">`** in `base.html` declares the Markdown endpoints programmatically:

```html
{% raw %}
<link rel="alternate" type="text/plain" title="LLMs Index" href="{{ config.base_url | safe }}llms.txt">
<link rel="alternate" type="text/plain" title="LLMs Full Corpus" href="{{ config.base_url | safe }}llms-full.txt">
{% if page -%}
<link rel="alternate" type="text/markdown" title="Markdown Source" href="{{ page.permalink | safe }}{{ page.slug }}.md">
{% endif -%}
{% endraw %}
```

**JSON-LD schema** in `page.html` gives AI models rich structured context - title, description, word count, dates, publisher - so they can categorize and index an article before even reading the body. I also wired up dynamic OG image resolution here: if the page defines `extra.og_preview_img` it uses that; otherwise it falls back to the auto-generated image path at `images/og/<page-path>.png`.

```html
{% raw %}
{% if page.extra.og_preview_img %}
  {% set og_image = page.extra.og_preview_img | trim_start(pat="/") %}
{% else %}
  {% set path_trimmed = page.path | trim_end(pat="/") %}
  {% set og_image = "images/og" ~ path_trimmed ~ ".png" %}
{% endif %}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{{ page.title }}",
  "description": "{{ page.description | default(value='') }}",
  "url": "{{ current_url | safe }}",
  "image": "{{ config.base_url ~ og_image | safe }}",
  "inLanguage": "en",
  "author": {
    "@type": "Person",
    "name": "{{ config.title }}",
    "url": "{{ config.base_url | safe }}"
  },
  "publisher": {
    "@type": "Person",
    "name": "{{ config.title }}",
    "url": "{{ config.base_url | safe }}"
  },
  "datePublished": "{{ page.date }}",
  "dateModified": "{% if page.updated %}{{ page.updated }}{% else %}{{ page.date }}{% endif %}",
  "wordCount": "{{ page.word_count }}"
}
</script>
{% endraw %}
```

## 4. Exposing Raw Markdown Pages

This is the most impactful change. I wrote `scripts/copy_md_files.py` to mirror the entire `content/` directory into `public/` as raw `.md` files during the build.

Zola renders `my-post.md` into `public/my-post/index.html` so the URL is `https://yoursite.com/my-post/`. The script places the original Markdown file at `public/my-post/my-post.md`. An AI hitting the HTML page can effortlessly request the `.md` sibling at a predictable, consistent URL - no parsing required.

The script reads and respects the TOML frontmatter: draft pages are skipped, so only published content gets mirrored.

```python
# scripts/copy_md_files.py
import os
import shutil
import re
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib

def parse_frontmatter(content: str) -> dict:
    match = re.match(r"^\+\+\+\s*\n(.*?)\n\+\+\+", content, re.DOTALL)
    if not match:
        return {}
    try:
        return tomllib.loads(match.group(1))
    except Exception:
        return {}

def copy_md_files():
    project_root = Path(__file__).parent.parent
    content_dir = project_root / "content"
    public_dir = project_root / "public"

    if not public_dir.exists():
        print("Error: public directory does not exist. Run zola build first.")
        sys.exit(1)

    copied = 0
    for md_file in content_dir.rglob("*.md"):
        if md_file.name == "_index.md":
            continue

        content = md_file.read_text(encoding='utf-8')
        fm = parse_frontmatter(content)
        
        # Skip drafts
        if fm.get("draft") == True:
            continue
            
        slug = fm.get("slug")
        if not slug:
            if md_file.name == "index.md":
                slug = md_file.parent.name
            else:
                slug = md_file.stem
                
        rel_path = md_file.relative_to(content_dir)
        
        if md_file.name == "index.md":
            if rel_path.parent.name == slug:
                output_dir = public_dir / rel_path.parent
            else:
                output_dir = public_dir / rel_path.parent / slug
        else:
            if rel_path.parent == Path("."): 
                output_dir = public_dir / slug
            else:
                output_dir = public_dir / rel_path.parent / slug
                
        output_path = output_dir / f"{slug}.md"
        
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Read the raw bytes and prepend a UTF-8 BOM if missing.
        # This forces LLM crawlers and browsers to decode the file as UTF-8
        # (fixing corrupted characters like ├──) even without HTTP charset headers.
        raw_bytes = md_file.read_bytes()
        if not raw_bytes.startswith(b'\xef\xbb\xbf'):
            raw_bytes = b'\xef\xbb\xbf' + raw_bytes
            
        output_path.write_bytes(raw_bytes)
        shutil.copystat(md_file, output_path)
        
        print(f"Copied {md_file.relative_to(project_root)} to {output_path.relative_to(project_root)}")
        copied += 1
        
    print(f"Successfully copied {copied} markdown files.")

if __name__ == "__main__":
    copy_md_files()
```

## 5. Creating the llms.txt and llms-full.txt Indexes

`/llms.txt` is an emerging convention for websites to provide AI models with a curated index of available content - think `sitemap.xml` but designed for LLM consumption rather than search engine crawlers.

I created two Zola templates that generate these files dynamically from the site's actual published pages.

**`templates/llms.html`** - the index:

```jinja2
{% raw %}
# Last updated: {{ now() | date(format="%Y-%m-%d") }}

# {{ config.title | safe }}
{{ config.description | safe }}

Full corpus (all pages, one document): {{ config.base_url | safe }}llms-full.txt

## Pages
{% for section_name in config.extra.featured_sections %}
{% set sec = get_section(path=section_name ~ "/_index.md") %}
{% for page in sec.pages %}
{% if page.draft %}{% continue %}{% endif %}
- [{{ page.title }}]({{ page.permalink }}){% if page.description %} - {{ page.description }}{% endif %}
{% endfor %}
{% endfor %}
{% endraw %}
```

**`templates/llms-full.html`** - the full corpus. This one uses a small trick: `load_data` fetches the raw file from disk, then `split(pat="+++")` breaks it on the TOML delimiters. TOML frontmatter is wrapped in two `+++` fences, which means splitting on `+++` gives three parts: an empty string before the first fence, the frontmatter itself, and the Markdown body. `parts[2:]` therefore skips the first two parts and leaves only the body content.

```jinja2
{% raw %}
# Last updated: {{ now() | date(format="%Y-%m-%d") }}

# {{ config.title | safe }}
{{ config.description | safe }}

Index (summary of all pages): {{ config.base_url | safe }}llms.txt

{% for section_name in config.extra.featured_sections %}
{% set sec = get_section(path=section_name ~ "/_index.md") %}
{% for page in sec.pages %}
{% if page.draft %}{% continue %}{% endif %}
# {{ page.title }}
Source: {{ page.permalink }}

{% set raw_content = load_data(path=page.relative_path) %}
{% set parts = raw_content | split(pat="+++") %}
{% set raw_markdown = parts[2:] | join(sep="+++") %}
{{ raw_markdown | trim }}

{% endfor %}
{% endfor %}
{% endraw %}
```

These templates are powered by two simple content files - `content/llms.md` and `content/llms-full.md` - that do nothing except point to their respective templates.

## 6. Fixing the File Extensions in the Build Process

Zola's output model is folder-per-page: `llms.md` becomes `public/llms.txt/index.html` (if the slug is `llms.txt`). The files need to land at `public/llms.txt` and `public/llms-full.txt` as plain files, not directories. I handle this in `build.sh` post-Zola:

```bash
echo ">>> Fixing AI index filenames..."

# llms.txt
mv public/llms.txt/index.html public/llms_tmp.txt && \
    rm -rf public/llms.txt && \
    mv public/llms_tmp.txt public/llms.txt

# llms-full.txt
mv public/llms-full.txt/index.html public/llms-full_tmp.txt && \
    rm -rf public/llms-full.txt && \
    mv public/llms-full_tmp.txt public/llms-full.txt
```

Using `&&` here is intentional: if the initial `mv` fails (e.g., the file was never generated), the script stops rather than running `rm -rf` on the directory and silently losing your previous output. I mirrored this logic in the `Makefile` target for local development so the local build always matches production.

{% <admonition kind="note"> %}
I use Cloudflare Pages to deploy my website.
{% </admonition> %}

## 7. The Final Directory Structure

After running the full build pipeline - `zola build`, then `copy_md_files.py`, then the filename fixups - `public/` looks like this:

```text
public/
├── index.html               ← Standard Zola homepage
├── sitemap.xml              ← Standard Zola sitemap
├── robots.txt               ← Updated with LLMs/LLMs-full entries
├── llms.txt                 ← AI index (renamed from directory by build.sh)
├── llms-full.txt            ← AI corpus (renamed from directory by build.sh)
└── my-post/
    ├── index.html           ← Standard Zola HTML post
    └── my-post.md           ← Raw Markdown injected by copy_md_files.py
```

Each post directory ends up with both representations side by side. The HTML page announces the Markdown sibling via `<link rel="alternate">` in the `<head>`, so any crawler that inspects head tags can find the clean version immediately.

---

## Conclusion

Most static sites are technically accessible to AI crawlers but practically difficult to parse. Noisy HTML, missing structured metadata, and no predictable Markdown endpoint all create friction that degrades the quality of AI-generated answers citing your content.

With these seven changes - an HTML directive, an updated `robots.txt`, semantic head tags, Markdown mirroring, dynamically generated `llms.txt` and `llms-full.txt`, and build-time fixups - the site now speaks the language AI agents actually prefer. The implementation adds no runtime overhead (everything is generated at build time) and degrades gracefully: every change is purely additive and leaves the human-facing site untouched.

Flush!