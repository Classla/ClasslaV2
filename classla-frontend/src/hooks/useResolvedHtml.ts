import { useState, useEffect, useRef, useCallback } from "react";
import { apiClient } from "../lib/api";

/**
 * Hook that resolves `<img data-s3-key="..." data-assignment-id="...">` tags
 * in HTML strings to presigned S3 URLs. Returns the HTML with `src` attributes
 * injected so images display correctly.
 *
 * Fast path: if the HTML contains no `data-s3-key`, returns it unchanged.
 * Caches resolved URLs in a ref to avoid redundant API calls.
 * Auto-refreshes every 4 minutes (presigned URLs expire in 5).
 */
export function useResolvedHtml(html: string): string {
  const [resolvedHtml, setResolvedHtml] = useState(html);
  const cacheRef = useRef<Map<string, string>>(new Map());
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>();
  const htmlRef = useRef(html);
  htmlRef.current = html;

  const resolve = useCallback(async (rawHtml: string) => {
    // Fast path: no images to resolve
    if (!rawHtml || !rawHtml.includes("data-s3-key")) {
      setResolvedHtml(rawHtml);
      return;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, "text/html");
    const images = doc.querySelectorAll("img[data-s3-key]");

    if (images.length === 0) {
      setResolvedHtml(rawHtml);
      return;
    }

    // Collect images that need URL resolution
    const toFetch: { el: Element; key: string; assignmentId: string }[] = [];
    images.forEach((img) => {
      const key = img.getAttribute("data-s3-key") || "";
      const assignmentId = img.getAttribute("data-assignment-id") || "";
      if (!key || !assignmentId) return;

      const cacheKey = `${assignmentId}:${key}`;
      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        img.setAttribute("src", cached);
        // Apply width from data attribute
        const w = img.getAttribute("data-width");
        if (w && w !== "0") {
          (img as HTMLImageElement).style.width = `${w}px`;
          (img as HTMLImageElement).style.maxWidth = "100%";
        }
      } else {
        toFetch.push({ el: img, key, assignmentId });
      }
    });

    // Fetch presigned URLs in parallel
    if (toFetch.length > 0) {
      const results = await Promise.allSettled(
        toFetch.map(({ key, assignmentId }) =>
          apiClient.getImageUrl(assignmentId, key)
        )
      );

      results.forEach((result, i) => {
        if (result.status === "fulfilled") {
          const url = result.value.data.url;
          const { el, key, assignmentId } = toFetch[i];
          const cacheKey = `${assignmentId}:${key}`;
          cacheRef.current.set(cacheKey, url);
          el.setAttribute("src", url);
          const w = el.getAttribute("data-width");
          if (w && w !== "0") {
            (el as HTMLImageElement).style.width = `${w}px`;
            (el as HTMLImageElement).style.maxWidth = "100%";
          }
        }
      });
    }

    setResolvedHtml(doc.body.innerHTML);
  }, []);

  useEffect(() => {
    resolve(html);
  }, [html, resolve]);

  // Auto-refresh every 4 minutes to keep presigned URLs fresh
  useEffect(() => {
    if (!html || !html.includes("data-s3-key")) return;

    refreshTimerRef.current = setInterval(() => {
      // Clear cache to force re-fetch
      cacheRef.current.clear();
      resolve(htmlRef.current);
    }, 4 * 60 * 1000);

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [html, resolve]);

  return resolvedHtml;
}
