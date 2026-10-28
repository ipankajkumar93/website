-- ==============================================================================
-- Upvote Schema for Zola-Slate (PostgreSQL / Neon / Supabase)
-- ==============================================================================
--
-- This script creates the tables and indexes required to track article upvotes
-- and prevent duplicate votes using an anonymous device/voter token + IP hash.
--
-- Supported Databases: Neon, Supabase, Vercel Postgres, AWS Aurora, local Postgres.
-- This script is idempotent: running it multiple times is completely safe.
-- ==============================================================================

-- 1. Table: article_upvotes
-- Stores the aggregated upvote count for each post/article.
-- Provides fast O(1) reads without expensive COUNT(*) table scans.
CREATE TABLE IF NOT EXISTS article_upvotes (
    id VARCHAR(255) PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Table: article_voters
-- Stores anonymous voter tokens and hashed IP addresses to prevent duplicate voting.
-- Neither raw IP addresses nor personal data are stored, preserving visitor privacy.
CREATE TABLE IF NOT EXISTS article_voters (
    id SERIAL PRIMARY KEY,
    post_id VARCHAR(255) NOT NULL,
    voter_token VARCHAR(64) NOT NULL,
    ip_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_article_voter UNIQUE (post_id, voter_token)
);

-- Index for fast lookup by post and voter token
CREATE INDEX IF NOT EXISTS idx_article_voters_post_token
    ON article_voters (post_id, voter_token);

-- Index for fast lookup by post and IP hash (fallback / rate limiting)
CREATE INDEX IF NOT EXISTS idx_article_voters_post_ip
    ON article_voters (post_id, ip_hash);

-- ==============================================================================
-- Sample Queries for Verification and Maintenance
-- ==============================================================================

-- Fetch top 10 most upvoted posts
-- SELECT id, count, updated_at FROM article_upvotes ORDER BY count DESC LIMIT 10;

-- Reset or set count for a specific post
-- INSERT INTO article_upvotes (id, count, updated_at)
-- VALUES ('posts/hello-world', 1, NOW())
-- ON CONFLICT (id) DO UPDATE SET count = 1, updated_at = NOW();

-- Clear test votes for a specific post (if testing)
-- DELETE FROM article_voters WHERE post_id = 'posts/hello-world';
-- UPDATE article_upvotes SET count = 0 WHERE id = 'posts/hello-world';
