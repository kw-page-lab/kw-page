// Auto-reload on index.html modifications (development helper)
(function() {
    let initialModified = null;
    async function checkUpdate() {
        try {
            const response = await fetch('/index.html', { method: 'HEAD', cache: 'no-cache' });
            const lastModified = response.headers.get('Last-Modified');
            if (lastModified) {
                if (initialModified === null) {
                    initialModified = lastModified;
                } else if (initialModified !== lastModified) {
                    console.log('Detectada modificación en index.html, recargando...');
                    window.location.reload();
                }
            }
        } catch (e) {
            // Ignore network errors
        }
    }
    setInterval(checkUpdate, 1500);
})();
