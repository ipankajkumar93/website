// Only load Umami analytics on production
if (location.hostname === 'pankajkumar.xyz' || location.hostname === 'www.pankajkumar.xyz') {
    const s = document.createElement('script');
    s.defer = true;
    s.src = 'https://um.pankajkumar.xyz/script.js';
    s.dataset.websiteId = 'ada632ca-2811-47a4-ab84-82c2edc0280f';
    document.head.appendChild(s);
}
