// Modal Manipulator Script - Injected separately
(function() {
    "use strict";
    
    console.log("[MODAL MANIPULATOR] Script starting...");
    
    function setupModalManipulation() {
        const handleModalContent = () => {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (!mutation.addedNodes) return;
                    
                    mutation.addedNodes.forEach((node) => {
                        // Check for various modal structures
                        const modalSelectors = [
                            ".ant-modal-content",
                            ".modal-content",
                            ".dialog-content",
                            "[role=\"dialog\"]",
                            ".popup-content"
                        ];
                        
                        let modalContent = null;
                        for (const selector of modalSelectors) {
                            modalContent = node.querySelector?.(selector) || 
                                          node.parentElement?.querySelector(selector);
                            if (modalContent) break;
                        }
                        
                        if (modalContent) {
                            // Try different modal body selectors
                            const bodySelectors = [".ant-modal-body", ".modal-body", ".dialog-body"];
                            let modalBody = null;
                            for (const selector of bodySelectors) {
                                modalBody = modalContent.querySelector(selector);
                                if (modalBody) break;
                            }
                            
                            if (modalBody) {
                                // Target the specific div structure
                                const containerDiv = modalBody.querySelector("div > div");
                                if (containerDiv) {
                                    // Get all direct child divs of the container
                                    const targetDivs = containerDiv.querySelectorAll(":scope > div");
                                    if (targetDivs.length >= 4) {
                                        // Remove divs 3 and 4 (zero-based index 2 and 3)
                                        targetDivs[3]?.remove(); // 4th div
                                        targetDivs[2]?.remove(); // 3rd div
                                        console.log("[MODAL MANIPULATOR] Removed modal elements");
                                    }
                                }
                            }
                        }
                    });
                });
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            return observer;
        };
        
        // Event delegation for button clicks
        document.addEventListener("click", (e) => {
            if (e.target.closest("div")) {
                // Start observing with cleanup
                const modalObserver = handleModalContent();
                setTimeout(() => modalObserver.disconnect(), 5000);
            }
        });
    }
    
    setupModalManipulation();
    console.log("[MODAL MANIPULATOR] Modal manipulation system initialized successfully!");
})();