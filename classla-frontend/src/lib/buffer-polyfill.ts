/**
 * Buffer polyfill initialization
 * This file ensures Buffer is available globally for Y.js and other libraries
 * that may use Node.js Buffer internally.
 * 
 * Vite is configured to bundle buffer (not externalize it) via vite.config.ts
 * We use dynamic import to avoid Vite's automatic externalization
 */

// Use dynamic import to load Buffer - this helps avoid Vite externalization
import('buffer')
  .then((bufferModule) => {
    const Buffer = bufferModule.Buffer;
    
    // Make Buffer available globally
    if (typeof window !== 'undefined') {
      (window as any).Buffer = Buffer;
    }
    if (typeof globalThis !== 'undefined') {
      (globalThis as any).Buffer = Buffer;
    }
    
    console.log('[Buffer Polyfill] Buffer loaded successfully');
  })
  .catch((error) => {
    console.warn('[Buffer Polyfill] Failed to load Buffer, using fallback:', error);
    // Fallback: The polyfill plugins should make Buffer available
    // If not, Y.js will need to handle the absence of Buffer
  });

