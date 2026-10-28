// static/js/upvote-client.js
// Client-side upvote handler for Zola-Slate (running in the reader's browser)
// Non-blocking, anti-tampering verified, custom-tooltip integrated.
(function () {
  function initUpvote() {
    const form = document.getElementById('upvote-form');
    const btn = document.getElementById('upvote-btn');
    const countEl = document.getElementById('upvote-count');
    if (!form || !btn || !countEl) return;

    const postId = form.dataset.id;
    const apiUrl = form.dataset.api;
    const storageKey = 'upvoted_' + postId;
    const honeypot = form.querySelector('input[name="title"]');

    const pageLoadTime = Date.now();
    let serverToken = ''; // Signed cryptographic token to prevent post ID tampering

    // Helper: Update button state and custom tooltip data-title
    function setUpvotedState(isUpvoted) {
      if (isUpvoted) {
        btn.classList.add('upvoted');
        btn.setAttribute('aria-pressed', 'true');
        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('data-title', 'You upvoted this article');
        btn.setAttribute('aria-label', 'You upvoted this article');
        btn.removeAttribute('title');
      } else {
        btn.classList.remove('upvoted');
        btn.removeAttribute('aria-pressed');
        btn.removeAttribute('aria-disabled');
        btn.setAttribute('data-title', 'Upvote this article');
        btn.setAttribute('aria-label', 'Upvote this article');
        btn.removeAttribute('title');
      }
    }

    // 1. Get or generate persistent anonymous voter token (device-level, VPN/IP-independent)
    function getVoterToken() {
      let token = localStorage.getItem('voter_token');
      if (!token) {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
          token = 'vtr_' + window.crypto.randomUUID().replace(/-/g, '');
        } else {
          token = 'vtr_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        }
        localStorage.setItem('voter_token', token);
      }
      return token;
    }

    const voterToken = getVoterToken();

    // 2. Anti-bot honeypot: clear honeypot field only on real human user interaction
    const clearHoneypot = () => {
      if (honeypot) honeypot.value = '';
    };
    window.addEventListener('mousemove', clearHoneypot, { once: true });
    window.addEventListener('touchstart', clearHoneypot, { once: true });
    window.addEventListener('keydown', clearHoneypot, { once: true });

    // 3. Instant UI feedback from localStorage:
    if (localStorage.getItem(storageKey) === 'true') {
      setUpvotedState(true);
    } else {
      setUpvotedState(false);
    }

    // 4. Asynchronously fetch live count and reconcile state with PostgreSQL
    if (apiUrl) {
      const fetchUrl = `${apiUrl}?id=${encodeURIComponent(postId)}&voterToken=${encodeURIComponent(voterToken)}`;
      fetch(fetchUrl)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;

          // Save signed security token for tampering prevention
          if (data.token) {
            serverToken = data.token;
          }

          // Always display latest fresh count from database
          if (typeof data.count === 'number') {
            countEl.textContent = data.count;
          }

          // Reconcile with authoritative database:
          if (data.dbStatus === 'online') {
            if (data.hasVoted) {
              localStorage.setItem(storageKey, 'true');
              setUpvotedState(true);
            } else {
              localStorage.removeItem(storageKey);
              setUpvotedState(false);
            }
          } else {
            // DB is offline or not configured: do not lock in localStorage
            localStorage.removeItem(storageKey);
            setUpvotedState(false);
          }
        })
        .catch(() => {
          // If offline or local zola serve (404), do not permanently lock the button
          localStorage.removeItem(storageKey);
          setUpvotedState(false);
          if (countEl.textContent === '—') {
            countEl.textContent = '0';
          }
        });
    }

    // 5. Handle upvote interaction
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('upvoted')) return;

      // Dwell-time check: ignore clicks occurring within 1.5 seconds of page load (bot trap)
      if (Date.now() - pageLoadTime < 1500) return;

      // Optimistic UI update for current session
      setUpvotedState(true);

      // Update custom tooltip immediately if currently visible while hovering
      const tooltipEl = document.querySelector('.custom-tooltip');
      if (tooltipEl && tooltipEl.classList.contains('visible')) {
        tooltipEl.textContent = 'You upvoted this article';
      }

      const currentCount = parseInt(countEl.textContent, 10) || 0;
      countEl.textContent = currentCount + 1;

      // Dispatch vote to backend with tamper-proof signed token
      fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: postId,
          voterToken: voterToken,
          token: serverToken, // Anti-tampering token issued on GET
          title: honeypot ? honeypot.value : '', // Honeypot: must be empty
        }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.count === 'number') {
            countEl.textContent = data.count;
          }

          // Only commit permanently to localStorage if DB actually saved it!
          if (data && data.dbStatus === 'online' && data.hasVoted) {
            localStorage.setItem(storageKey, 'true');
            setUpvotedState(true);
          } else {
            // DB is offline/unreachable: do not lock in localStorage
            localStorage.removeItem(storageKey);
          }
        })
        .catch(() => {
          // Network failed or local 404: do not lock in localStorage
          localStorage.removeItem(storageKey);
        });
    });
  }

  // Defer execution until browser has completed initial rendering
  if ('requestIdleCallback' in window) {
    requestIdleCallback(initUpvote);
  } else if (document.readyState === 'complete') {
    initUpvote();
  } else {
    window.addEventListener('load', initUpvote);
  }
})();
