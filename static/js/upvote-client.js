// static/js/upvote-client.js
// Client-side upvote handler for Zola-Slate (runs in the reader's browser).
//
// - The server is the source of truth. The UI updates optimistically on click
//   and is rolled back if the vote is not confirmed.
// - The anonymous voter token and the "already upvoted" flag live in
//   localStorage, with an in-memory fallback when storage is unavailable.
// - The honeypot field is pre-filled by the template and cleared on real user
//   interaction; bots that never interact send it filled and are rejected.
(function () {
  'use strict';

  const DWELL_MS = 1500; // votes are sent no earlier than this after page load
  const MESSAGE_MS = 5000; // how long an error message stays in the tooltip
  const TOKEN_RE = /^vtr_[a-f0-9]{32}$/;

  const TEXT = {
    idle: 'Upvote this article',
    voted: 'You upvoted this article',
    limited: 'Upvote request throttled. Please try later.',
    failed: 'Upvote failed. Please try later.',
  };

  // localStorage that never throws (Safari private mode, blocked storage, ...).
  const store = (() => {
    const mem = {};
    return {
      get(key) {
        try {
          const v = window.localStorage.getItem(key);
          if (v !== null) return v;
        } catch (_) {
          /* fall through to memory */
        }
        return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
      },
      set(key, value) {
        mem[key] = value;
        try {
          window.localStorage.setItem(key, value);
        } catch (_) {
          /* memory fallback only */
        }
      },
      remove(key) {
        delete mem[key];
        try {
          window.localStorage.removeItem(key);
        } catch (_) {
          /* ignore */
        }
      },
    };
  })();

  function randomHex(byteCount) {
    const bytes = new Uint8Array(byteCount);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Persistent anonymous device token: "vtr_" + 32 hex chars (the format the
  // server validates). Anything stored in an older format is replaced.
  function getVoterToken() {
    let token = store.get('voter_token');
    if (!token || !TOKEN_RE.test(token)) {
      token = 'vtr_' + randomHex(16);
      store.set('voter_token', token);
    }
    return token;
  }

  function initUpvote() {
    const form = document.getElementById('upvote-form');
    const btn = document.getElementById('upvote-btn');
    const countEl = document.getElementById('upvote-count');
    if (!form || !btn || !countEl) return;

    const postId = form.dataset.id;
    const apiUrl = form.dataset.api;
    if (!postId || !apiUrl) {
      console.warn('upvote: missing data-id or data-api on #upvote-form');
      return;
    }

    const storageKey = 'upvoted_' + postId;
    const honeypot = form.querySelector('input[name="title"]');
    const voterToken = getVoterToken();
    const pageLoadTime = Date.now();

    let inFlight = false; // a vote request is pending
    let votedThisSession = false; // the server confirmed a vote in this page view
    let messageTimer = null;

    const readCount = () => parseInt(countEl.textContent, 10) || 0;
    const setCount = (n) => {
      countEl.textContent = String(n);
    };

    // Keep the custom tooltip text in sync if it is currently showing.
    function syncVisibleTooltip(text) {
      const tooltipEl = document.querySelector('.custom-tooltip');
      if (tooltipEl && tooltipEl.classList.contains('visible')) tooltipEl.textContent = text;
    }

    function setLabel(text) {
      btn.setAttribute('data-title', text);
      btn.setAttribute('aria-label', text);
      btn.removeAttribute('title');
      syncVisibleTooltip(text);
    }

    function setUpvotedState(isUpvoted) {
      if (isUpvoted) {
        btn.classList.add('upvoted');
        btn.setAttribute('aria-pressed', 'true');
        btn.setAttribute('aria-disabled', 'true');
        setLabel(TEXT.voted);
      } else {
        btn.classList.remove('upvoted');
        btn.removeAttribute('aria-pressed');
        btn.removeAttribute('aria-disabled');
        setLabel(TEXT.idle);
      }
    }

    // Show an error in the tooltip/aria-label for a few seconds, then restore.
    function flashMessage(text) {
      clearTimeout(messageTimer);
      setLabel(text);
      messageTimer = setTimeout(() => {
        if (!btn.classList.contains('upvoted')) setLabel(TEXT.idle);
      }, MESSAGE_MS);
    }

    // Honeypot: cleared only by real user interaction.
    const clearHoneypot = () => {
      if (honeypot) honeypot.value = '';
    };
    ['mousemove', 'touchstart', 'keydown', 'pointerdown'].forEach((evt) =>
      window.addEventListener(evt, clearHoneypot, { once: true, passive: true })
    );

    // Instant UI from the local flag; the server reconciles it below.
    setUpvotedState(store.get(storageKey) === 'true');

    // Fetch the live count and reconcile with the server. Non-blocking, and a
    // failure leaves the current UI untouched.
    function loadState() {
      const url =
        apiUrl +
        '?id=' +
        encodeURIComponent(postId) +
        '&voterToken=' +
        encodeURIComponent(voterToken);

      fetch(url, { headers: { Accept: 'application/json' } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          // This response may have been computed before the user's vote. Once a
          // vote is in flight or confirmed, the POST result owns the UI.
          if (inFlight || votedThisSession) return;

          if (typeof data.count === 'number') setCount(data.count);

          if (data.hasVoted) {
            store.set(storageKey, 'true');
            setUpvotedState(true);
          } else {
            store.remove(storageKey);
            setUpvotedState(false);
          }
        })
        .catch(() => {
          /* offline or API unavailable: keep whatever the UI shows */
        });
    }

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(loadState, { timeout: 2000 });
    } else {
      setTimeout(loadState, 0);
    }

    function rollback(previousCount, data) {
      setUpvotedState(false);
      setCount(data && typeof data.count === 'number' ? data.count : previousCount);
    }

    function sendVote(previousCount) {
      fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: postId,
          voterToken: voterToken,
          title: honeypot ? honeypot.value : '', // must be empty
        }),
      })
        .then((res) =>
          res
            .json()
            .catch(() => null)
            .then((data) => ({ ok: res.ok, status: res.status, data }))
        )
        .then(({ ok, status, data }) => {
          inFlight = false;

          if (ok && data && data.hasVoted) {
            // 'voted' or 'duplicate' (already voted on this device): either
            // way the server has the vote. Use its authoritative count.
            if (typeof data.count === 'number') setCount(data.count);
            votedThisSession = true;
            store.set(storageKey, 'true');
            setUpvotedState(true);
            return;
          }

          rollback(previousCount, data);
          flashMessage(status === 429 ? TEXT.limited : TEXT.failed);
        })
        .catch(() => {
          inFlight = false;
          rollback(previousCount, null);
          flashMessage(TEXT.failed);
        });
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      // Ignore script-generated clicks (element.click() from a bot). Assistive
      // technology and keyboard activation are trusted events and still work.
      if (!e.isTrusted) return;
      if (inFlight || btn.classList.contains('upvoted')) return;

      clearHoneypot();
      inFlight = true;

      // Optimistic update.
      const previousCount = readCount();
      setUpvotedState(true);
      setCount(previousCount + 1);

      // Dwell-time bot trap: an early click is not dropped, it is sent once
      // DWELL_MS has passed since page load.
      const wait = Math.max(0, DWELL_MS - (Date.now() - pageLoadTime));
      setTimeout(() => sendVote(previousCount), wait);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpvote, { once: true });
  } else {
    initUpvote();
  }
})();