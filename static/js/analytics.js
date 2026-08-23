// Production Analytics Loader
(function() {
    const host = window.location.hostname;
    // Skip tracking on local development environments
    if (host === 'localhost' || host === '127.0.0.1' || host === '' || host.endsWith('.local')) {
        return;
    }

    const currentScript = document.currentScript || document.querySelector('script[src*="analytics.js"]');
    if (!currentScript) return;

    const url = currentScript.getAttribute('data-analytics-url');
    const websiteId = currentScript.getAttribute('data-website-id');
    const domains = currentScript.getAttribute('data-domains');

    if (url && websiteId) {
        const s = document.createElement('script');
        s.defer = true;
        s.src = url;
        s.dataset.websiteId = websiteId;
        if (domains) {
            s.dataset.domains = domains;
        }
        document.head.appendChild(s);
    }
})();
