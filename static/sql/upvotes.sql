-- ==============================================================================
-- Upvote schema for Zola-Slate (PostgreSQL / Neon)
-- ==============================================================================
--
-- Fresh-install script. Safe to re-run (CREATE ... IF NOT EXISTS), it never
-- drops data.
--
-- RESET (destructive, only while the tables hold no real votes):
--   DROP TABLE IF EXISTS ip_quota;
--   DROP TABLE IF EXISTS article_voters;
--   DROP TABLE IF EXISTS article_upvotes;
-- then run the rest of this file.
--
-- Changes vs. the previous schema:
--   * article_voters: composite PRIMARY KEY (post_id, voter_token) replaces the
--     SERIAL id + UNIQUE constraint + duplicate index (the PK already provides
--     the index). ip_hash is gone: no IP-derived data is stored next to a vote.
--   * ip_quota (new): per-IP hourly counters used for the rate caps. Updated
--     atomically inside the vote statement, so concurrent requests cannot
--     exceed a cap. Rows hold only a keyed hash of the IP and a count, and the
--     server deletes them a couple of hours after their window ends.
--   * CHECK (count >= 0) on the counter; column sizes match the validation in
--     the Pages Function (post id <= 200 chars, token = "vtr_" + 32 hex).
-- ==============================================================================

-- 1. Aggregated upvote count per post (O(1) reads).
CREATE TABLE IF NOT EXISTS article_upvotes (
    id          VARCHAR(200) PRIMARY KEY,
    count       INTEGER      NOT NULL DEFAULT 0 CHECK (count >= 0),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2. One row per (post, anonymous device token). The PK is what makes a vote
--    idempotent. The server inserts here and bumps the counter in ONE
--    statement, so the counter cannot drift from this table.
CREATE TABLE IF NOT EXISTS article_voters (
    post_id      VARCHAR(200) NOT NULL,
    voter_token  VARCHAR(40)  NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, voter_token)
);

-- 3. Per-IP rate-limit counters, one row per (hashed IP, scope, UTC hour).
--    scope = a post id (per-post cap) or '*' (all-posts cap).
CREATE TABLE IF NOT EXISTS ip_quota (
    ip_hash       VARCHAR(64)  NOT NULL,
    scope         VARCHAR(200) NOT NULL,
    window_start  TIMESTAMPTZ  NOT NULL,
    n             INTEGER      NOT NULL DEFAULT 0,
    PRIMARY KEY (ip_hash, scope, window_start)
);

-- ==============================================================================
-- Maintenance queries
-- ==============================================================================

-- Top 10 posts:
-- SELECT id, count, updated_at FROM article_upvotes ORDER BY count DESC LIMIT 10;

-- Drift check (should return no rows):
-- SELECT u.id, u.count, COUNT(v.*) AS voters
-- FROM article_upvotes u LEFT JOIN article_voters v ON v.post_id = u.id
-- GROUP BY u.id, u.count HAVING u.count <> COUNT(v.*);

-- Remove all test votes for a post:
-- DELETE FROM article_voters WHERE post_id = 'posts/hello-world';
-- UPDATE article_upvotes SET count = 0, updated_at = NOW() WHERE id = 'posts/hello-world';