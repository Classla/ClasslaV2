import { useState, useCallback, useRef } from "react";
import { apiClient } from "../lib/api";

export interface FileVersion {
  versionId: string;
  lastModified: string;
  size: number;
  isLatest: boolean;
}

interface UseFileHistoryOptions {
  snapshotBucketId: string | null;
  directLiveBucketId: string | null; // When we already know the live bucket (no snapshot)
  enabled: boolean; // only true when isViewingOtherStudent
}

interface UseFileHistoryReturn {
  isHistoryMode: boolean;
  versions: FileVersion[];
  currentVersionIndex: number;
  versionContent: string | null;
  isLoadingVersions: boolean;
  isLoadingContent: boolean;
  enableHistory: (filePath: string) => Promise<void>;
  disableHistory: () => void;
  setVersionIndex: (index: number) => void;
  loadVersionsForFile: (filePath: string) => Promise<void>;
}

const MAX_CACHE_ENTRIES = 20;

export function useFileHistory({ snapshotBucketId, directLiveBucketId, enabled }: UseFileHistoryOptions): UseFileHistoryReturn {
  const [isHistoryMode, setIsHistoryMode] = useState(false);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(0);
  const [versionContent, setVersionContent] = useState<string | null>(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);

  // Cache: versionId -> content
  const contentCacheRef = useRef<Map<string, string>>(new Map());
  // Resolved live bucket ID (cached across file switches)
  const liveBucketIdRef = useRef<string | null>(null);
  // Current file path being viewed in history
  const currentFilePathRef = useRef<string | null>(null);

  const resolveLiveBucket = useCallback(async (): Promise<string | null> => {
    if (liveBucketIdRef.current) return liveBucketIdRef.current;

    // If we have a direct live bucket ID (no snapshot), use it
    if (directLiveBucketId) {
      liveBucketIdRef.current = directLiveBucketId;
      return directLiveBucketId;
    }

    // Otherwise resolve from snapshot
    if (!snapshotBucketId) return null;

    try {
      const response = await apiClient.getSourceBucket(snapshotBucketId);
      const id = response.data.liveBucketId;
      liveBucketIdRef.current = id;
      return id;
    } catch (error) {
      console.error("[useFileHistory] Failed to resolve live bucket:", error);
      return null;
    }
  }, [snapshotBucketId, directLiveBucketId]);

  const fetchVersionContent = useCallback(async (liveBucketId: string, versionId: string, filePath: string): Promise<string | null> => {
    // Check cache
    const cached = contentCacheRef.current.get(versionId);
    if (cached !== undefined) return cached;

    try {
      const response = await apiClient.getS3FileVersionContent(liveBucketId, versionId, filePath);
      const content = response.data.content;

      // Add to cache, evict oldest if needed
      if (contentCacheRef.current.size >= MAX_CACHE_ENTRIES) {
        const firstKey = contentCacheRef.current.keys().next().value;
        if (firstKey) contentCacheRef.current.delete(firstKey);
      }
      contentCacheRef.current.set(versionId, content);

      return content;
    } catch (error) {
      console.error("[useFileHistory] Failed to fetch version content:", error);
      return null;
    }
  }, []);

  // Pre-fetch adjacent versions for smooth scrubbing
  const prefetchAdjacent = useCallback((liveBucketId: string, versions: FileVersion[], index: number, filePath: string) => {
    const indicesToPrefetch = [index - 1, index + 1, index - 2, index + 2];
    for (const i of indicesToPrefetch) {
      if (i >= 0 && i < versions.length) {
        const v = versions[i];
        if (!contentCacheRef.current.has(v.versionId)) {
          // Fire and forget
          fetchVersionContent(liveBucketId, v.versionId, filePath).catch(() => {});
        }
      }
    }
  }, [fetchVersionContent]);

  const enableHistory = useCallback(async (filePath: string) => {
    if (!enabled) {
      console.warn("[useFileHistory] enableHistory called but not enabled");
      return;
    }
    if (!snapshotBucketId && !directLiveBucketId) {
      console.warn("[useFileHistory] enableHistory called but no bucket ID available");
      return;
    }

    console.log("[useFileHistory] Enabling history for:", filePath);
    setIsLoadingVersions(true);
    currentFilePathRef.current = filePath;

    try {
      const liveBucketId = await resolveLiveBucket();
      if (!liveBucketId) {
        console.warn("[useFileHistory] Could not resolve live bucket");
        setIsLoadingVersions(false);
        return;
      }

      console.log("[useFileHistory] Resolved live bucket:", liveBucketId, "fetching versions for:", filePath);
      const response = await apiClient.getS3FileVersions(liveBucketId, filePath);
      const fetchedVersions: FileVersion[] = response.data.versions || [];
      console.log("[useFileHistory] Got", fetchedVersions.length, "versions");

      setVersions(fetchedVersions);
      setIsHistoryMode(true);
      setIsLoadingVersions(false);

      if (fetchedVersions.length > 0) {
        // Start at the latest version (index 0)
        setCurrentVersionIndex(0);
        setIsLoadingContent(true);
        const content = await fetchVersionContent(liveBucketId, fetchedVersions[0].versionId, filePath);
        setVersionContent(content);
        setIsLoadingContent(false);

        // Pre-fetch adjacent
        prefetchAdjacent(liveBucketId, fetchedVersions, 0, filePath);
      } else {
        setVersionContent(null);
      }
    } catch (error) {
      console.error("[useFileHistory] Failed to enable history:", error);
      setIsLoadingVersions(false);
    }
  }, [enabled, snapshotBucketId, directLiveBucketId, resolveLiveBucket, fetchVersionContent, prefetchAdjacent]);

  const disableHistory = useCallback(() => {
    setIsHistoryMode(false);
    setVersions([]);
    setCurrentVersionIndex(0);
    setVersionContent(null);
    currentFilePathRef.current = null;
    // Don't clear liveBucketIdRef — it can be reused
    // Don't clear contentCacheRef — versions are immutable
  }, []);

  const setVersionIndex = useCallback(async (index: number) => {
    if (index < 0 || index >= versions.length) return;

    setCurrentVersionIndex(index);
    const version = versions[index];
    const filePath = currentFilePathRef.current;
    const liveBucketId = liveBucketIdRef.current;

    if (!liveBucketId || !filePath) return;

    // Check cache first
    const cached = contentCacheRef.current.get(version.versionId);
    if (cached !== undefined) {
      setVersionContent(cached);
    } else {
      setIsLoadingContent(true);
      const content = await fetchVersionContent(liveBucketId, version.versionId, filePath);
      setVersionContent(content);
      setIsLoadingContent(false);
    }

    // Pre-fetch adjacent
    prefetchAdjacent(liveBucketId, versions, index, filePath);
  }, [versions, fetchVersionContent, prefetchAdjacent]);

  const loadVersionsForFile = useCallback(async (filePath: string) => {
    if (!isHistoryMode) return;

    currentFilePathRef.current = filePath;
    setIsLoadingVersions(true);

    try {
      const liveBucketId = liveBucketIdRef.current;
      if (!liveBucketId) {
        setIsLoadingVersions(false);
        return;
      }

      const response = await apiClient.getS3FileVersions(liveBucketId, filePath);
      const fetchedVersions: FileVersion[] = response.data.versions || [];

      setVersions(fetchedVersions);
      setIsLoadingVersions(false);

      if (fetchedVersions.length > 0) {
        setCurrentVersionIndex(0);
        setIsLoadingContent(true);
        const content = await fetchVersionContent(liveBucketId, fetchedVersions[0].versionId, filePath);
        setVersionContent(content);
        setIsLoadingContent(false);
        prefetchAdjacent(liveBucketId, fetchedVersions, 0, filePath);
      } else {
        setCurrentVersionIndex(0);
        setVersionContent(null);
      }
    } catch (error) {
      console.error("[useFileHistory] Failed to load versions for file:", error);
      setIsLoadingVersions(false);
    }
  }, [isHistoryMode, fetchVersionContent, prefetchAdjacent]);

  return {
    isHistoryMode,
    versions,
    currentVersionIndex,
    versionContent,
    isLoadingVersions,
    isLoadingContent,
    enableHistory,
    disableHistory,
    setVersionIndex,
    loadVersionsForFile,
  };
}
