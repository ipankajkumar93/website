# Third-Party Licenses

This website is built upon and incorporates code from several open-source projects. 

## Zola

[Zola](https://www.getzola.org/) is the static site generator used to build this website. Zola is licensed under the MIT License.

> Copyright (c) 2017-2023 Vincent Prouillet
> 
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
> 
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
> 
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Bearblog Theme

The underlying layout and styling are heavily inspired by [bearblog.dev](https://bearblog.dev/), specifically adapted from the [zola-bearblog](https://codeberg.org/alanpearce/zola-bearblog) theme port which is licensed under the MIT License.

> Copyright (c) 2021 Alan Pearce
> 
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
> 
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
> 
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
> THE SOFTWARE.

## Frontend Libraries

### Mermaid.js
[Mermaid.js](https://mermaid.js.org/) is used for rendering interactive flowcharts and diagrams natively in Markdown code blocks. It is licensed under the MIT License.

### KaTeX
[KaTeX](https://katex.org/) is used for fast math typesetting and rendering natively in the browser. It is licensed under the MIT License.

## Fonts

### Geist
[Geist](https://vercel.com/font) is the primary sans-serif font family. It is licensed under the SIL Open Font License (OFL) 1.1.

### Instrument
[Instrument](https://github.com/Instrument/instrument-sans) is used for specific typography accents. It is licensed under the SIL Open Font License (OFL) 1.1.

### JetBrains Mono
[JetBrains Mono](https://www.jetbrains.com/lp/mono/) is the monospace font used for rendering code blocks. It is licensed under the SIL Open Font License (OFL) 1.1.

## Python Scripts & Build Tools

### Pillow (PIL)
[Pillow](https://python-pillow.org/) is used in the `generate_og_images.py` script to programmatically generate Open Graph (OG) social preview images. It is licensed under the HPND License.

### Requests
[Requests](https://requests.readthedocs.io/) is used in the `fetch_all_github_projects.py` script to fetch repository data via the GitHub API. It is licensed under the Apache License 2.0.
