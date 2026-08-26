(function () {
    const stored = localStorage.getItem('theme');
    let theme;
    if (stored === 'light' || stored === 'dark') {
        theme = stored;
    } else {
        try {
            const mq = window.matchMedia('(prefers-color-scheme: light)');
            theme = mq.matches ? 'light' : 'dark';
        } catch (e) {
            theme = 'dark';
        }
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    // Only write to localStorage if the value has changed (avoids redundant writes)
    if (stored !== theme) {
        localStorage.setItem('theme', theme);
    }

    // Swap favicons based on resolved theme (Chrome ignores media on <link rel="icon">)
    try {
        const svgIcon = document.getElementById('svg-favicon');
        if (svgIcon) {
            svgIcon.href = theme === 'dark' ? (svgIcon.dataset.darkHref || '/favicon-light.svg') : (svgIcon.dataset.lightHref || '/favicon-light.svg');
        }
        const icoIcon = document.getElementById('ico-favicon');
        if (icoIcon) {
            icoIcon.href = theme === 'dark' ? (icoIcon.dataset.darkHref || '/favicon-light.ico') : (icoIcon.dataset.lightHref || '/favicon-light.ico');
        }
    } catch (e) {}
})();

