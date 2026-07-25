# Template Sync Guide

This repository (`website`) is set up to pull upstream changes from the open-source `zola-slate` template repository while preserving your personal content and configuration. 

Because we've already done the initial history linkage, future updates are very straightforward.

## 💻 Setting this up on a New Machine (or Fresh Clone)
If you ever clone this repository to a new computer, the Git remotes and local Git config will not carry over automatically (only the files like `.gitattributes` carry over). You will need to re-run these two commands:

1. **Add the template remote:**
   ```bash
   git remote add template https://github.com/ipankajkumar93/zola-slate.git
   ```

2. **Register the custom merge driver:**
   This tells Git how to handle the `merge=ours` rule defined in `.gitattributes` so that your personal content is protected during a merge.
   ```bash
   git config merge.ours.driver true
   ```

---

## 🔄 Ongoing Sync (Pulling Updates from Template)
Whenever you make changes to `zola-slate` and want to bring those updates into this website, run the following:

1. **Fetch the latest template changes:**
   ```bash
   git fetch template
   ```

2. **Merge the updates:**
   ```bash
   git merge template/master
   ```
   *(Note: The custom `.gitattributes` rules we set up will automatically prevent your `content/`, `static/images/`, and `config.toml` from being overwritten by the template during this merge. Edit the content of `.gitattributes` to add or remove files/folders that should be excluded from the merge.)*
