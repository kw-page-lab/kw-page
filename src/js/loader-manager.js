window.monolithProgress = 0;
window.tvProgress = 0;
window.wsProgress = 0;
window.currentVisibleProgress = 0;

window.updateOverallProgress = function() {
    // monolithProgress is 0-100 (40% weight)
    // tvProgress is 0-100 (40% weight)
    // wsProgress is 0-100 (20% weight)
    const targetProgress = Math.min(100, Math.round(
        (window.monolithProgress * 0.4) +
        (window.tvProgress * 0.4) +
        (window.wsProgress * 0.2)
    ));
    
    // Progress should only increase
    if (targetProgress > window.currentVisibleProgress) {
        window.currentVisibleProgress = targetProgress;
    }
    
    const visibleBar = document.getElementById('visible-loading-bar-fill');
    const visibleText = document.getElementById('visible-loading-text');
    
    if (visibleBar) {
        visibleBar.style.width = window.currentVisibleProgress + '%';
    }
    if (visibleText) {
        visibleText.textContent = window.currentVisibleProgress + '%';
    }
    
    if (window.currentVisibleProgress >= 100) {
        const overlay = document.getElementById('loading-overlay');
        if (overlay && !overlay.classList.contains('faded')) {
            overlay.classList.add('faded');
            overlay.style.opacity = '0';
            if (typeof resetIdleTimer === 'function') {
                resetIdleTimer();
            }
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 600);
        }
    }
};

// MutationObserver to track dummy loading bar style width changes
document.addEventListener('DOMContentLoaded', () => {
    const dummyBar = document.getElementById('loading-bar-fill');
    if (dummyBar) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const widthStr = dummyBar.style.width;
                    if (widthStr && widthStr.endsWith('%')) {
                        const rawPercent = parseFloat(widthStr);
                        if (!isNaN(rawPercent)) {
                            // Map TV progress (50% to 100% in dummy) to (0% to 100% in tvProgress)
                            let normalized = (rawPercent - 50) / 50;
                            normalized = Math.max(0, Math.min(1, normalized));
                            window.tvProgress = normalized * 100;
                            window.updateOverallProgress();
                        }
                    }
                }
            });
        });
        observer.observe(dummyBar, { attributes: true, attributeFilter: ['style'] });
    }
});
