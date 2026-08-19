#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

"""
Copies raw markdown files from the content directory to their corresponding
output directories in public/ so they can be accessed directly by LLMs.
"""

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
                output_dir = public_dir / rel_path.parent.parent / slug
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
