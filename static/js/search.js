// ── Search ─────────────────────────────────────────────
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
    const fullPlaceHolder = "Search posts, projects, travel…";

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

    function sanitize(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function initSearchIndex() {
        if (searchIndex) return;
        if (typeof elasticlunr !== 'undefined' && typeof window.searchIndex !== 'undefined') {
            searchIndex = elasticlunr.Index.load(window.searchIndex);
        }
    }

    function openSearch() {
        searchResults.innerHTML = '<div class="search-empty-state">Start typing to search</div>';
        searchInput.value = '';
        searchModal.classList.add('active');
        document.body.classList.add('no-scroll');
        
        typePlaceHolder();

        if (window.__searchLoaded && window.__searchLoaded()) {
            initSearchIndex();
            setTimeout(() => {
                searchInput.focus();
            }, 100);
        } else {
            searchResults.innerHTML = '<div class="search-empty-state">Indexing…</div>';
            searchInput.disabled = true;
            if (window.__loadSearch) {
                window.__loadSearch(function() {
                    initSearchIndex();
                    searchInput.disabled = false;
                    searchResults.innerHTML = '<div class="search-empty-state">Start typing to search</div>';
                    setTimeout(() => {
                        searchInput.focus();
                    }, 100);
                });
            }
        }
    }

    function closeSearch() {
        searchModal.classList.remove('active');
        
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
            } else if (!item.url.match(/^https?:\/\//)) {
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
            searchResults.innerHTML = '<div class="search-empty-state">Start typing to search</div>';
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
            searchResults.innerHTML = '<div class="search-empty-state">No results found for "' + sanitize(query) + '"</div>';
            return;
        }

        const grouped = {};
        results.forEach(r => {
            if (!grouped[r.category]) grouped[r.category] = [];
            grouped[r.category].push(r);
        });

        let html = '';
        categoryOrder.forEach(cat => {
            if (!grouped[cat]) return;
            html += '<div class="search-group">';
            html += '<h3 class="search-group-title">' + sanitize(cat) + ' <span class="search-group-count">(' + grouped[cat].length + ')</span></h3>';
            grouped[cat].forEach(item => {
                const isExternal = item.url && (item.url.startsWith('http://') || item.url.startsWith('https://'));
                const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
                html += '<a href="' + sanitize(item.url) + '"' + targetAttr + ' class="search-result-item" role="option">';
                html += '<span class="search-result-title">' + sanitize(item.title) + '</span>';
                if (item.description) {
                    html += '<span class="search-result-desc">' + sanitize(item.description).substring(0, 120) + '</span>';
                }
                html += '</a>';
            });
            html += '</div>';
        });

        searchResults.innerHTML = html;
    }

    searchBtns.forEach(btn => btn.addEventListener('click', openSearch));
    if (searchClose) searchClose.addEventListener('click', closeSearch);
    if (searchBackdrop) searchBackdrop.addEventListener('click', closeSearch);

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => performSearch(this.value.trim()), 250);
        });
    }

    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            if (searchModal && searchModal.classList.contains('active')) {
                closeSearch();
            } else if (searchModal) {
                openSearch();
            }
        }
        if (e.key === 'Escape' && searchModal && searchModal.classList.contains('active')) {
            e.preventDefault();
            closeSearch();
        }
    });

    if (searchModal) {
        searchModal.addEventListener('keydown', function (e) {
            if (!searchModal.classList.contains('active')) return;

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
    }
})();
