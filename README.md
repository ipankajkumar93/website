# 🌐 pankajkumar.xyz

[![Built with Zola](https://img.shields.io/badge/Built%20with-Zola-blue?style=flat-square&logo=zola)](https://www.getzola.org/)
[![Deployed on Cloudflare Pages](https://img.shields.io/badge/Deployed%20on-Cloudflare%20Pages-F38020?style=flat-square&logo=cloudflare)](https://pages.cloudflare.com/)
[![Website Status](https://img.shields.io/badge/Website-UP-success?style=flat-square)](https://pankajkumar.xyz)

The source code for my personal website and blog, available at [pankajkumar.xyz](https://pankajkumar.xyz).

---

## 🛠️ Tech Stack & Theme

- **Framework:** [Zola](https://www.getzola.org/) (A fast static site generator in Rust)
- **Deployment:** Cloudflare Pages
- **Theme:** Inspired by [mr-karan.dev](https://mrkaran.dev), which was originally adapted from [zola-bearblog](https://codeberg.org/alanpearce/zola-bearblog).

### ✨ Enhancements & Features

I have heavily customized the base theme to meet my personal requirements and improve the overall UX:

- 🔍 **Global Search:** Interactive modal for full-text site search.
- 🏷️ **Topics Taxonomy:** A unified page to browse global tags across posts and notes.
- 📱 **Responsive Design:** Fully fluid and responsive layout, including a dynamic sticky Table of Contents that perfectly adapts across mobile, tablet, and desktop views.
- 📄 **AJAX Pagination:** Seamless, JavaScript-powered pagination without page reloads.
- ⬆️ **Back to Top:** Convenient floating button for long articles.
- 🖼️ **Dynamic OG Images:** Automated Open Graph image generation for rich social sharing.
- 🎨 **UI Polish:** Various typography, spacing, component-centering, and styling improvements for a highly polished reading experience.

---

## 🚀 Local Development

### Prerequisites
- [Zola](https://www.getzola.org/documentation/getting-started/installation/) (for serving the site)
- [uv](https://github.com/astral-sh/uv) (for running python scripts)
- `make`

### Serving the Site
To spin up a local development server (drafts included):

```bash
zola serve --drafts
# or
make preview
```

### Generating Open Graph (OG) Images

The site uses a Python script to automatically generate preview images for social media sharing. While Cloudflare Pages handles this automatically during deployment, you can run it locally to preview changes:

```bash
uv run scripts/generate_og_images.py
# or
make og-images
```

---

## 📝 Content Creation

You can quickly scaffold new articles using the provided `make` commands. These commands automatically generate properly formatted Markdown files in the correct directories (`content/posts`, `content/travel`, or `content/rtd`) and pre-populate the TOML frontmatter (including correctly formatted `slug`, `date`, `title`, and `description`).

### Syntax
```bash
make <type> <Title>[, <Description>]
```
- `<Title>` is **required**.
- `<Description>` is **optional** (separated from the title by a comma).
- *Note: You do not need to wrap the arguments in quotes.*

### Examples

```bash
# Create a new Post with a description
make post Setting Up Pi-hole, A guide to setting up a highly available pi-hole cluster

# Create a new Travel log (no description)
make travel My Trip to Tokyo

# Create a new RTD (Read The Docs) entry
make rtd How to configure Nginx, A quick reference for Nginx routing
```