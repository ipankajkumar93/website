(() => {
    const meta = document.querySelector('meta[name="redirect-target"]');
    const target = meta ? meta.getAttribute('content') : '';
    if (!target) return;
    const hash = window.location.hash || '';
    window.location.replace(target + hash);
})();
