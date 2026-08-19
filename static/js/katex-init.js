// Render math once KaTeX and its auto-render extension have loaded.
renderMathInElement(document.body, {
    delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
    ],
    throwOnError: false
});
