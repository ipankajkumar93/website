#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["Pillow"]
# ///
"""
OG Image Generator for example.com

Generates social preview images for blog posts that don't have a custom og_preview_img.
Uses the blog's warm terracotta aesthetic with clean, modern typography.
"""

import hashlib
import json
import re
import sys
try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

CACHE_VERSION = 1

# Configuration
CONFIG = {
    "author": "John Doe",
    "site": "example.com",
    "width": 1200,
    "height": 630,
    "padding": 80,
    # Dark Mode Background with Large Dark Box
    "bg_color": (25, 35, 90),       # Extra Punchy Indigo Blue
    "glow_color_1": (40, 112, 194), # Cobalt Blue
    "glow_color_2": (20, 60, 110),  # Deep Blue
    "card_bg": (15, 15, 18, 255),   # Solid dark box
    "card_border": (39, 39, 42, 255), # Subtle border
    "title_color": (250, 250, 250), # Crisp White
    "desc_color": (161, 161, 170),  # Zinc 400
    "author_color": (228, 228, 231), # Zinc 200
    "domain_color": (161, 161, 170), # Zinc 400
}


class OGImageGenerator:
    def __init__(self, project_root: Path):
        self.project_root = project_root
        # Read og_sections from config.toml dynamically
        config_path = project_root / "config.toml"
        with open(config_path, "rb") as f:
            config_data = tomllib.load(f)
            
        og_sections = config_data.get("extra", {}).get("og_sections", [])
        
        self.content_dirs = [
            project_root / "content" / section 
            for section in og_sections
        ]
        self.output_dir = project_root / "static" / "images" / "og"
        self.cache_file = project_root / ".og_cache.json"
        self.cache = self._load_cache()

        self.width = CONFIG["width"]
        self.height = CONFIG["height"]
        self.padding = CONFIG["padding"]
        self.content_width = self.width - (2 * self.padding)

        self.fonts = self._load_fonts()
        self._load_site_config()
        self.footer_items = self._get_footer_items()

    def _load_site_config(self):
        """Parse config.toml once to dynamically set site metadata and category mappings."""
        self.site_config = {}
        self.cat_map = {}
        try:
            with open(self.project_root / "config.toml", "rb") as f:
                self.site_config = tomllib.load(f)
                
            # Update global CONFIG dynamically
            if title := self.site_config.get("title"):
                CONFIG["author"] = title
                
            if base_url := self.site_config.get("base_url"):
                domain = base_url.replace("https://", "").replace("http://", "").strip("/")
                CONFIG["site"] = domain
                
            # Build dynamic category map from main_menu
            menu = self.site_config.get("extra", {}).get("main_menu", [])
            for item in menu:
                name = item.get("name", "")
                url = item.get("url", "")
                if url.startswith("@/") and "/_index.md" in url:
                    dir_name = url.replace("@/", "").replace("/_index.md", "")
                    self.cat_map[dir_name] = name
                    
        except Exception as e:
            print(f"Warning: Could not load site config: {e}")
            self.cat_map = {}

    def _get_footer_items(self) -> str:
        """Get menu items from already-loaded site config, excluding Home and Contact, in lowercase."""
        try:
            menu = self.site_config.get("extra", {}).get("main_menu", [])
            items = [m.get("name", "").lower() for m in menu]
            items = [i for i in items if i and i not in ("home", "contact")]
            return "   •   ".join(items)
        except Exception as e:
            print(f"Warning: Could not parse footer items: {e}")
            return ""

    def _load_fonts(self):
        """Load fonts with fallbacks."""
        fonts = {}
        
        bold_font = self.project_root / "scripts" / "fonts" / "Roboto-Bold.ttf"
        regular_font = self.project_root / "scripts" / "fonts" / "Roboto-Regular.ttf"
        
        if bold_font.exists() and regular_font.exists():
            fonts["title_large"] = ImageFont.truetype(str(bold_font), 56)
            fonts["title_medium"] = ImageFont.truetype(str(bold_font), 46)
            fonts["title_small"] = ImageFont.truetype(str(bold_font), 38)
            fonts["desc"] = ImageFont.truetype(str(regular_font), 32)
            fonts["author"] = ImageFont.truetype(str(bold_font), 28)
            fonts["domain"] = ImageFont.truetype(str(regular_font), 24)
        else:
            print("Warning: Custom fonts not found, using defaults")
            fonts = {k: ImageFont.load_default() for k in ["title_large", "title_medium", "title_small", "desc", "author", "domain"]}
            
        return fonts

    def _load_cache(self) -> dict:
        """Load generation cache."""
        if self.cache_file.exists():
            try:
                with open(self.cache_file) as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass
        return {}

    def _save_cache(self):
        """Save generation cache."""
        with open(self.cache_file, "w") as f:
            json.dump(self.cache, f, indent=2)

    def _content_hash(self, title: str, description: str, category: str = None, date_str: str = "", read_time: int = 0) -> str:
        """Generate hash for caching."""
        content = f"{CACHE_VERSION}:{title}:{description}:{category}:{date_str}:{read_time}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def _parse_frontmatter(self, content: str) -> dict | None:
        """Parse TOML frontmatter from markdown file."""
        match = re.match(r"^\+\+\+\s*\n(.*?)\n\+\+\+", content, re.DOTALL)
        if not match:
            return None
        try:
            fm = tomllib.loads(match.group(1))
            # Flatten [extra] section keys into top-level for backwards compatibility
            if "extra" in fm:
                for k, v in fm["extra"].items():
                    fm[k] = v
            return fm
        except Exception:
            return None

    def _wrap_text(self, text: str, font, max_width: int) -> list[str]:
        """Wrap text to fit within max_width."""
        if not text:
            return []

        dummy = Image.new("RGB", (1, 1))
        draw = ImageDraw.Draw(dummy)

        words = text.split()
        lines = []
        current_line = []

        for word in words:
            test_line = " ".join(current_line + [word])
            bbox = draw.textbbox((0, 0), test_line, font=font)
            width = bbox[2] - bbox[0]

            if width <= max_width or not current_line:
                current_line.append(word)
            else:
                lines.append(" ".join(current_line))
                current_line = [word]

        if current_line:
            lines.append(" ".join(current_line))

        return lines

    def _get_title_font(self, title: str):
        """Select font size based on title length."""
        if len(title) <= 35:
            return self.fonts["title_large"]
        elif len(title) <= 60:
            return self.fonts["title_medium"]
        else:
            return self.fonts["title_small"]

    def _text_height(self, text: str, font) -> int:
        """Get height of rendered text."""
        dummy = Image.new("RGB", (1, 1))
        draw = ImageDraw.Draw(dummy)
        bbox = draw.textbbox((0, 0), text, font=font)
        return bbox[3] - bbox[1]

    def _create_glow_background(self) -> Image.Image:
        """Create a premium background with soft glowing orbs."""
        base = Image.new("RGBA", (self.width, self.height), CONFIG["bg_color"] + (255,))
        glow = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow)
        
        # Draw glowing orbs
        glow_draw.ellipse([-self.width*0.2, -self.height*0.5, self.width*0.6, self.height*1.2], fill=CONFIG["glow_color_1"] + (45,))
        glow_draw.ellipse([self.width*0.4, -self.height*0.2, self.width*1.2, self.height*1.5], fill=CONFIG["glow_color_2"] + (40,))
        
        # Apply heavy blur for smooth gradient effect
        glow = glow.filter(ImageFilter.GaussianBlur(140))
        base = Image.alpha_composite(base, glow)
        return base

    def _get_circle_avatar(self, size: int) -> Image.Image | None:
        """Load and crop the profile avatar into a circle."""
        avatar_path = self.project_root / "static" / "images" / "website" / "profile.jpg"
        if not avatar_path.exists():
            return None
            
        try:
            img = Image.open(avatar_path).convert("RGBA")
            min_dim = min(img.size)
            left = (img.width - min_dim) / 2
            top = (img.height - min_dim) / 2
            img = img.crop((left, top, left + min_dim, top + min_dim))
            img = img.resize((size, size), Image.Resampling.LANCZOS)
            
            # Anti-aliasing trick: Draw mask at 4x resolution, then scale down
            aa_scale = 4
            mask_size = size * aa_scale
            mask = Image.new('L', (mask_size, mask_size), 0)
            draw = ImageDraw.Draw(mask)
            draw.ellipse((0, 0, mask_size, mask_size), fill=255)
            mask = mask.resize((size, size), Image.Resampling.LANCZOS)
            
            output = Image.new('RGBA', (size, size), (0, 0, 0, 0))
            output.paste(img, (0, 0), mask)
            
            return output
        except Exception:
            return None

    def _draw_category_pill(self, img: Image.Image, draw: ImageDraw.ImageDraw, cat_text: str, pill_x_end: int, pill_y: int):
        pill_width = 56
        pill_height = 4
        pill_x_start = pill_x_end - pill_width
        
        cat_font = self.fonts["domain"]
        cat_bbox = draw.textbbox((0, 0), cat_text, font=cat_font)
        cat_w = cat_bbox[2] - cat_bbox[0]
        cat_visual_center = cat_bbox[1] + (cat_bbox[3] - cat_bbox[1]) / 2
        
        cat_x = pill_x_start - cat_w - 16
        cat_y = pill_y - cat_visual_center
        
        draw.text((cat_x, cat_y), cat_text, fill=(113, 113, 122), font=cat_font)
        
        pill_img = Image.new("RGBA", (pill_width, pill_height), (0, 0, 0, 0))
        pill_draw = ImageDraw.Draw(pill_img)
        
        c1 = CONFIG["glow_color_1"] + (255,)
        c2 = CONFIG["glow_color_2"] + (255,)
        for px in range(pill_width):
            ratio = px / max(1, pill_width - 1)
            r = int(c1[0] * (1 - ratio) + c2[0] * ratio)
            g = int(c1[1] * (1 - ratio) + c2[1] * ratio)
            b = int(c1[2] * (1 - ratio) + c2[2] * ratio)
            a = int(c1[3] * (1 - ratio) + c2[3] * ratio)
            pill_draw.line([(px, 0), (px, pill_height)], fill=(r, g, b, a))
            
        pill_mask = Image.new("L", (pill_width, pill_height), 0)
        ImageDraw.Draw(pill_mask).rounded_rectangle([0, 0, pill_width, pill_height], radius=2, fill=255)
        
        pill_final = Image.new("RGBA", (pill_width, pill_height), (0, 0, 0, 0))
        pill_final.paste(pill_img, (0, 0), mask=pill_mask)
        
        img.paste(pill_final, (int(pill_x_start), int(pill_y - pill_height/2)), pill_final)

    def generate_image(self, title: str, description: str, output_path: Path, category: str = None, date_str: str = "", read_time: int = 0, is_landing_page: bool = False):
        """Generate the OG image."""
        is_home = category == "home"
        is_centered = is_home or is_landing_page

        img = self._create_glow_background()
        draw = ImageDraw.Draw(img, "RGBA")

        # Draw larger black card with a subtle bottom gradient
        pad = 40
        card_w = self.width - 2 * pad
        card_h = self.height - 2 * pad
        
        card_img = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
        card_draw = ImageDraw.Draw(card_img)
        card_draw.rounded_rectangle([0, 0, card_w, card_h], radius=24, fill=CONFIG["card_bg"])
        
        gradient = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
        grad_draw = ImageDraw.Draw(gradient)
        grad_draw.ellipse([-card_w * 0.2, card_h * 0.5, card_w * 1.2, card_h * 1.5], fill=(0, 0, 0, 150))
        gradient = gradient.filter(ImageFilter.GaussianBlur(80))
        
        card_img = Image.alpha_composite(card_img, gradient)
        
        mask = Image.new("L", (card_w, card_h), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([0, 0, card_w, card_h], radius=24, fill=255)
        
        final_card = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
        final_card.paste(card_img, (0, 0), mask=mask)
        # Removed the dark grey line (CONFIG["card_border"]) around the inner card
        
        # Add a pronounced glowing effect behind the card edge
        card_glow = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(card_glow)
        glow_draw.rounded_rectangle([pad, pad, pad + card_w, pad + card_h], radius=24, outline=CONFIG["glow_color_1"] + (255,), width=24)
        card_glow = card_glow.filter(ImageFilter.GaussianBlur(24))
        
        img = Image.alpha_composite(img, card_glow)
        draw = ImageDraw.Draw(img, "RGBA")
        
        img.paste(final_card, (pad, pad), final_card)

        # Avatar & Author Header
        y = pad + 48
        x = pad + 64
        
        avatar_size = 96
        avatar = self._get_circle_avatar(avatar_size)
        
        if avatar:
            # Shift the avatar down slightly to visually center align with the text
            img.paste(avatar, (int(x), int(y + 6)), avatar)
            
            # Center the text vertically relative to the avatar
            text_x = x + avatar_size + 24
            
            # We want author name and domain to sit aligned with the avatar.
            author_y = y + 16
            domain_y = author_y + 36 # Gap between name and website
            
            draw.text((text_x, author_y), CONFIG["author"], fill=CONFIG["author_color"], font=self.fonts["author"])
            draw.text((text_x, domain_y), CONFIG["site"], fill=CONFIG["domain_color"], font=self.fonts["domain"])
            y += avatar_size + 48
        else:
            draw.text((x, y), CONFIG["author"], fill=CONFIG["author_color"], font=self.fonts["author"])
            y += 50

        # Top Right: Date and Read Time OR Landing Page Pill
        info_font = self.fonts["domain"]
        if is_centered and category:
            x_end = self.width - pad - 64
            avatar_center_y = pad + 48 + (96 / 2) # avatar_size is 96
            self._draw_category_pill(img, draw, category.lower(), x_end, avatar_center_y)
        elif date_str or read_time > 0:
            date_text = ""
            read_text = ""
            
            if date_str:
                try:
                    d = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                    date_text = d.strftime("%b %d, %Y")
                except Exception:
                    date_text = date_str
            
            if read_time > 0:
                read_text = f"{read_time} min read"
                
            lines = [t for t in [date_text, read_text] if t]
            
            if lines:
                gap = 8
                bboxes = [draw.textbbox((0, 0), line, font=info_font) for line in lines]
                heights = [bbox[3] - bbox[1] for bbox in bboxes]
                total_height = sum(heights) + gap * (len(lines) - 1)
                
                avatar_center_y = pad + 48 + (avatar_size / 2)
                current_y = avatar_center_y - (total_height / 2)
                
                for info_line, bbox, h in zip(lines, bboxes, heights):
                    w = bbox[2] - bbox[0]
                    info_x = self.width - pad - 64 - w
                    info_y = current_y - bbox[1]
                    draw.text((info_x, info_y), info_line, fill=(113, 113, 122), font=info_font) # Zinc 500
                    current_y += h + gap

        # Draw Title
        title_font = self._get_title_font(title)
        title_lines = self._wrap_text(title, title_font, self.width - (2 * pad) - 128)

        for line in title_lines[:3]:
            bbox = draw.textbbox((0, 0), line, font=title_font)
            line_x = (self.width - (bbox[2] - bbox[0])) / 2
            draw.text((line_x, y), line, fill=CONFIG["title_color"], font=title_font)
            y += self._text_height(line, title_font) + 12

        y += 48

        # Draw Description
        if description:
            desc_font = self.fonts["desc"]
            desc_lines = self._wrap_text(description, desc_font, self.width - (2 * pad) - 128)

            for line in desc_lines[:3]:  # Limit description to 3 lines
                bbox = draw.textbbox((0, 0), line, font=desc_font)
                line_x = (self.width - (bbox[2] - bbox[0])) / 2
                draw.text((line_x, y), line, fill=CONFIG["desc_color"], font=desc_font)
                y += self._text_height(line, desc_font) + 10

        # Bottom Right: Category and Pill
        if category and not is_home and not is_landing_page:
            pill_x_end = self.width - pad - 64
            pill_y = self.height - pad - 64
            self._draw_category_pill(img, draw, category.lower(), pill_x_end, pill_y)

        # Homepage/Landing page specific bottom-center footer
        if is_centered:
            footer_text = self.footer_items
            footer_font = self.fonts["domain"]
            footer_bbox = draw.textbbox((0, 0), footer_text, font=footer_font)
            footer_w = footer_bbox[2] - footer_bbox[0]
            
            footer_x = (self.width - footer_w) / 2
            
            target_bottom_y = self.height - pad - 64
            text_visual_bottom = footer_bbox[3]
            footer_y = target_bottom_y - text_visual_bottom
            
            draw.text((footer_x, footer_y), footer_text, fill=(82, 82, 91), font=footer_font) # Zinc 600

        # Save
        output_path.parent.mkdir(parents=True, exist_ok=True)
        img.convert("RGB").save(output_path, "PNG", optimize=True)


    def process_posts(self) -> tuple[int, int, int]:
        """Process all posts and generate missing OG images."""
        generated = 0
        skipped_custom = 0
        skipped_cached = 0

        self.output_dir.mkdir(parents=True, exist_ok=True)

        for content_dir in self.content_dirs:
            if not content_dir.exists():
                continue
                
            category = self.cat_map.get(content_dir.name, content_dir.name.capitalize())
            
            for md_file in content_dir.rglob("*.md"):
                if md_file.name == "_index.md":
                    continue

                content = md_file.read_text(encoding='utf-8')
                fm = self._parse_frontmatter(content)

                if not fm or not fm.get("title"):
                    continue

                # Skip if custom og_preview_img is set
                if fm.get("og_preview_img") or fm.get("draft"):
                    skipped_custom += 1
                    continue

                title = str(fm.get("title", ""))
                description = str(fm.get("description", ""))
                date_val = fm.get("updated")
                if not date_val:
                    date_val = fm.get("date", "")
                
                # tomllib parses bare TOML dates as datetime.date objects
                date_str = date_val.isoformat() if hasattr(date_val, 'isoformat') else str(date_val)
                
                # Zola uses the slug from frontmatter if it exists, otherwise it defaults to the filename
                slug = fm.get("slug")
                if not slug:
                    if md_file.name == "index.md":
                        slug = md_file.parent.name
                    else:
                        slug = md_file.stem
                
                # Get the relative path from the content directory to preserve subfolders
                rel_path = md_file.relative_to(self.project_root / "content")
                
                if md_file.name == "index.md" and rel_path.parent.name == slug:
                    public_html_dir = self.project_root / "public" / rel_path.parent
                else:
                    public_html_dir = self.project_root / "public" / rel_path.parent.parent / slug
                
                # Try to extract the exact reading time from Zola's generated HTML
                read_time = 0
                public_html = public_html_dir / "index.html"
                if public_html.exists():
                    try:
                        html_content = public_html.read_text(encoding='utf-8', errors='ignore')
                        match = re.search(r'<div class="reading-time">\s*<i>(\d+)\s+minute', html_content)
                        if match:
                            read_time = int(match.group(1))
                    except Exception:
                        pass
                
                # Fallback to an approximation if the HTML hasn't been generated yet
                if not read_time:
                    match = re.match(r"^\+\+\+\s*\n(.*?)\n\+\+\+", content, re.DOTALL)
                    body = content[match.end():] if match else content
                    body_clean = re.sub(r'```.*?```', '', body, flags=re.DOTALL)
                    body_clean = re.sub(r'{%.*?%}', '', body_clean, flags=re.DOTALL)
                    body_clean = re.sub(r'<[^>]+>', '', body_clean)
                    # Zola's unicode-segmentation treats IPs and numbers differently. Counting alphabetical sequences gets us within 1% of Zola's logic.
                    word_count = len(re.findall(r'[a-zA-Z]+', body_clean))
                    read_time = max(1, int(word_count / 200) + (1 if word_count % 200 > 0 else 0))
                
                if md_file.name == "index.md":
                    output_path = self.output_dir / rel_path.parent.parent / f"{slug}.png"
                else:
                    output_path = self.output_dir / rel_path.parent / f"{slug}.png"

                # Check cache
                content_hash = self._content_hash(title, description, category, date_str, read_time)
                cache_key = str(output_path.relative_to(self.project_root))

                if output_path.exists() and self.cache.get(cache_key) == content_hash:
                    skipped_cached += 1
                    continue

                # Generate image
                print(f"  Generating: {rel_path.parent}/{slug}.png")
                self.generate_image(title, description, output_path, category, date_str, read_time)
                self.cache[cache_key] = content_hash
                generated += 1

        self._save_cache()
        return generated, skipped_custom, skipped_cached

    def process_home(self) -> tuple[int, int]:
        """Generate the OG image for the homepage using config.toml."""
        title = self.site_config.get("title", CONFIG["author"])
        description = self.site_config.get("description", "")
            
        self.output_dir.mkdir(parents=True, exist_ok=True)
        output_path = self.output_dir / "home.png"
        
        # Check cache
        content_hash = self._content_hash(title, description, "home", "", 0)
        cache_key = str(output_path.relative_to(self.project_root))

        if output_path.exists() and self.cache.get(cache_key) == content_hash:
            return 0, 1
            
        print("  Generating: home.png")
        self.generate_image(title, description, output_path, "home", "", 0)
        self.cache[cache_key] = content_hash
        self._save_cache()
        return 1, 0

    def process_landing_pages(self) -> tuple[int, int]:
        """Generate OG images for landing pages."""
        generated = 0
        skipped = 0

        pages = []
        content_dir = self.project_root / "content"
        
        for md_file in content_dir.glob("*.md"):
            if md_file.name == "_index.md":
                continue
            pages.append((md_file.stem, md_file))
            
        for subdir in content_dir.iterdir():
            if subdir.is_dir():
                md_file = subdir / "_index.md"
                if md_file.exists():
                    pages.append((subdir.name, md_file))

        self.output_dir.mkdir(parents=True, exist_ok=True)

        for cat_name, md_file in pages:
            if not md_file.exists():
                continue

            content = md_file.read_text(encoding='utf-8')
            fm = self._parse_frontmatter(content)
            if not fm or fm.get("draft"):
                continue

            title = fm.get("title", cat_name.capitalize())
            description = fm.get("description", "")

            if "." in description:
                description = description.split(".")[0] + "."

            output_path = self.output_dir / f"{cat_name}.png"

            content_hash = self._content_hash(title, description, cat_name, "", 0)
            cache_key = str(output_path.relative_to(self.project_root))

            if output_path.exists() and self.cache.get(cache_key) == content_hash:
                skipped += 1
                continue

            print(f"  Generating: {cat_name}.png")
            self.generate_image(title, description, output_path, cat_name, "", 0, is_landing_page=True)
            self.cache[cache_key] = content_hash
            generated += 1

        self._save_cache()
        return generated, skipped


def main():
    project_root = Path(__file__).parent.parent

    print("Generating OG images...")
    generator = OGImageGenerator(project_root)
    home_gen, home_cached = generator.process_home()
    lp_gen, lp_cached = generator.process_landing_pages()
    generated, skipped_custom, skipped_cached = generator.process_posts()

    total_gen = generated + home_gen + lp_gen
    total_cached = skipped_cached + home_cached + lp_cached

    print(
        f"Done: {total_gen} generated, {skipped_custom} have custom images, {total_cached} cached"
    )


if __name__ == "__main__":
    main()
