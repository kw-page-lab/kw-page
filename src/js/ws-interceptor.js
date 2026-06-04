// WebSocket Interceptor to track connection state
(function() {
    window.wsConnected = false;
    window.wsProgress = 0;
    
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        console.log('[WebSocket Interceptor] Intercepted WebSocket creation to:', url);
        const ws = new OriginalWebSocket(url, protocols);
        ws.addEventListener('open', () => {
            console.log('[WebSocket Interceptor] WebSocket connected!');
            window.wsConnected = true;
            window.wsProgress = 100;
            if (typeof window.updateOverallProgress === 'function') {
                window.updateOverallProgress();
            }
        });
        return ws;
    };
    // Copy static properties of WebSocket
    Object.getOwnPropertyNames(OriginalWebSocket).forEach(prop => {
        if (OriginalWebSocket.hasOwnProperty(prop)) {
            try {
                window.WebSocket[prop] = OriginalWebSocket[prop];
            } catch(e) {}
        }
    });
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    
    // Timeout to mark WS as loaded if connection takes too long
    setTimeout(() => {
        if (!window.wsConnected) {
            console.warn('[Loader] WebSocket connection timed out, marking as loaded to proceed...');
            window.wsProgress = 100;
            if (typeof window.updateOverallProgress === 'function') {
                window.updateOverallProgress();
            }
        }
    }, 2000);
})();
