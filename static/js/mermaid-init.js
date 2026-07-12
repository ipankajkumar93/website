document.addEventListener("DOMContentLoaded", async function () {
    function getMermaidTheme() {
        return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
    }

    async function renderMermaid() {
        if (!window.mermaid) return;
        
        // Reset already-rendered elements
        document.querySelectorAll(".mermaid[data-mermaid-source]").forEach(el => {
            el.removeAttribute("data-processed");
            el.textContent = el.getAttribute("data-mermaid-source") || "";
        });
        
        mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });
        await mermaid.run();
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
