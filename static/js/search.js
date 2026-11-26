// ── Search ─────────────────────────────────────────────────────────
(function () {
    const searchBtns = document.querySelectorAll('.search-btn');
    const searchModal = document.getElementById('search-modal');
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const searchClose = document.querySelector('.search-close');
    const searchBackdrop = document.querySelector('.search-modal-backdrop');
    const searchDataEl = document.getElementById('search-data');

    if (searchBtns.length === 0 || !searchModal || !searchDataEl) return;

    let searchData = {};
    try {
        searchData = JSON.parse(searchDataEl.textContent);
    } catch (e) {
        console.error('Failed to parse search data', e);
        searchData = { projects: [], menu: [] };
    }

    const projectData = searchData.projects || [];
    const servicesData = searchData.services || [];
    const menuData = searchData.menu || [];

    // Precompute menu names and category order
    let projectsMenuName = 'Projects';
    let servicesMenuName = 'Services';
    const categoryOrder = [];
    menuData.forEach(item => {
        categoryOrder.push(item.name);
        if (item.url.includes("projects")) {
            projectsMenuName = item.name;
        }
        if (item.url.includes("services")) {
            servicesMenuName = item.name;
        }
    });
    categoryOrder.push('Other');

    let searchIndex = null;
    let debounceTimer = null;
    let typeInterval = null;
    const fullPlaceHolder = (searchInput && searchInput.getAttribute('placeholder')) || "Type to Search…";

    function typePlaceHolder() {
        searchInput.setAttribute('placeholder', '');
        let i = 0;
        clearInterval(typeInterval);
        typeInterval = setInterval(() => {
            searchInput.setAttribute('placeholder', fullPlaceHolder.substring(0, i + 1));
            i++;
            if (i >= fullPlaceHolder.length) {
                clearInterval(typeInterval);
            }
        }, 45);
    }

    function renderEmptyState(message) {
        const empty = document.createElement('div');
        empty.className = 'search-empty-state';
        empty.textContent = message;
        searchResults.replaceChildren(empty);
    }

    function isSafeUrl(url) {
        if (!url || typeof url !== 'string') return false;
        const trimmed = url.trim();
        if (/^\s*javascript:/i.test(trimmed) || /^\s*data:/i.test(trimmed)) return false;
        return /^(https?:\/\/|\/|#)/i.test(trimmed);
    }

    function initSearchIndex() {
        if (searchIndex) return;
        if (typeof elasticlunr !== 'undefined' && typeof window.searchIndex !== 'undefined') {
            searchIndex = elasticlunr.Index.load(window.searchIndex);
        }
    }

    function openSearch() {
        renderEmptyState('Start typing to search');
        searchInput.value = '';
        
        if (typeof searchModal.showModal === 'function') {
            if (!searchModal.open) {
                searchModal.showModal();
            }
        }
        searchModal.classList.add('active');
        document.body.classList.add('no-scroll');
        
        typePlaceHolder();

        if (window.__searchLoaded && window.__searchLoaded()) {
            initSearchIndex();
            setTimeout(() => {
                searchInput.focus();
            }, 100);
        } else {
            renderEmptyState('Indexing…');
            searchInput.disabled = true;
            if (window.__loadSearch) {
                window.__loadSearch(function() {
                    initSearchIndex();
                    searchInput.disabled = false;
                    renderEmptyState('Start typing to search');
                    setTimeout(() => {
                        searchInput.focus();
                    }, 100);
                });
            }
        }
    }

    function closeSearch() {
        searchModal.classList.remove('active');
        if (typeof searchModal.close === 'function' && searchModal.open) {
            searchModal.close();
        }
        
        const navItems = document.querySelector('.nav-items');
        if (navItems && navItems.classList.contains('active')) {
            // Keep overflow hidden if mobile menu is open
        } else {
            document.body.classList.remove('no-scroll');
        }
    }

    function getCategory(url) {
        for (const item of menuData) {
            if (item.url === '/') {
                if (url === '/') return item.name;
            } else if (!item.url.match(/^https?:/)) {
                if (url.includes(item.clean_url)) return item.name;
            }
        }
        return 'Other';
    }

    function searchProjects(query) {
        const q = query.toLowerCase();
        return projectData.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.language.toLowerCase().includes(q)
        ).map(p => ({
            title: p.name,
            description: p.description,
            url: p.url,
            github: p.github || "",
            category: projectsMenuName
        }));
    }

    function searchServices(query) {
        const q = query.toLowerCase();
        return servicesData.filter(s =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q)
        ).map(s => ({
            title: s.name,
            description: s.description,
            url: s.url,
            github: s.github || "",
            category: servicesMenuName
        }));
    }

    function performSearch(query) {
        if (!query || query.length < 2) {
            renderEmptyState('Start typing to search');
            return;
        }

        let results = [];

        if (searchIndex) {
            const elasticResults = searchIndex.search(query, {
                fields: { title: { boost: 3 }, body: { boost: 1 } },
                bool: 'OR',
                expand: true
            });

            results = elasticResults.slice(0, 20).map(r => {
                const item = searchIndex.documentStore.getDoc(r.ref);
                let resultUrl = r.ref;
                try {
                    const parsed = new URL(r.ref);
                    resultUrl = parsed.pathname;
                } catch(e) { /* relative path */ }
                return {
                    title: item.title,
                    description: item.body ? item.body.substring(0, 150) + '…' : '',
                    url: resultUrl,
                    category: getCategory(r.ref)
                };
            });
        }

        const projectResults = searchProjects(query).slice(0, 10);
        const serviceResults = searchServices(query).slice(0, 10);
        const existingItems = new Set(results.map(r => r.title + '|' + r.url + '|' + (r.github || "")));
        
        projectResults.forEach(p => {
            const key = p.title + '|' + p.url + '|' + p.github;
            if (!existingItems.has(key)) {
                existingItems.add(key);
                results.push(p);
            }
        });
        
        serviceResults.forEach(s => {
            const key = s.title + '|' + s.url + '|' + s.github;
            if (!existingItems.has(key)) {
                existingItems.add(key);
                results.push(s);
            }
        });

        if (results.length === 0) {
            renderEmptyState('No results found for "' + query + '"');
            return;
        }

        const grouped = {};
        results.forEach(r => {
            if (!grouped[r.category]) grouped[r.category] = [];
            grouped[r.category].push(r);
        });

        const fragment = document.createDocumentFragment();
        categoryOrder.forEach(cat => {
            if (!grouped[cat]) return;
            const groupEl = document.createElement('div');
            groupEl.className = 'search-group';

            const headingEl = document.createElement('h3');
            headingEl.className = 'search-group-title';
            headingEl.appendChild(document.createTextNode(cat + ' '));

            const countEl = document.createElement('span');
            countEl.className = 'search-group-count';
            countEl.textContent = '(' + grouped[cat].length + ')';
            headingEl.appendChild(countEl);
            groupEl.appendChild(headingEl);

            grouped[cat].forEach(item => {
                const rawUrl = isSafeUrl(item.url) ? item.url : '#';
                const isExternal = rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'));

                const linkEl = document.createElement('a');
                linkEl.href = rawUrl;
                linkEl.className = 'search-result-item';
                linkEl.setAttribute('role', 'option');
                if (isExternal) {
                    linkEl.target = '_blank';
                    linkEl.rel = 'noopener noreferrer';
                }

                const titleEl = document.createElement('span');
                titleEl.className = 'search-result-title';
                titleEl.textContent = item.title;
                linkEl.appendChild(titleEl);

                if (item.description) {
                    const descEl = document.createElement('span');
                    descEl.className = 'search-result-desc';
                    descEl.textContent = String(item.description).slice(0, 120);
                    linkEl.appendChild(descEl);
                }

                groupEl.appendChild(linkEl);
            });

            fragment.appendChild(groupEl);
        });

        searchResults.replaceChildren(fragment);
    }

    searchBtns.forEach(btn => btn.addEventListener('click', openSearch));
    if (searchClose) searchClose.addEventListener('click', closeSearch);
    if (searchBackdrop) searchBackdrop.addEventListener('click', closeSearch);

    searchModal.addEventListener('cancel', function(e) {
        e.preventDefault();
        closeSearch();
    });

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => performSearch(this.value.trim()), 250);
        });
    }

    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            const isOpen = searchModal.open || searchModal.classList.contains('active');
            if (isOpen) {
                closeSearch();
            } else {
                openSearch();
            }
        }
        if (e.key === 'Escape') {
            const isOpen = searchModal.open || searchModal.classList.contains('active');
            if (isOpen) {
                e.preventDefault();
                closeSearch();
            }
        }
    });

    searchModal.addEventListener('keydown', function (e) {
        const isOpen = searchModal.open || searchModal.classList.contains('active');
        if (!isOpen) return;

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const results = Array.from(searchResults.querySelectorAll('.search-result-item'));
            if (results.length === 0) return;
            
            e.preventDefault();
            const active = document.activeElement;
            const currentIndex = results.indexOf(active);
            let nextIndex = 0;

            if (e.key === 'ArrowDown') {
                nextIndex = currentIndex < results.length - 1 ? currentIndex + 1 : 0;
            } else {
                nextIndex = currentIndex > 0 ? currentIndex - 1 : results.length - 1;
            }
            results[nextIndex].focus();
            return;
        }

        if (e.key === 'Tab') {
            const focusable = Array.from(
                searchModal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')
            ).filter(el => !el.closest('[aria-hidden="true"]'));

            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === first || document.activeElement === searchModal) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    });
})();
