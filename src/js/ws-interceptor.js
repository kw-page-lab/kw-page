// WebSocket Interceptor to track connection state
(function() {
    window.wsConnected = false;
    window.wsProgress = 0;
    
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        let modifiedUrl = url;
        try {
            let id = localStorage.getItem('kimeraware_client_id');
            if (!id) {
                id = 'client_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
                localStorage.setItem('kimeraware_client_id', id);
            }
            
            let tempUrl = url;
            let isWs = false;
            let isWss = false;
            if (url.startsWith('ws://')) {
                tempUrl = url.replace('ws://', 'http://');
                isWs = true;
            } else if (url.startsWith('wss://')) {
                tempUrl = url.replace('wss://', 'https://');
                isWss = true;
            }
            
            const urlObj = new URL(tempUrl, window.location.href);
            urlObj.searchParams.set('clientId', id);
            modifiedUrl = urlObj.toString();
            
            if (isWs) {
                modifiedUrl = modifiedUrl.replace('http://', 'ws://');
            } else if (isWss) {
                modifiedUrl = modifiedUrl.replace('https://', 'wss://');
            }
        } catch(e) {
            console.error('[WebSocket Interceptor] Failed to append clientId:', e);
        }

        console.log('[WebSocket Interceptor] Intercepted WebSocket creation to:', modifiedUrl);
        const ws = new OriginalWebSocket(modifiedUrl, protocols);
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
