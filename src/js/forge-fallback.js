window.decryptWsMessageFallback = function(raw) {
    try {
        // Decode base64 to raw binary string
        const combined = forge.util.decode64(raw);
        
        // iv = 12 bytes, tag = 16 bytes, ciphertext = rest
        const ivStr = combined.substring(0, 12);
        const tagStr = combined.substring(12, 28);
        const ciphertextStr = combined.substring(28);
        
        // Derive key: HMAC-SHA256(keyBytes, salt)
        // keyBytes = [75, 87, 95, 65, 82, 71]
        const hmac = forge.hmac.create();
        hmac.start('sha256', forge.util.createBuffer(String.fromCharCode(75, 87, 95, 65, 82, 71)));
        hmac.update('kimeraware-ws-2025');
        const derivedKeyBytes = hmac.digest().getBytes();
        
        const decipher = forge.cipher.createDecipher('AES-GCM', derivedKeyBytes);
        decipher.start({
            iv: ivStr,
            tag: forge.util.createBuffer(tagStr)
        });
        decipher.update(forge.util.createBuffer(ciphertextStr));
        const pass = decipher.finish();
        if (pass) {
            const plaintextBytes = decipher.output.getBytes();
            const plaintext = forge.util.decodeUtf8(plaintextBytes);
            return JSON.parse(plaintext);
        } else {
            throw new Error("Decryption failed");
        }
    } catch (err) {
        console.error("Fallback decryption error:", err);
        try {
            return JSON.parse(raw);
        } catch {
            throw err;
        }
    }
};
