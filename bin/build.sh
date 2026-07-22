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

echo ">>> Done."
