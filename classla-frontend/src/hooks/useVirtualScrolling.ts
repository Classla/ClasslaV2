import { useEffect, useRef, useState, useCallback } from "react";

interface UseVirtualScrollingOptions {
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
}

interface VirtualScrollingResult {
  containerRef: React.RefObject<HTMLDivElement>;
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  offsetY: number;
}

/**
 * Custom hook for virtual scrolling optimization
 * Useful for large assignments with many MCQ blocks
 */
export const useVirtualScrolling = (
  itemCount: number,
  options: UseVirtualScrollingOptions
): VirtualScrollingResult => {
  const { itemHeight, containerHeight, overscan = 5 } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    itemCount - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const totalHeight = itemCount * itemHeight;
  const offsetY = startIndex * itemHeight;

  const handleScroll = useCallback((e: Event) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  return {
    containerRef,
    startIndex,
    endIndex,
    totalHeight,
    offsetY,
  };
};

/**
 * Hook for detecting if an assignment is large enough to benefit from optimizations
 */
export const useAssignmentOptimization = (contentLength: number) => {
  const shouldOptimize = contentLength > 50000; // 50KB threshold
  const shouldUseVirtualScrolling = contentLength > 100000; // 100KB threshold

  return {
    shouldOptimize,
    shouldUseVirtualScrolling,
  };
};

/**
 * Hook for performance monitoring and optimization suggestions
 */
export const usePerformanceMonitoring = () => {
  const [metrics, setMetrics] = useState({
    renderTime: 0,
    mcqBlockCount: 0,
    memoryUsage: 0,
  });

  const measureRenderTime = useCallback((callback: () => void) => {
    const start = performance.now();
    callback();
    const end = performance.now();

    setMetrics((prev) => ({
      ...prev,
      renderTime: end - start,
    }));
  }, []);

  const updateMCQCount = useCallback((count: number) => {
    setMetrics((prev) => ({
      ...prev,
      mcqBlockCount: count,
    }));
  }, []);

  const getOptimizationSuggestions = useCallback(() => {
    const suggestions: string[] = [];

    if (metrics.renderTime > 100) {
      suggestions.push(
        "Consider reducing the number of MCQ blocks per assignment"
      );
    }

    if (metrics.mcqBlockCount > 20) {
      suggestions.push(
        "Large number of questions detected. Consider splitting into multiple assignments"
      );
    }

    if (metrics.memoryUsage > 50) {
      suggestions.push(
        "High memory usage detected. Consider optimizing content"
      );
    }

    return suggestions;
  }, [metrics]);

  return {
    metrics,
    measureRenderTime,
    updateMCQCount,
    getOptimizationSuggestions,
  };
};
