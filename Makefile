# Zola Makefile

# Variables
ZOLA := zola
SRC_DIR := public

# Default target
all: build

# Check for broken links using lychee
check-links:
	@echo "Checking links in public directory..."
	@lychee "public/**/*.html"

# Serve the site using zola (includes drafts for local preview)
preview:
	$(ZOLA) serve --drafts

# Generate OG images for posts without custom images
og-images:
	@uv run scripts/generate_og_images.py

# Build the site using zola
build:
	$(ZOLA) build
	$(MAKE) og-images
	@mv public/llms.txt/index.html public/llms.txt && rmdir public/llms.txt
	@mv public/llms-full.txt/index.html public/llms-full.txt && rmdir public/llms-full.txt

# Update project metadata from GitHub (Currently disabled)
# projects:
# 	@echo "Fetching latest project metadata from GitHub..."
# 	@uv run scripts/fetch_all_github_projects.py johndoe > content/projects/projects.toml
# 	@echo "Successfully updated content/projects/projects.toml"

# Content creation targets
ifeq ($(firstword $(MAKECMDGOALS)),$(filter $(firstword $(MAKECMDGOALS)),rtd post travel))
  RUN_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  $(eval $(RUN_ARGS):;@:)
endif

rtd:
	@./bin/rtd $(RUN_ARGS)

post:
	@./bin/post $(RUN_ARGS)

travel:
	@./bin/travel $(RUN_ARGS)

.PHONY: all preview build og-images rtd post travel