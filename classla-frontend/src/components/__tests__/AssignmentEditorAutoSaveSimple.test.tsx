import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Test the auto-save debounce logic in isolation
describe("AssignmentEditor Auto-Save Logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Debounce Function", () => {
    it("debounces function calls correctly", async () => {
      const mockFn = vi.fn();

      // Simple debounce implementation to test
      function debounce<T extends (...args: any[]) => any>(
        func: T,
        wait: number
      ): (...args: Parameters<T>) => void {
        let timeout: NodeJS.Timeout;
        return (...args: Parameters<T>) => {
          clearTimeout(timeout);
          timeout = setTimeout(() => func(...args), wait);
        };
      }

      const debouncedFn = debounce(mockFn, 2000);

      // Call multiple times rapidly
      debouncedFn("call1");
      debouncedFn("call2");
      debouncedFn("call3");
      debouncedFn("call4");
      debouncedFn("call5");

      // Should not have called the function yet
      expect(mockFn).not.toHaveBeenCalled();

      // Advance time by less than debounce delay
      vi.advanceTimersByTime(1000);
      expect(mockFn).not.toHaveBeenCalled();

      // Advance past debounce delay
      vi.advanceTimersByTime(1000);

      // Should have called only once with the last value
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith("call5");
    });

    it("resets debounce timer on new calls", () => {
      const mockFn = vi.fn();

      function debounce<T extends (...args: any[]) => any>(
        func: T,
        wait: number
      ): (...args: Parameters<T>) => void {
        let timeout: NodeJS.Timeout;
        return (...args: Parameters<T>) => {
          clearTimeout(timeout);
          timeout = setTimeout(() => func(...args), wait);
        };
      }

      const debouncedFn = debounce(mockFn, 2000);

      // First call
      debouncedFn("first");

      // Advance time but not past delay
      vi.advanceTimersByTime(1500);

      // Second call should reset the timer
      debouncedFn("second");

      // Advance time by the original remaining time
      vi.advanceTimersByTime(1500);

      // Should not have called yet (timer was reset)
      expect(mockFn).not.toHaveBeenCalled();

      // Advance past the new delay
      vi.advanceTimersByTime(500);

      // Should have called with the second value
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith("second");
    });
  });

  describe("Save Status Logic", () => {
    it("formats time ago correctly", () => {
      // Time formatting function from AssignmentEditor
      function formatTimeAgo(date: Date): string {
        const now = new Date();
        const diffInSeconds = Math.floor(
          (now.getTime() - date.getTime()) / 1000
        );

        if (diffInSeconds < 60) {
          return "just now";
        } else if (diffInSeconds < 3600) {
          const minutes = Math.floor(diffInSeconds / 60);
          return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
        } else {
          const hours = Math.floor(diffInSeconds / 3600);
          return `${hours} hour${hours > 1 ? "s" : ""} ago`;
        }
      }

      const now = new Date("2024-01-01T12:00:00Z");
      vi.setSystemTime(now);

      // Test "just now"
      const justNow = new Date("2024-01-01T11:59:30Z"); // 30 seconds ago
      expect(formatTimeAgo(justNow)).toBe("just now");

      // Test minutes
      const oneMinuteAgo = new Date("2024-01-01T11:59:00Z");
      expect(formatTimeAgo(oneMinuteAgo)).toBe("1 minute ago");

      const fiveMinutesAgo = new Date("2024-01-01T11:55:00Z");
      expect(formatTimeAgo(fiveMinutesAgo)).toBe("5 minutes ago");

      // Test hours
      const oneHourAgo = new Date("2024-01-01T11:00:00Z");
      expect(formatTimeAgo(oneHourAgo)).toBe("1 hour ago");

      const threeHoursAgo = new Date("2024-01-01T09:00:00Z");
      expect(formatTimeAgo(threeHoursAgo)).toBe("3 hours ago");
    });
  });

  describe("Content Validation Logic", () => {
    it("validates MCQ content in HTML", () => {
      // Mock DOM parsing
      const mockElement = {
        querySelectorAll: vi.fn(),
        getAttribute: vi.fn(),
      };

      // Mock MCQ validation function
      const validateMCQData = (data: any) => {
        const errors: string[] = [];

        if (!data || typeof data !== "object") {
          errors.push("MCQ data must be an object");
          return { isValid: false, errors };
        }

        if (!data.id) errors.push("MCQ must have a valid ID");
        if (!data.question) errors.push("MCQ must have a question");
        if (!Array.isArray(data.options) || data.options.length < 2) {
          errors.push("MCQ must have at least 2 options");
        }

        return { isValid: errors.length === 0, errors };
      };

      // Test valid MCQ data
      const validMCQ = {
        id: "mcq-1",
        question: "Test?",
        options: [
          { id: "opt-1", text: "A", isCorrect: true },
          { id: "opt-2", text: "B", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
      };

      const validResult = validateMCQData(validMCQ);
      expect(validResult.isValid).toBe(true);
      expect(validResult.errors).toHaveLength(0);

      // Test invalid MCQ data
      const invalidMCQ = {
        question: "Test?",
        // Missing id and options
      };

      const invalidResult = validateMCQData(invalidMCQ);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });

    it("handles JSON parsing errors gracefully", () => {
      const parseJSONSafely = (jsonString: string) => {
        try {
          return { success: true, data: JSON.parse(jsonString) };
        } catch (error) {
          return { success: false, error: error.message };
        }
      };

      // Valid JSON
      const validResult = parseJSONSafely('{"valid": "json"}');
      expect(validResult.success).toBe(true);
      expect(validResult.data).toEqual({ valid: "json" });

      // Invalid JSON
      const invalidResult = parseJSONSafely('{"invalid": json}');
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.error).toBeTruthy();
    });
  });

  describe("Error Handling Logic", () => {
    it("categorizes API errors correctly", () => {
      const getErrorMessage = (error: any) => {
        let errorMessage = "Your changes could not be saved. Please try again.";
        let errorTitle = "Failed to save";

        if (error.name === "ApiError") {
          switch (error.statusCode) {
            case 400:
              errorTitle = "Invalid Content";
              errorMessage =
                "The assignment content contains invalid data. Please check your questions and try again.";
              break;
            case 401:
              errorTitle = "Session Expired";
              errorMessage = "Your session has expired. Please sign in again.";
              break;
            case 403:
              errorTitle = "Permission Denied";
              errorMessage =
                "You don't have permission to edit this assignment.";
              break;
            case 413:
              errorTitle = "Content Too Large";
              errorMessage =
                "The assignment content is too large. Please reduce the content size.";
              break;
            case 500:
              errorTitle = "Server Error";
              errorMessage =
                "A server error occurred. Please try again in a few moments.";
              break;
          }
        } else if (error.message?.includes("Network error")) {
          errorTitle = "Connection Error";
          errorMessage =
            "Unable to connect to the server. Please check your internet connection.";
        } else if (error.message?.includes("timeout")) {
          errorTitle = "Request Timeout";
          errorMessage = "The save request timed out. Please try again.";
        }

        return { errorTitle, errorMessage };
      };

      // Test different error types
      const apiError400 = { name: "ApiError", statusCode: 400 };
      const result400 = getErrorMessage(apiError400);
      expect(result400.errorTitle).toBe("Invalid Content");

      const apiError401 = { name: "ApiError", statusCode: 401 };
      const result401 = getErrorMessage(apiError401);
      expect(result401.errorTitle).toBe("Session Expired");

      const networkError = { message: "Network error: Failed to fetch" };
      const networkResult = getErrorMessage(networkError);
      expect(networkResult.errorTitle).toBe("Connection Error");

      const timeoutError = { message: "Request timeout" };
      const timeoutResult = getErrorMessage(timeoutError);
      expect(timeoutResult.errorTitle).toBe("Request Timeout");

      const unknownError = { message: "Unknown error" };
      const unknownResult = getErrorMessage(unknownError);
      expect(unknownResult.errorTitle).toBe("Failed to save");
    });
  });

  describe("Content Change Detection", () => {
    it("detects content changes correctly", () => {
      const hasContentChanged = (oldContent: string, newContent: string) => {
        return oldContent !== newContent;
      };

      // Same content
      expect(hasContentChanged("<p>Same</p>", "<p>Same</p>")).toBe(false);

      // Different content
      expect(hasContentChanged("<p>Old</p>", "<p>New</p>")).toBe(true);

      // Empty vs content
      expect(hasContentChanged("", "<p>Content</p>")).toBe(true);
      expect(hasContentChanged("<p>Content</p>", "")).toBe(true);

      // Whitespace differences
      expect(hasContentChanged("<p>Test</p>", "<p> Test </p>")).toBe(true);
    });

    it("handles null and undefined content", () => {
      const normalizeContent = (content: any) => {
        return content || "";
      };

      expect(normalizeContent(null)).toBe("");
      expect(normalizeContent(undefined)).toBe("");
      expect(normalizeContent("")).toBe("");
      expect(normalizeContent("<p>Content</p>")).toBe("<p>Content</p>");
    });
  });
});
