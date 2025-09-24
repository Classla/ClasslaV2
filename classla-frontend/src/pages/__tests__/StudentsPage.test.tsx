import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import StudentsPage from "../StudentsPage";
import { UserRole } from "../../types";

// Mock the API client
vi.mock("../../lib/api", () => ({
  apiClient: {
    getCourseStudents: vi.fn().mockResolvedValue({ data: { data: [] } }),
    getCourseEnrollments: vi.fn().mockResolvedValue({ data: { data: [] } }),
    getCurrentUserEnrollment: vi.fn().mockResolvedValue({
      data: {
        data: {
          id: "enrollment-1",
          role: "instructor",
          section_id: null,
          section: null,
        },
      },
    }),
    getCourseSections: vi.fn().mockResolvedValue({ data: { data: [] } }),
    createSection: vi.fn(),
    updateEnrollment: vi.fn(),
    deleteEnrollment: vi.fn(),
  },
}));

// Mock the toast hook
vi.mock("../../hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock react-router-dom
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ courseSlug: "test-course" }),
  };
});

const mockCourse = {
  id: "course-1",
  name: "Test Course",
  slug: "TEST123",
  created_by_id: "user-1",
  created_at: new Date(),
  settings: {},
  thumbnail_url: "",
  summary_content: "",
};

const renderStudentsPage = (props = {}) => {
  const defaultProps = {
    course: mockCourse,
    userRole: UserRole.INSTRUCTOR,
    isStudent: false,
    isInstructor: true,
    ...props,
  };

  return render(
    <BrowserRouter>
      <StudentsPage {...defaultProps} />
    </BrowserRouter>
  );
};

describe("StudentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the students page title", async () => {
    renderStudentsPage();
    // Wait for loading to complete - instructors see "Course Members"
    await screen.findByText("Course Members");
    expect(screen.getByText("Course Members")).toBeInTheDocument();
  });

  it("shows create section button for instructors", async () => {
    renderStudentsPage({
      userRole: UserRole.INSTRUCTOR,
      isInstructor: true,
      isStudent: false,
    });

    // Wait for loading to complete - instructors see "Course Members"
    await screen.findByText("Course Members");
    expect(screen.getByText("Create Section")).toBeInTheDocument();
  });

  it("does not show create section button for students", () => {
    renderStudentsPage({
      userRole: UserRole.STUDENT,
      isInstructor: false,
      isStudent: true,
    });

    expect(screen.queryByText("Create Section")).not.toBeInTheDocument();
  });

  it("shows students title for student users", async () => {
    renderStudentsPage({
      userRole: UserRole.STUDENT,
      isInstructor: false,
      isStudent: true,
    });

    // Wait for loading to complete - students see "Students"
    await screen.findByText("Students");
    expect(screen.getByText("Students")).toBeInTheDocument();
  });

  it("does not show section filter for students", async () => {
    renderStudentsPage({
      userRole: UserRole.STUDENT,
      isInstructor: false,
      isStudent: true,
    });

    // Wait for loading to complete
    await screen.findByText("Students");

    // Students should not see the section filter
    expect(screen.queryByText("Filter by Section")).not.toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    renderStudentsPage();
    expect(screen.getByText("Loading students...")).toBeInTheDocument();
  });
});
