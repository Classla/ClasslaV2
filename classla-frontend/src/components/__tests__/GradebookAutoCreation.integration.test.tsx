import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserRouter } from "react-router-dom";
import GradebookPage from "../../pages/GradebookPage";
import * as api from "../../lib/api";

vi.mock("../../lib/api");

const mockApi = api as any;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
};

describe("Gradebook Auto-Creation Integration Tests", () => {
  const mockCourse = {
    id: "course-1",
    name: "Test Course",
    code: "TEST101",
  };

  const mockAssignments = [
    {
      id: "assignment-1",
      title: "Assignment 1",
      course_id: "course-1",
      max_score: 100,
      published: true,
    },
    {
      id: "assignment-2",
      title: "Assignment 2",
      course_id: "course-1",
      max_score: 50,
      published: true,
    },
  ];

  const mockGradebookData = {
    students: [
      {
        id: "student-1",
        firstName: "Alice",
        lastName: "Anderson",
        email: "alice@test.com",
      },
      {
        id: "student-2",
        firstName: "Bob",
        lastName: "Brown",
        email: "bob@test.com",
      },
      {
        id: "student-3",
        firstName: "Charlie",
        lastName: "Chen",
        email: "charlie@test.com",
      },
    ],
    assignments: mockAssignments,
    grades: {
      "student-1": {
        "assignment-1": {
          submission: {
            id: "sub-1",
            status: "submitted",
          },
          grader: {
            id: "grader-1",
            raw_assignment_score: 85,
            score_modifier: "+5",
          },
          finalGrade: 90,
        },
        "assignment-2": {
          submission: {
            id: "sub-2",
            status: "submitted",
          },
          grader: null,
        },
      },
      "student-2": {
        "assignment-1": {
          submission: null,
          grader: null,
        },
        "assignment-2": {
          submission: {
            id: "sub-3",
            status: "in-progress",
          },
          grader: null,
        },
      },
      "student-3": {
        "assignment-1": {
          submission: {
            id: "sub-4",
            status: "submitted",
          },
          grader: {
            id: "grader-4",
            raw_assignment_score: 75,
            score_modifier: "",
          },
          finalGrade: 75,
        },
        "assignment-2": {
          submission: null,
          grader: null,
        },
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/courses/")) {
        return Promise.resolve({ data: mockCourse });
      }
      if (url.includes("/gradebook")) {
        return Promise.resolve({ data: mockGradebookData });
      }
      return Promise.reject(new Error("Unknown endpoint"));
    });
  });

  it("should display all students in gradebook including non-submitters", async () => {
    render(<GradebookPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Anderson, Alice")).toBeInTheDocument();
      expect(screen.getByText("Brown, Bob")).toBeInTheDocument();
      expect(screen.getByText("Chen, Charlie")).toBeInTheDocument();
    });
  });

  it("should show correct status for different submission states in gradebook cells", async () => {
    render(<GradebookPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      // Alice - Assignment 1: Graded (90)
      const aliceRow = screen.getByText("Anderson, Alice").closest("tr");
      expect(within(aliceRow!).getByText("90")).toBeInTheDocument();

      // Alice - Assignment 2: Submitted but not graded
      expect(within(aliceRow!).getByText(/Submitted/i)).toBeInTheDocument();

      // Bob - Assignment 1: Not Started
      const bobRow = screen.getByText("Brown, Bob").closest("tr");
      expect(within(bobRow!).getByText(/Not Started/i)).toBeInTheDocument();

      // Bob - Assignment 2: In Progress
      expect(within(bobRow!).getByText(/In Progress/i)).toBeInTheDocument();

      // Charlie - Assignment 1: Graded (75)
      const charlieRow = screen.getByText("Chen, Charlie").closest("tr");
      expect(within(charlieRow!).getByText("75")).toBeInTheDocument();

      // Charlie - Assignment 2: Not Started
      expect(within(charlieRow!).getByText(/Not Started/i)).toBeInTheDocument();
    });
  });

  it("should apply correct color coding to status cells", async () => {
    render(<GradebookPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      const bobRow = screen.getByText("Brown, Bob").closest("tr");

      // Not Started should be red
      const notStartedCell = within(bobRow!).getByText(/Not Started/i);
      expect(notStartedCell).toHaveClass("text-red-600");

      // In Progress should be yellow
      const inProgressCell = within(bobRow!).getByText(/In Progress/i);
      expect(inProgressCell).toHaveClass("text-yellow-600");
    });
  });

  it('should make all cells clickable including "Not Started" cells', async () => {
    const user = userEvent.setup();

    render(<GradebookPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Brown, Bob")).toBeInTheDocument();
    });

    const bobRow = screen.getByText("Brown, Bob").closest("tr");
    const notStartedCell = within(bobRow!)
      .getByText(/Not Started/i)
      .closest("td");

    // Verify cell is clickable
    expect(notStartedCell).toHaveClass("cursor-pointer");

    // Click on "Not Started" cell
    await user.click(notStartedCell!);

    // Verify grading panel opens (this would show the student name in the panel)
    await waitFor(() => {
      expect(screen.getByText(/Grading:/i)).toBeInTheDocument();
    });
  });

  it("should handle clicking on cells with different statuses", async () => {
    const user = userEvent.setup();

    render(<GradebookPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Anderson, Alice")).toBeInTheDocument();
    });

    // Click on graded cell
    const aliceRow = screen.getByText("Anderson, Alice").closest("tr");
    const gradedCell = within(aliceRow!).getByText("90").closest("td");
    await user.click(gradedCell!);

    await waitFor(() => {
      expect(screen.getByText(/Grading:/i)).toBeInTheDocument();
    });

    // Close panel
    const closeButton = screen.getByRole("button", { name: /close/i });
    await user.click(closeButton);

    // Click on "Submitted" cell
    const submittedCell = within(aliceRow!)
      .getByText(/Submitted/i)
      .closest("td");
    await user.click(submittedCell!);

    await waitFor(() => {
      expect(screen.getByText(/Grading:/i)).toBeInTheDocument();
    });
  });

  it("should trigger auto-creation when grading from gradebook cell", async () => {
    const user = userEvent.setup();

    mockApi.post.mockResolvedValue({
      data: {
        submission: {
          id: "new-submission",
          assignment_id: "assignment-1",
          student_id: "student-2",
          status: "in-progress",
          content: {},
          grade: null,
        },
        grader: {
          id: "new-grader",
          submission_id: "new-submission",
          raw_assignment_score: 0,
          raw_rubric_score: 0,
          score_modifier: "",
          feedback: "",
          reviewed_at: null,
        },
        created: {
          submission: true,
          grader: true,
        },
      },
    });

    render(<GradebookPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Brown, Bob")).toBeInTheDocument();
    });

    // Click on "Not Started" cell for Bob
    const bobRow = screen.getByText("Brown, Bob").closest("tr");
    const notStartedCell = within(bobRow!)
      .getByText(/Not Started/i)
      .closest("td");
    await user.click(notStartedCell!);

    // Wait for grading panel to open
    await waitFor(() => {
      expect(screen.getByText(/Grading:/i)).toBeInTheDocument();
    });

    // Focus on score input to trigger auto-creation
    const scoreInput = screen.getByLabelText(/score modifier/i);
    await user.click(scoreInput);

    // Verify auto-creation was triggered
    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        "/grader/create-with-submission",
        expect.objectContaining({
          assignmentId: "assignment-1",
          studentId: "student-2",
          courseId: "course-1",
        })
      );
    });
  });

  it("should handle large class sizes efficiently", async () => {
    // Create mock data for 100 students
    const largeClassData = {
      students: Array.from({ length: 100 }, (_, i) => ({
        id: `student-${i}`,
        firstName: `Student${i}`,
        lastName: `Last${i}`,
        email: `student${i}@test.com`,
      })),
      assignments: mockAssignments,
      grades: {},
    };

    // Add grades for all students
    largeClassData.students.forEach((student) => {
      largeClassData.grades[student.id] = {
        "assignment-1": {
          submission:
            Math.random() > 0.3
              ? {
                  id: `sub-${student.id}-1`,
                  status: "submitted",
                }
              : null,
          grader: null,
        },
        "assignment-2": {
          submission:
            Math.random() > 0.5
              ? {
                  id: `sub-${student.id}-2`,
                  status: "in-progress",
                }
              : null,
          grader: null,
        },
      };
    });

    mockApi.get.mockImplementation((url: string) => {
      if (url.includes("/courses/")) {
        return Promise.resolve({ data: mockCourse });
      }
      if (url.includes("/gradebook")) {
        return Promise.resolve({ data: largeClassData });
      }
      return Promise.reject(new Error("Unknown endpoint"));
    });

    const startTime = performance.now();
    render(<GradebookPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Last0, Student0")).toBeInTheDocument();
    });

    const endTime = performance.now();
    const renderTime = endTime - startTime;

    // Verify render time is reasonable (less than 3 seconds)
    expect(renderTime).toBeLessThan(3000);

    // Verify all students are rendered (check first and last)
    expect(screen.getByText("Last0, Student0")).toBeInTheDocument();
    expect(screen.getByText("Last99, Student99")).toBeInTheDocument();
  });
});
