/**
 * Wraps fetch() with automatic retries on network errors (TypeError).
 * HTTP error responses (4xx/5xx) are returned immediately without retrying.
 * Retries up to 10 times with 500ms delay (~5 seconds total).
 */
export async function fetchWithNetworkRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxRetries = 10,
  delayMs = 500
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (!(error instanceof TypeError) || attempt === maxRetries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable, but satisfies TypeScript
  throw new Error("fetchWithNetworkRetry: exhausted retries");
}
