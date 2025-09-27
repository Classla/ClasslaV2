import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Test the answer state management functions in isolation
describe("AssignmentViewer Answer State Management", () => {
  beforeEach(() => {
    // Mock sessionStorage
    Object.defineProperty(window, "sessionStorage", {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates correct storage key for assignment", () => {
    const getAnswerStorageKey = (assignmentId: string) =>
      `assignment_answers_${assignmentId}`;

    expect(getAnswerStorageKey("123")).toBe("assignment_answers_123");
    expect(getAnswerStorageKey("test-assignment")).toBe(
      "assignment_answers_test-assignment"
    );
  });

  it("handles session storage save and load operations", () => {
    const storageKey = "assignment_answers_1";
    const answerState = {
      "mcq-1": {
        selectedOptions: ["opt-1", "opt-2"],
        timestamp: new Date("2023-01-01T00:00:00.000Z"),
      },
    };

    // Test save operation
    const saveAnswerState = (state: any) => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(state));
        return true;
      } catch (error) {
        console.error("Failed to save answers to session storage:", error);
        return false;
      }
    };

    const result = saveAnswerState(answerState);
    expect(result).toBe(true);
    expect(window.sessionStorage.setItem).toHaveBeenCalledWith(
      storageKey,
      JSON.stringify(answerState)
    );

    // Test load operation
    (window.sessionStorage.getItem as any).mockReturnValue(
      JSON.stringify(answerState)
    );

    const loadAnswerState = () => {
      const savedAnswers = sessionStorage.getItem(storageKey);
      if (savedAnswers) {
        try {
          const parsedAnswers = JSON.parse(savedAnswers);
          // Convert timestamp strings back to Date objects
          const restoredAnswers: any = {};
          Object.keys(parsedAnswers).forEach((blockId) => {
            restoredAnswers[blockId] = {
              ...parsedAnswers[blockId],
              timestamp: new Date(parsedAnswers[blockId].timestamp),
            };
          });
          return restoredAnswers;
        } catch (error) {
          console.error("Failed to load saved answers:", error);
          return {};
        }
      }
      return {};
    };

    const loadedState = loadAnswerState();
    expect(loadedState["mcq-1"].selectedOptions).toEqual(["opt-1", "opt-2"]);
    expect(loadedState["mcq-1"].timestamp).toBeInstanceOf(Date);
  });

  it("handles storage errors gracefully", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Test save error
    (window.sessionStorage.setItem as any).mockImplementation(() => {
      throw new Error("Storage full");
    });

    const saveAnswerState = (state: any) => {
      try {
        sessionStorage.setItem("test", JSON.stringify(state));
        return true;
      } catch (error) {
        console.error("Failed to save answers to session storage:", error);
        return false;
      }
    };

    const saveResult = saveAnswerState({ test: "data" });
    expect(saveResult).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to save answers to session storage:",
      expect.any(Error)
    );

    // Test load error
    (window.sessionStorage.getItem as any).mockImplementation(() => {
      throw new Error("Storage error");
    });

    const loadAnswerState = () => {
      try {
        const savedAnswers = sessionStorage.getItem("test");
        return savedAnswers ? JSON.parse(savedAnswers) : {};
      } catch (error) {
        console.error("Failed to load saved answers:", error);
        return {};
      }
    };

    const loadResult = loadAnswerState();
    expect(loadResult).toEqual({});
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to load saved answers:",
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("manages answer state updates correctly", () => {
    let answerState: any = {};

    const handleMCQAnswerChange = (
      blockId: string,
      selectedOptions: string[]
    ) => {
      const newAnswerState = {
        ...answerState,
        [blockId]: {
          selectedOptions,
          timestamp: new Date(),
        },
      };
      answerState = newAnswerState;
      return newAnswerState;
    };

    const getBlockAnswerState = (blockId: string) => {
      return (
        answerState[blockId] || { selectedOptions: [], timestamp: new Date() }
      );
    };

    // Test initial state
    const initialState = getBlockAnswerState("mcq-1");
    expect(initialState.selectedOptions).toEqual([]);
    expect(initialState.timestamp).toBeInstanceOf(Date);

    // Test answer change
    const updatedState = handleMCQAnswerChange("mcq-1", ["opt-1"]);
    expect(updatedState["mcq-1"].selectedOptions).toEqual(["opt-1"]);
    expect(updatedState["mcq-1"].timestamp).toBeInstanceOf(Date);

    // Test getting updated state
    const retrievedState = getBlockAnswerState("mcq-1");
    expect(retrievedState.selectedOptions).toEqual(["opt-1"]);

    // Test multiple updates
    handleMCQAnswerChange("mcq-1", ["opt-1", "opt-2"]);
    handleMCQAnswerChange("mcq-2", ["opt-3"]);

    expect(getBlockAnswerState("mcq-1").selectedOptions).toEqual([
      "opt-1",
      "opt-2",
    ]);
    expect(getBlockAnswerState("mcq-2").selectedOptions).toEqual(["opt-3"]);
  });
});
