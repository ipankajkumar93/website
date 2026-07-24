// Lazy search loader - loads elasticlunr + search index without blocking page render
(function () {
    const meta = document.getElementById('search-config');
    if (!meta) return;

    const searchScripts = [
        meta.getAttribute('data-elasticlunr'),
        meta.getAttribute('data-search-index')
    ];
    let loaded = false;
    let callbacks = [];
    let isLoading = false;

    function loadSearchScripts(cb) {
        if (loaded) { if (cb) cb(); return; }
        if (cb) callbacks.push(cb);
        if (isLoading) return; // Prevent racing: already fetching

        isLoading = true;

        let remaining = searchScripts.length;
        function onLoad() {
            remaining--;
            if (remaining === 0) {
                loaded = true;
                isLoading = false;
                callbacks.forEach(function (fn) { fn(); });
                callbacks = [];
            }
        }

        // Load in order: elasticlunr first, then search index.
        const s1 = document.createElement('script');
        s1.src = searchScripts[0];
        s1.onload = function () {
            const s2 = document.createElement('script');
            s2.src = searchScripts[1];
            s2.onload = onLoad;
            document.body.appendChild(s2);
            onLoad();
        };
        document.body.appendChild(s1);
    }

    // Expose for search.html
    window.__loadSearch = loadSearchScripts;
    window.__searchLoaded = function () { return loaded; };

    // Strategy 1: Load during browser idle time (covers 90%+ of cases)
    if ('requestIdleCallback' in window) {
        requestIdleCallback(function () { loadSearchScripts(); }, { timeout: 3000 });
    } else {
        // Fallback: load after 1.5s
        setTimeout(function () { loadSearchScripts(); }, 1500);
    }

    // Strategy 2: Preload on hover/focus of search button
    const searchBtns = document.querySelectorAll('.search-btn');
    searchBtns.forEach(btn => {
        btn.addEventListener('mouseenter', function () { loadSearchScripts(); }, { once: true });
        btn.addEventListener('focus', function () { loadSearchScripts(); }, { once: true });
    });
})();
