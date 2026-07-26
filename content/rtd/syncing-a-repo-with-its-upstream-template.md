+++
draft = false # Set this to false when you're ready to publish the article to production
slug = "syncing-a-repo-with-its-upstream-template"
type = "rtd"
in_search_index = true
title = "Syncing a Repo with Its Upstream Template, Without Losing Content"
description = "A practical Git workflow for syncing your repo with an upstream template or boilerplate - without forking - using a second remote and a custom merge driver to keep your own content safe on every merge."
date = 2026-07-26
# updated = 2026-07-26

[extra]
toc = true
featured = true
license = "CC-BY-SA-4.0"
wrap_code = false
# og_preview_img = "/images/sample-image.jpeg" # Uncomment to specify a custom OG preview image, otherwise the build script will auto-generate one.
# cover_image = "/images/sample-image.jpeg"

[taxonomies]
rtd_tags = ["rtd","git","fork","repo"]
+++

## Background

If you build a project on top of an open-source template or boilerplate repo, you eventually hit a fork-management problem: how do you keep pulling in upstream improvements without your own content, config, or custom code getting clobbered every time you merge?

Here's the setup I landed on. It uses a second Git remote pointed at the upstream repo, plus a custom merge driver that tells Git to always keep "our" version of specific files and folders. Once it's wired up, pulling updates becomes a two-command routine.

> **Note:** I'm using a website/theme as the running example below since that's the situation I was in, but nothing here is specific to websites. This works for any repo that needs to keep tracking an external template, boilerplate, or starter-kit repo - a backend service scaffolded from a starter template, a config repo based on a shared base, and so on. Swap in whatever names make sense for your project; `template` is just the remote name I chose, not a requirement.

## Why Not Just Fork the Upstream Repo?

The usual advice for this kind of setup is: fork the upstream repo, then build your project inside the fork. That way, your repo *is* a fork, and pulling upstream changes is just a routine "sync fork" operation.

That advice assumes you're starting fresh. I wasn't. My repo was already live, with its own commit history going back years, long before I decided to move it onto an open-source template published on GitHub. There was no clean way to retroactively turn an existing, live repo into a fork of a repo that didn't exist yet when mine was created - and I wasn't willing to throw away my history just to get a tidier Git relationship.

So instead of forking, I linked the histories after the fact: added the upstream repo as a second remote on my existing repo, did the initial merge, and set up `.gitattributes` with a custom merge driver so my content wouldn't get overwritten by the upstream repo's own files going forward. If you're in the same boat - an existing repo that you want to start tracking an external template from, without recreating it as a fork - this is the pattern that worked for me.

## Initial Setup (One-Time)

This part only needs to happen once, on the repo itself, and it's what makes everything else possible.

1. **Add a `.gitattributes` file** at the root of your repo that marks the paths you want protected with the `merge=ours` strategy - for example:
   ```
   content/** merge=ours
   static/images/** merge=ours
   config.toml merge=ours
   ```
   Adjust the paths to match your own project's layout.

2. **Register the custom merge driver locally** so Git knows how to apply the rule:
   ```bash
   git config merge.ours.driver true
   ```

3. **Commit and push `.gitattributes`:**
   ```bash
   git add .gitattributes
   git commit -m "Add merge=ours rules to protect personal content during template sync"
   git push
   ```

Once `.gitattributes` is committed and pushed, it's a permanent part of your repo's history - it travels with every future clone. You won't need to redo this step again, even on a fresh machine. What *doesn't* travel automatically is the remote pointing to the upstream repo, and the local merge driver registration - that's the part covered next.

## Setting This Up on a New Machine (or Fresh Clone)

Git remotes and local Git config don't travel with a repo - only tracked files like `.gitattributes` do. So on a new clone, you need to re-run two commands:

1. **Add the upstream repo as a remote:**
   ```bash
   git remote add template https://github.com/your-username/your-upstream-repo.git
   ```
   (Name it whatever makes sense to you - `template`, `upstream`, `theme`, etc. Just stay consistent with whatever name you use in the commands below.)

2. **Register the custom merge driver:**
   This tells Git how to honor the `merge=ours` rule defined in `.gitattributes`, so your own content is protected whenever you merge in upstream changes.
   ```bash
   git config merge.ours.driver true
   ```

## Ongoing Sync: Pulling Updates from Upstream

Once the remote and merge driver are set up, syncing is just two steps:

1. **Fetch the latest upstream changes:**
   ```bash
   git fetch template
   ```

2. **Merge the updates:**
   ```bash
   git merge template/master
   ```
   (Use whatever the upstream repo's default branch is called - `main`, `master`, etc.)

The `.gitattributes` rules do the heavy lifting here - they automatically prevent your own folders and files (in my case, things like `content/`, `static/images/`, and `config.toml`) from being overwritten during the merge. If you want to exclude (or stop excluding) other files or folders from future syncs, just edit `.gitattributes` to match your own project's layout.

That's it - no manual cherry-picking, no diffing upstream changes by hand. The merge driver keeps your content safe by default, and you opt files in or out as your setup evolves.

Flush!
