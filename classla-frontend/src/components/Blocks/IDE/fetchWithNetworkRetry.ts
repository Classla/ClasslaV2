/**
 * Wraps fetch() with automatic retries on network errors (TypeError).
 * HTTP error responses (4xx/5xx) are returned immediately without retrying.
 * Retries up to 10 times with 500ms delay (~5 seconds total).
 *
 * When retryOnGatewayError is true, also retries on HTTP 502/503/504 responses
 * (e.g. Traefik returning gateway errors before a container route is fully live).
 */

const GATEWAY_ERROR_STATUSES = [502, 503, 504];

export async function fetchWithNetworkRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxRetries = 10,
  delayMs = 500,
  retryOnGatewayError = false
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(input, init);
      if (
        retryOnGatewayError &&
        GATEWAY_ERROR_STATUSES.includes(response.status) &&
        attempt < maxRetries
      ) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      return response;
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
