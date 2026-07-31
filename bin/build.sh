#!/bin/bash
set -euo pipefail

echo ">>> Installing uv..."
curl -LsSf https://astral.sh/uv/0.11.21/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

echo ">>> Building Zola site..."
zola build

echo ">>> Generating OG images..."
uv run scripts/generate_og_images.py

echo ">>> Synchronizing OG images to public directory..."
mkdir -p public/images/og
cp -a static/images/og/* public/images/og/ || true

echo ">>> Copying markdown files to public directory..."
uv run scripts/copy_md_files.py

echo ">>> Fixing AI index filenames..."
mv public/llms.txt/index.html public/llms_tmp.txt && \
    rm -rf public/llms.txt && \
    mv public/llms_tmp.txt public/llms.txt

# llms-full.txt
mv public/llms-full.txt/index.html public/llms-full_tmp.txt && \
    rm -rf public/llms-full.txt && \
    mv public/llms-full_tmp.txt public/llms-full.txt

echo ">>> Done."
