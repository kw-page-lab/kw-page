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

        // Decryption logic for encrypted WebSocket messages
        let Ae = null;
        async function kt() {
            if (Ae) return Ae;
            const e = "75,87,95,65,82,71",
                  n = new Uint8Array(e.split(",").map(Number)),
                  t = new TextEncoder().encode("kimeraware-ws-2025"),
                  i = await crypto.subtle.importKey("raw", n, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]),
                  d = await crypto.subtle.sign("HMAC", i, t);
            return Ae = await crypto.subtle.importKey("raw", d, {name: "AES-GCM"}, false, ["decrypt"]), Ae;
        }
        
        async function decryptMessage(e) {
            try {
                const n = Uint8Array.from(atob(e), r => r.charCodeAt(0)),
                      t = n.slice(0, 12),
                      i = n.slice(12, 28),
                      d = n.slice(28),
                      a = new Uint8Array(d.length + 16);
                a.set(d);
                a.set(i, d.length);
                const u = await kt(),
                      s = await crypto.subtle.decrypt({name: "AES-GCM", iv: t}, u, a);
                return JSON.parse(new TextDecoder().decode(s));
            } catch(err) {
                try { return JSON.parse(e); } catch { throw err; }
            }
        }

        // Intercept WS messages to trigger Act 1 sequence states
        ws.addEventListener('message', async (event) => {
            try {
                let data;
                const rawData = event.data;
                if (typeof rawData === 'string' && rawData.startsWith('{')) {
                    data = JSON.parse(rawData);
                } else if (typeof rawData === 'string') {
                    data = await decryptMessage(rawData);
                }
                
                if (data) {
                    if (data.type === 'apply_preset' || data.type === 'trigger_video') {
                        const isAct1 = data.presetId === 'act1' || 
                                       data.act1 === true ||
                                       (data.text && data.text.toLowerCase().includes('act1')) ||
                                       (data.videoUrl && data.videoUrl.toLowerCase().includes('act1'));
                        
                        if (isAct1) {
                            if (typeof window.setAct1 === 'function') window.setAct1(true);
                        } else if (data.type === 'apply_preset' && data.presetId !== 'act1') {
                            if (typeof window.setAct1 === 'function') window.setAct1(false);
                        }
                    } else if (data.type === 'filter') {
                        if (data.filterMode === 'darkness') {
                            if (typeof window.setAct1 === 'function') window.setAct1(true);
                        } else if (data.filterMode === 'default' || data.filterMode === 'normal') {
                            if (typeof window.setAct1 === 'function') window.setAct1(false);
                        }
                    } else if (data.type === 'reset') {
                        if (typeof window.setAct1 === 'function') window.setAct1(false);
                    }
                }
            } catch(e) {
                // Ignore errors
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
    }, 5000);
})();
