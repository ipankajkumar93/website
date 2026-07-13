// ── Helpers ────────────────────────────────────────────────────────────────

// ── Theme Toggle ────────────────────────────────────────────────────────────
// main.js loads synchronously at the end of <body> so the DOM is fully
// available here. The icon is updated eagerly (before DOMContentLoaded)
// so the correct sun/moon icon renders without waiting for later init.
const themeToggle = document.querySelector('.theme-toggle');

if (themeToggle) {
    const activeTheme = document.documentElement.getAttribute('data-theme') || 'dark';

    if (activeTheme === 'dark') {
        // SVG is now managed by CSS and base.html template
    }
    // Sync aria-pressed to the actual theme on load (not hardcoded in HTML)
    themeToggle.setAttribute('aria-pressed', activeTheme === 'dark' ? 'true' : 'false');

    themeToggle.addEventListener('click', function () {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const theme = isDark ? 'light' : 'dark';

        document.body.classList.add('theme-transition');
        themeToggle.setAttribute('aria-pressed', isDark ? 'false' : 'true');

        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.style.colorScheme = theme;
        localStorage.setItem('theme', theme);

        // Sync the status-bar / browser chrome color with the active theme.
        // We update both media-prefixed <meta name="theme-color"> tags so
        // Android Chrome picks the right one regardless of the OS dark-mode setting.
        const themeColors = { dark: '#0C0A09', light: '#FAF9F7' };
        document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
            const mediaDark = meta.media && meta.media.includes('dark');
            meta.content = mediaDark ? themeColors.dark : themeColors.light;
        });

        setTimeout(() => document.body.classList.remove('theme-transition'), 500);
    });
}

// ── DOM-dependent functionality ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {

    // ── Focus Trap Helper ───────────────────────────────────────────────────
    function createFocusTrap(element) {
        element.addEventListener('keydown', function (e) {
            if (e.key === 'Tab') {
                const focusable = Array.from(
                    element.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')
                ).filter(el => !el.closest('[aria-hidden="true"]') && el.offsetWidth > 0);

                if (focusable.length === 0) return;

                const first = focusable[0];
                const last = focusable[focusable.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === first || document.activeElement === element) {
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

    // ── Lightbox ────────────────────────────────────────────────────────────
    const lightboxModal = document.createElement('div');
    lightboxModal.className = 'lightbox-modal';
    lightboxModal.setAttribute('role', 'dialog');
    lightboxModal.setAttribute('aria-modal', 'true');
    lightboxModal.innerHTML = '<button class="lightbox-close" aria-label="Close lightbox">&times;</button><img src="" alt="">';
    document.body.appendChild(lightboxModal);

    createFocusTrap(lightboxModal);

    const lightboxImg = lightboxModal.querySelector('img');
    const lightboxCloseBtn = lightboxModal.querySelector('.lightbox-close');

    document.querySelectorAll('a.lightbox-thumbnail').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            lightboxImg.src = this.getAttribute('href');
            lightboxImg.alt = this.querySelector('img')?.getAttribute('alt') || '';
            lightboxModal.classList.add('active');
            document.body.style.overflow = 'hidden';
            lightboxCloseBtn.focus();
        });
    });

    lightboxModal.addEventListener('click', function (e) {
        if (e.target === lightboxModal || e.target === lightboxCloseBtn) {
            closeLightbox();
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && lightboxModal.classList.contains('active')) {
            closeLightbox();
        }
    });

    function closeLightbox() {
        lightboxModal.classList.remove('active');
        document.body.style.overflow = '';
    }

    // ── Mobile Menu ─────────────────────────────────────────────────────────
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const mobileCloseBtn = document.querySelector('.mobile-close-btn');
    const navItems = document.querySelector('.nav-items');
    const mobileBackdrop = document.querySelector('.mobile-menu-backdrop');

    if (mobileMenuBtn) {
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
        mobileMenuBtn.addEventListener('click', openMobileMenu);
        mobileCloseBtn.addEventListener('click', closeMobileMenu);
        mobileBackdrop.addEventListener('click', closeMobileMenu);

        createFocusTrap(navItems);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && navItems.classList.contains('active')) {
                closeMobileMenu();
                mobileMenuBtn.focus();
            }
        });
    }

    function openMobileMenu() {
        navItems.classList.add('active');
        mobileBackdrop.classList.add('active');
        document.body.style.overflow = 'hidden';
        mobileMenuBtn.setAttribute('aria-expanded', 'true');
        mobileCloseBtn.focus();
    }

    function closeMobileMenu() {
        navItems.classList.remove('active');
        mobileBackdrop.classList.remove('active');
        document.body.style.overflow = '';
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
    }

    // ── Back to Top ─────────────────────────────────────────────────────────
    const backToTop = document.getElementById('back-to-top');

    if (backToTop) {
        // RAF-throttled scroll listener — avoids layout thrashing
        let scrollTicking = false;
        window.addEventListener('scroll', function () {
            if (!scrollTicking) {
                requestAnimationFrame(function () {
                    const scrollY = window.scrollY;
                    backToTop.classList.toggle('visible', scrollY > 100);

                    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
                    const scrollProgress = docHeight > 0 ? Math.min((scrollY / docHeight) * 100, 100) : 0;
                    backToTop.style.setProperty('--scroll-progress', scrollProgress + '%');

                    scrollTicking = false;
                });
                scrollTicking = true;
            }
        }, { passive: true });

        backToTop.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ── Responsive Tables ───────────────────────────────────────────────────
    // Wraps tables in a scrollable container; uses a CSS class (not inline
    // style) to suppress the table's own bottom margin inside the wrapper.
    document.querySelectorAll('table').forEach(table => {
        const wrapper = document.createElement('div');
        wrapper.className = 'table-responsive-wrapper';
        table.classList.add('in-wrapper');
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
    });

    const copyTemplate = document.getElementById('icon-copy');
    const checkTemplate = document.getElementById('icon-check');

    // ── Code Block Copy Button ──────────────────────────────────────────────
    document.querySelectorAll('pre').forEach(block => {
        if (block.querySelector('.copy-code-btn') || !block.querySelector('code')) return;

        const button = document.createElement('button');
        button.className = 'copy-code-btn';
        button.setAttribute('aria-label', 'Copy code');
        button.setAttribute('title', 'Copy to clipboard');
        if (copyTemplate) {
            button.appendChild(copyTemplate.content.cloneNode(true));
        }

        button.addEventListener('click', () => {
            const code = block.querySelector('code');
            if (!code) return;

            const textToCopy = code.textContent.trimEnd();

            const showSuccess = () => {
                button.innerHTML = '';
                if (checkTemplate) button.appendChild(checkTemplate.content.cloneNode(true));
                button.classList.add('copied');

                setTimeout(() => {
                    button.innerHTML = '';
                    if (copyTemplate) button.appendChild(copyTemplate.content.cloneNode(true));
                    button.classList.remove('copied');
                }, 2000);
            };

            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(textToCopy).then(showSuccess).catch(err => {
                    console.error('Failed to copy text: ', err);
                });
            } else {
                const textArea = document.createElement("textarea");
                textArea.value = textToCopy;
                textArea.style.position = "fixed";
                textArea.style.opacity = "0";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    document.execCommand('copy');
                    showSuccess();
                } catch (err) {
                    console.error('Fallback copy failed', err);
                }
                document.body.removeChild(textArea);
            }
        });

        block.appendChild(button);
    });

    // ── Code Block Line Diffs Highlighter(// [!code ++], // [!code --]) ───────────────

    // Regex to match the comment markers even if Syntect splits them into multiple HTML spans
    // Supports //, #, --, /* */, and <!-- -->
    const commentStart = '(?:\\/\\/|#|--|<!--|\\/\\*)';
    const commentEnd = '(?:-->|\\*\\/)?';
    const addRegex = new RegExp(`(?:<[^>]+>|\\s)*${commentStart}(?:<[^>]+>|\\s)*\\[!code(?:<[^>]+>|\\s)*\\+\\+(?:<[^>]+>|\\s)*\\](?:<[^>]+>|\\s)*${commentEnd}(?:<[^>]+>|\\s)*`, 'g');
    const removeRegex = new RegExp(`(?:<[^>]+>|\\s)*${commentStart}(?:<[^>]+>|\\s)*\\[!code(?:<[^>]+>|\\s)*--(?:<[^>]+>|\\s)*\\](?:<[^>]+>|\\s)*${commentEnd}(?:<[^>]+>|\\s)*`, 'g');

    document.querySelectorAll('pre code').forEach(codeBlock => {
        let html = codeBlock.innerHTML;
        if (!html.includes('[!code ++]') && !html.includes('[!code --]')) return;

        let lines = html.split('\n');
        let modified = false;

        // Remove trailing empty line often created by split
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }

        let newHtml = lines.map(line => {
            let className = 'line';
            let cleaned = line;


            if (line.includes('[!code ++]')) {
                modified = true;
                // Replace the match with ONLY the HTML tags it contained, preserving DOM structure
                cleaned = line.replace(addRegex, match => match.match(/<[^>]+>/g)?.join('') || '');
                className = 'line diff-add';
            } else if (line.includes('[!code --]')) {
                modified = true;
                cleaned = line.replace(removeRegex, match => match.match(/<[^>]+>/g)?.join('') || '');
                className = 'line diff-remove';
            }

            // To ensure empty lines still take up space vertically
            if (!cleaned.trim()) {
                cleaned = ' ';
            }
            // Add a display: none newline so that textContent (and copying) preserves line breaks
            // but the browser layout doesn't create extra gaps
            return `<span class="${className}">${cleaned}</span><span style="display: none;">\n</span>`;
        }).join('');

        if (modified) {
            codeBlock.innerHTML = newHtml;
            codeBlock.classList.add('has-diff');
        }
    });

    // ── Code Block Copy-Event Interceptor ───────────────────────────────────
    // CSS `white-space: pre-wrap` makes long lines wrap visually, but the
    // browser would normally insert \n at each visual break when the user
    // copies selected text. The handler below intercepts the native `copy`
    // event and writes the original unwrapped text to the clipboard instead,
    // so code executes correctly after pasting.
    document.addEventListener('copy', function (e) {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const range = selection.getRangeAt(0);
        const codeEl = range.commonAncestorContainer.nodeType === 1
            ? range.commonAncestorContainer.closest('pre code')
            : range.commonAncestorContainer.parentElement?.closest('pre code');
        if (!codeEl || !codeEl.contains(range.commonAncestorContainer)) return;

        const fragment = range.cloneContents();
        const tmp = document.createElement('div');
        tmp.appendChild(fragment);

        e.clipboardData.setData('text/plain', tmp.textContent);
        e.preventDefault();
    });

    // ── AJAX Pagination ─────────────────────────────────────────────────────
    let currentPageController = null;

    async function loadPage(url, isPopState = false) {
        const container = document.getElementById('pagination-container');
        if (!container) return;

        // Cancel any in-flight request to prevent race conditions
        if (currentPageController) {
            currentPageController.abort();
        }
        currentPageController = new AbortController();

        container.classList.add('loading');

        let isTimeout = false;
        try {
            const timeoutId = setTimeout(() => {
                isTimeout = true;
                if (currentPageController) currentPageController.abort();
            }, 15000);

            const response = await fetch(url, { signal: currentPageController.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error('Network response was not ok');

            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');

            const newContainer = doc.getElementById('pagination-container');
            if (newContainer) {
                container.innerHTML = newContainer.innerHTML;

                if (doc.title) {
                    document.title = doc.title;
                }

                if (!isPopState) {
                    window.history.pushState({ path: url }, '', url);
                    // Umami intercepts history.pushState natively — no manual track() needed
                }


                // Scroll to absolute top of the page
                window.scrollTo({ top: 0, behavior: 'smooth' });

            }
        } catch (error) {
            if (error.name === 'AbortError' && !isTimeout) return; // Intentional cancellation — do nothing
            console.error('Pagination fetch error:', error);
            window.location.href = url; // Fallback to full navigation
        } finally {
            container.classList.remove('loading');
            currentPageController = null;
        }
    }

    function initAjaxPagination() {
        const container = document.getElementById('pagination-container');
        if (!container) return;

        container.addEventListener('click', function (e) {
            const link = e.target.closest('a');
            if (!link || !link.href || link.classList.contains('disabled') || !link.closest('.pagination')) return;

            const url = new URL(link.href);
            if (url.origin !== window.location.origin) return;

            e.preventDefault();
            loadPage(url.href);
        });
    }

    // Handle back/forward buttons
    window.addEventListener('popstate', function (e) {
        if (e.state && e.state.path) {
            loadPage(e.state.path, true);
        } else {
            loadPage(window.location.href, true);
        }
    });

    // Initialize pagination if the container exists
    if (document.getElementById('pagination-container')) {
        window.history.replaceState({ path: window.location.href }, '', window.location.href);
        initAjaxPagination();
    }

    // TOC Sticky Observer & Toggle Logic
    const tocSentinel = document.getElementById('toc-sentinel');
    const toc = document.querySelector('.toc');
    if (toc) {
        if (tocSentinel) {
            const observer = new IntersectionObserver((entries) => {
                if (entries[0].boundingClientRect.top < 0) {
                    toc.classList.add('is-stuck');
                } else {
                    toc.classList.remove('is-stuck');
                }
            });
            observer.observe(tocSentinel);
        }

        const tocTitle = toc.querySelector('.toc-title');
        const tocInner = toc.querySelector('.toc-inner');
        if (tocTitle) {
            tocTitle.addEventListener('click', (e) => {
                e.stopPropagation();
                toc.classList.toggle('is-open');

                if (tocInner) {
                    if (toc.classList.contains('is-open')) {
                        setTimeout(() => {
                            // Only set if still open after transition
                            if (toc.classList.contains('is-open')) {
                                tocInner.style.overflowY = 'auto';
                            }
                        }, 300);
                    } else {
                        tocInner.style.overflowY = 'hidden';
                    }
                }
            });
        }

        // Close TOC on outside click or when clicking a link inside
        document.addEventListener('click', (e) => {
            if (toc.classList.contains('is-open')) {
                if (!toc.contains(e.target) || e.target.closest('a')) {
                    toc.classList.remove('is-open');
                    if (tocInner) tocInner.style.overflowY = 'hidden';
                }
            }
        });

        // ScrollSpy - TOC Active Link Highlighting
        const tocLinks = Array.from(toc.querySelectorAll('a'));
        const headings = tocLinks
            .map(link => document.getElementById(link.hash.substring(1)))
            .filter(h => h);

        if (headings.length > 0) {
            let activeHeadingId = null;
            let scrollTicking = false;

            const updateActiveLink = () => {
                let current = null;
                // Find the last heading that has scrolled past the top offset
                for (let h of headings) {
                    if (h.getBoundingClientRect().top <= 150) {
                        current = h.id;
                    }
                }
                // Fallback to first heading if at the very top
                if (!current && headings.length > 0) {
                    current = headings[0].id;
                }

                if (current !== activeHeadingId) {
                    activeHeadingId = current;
                    tocLinks.forEach(link => {
                        if (link.hash === '#' + current) {
                            link.classList.add('active');
                        } else {
                            link.classList.remove('active');
                        }
                    });
                }
                scrollTicking = false;
            };

            window.addEventListener('scroll', () => {
                if (!scrollTicking) {
                    requestAnimationFrame(updateActiveLink);
                    scrollTicking = true;
                }
            }, { passive: true });
            // Initial check
            updateActiveLink();
        }
    }

    // ── Taxonomy Filter Logic ───────────────────────────────────────────────
    const filterClear = document.getElementById('filter-clear');
    if (filterClear && new URLSearchParams(window.location.search).get('ref') === 'topics') {
        const topicsUrl = filterClear.getAttribute('data-topics-url');
        if (topicsUrl) {
            filterClear.href = topicsUrl;
        }
        const defaultView = document.getElementById('default-taxonomy-view');
        const unifiedView = document.getElementById('unified-topics-view');
        if (defaultView) defaultView.style.display = 'none';
        if (unifiedView) unifiedView.style.display = 'block';
    }

});
