import { useEffect, useState, useCallback, useRef } from "react";
import { getModuleTreeYjsProvider, ModuleTreeData } from "../lib/moduleTreeYjsProvider";

/**
 * React hook for module tree YJS synchronization
 * @param courseId - The course ID to subscribe to (or null for templates)
 * @param templateId - The template ID to subscribe to (or null for courses)
 * @returns Module tree data and refresh function
 */
export function useModuleTreeYjs(courseId?: string, templateId?: string) {
  const [moduleTreeData, setModuleTreeData] = useState<ModuleTreeData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const providerRef = useRef(getModuleTreeYjsProvider());
  const subscribedRef = useRef(false);

  // Handle module tree updates
  const handleModuleTreeUpdate = useCallback((data: ModuleTreeData) => {
    console.log("[useModuleTreeYjs] Module tree updated", {
      assignmentsCount: data.assignments.size,
      foldersCount: data.folders.size,
      lastUpdate: data.lastUpdate,
    });
    setModuleTreeData(data);
    setIsLoading(false);
    setError(null);
  }, []);

  // Subscribe to module tree
  useEffect(() => {
    if (!courseId && !templateId) {
      console.warn("[useModuleTreeYjs] No courseId or templateId provided");
      setIsLoading(false);
      return;
    }

    if (subscribedRef.current) {
      console.log("[useModuleTreeYjs] Already subscribed, skipping");
      return;
    }

    const provider = providerRef.current;

    console.log("[useModuleTreeYjs] Subscribing to module tree", { courseId, templateId });

    // Set up change listener
    const unsubscribe = provider.onChange(handleModuleTreeUpdate);

    // Subscribe to the module tree
    try {
      provider.subscribe(courseId, templateId);
      subscribedRef.current = true;

      // Get initial data if available
      const initialData = provider.getModuleTreeData();
      if (initialData) {
        handleModuleTreeUpdate(initialData);
      }
    } catch (err) {
      console.error("[useModuleTreeYjs] Failed to subscribe:", err);
      setError(err instanceof Error ? err : new Error("Failed to subscribe"));
      setIsLoading(false);
    }

    // Cleanup on unmount or when courseId/templateId changes
    return () => {
      console.log("[useModuleTreeYjs] Unsubscribing from module tree");
      unsubscribe();
      provider.unsubscribe();
      subscribedRef.current = false;
    };
  }, [courseId, templateId, handleModuleTreeUpdate]);

  // Force refresh function
  const refresh = useCallback(() => {
    const provider = providerRef.current;
    const data = provider.getModuleTreeData();
    if (data) {
      handleModuleTreeUpdate(data);
    }
  }, [handleModuleTreeUpdate]);

  return {
    moduleTreeData,
    isLoading,
    error,
    refresh,
  };
}
