#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["requests"]
# ///

"""
Fetch all public GitHub repositories for a user and generate TOML entries.
Sorts repositories by last updated date in descending order.

Usage:
    uv run scripts/fetch_all_github_projects.py [username]
    
Example:
    uv run scripts/fetch_all_github_projects.py johndoe
"""

import json
import sys
import time
import tomllib
from datetime import datetime
from pathlib import Path
import requests

def fetch_all_repos(username: str) -> list:
    """
    Fetch all public repositories for a GitHub user.
    
    Args:
        username: GitHub username
        
    Returns:
        List of repository data
    """
    repos = []
    page = 1
    per_page = 100
    
    print(f"Fetching repositories for {username}...", file=sys.stderr)
    
    while True:
        url = f"https://api.github.com/users/{username}/repos"
        params = {
            'page': page,
            'per_page': per_page,
            'type': 'owner',
            'sort': 'pushed',
            'direction': 'desc'
        }
        
        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if not data:
                break
                
            repos.extend(data)
            
            print(f"  Fetched page {page} ({len(data)} repos)", file=sys.stderr)
            
            if len(data) < per_page:
                break
                
            page += 1
            time.sleep(0.5)  # Rate limiting
            
        except Exception as e:
            print(f"Error fetching repos: {e}", file=sys.stderr)
            break
    
    return repos

def fetch_languages(repo: dict) -> list:
    """
    Fetch all languages for a repository, sorted by bytes (descending).

    Args:
        repo: Repository data from GitHub API

    Returns:
        List of language names (excluding "Other")
    """
    url = repo.get("languages_url", "")
    if not url:
        return []

    try:
        response = requests.get(url)
        response.raise_for_status()
        languages = response.json()  # e.g. {"TypeScript": 45000, "HTML": 12000}
        # Sort by bytes descending, filter out "Other"
        sorted_langs = sorted(languages.items(), key=lambda x: x[1], reverse=True)
        return [name for name, _ in sorted_langs if name != "Other"]
    except Exception as e:
        print(f"  Warning: Could not fetch languages for {repo.get('name')}: {e}", file=sys.stderr)
        # Fall back to primary language
        primary = repo.get("language", "")
        return [primary] if primary else []

def format_date(date_str: str) -> str:
    """
    Format ISO date string to Month Year format.
    
    Args:
        date_str: ISO format date string
        
    Returns:
        Formatted date string (e.g., "Jan 2024")
    """
    if not date_str:
        return ""
    
    try:
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        return dt.strftime("%b %Y")
    except Exception:
        return ""

def should_include_repo(repo: dict) -> bool:
    """
    Filter to determine if a repository should be included.
    
    Args:
        repo: Repository data from GitHub API
        
    Returns:
        True if the repo should be included
    """
    # Skip forks
    if repo.get('fork', False):
        return False
    
    # Skip repos with no description
    if not repo.get('description'):
        return False
    
    # Skip archived repos
    if repo.get('archived', False):
        return False
    
    return True

def generate_toml_entry(repo: dict) -> str:
    """
    Generate a TOML entry for a repository.
    
    Args:
        repo: Repository data from GitHub API
        
    Returns:
        TOML formatted string
    """
    lines = []
    lines.append("[[project]]")
    lines.append(f'name = "{repo["name"]}"')
    
    # Clean up description
    description = repo.get("description", "").replace('"', '\\"')
    lines.append(f'description = "{description}"')
    
    # Add created and pushed dates
    created_date = format_date(repo.get("created_at", ""))
    pushed_date = format_date(repo.get("pushed_at", ""))
    
    if created_date:
        lines.append(f'created = "{created_date}"')
    if pushed_date:
        lines.append(f'pushed = "{pushed_date}"')
    
    # Add star and fork counts
    stars = repo.get("stargazers_count", 0)
    forks = repo.get("forks_count", 0)
    lines.append(f'stars = {stars}')
    lines.append(f'forks = {forks}')
    
    # Add languages if present
    languages = repo.get("_languages", [])
    if languages:
        lines.append(f'language = "{", ".join(languages)}"')
    
    lines.append('links = [')
    
    # Add homepage if exists
    homepage = repo.get("homepage", "")
    if homepage and homepage.strip():
        lines.append(f'  {{ name = "Homepage", url = "{homepage}" }},')
    
    # Add GitHub link
    lines.append(f'  {{ name = "GitHub", url = "{repo["html_url"]}" }},')
    lines.append(']')
    
    return '\n'.join(lines)

def get_default_username() -> str:
    """Extract default GitHub username from config.toml."""
    try:
        config_path = Path(__file__).parent.parent / "config.toml"
        with open(config_path, "rb") as f:
            config = tomllib.load(f)
            github_url = config.get("extra", {}).get("github", "")
            if github_url:
                return github_url.strip("/").split("/")[-1]
    except Exception as e:
        print(f"Warning: Could not parse config.toml for github username: {e}", file=sys.stderr)
    return "johndoe"

def main():
    """Main function to process repositories."""
    
    # Get username from command line or default
    username = sys.argv[1] if len(sys.argv) > 1 else get_default_username()
    
    # Fetch all repositories
    repos = fetch_all_repos(username)
    
    if not repos:
        print("No repositories found", file=sys.stderr)
        sys.exit(1)
    
    # Filter repositories
    filtered_repos = [repo for repo in repos if should_include_repo(repo)]
    
    # Sort by pushed_at in descending order (most recently pushed first)
    filtered_repos.sort(key=lambda x: x.get('pushed_at', ''), reverse=True)
    
    print(f"Found {len(repos)} total repos, including {len(filtered_repos)} non-fork repos", file=sys.stderr)
    
    # Fetch all languages for each repo
    for repo in filtered_repos:
        repo["_languages"] = fetch_languages(repo)
        time.sleep(0.3)  # Rate limiting
    
    # Generate TOML output to new_projects.toml
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    output_path = project_root / "content" / "projects" / "new_projects.toml"

    with open(output_path, "w") as f:
        f.write("# GitHub Projects\n")
        f.write(f"# Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"# Total projects: {len(filtered_repos)}\n")
        f.write("\n")

        for repo in filtered_repos:
            f.write(generate_toml_entry(repo))
            f.write("\n\n")

    print(f"Wrote {len(filtered_repos)} projects to {output_path}", file=sys.stderr)

if __name__ == "__main__":
    main()