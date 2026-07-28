document.addEventListener("DOMContentLoaded", async function () {
    function getMermaidTheme() {
        return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
    }

    // Wait for a layout-stable frame before rendering so the container
    // has its final dimensions.  Double-rAF guarantees at least one
    // completed layout pass.
    function afterLayout() {
        return new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
    }

    // After mermaid.run() the library stamps fixed width/height attributes
    // on the SVG.  Strip them and rely on the viewBox so the diagram
    // scales responsively within the flex container.
    function makeSvgsResponsive() {
        document.querySelectorAll(".mermaid svg").forEach(svg => {
            const w = svg.getAttribute("width");
            const h = svg.getAttribute("height");
            if (w && h) {
                // Ensure there is a viewBox so the SVG scales correctly
                if (!svg.getAttribute("viewBox")) {
                    svg.setAttribute("viewBox", `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
                }
                svg.removeAttribute("width");
                svg.removeAttribute("height");
                // Let CSS control the size
                svg.style.width = "100%";
                svg.style.maxWidth = parseFloat(w) + "px";
                svg.style.height = "auto";
            }
        });
    }

    async function renderMermaid() {
        if (!window.mermaid) return;

        // Reset already-rendered elements
        document.querySelectorAll(".mermaid[data-mermaid-source]").forEach(el => {
            el.removeAttribute("data-processed");
            el.textContent = el.getAttribute("data-mermaid-source") || "";
        });

        mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });

        // Wait for layout and web fonts to settle before asking mermaid to measure
        await document.fonts.ready;
        await afterLayout();
        await mermaid.run();

        // Post-process: make generated SVGs responsive
        makeSvgsResponsive();
    }
    
    const mermaidBlocks = document.querySelectorAll('pre[data-lang="mermaid"], code[data-lang="mermaid"], pre > code.language-mermaid');
    if (mermaidBlocks.length === 0) return;

    mermaidBlocks.forEach((block) => {
        const div = document.createElement('div');
        div.className = 'mermaid';
        
        // Extract text, handling newlines properly if wrapped in spans
        let text = block.innerText || block.textContent;
        // Sometimes innerText can remove empty lines, if textContent has \n we can use it
        if (block.textContent.includes('\n')) {
            text = block.textContent;
        }
        
        div.setAttribute("data-mermaid-source", text);
        div.textContent = text;
        
        const pre = block.tagName === 'PRE' ? block : block.closest('pre') || block.parentElement;
        pre.replaceWith(div);
    });

    await renderMermaid();
    
    const mermaidObserver = new MutationObserver(() => {
        if (document.querySelector("[data-mermaid-source]")) renderMermaid();
    });
    mermaidObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
    });
});
