import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GradingPanel from "../GradingPanel";
import { apiClient } from "../../lib/api";

// Create a test query client
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

// Mock the API client
vi.mock("../../lib/api", () => ({
  apiClient: {
    getSubmissionsWithStudents: vi.fn(),
    getCourseSections: vi.fn(),
    autoSaveGrader: vi.fn(),
  },
}));

// Mock the child components
vi.mock("../StudentList", () => ({
  default: ({ students }: any) => (
    <div data-testid="student-list">
      Student List ({students.length} students)
    </div>
  ),
}));

vi.mock("../StudentSubmissionView", () => ({
  StudentSubmissionView: () => (
    <div data-testid="student-submission-view">Student Submission View</div>
  ),
}));

describe("GradingPanel Integration", () => {
  const mockAssignment = {
    id: "assignment-1",
    name: "Test Assignment",
    course_id: "course-1",
    content: {},
    published_to: [],
    due_dates_map: {},
    timestamp: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with assignment and courseId props", async () => {
    // Mock API responses
    vi.mocked(apiClient.getSubmissionsWithStudents).mockResolvedValue({
      data: [],
    } as any);

    vi.mocked(apiClient.getCourseSections).mockResolvedValue({
      data: [],
    } as any);

    const onClose = vi.fn();
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <GradingPanel
            assignment={mockAssignment as any}
            courseId="course-1"
            onClose={onClose}
          />
        </BrowserRouter>
      </QueryClientProvider>
    );

    // Check that the panel header is rendered
    expect(screen.getByText("Grading Panel")).toBeInTheDocument();

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.getByTestId("student-list")).toBeInTheDocument();
    });
  });

  it("calls onClose when close button is clicked", async () => {
    vi.mocked(apiClient.getSubmissionsWithStudents).mockResolvedValue({
      data: [],
    } as any);

    vi.mocked(apiClient.getCourseSections).mockResolvedValue({
      data: [],
    } as any);

    const onClose = vi.fn();
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <GradingPanel
            assignment={mockAssignment as any}
            courseId="course-1"
            onClose={onClose}
          />
        </BrowserRouter>
      </QueryClientProvider>
    );

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.getByTestId("student-list")).toBeInTheDocument();
    });

    // Click the close button (it has an X icon, not text)
    const closeButton = screen.getByRole("button");
    closeButton.click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fetches submissions and sections on mount", async () => {
    const mockSubmissions = [
      {
        submission: {
          id: "sub-1",
          assignment_id: "assignment-1",
          student_id: "student-1",
          status: "submitted",
        },
        student: {
          id: "student-1",
          firstName: "John",
          lastName: "Doe",
        },
        grader: null,
        sectionId: "section-1",
        sectionName: "Section A",
      },
    ];

    const mockSections = [
      {
        id: "section-1",
        name: "Section A",
        course_id: "course-1",
      },
    ];

    vi.mocked(apiClient.getSubmissionsWithStudents).mockResolvedValue({
      data: mockSubmissions,
    } as any);

    vi.mocked(apiClient.getCourseSections).mockResolvedValue({
      data: mockSections,
    } as any);

    const onClose = vi.fn();
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <GradingPanel
            assignment={mockAssignment as any}
            courseId="course-1"
            onClose={onClose}
          />
        </BrowserRouter>
      </QueryClientProvider>
    );

    // Wait for API calls
    await waitFor(() => {
      expect(apiClient.getSubmissionsWithStudents).toHaveBeenCalledWith(
        "assignment-1"
      );
      expect(apiClient.getCourseSections).toHaveBeenCalledWith("course-1");
    });

    // Check that student list is rendered with data
    await waitFor(() => {
      expect(screen.getByText(/1 students/)).toBeInTheDocument();
    });
  });
});
