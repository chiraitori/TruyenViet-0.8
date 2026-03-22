/**
 * YuriGarden Pages Decryptor
 * 
 * Reverse-engineered from common-DZWC264q.js
 * The pages API returns AES-CBC encrypted data when { encrypted: true, data: "..." }
 * This module decrypts it and decodes the scramble keys.
 */

import CryptoJS from 'crypto-js';

// XOR'd byte arrays that produce the decryption passphrase
const w = [84, 122, 83, 44];
const S = [53, 45, 64, 230];
const E = [220, 207, 245, 148];
const U = [184, 136, 188, 119];
const K = [18, 35, 52, 69];
const O = [86, 103, 120, 137];
const T = [154, 171, 188, 205];
const v = [222, 239, 240, 1];

/**
 * Reconstruct the AES passphrase by XOR'ing byte arrays
 * Produces: "FYgicJ8oFdIYfgLv"
 */
function getPassphrase(): string {
    const t: number[] = [];
    for (let e = 0; e < 4; e++) t.push((w[e] ?? 0) ^ (K[e] ?? 0));
    for (let e = 0; e < 4; e++) t.push((S[e] ?? 0) ^ (O[e] ?? 0));
    for (let e = 0; e < 4; e++) t.push((E[e] ?? 0) ^ (T[e] ?? 0));
    for (let e = 0; e < 4; e++) t.push((U[e] ?? 0) ^ (v[e] ?? 0));
    return String.fromCharCode(...t);
}

/**
 * Convert byte array to CryptoJS WordArray
 */
function toWordArray(bytes: number[], sigBytes?: number): CryptoJS.lib.WordArray {
    const words: number[] = [];
    const len = sigBytes ?? bytes.length;
    for (let i = 0; i < bytes.length; i += 4) {
        words.push(
            (((bytes[i] ?? 0) << 24) |
                ((bytes[i + 1] ?? 0) << 16) |
                ((bytes[i + 2] ?? 0) << 8) |
                ((bytes[i + 3] ?? 0))) >>> 0
        );
    }
    return CryptoJS.lib.WordArray.create(words, len);
}

/**
 * Convert CryptoJS WordArray to byte array
 */
function fromWordArray(wordArray: CryptoJS.lib.WordArray): number[] {
    const bytes: number[] = [];
    const sigBytes = wordArray.sigBytes;
    for (let i = 0; i < sigBytes; i++) {
        const word = wordArray.words[i >>> 2];
        bytes.push((word >>> (24 - (i % 4) * 8)) & 0xff);
    }
    return bytes;
}

/**
 * Derive AES key and IV from passphrase and salt using MD5
 * This implements OpenSSL's EVP_BytesToKey-like derivation
 */
function deriveKeyIV(passphrase: string, salt: Uint8Array): { key: number[]; iv: number[] } {
    const concat = (a: number[], b: number[]): number[] => [...a, ...b];
    const md5Hash = (data: number[]): number[] => {
        const wa = toWordArray(data);
        const hash = CryptoJS.MD5(wa).toString(CryptoJS.enc.Hex);
        const result: number[] = [];
        for (let i = 0; i < hash.length; i += 2) {
            result.push(parseInt(hash.slice(i, i + 2), 16));
        }
        return result;
    };

    const passphraseBytes = Array.from(passphrase).map(c => c.charCodeAt(0));
    const saltBytes = Array.from(salt);

    const a = concat(passphraseBytes, saltBytes);
    const c = md5Hash(a);       // First MD5 round
    const i = concat(c, concat(passphraseBytes, saltBytes));
    const f = md5Hash(i);       // Second MD5 round
    const l = concat(f, concat(passphraseBytes, saltBytes));
    const A = md5Hash(l);       // Third MD5 round

    return {
        key: [...c, ...f],     // 32 bytes (256-bit key)
        iv: A                   // 16 bytes (128-bit IV)
    };
}

/**
 * Decrypt AES-CBC encrypted base64 data
 * Format: "Salted__" (8 bytes) + salt (8 bytes) + ciphertext
 */
function decryptAES(base64Data: string, passphrase: string): string {
    const raw = CryptoJS.enc.Base64.parse(base64Data);
    const rawBytes = fromWordArray(raw);

    if (rawBytes.length < 16) {
        throw new Error('Encrypted data too short');
    }

    // Skip "Salted__" header (8 bytes), extract salt (next 8 bytes)
    const salt = new Uint8Array(rawBytes.slice(8, 16));
    const cipherBytes = rawBytes.slice(16);

    const { key, iv } = deriveKeyIV(passphrase, salt);

    const keyWA = toWordArray(key, 32);
    const ivWA = toWordArray(iv, 16);
    const cipherWA = toWordArray(cipherBytes, cipherBytes.length);

    const decrypted = CryptoJS.AES.decrypt(
        { ciphertext: cipherWA } as any,
        keyWA,
        {
            iv: ivWA,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        }
    );

    return decrypted.toString(CryptoJS.enc.Utf8);
}

/**
 * Base58 alphabet (no 0, I, O, l)
 */
const BASE58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Factorials for permutation decoding
 */
const FACTORIALS = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];

/**
 * Convert base58 string to number
 */
function base58Decode(str: string): number {
    let value = 0;
    for (const char of str) {
        const index = BASE58_CHARS.indexOf(char);
        if (index < 0) throw new Error('Invalid base58 character');
        value = value * 58 + index;
    }
    return value;
}

/**
 * Convert factoradic number to permutation array
 * (Lehmer code to permutation)
 */
function factoradicToPermutation(value: number, size: number = 10): number[] {
    const available = Array.from({ length: size }, (_, i) => i);
    const result: number[] = [];
    for (let i = size - 1; i >= 0; i--) {
        const factorial = FACTORIALS[i] ?? 1;
        const index = Math.floor(value / factorial);
        value = value % factorial;
        result.push(available.splice(index, 1)[0]!);
    }
    return result;
}

/**
 * Decode a single scramble key string (format: "YGK_<base58><checksum>")
 * Returns array of 10 integers representing the strip order
 */
function decodeScrambleKey(key: string): number[] {
    if (!/^H[1-9A-HJ-NP-Za-km-z]+$/.test(key)) {
        throw new Error('Invalid key format');
    }
    const body = key.slice(1, -1);      // Remove prefix 'H' and checksum
    const checksum = key.slice(-1);     // Last character is checksum
    const value = base58Decode(body);

    // Verify checksum
    if (BASE58_CHARS[value % 58] !== checksum) {
        throw new Error('Checksum mismatch');
    }

    return factoradicToPermutation(value, 10);
}

/**
 * Decode array of scramble key strings to permutation arrays
 */
function decodeScrambleKeys(keys: string[]): number[][] {
    return keys.map(key => decodeScrambleKey(key.slice(4)));  // Remove "YGK_" prefix
}

/**
 * Main decryption function for pages API response
 * Handles both encrypted and unencrypted responses
 */
export function decryptPagesResponse(data: any): any {
    let parsed: any;

    if (data?.encrypted === true && typeof data?.data === 'string') {
        // Encrypted response - decrypt it
        const passphrase = getPassphrase();
        const decryptedStr = decryptAES(data.data, passphrase);
        parsed = JSON.parse(decryptedStr);
    } else {
        // Not encrypted - use as-is
        parsed = data;
    }

    // Decode scramble keys if present
    const keyStrings: string[] = parsed.pages
        ?.map((p: any) => p.key)
        .filter((k: any) => k !== undefined) ?? [];

    const decodedKeys: Record<string, number[]> = {};

    if (keyStrings.length > 0) {
        try {
            const decoded = decodeScrambleKeys(keyStrings);
            parsed.pages?.forEach((page: any) => {
                if (page.key) {
                    const idx = keyStrings.indexOf(page.key);
                    if (idx >= 0 && decoded[idx]) {
                        decodedKeys[page.id] = [...decoded[idx]!];
                    }
                }
            });
        } catch (e) {
            // Scramble key decoding failed - continue without it
        }
    }

    return {
        ...parsed,
        pages: parsed?.pages?.map((p: any) => ({
            ...p,
            url: (p.url ?? '').replace('_credit', ''),
            decoded: decodedKeys[p.id] ?? undefined
        })) ?? []
    };
}
