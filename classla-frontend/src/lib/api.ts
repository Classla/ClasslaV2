import axios, { AxiosError, AxiosResponse } from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";

// Error response interface matching backend
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
  path: string;
  requestId?: string;
}

// Custom API Error class
export class ApiError extends Error {
  public statusCode: number;
  public code: string;
  public path: string;
  public timestamp: string;
  public requestId?: string;
  public details?: any;

  constructor(response: AxiosResponse<ApiErrorResponse>) {
    const errorData = response.data.error;
    super(errorData.message);

    this.name = "ApiError";
    this.statusCode = response.status;
    this.code = errorData.code;
    this.path = response.data.path;
    this.timestamp = response.data.timestamp;
    this.requestId = response.data.requestId;
    this.details = errorData.details;
  }
}

// Create axios instance configured for session-based authentication
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000, // 10 second timeout
  withCredentials: true, // Include cookies for session-based auth (required for WorkOS sessions)
});

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    // Log successful responses in development
    if (import.meta.env.DEV) {
      console.log(
        `✅ ${response.config.method?.toUpperCase()} ${response.config.url}`,
        {
          status: response.status,
          data: response.data,
        }
      );
    }
    return response;
  },
  (error: AxiosError) => {
    // Handle different types of errors
    if (error.response) {
      // Server responded with error status
      const response = error.response as AxiosResponse<ApiErrorResponse>;

      // Log error in development
      if (import.meta.env.DEV) {
        console.error(
          `❌ ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
          {
            status: response.status,
            error: response.data,
          }
        );
      }

      // Handle authentication errors
      if (response.status === 401) {
        // Session expired or invalid, dispatch custom event for AuthContext
        window.dispatchEvent(new CustomEvent("auth:session-expired"));

        // Only redirect if not already on auth pages
        const currentPath = window.location.pathname;
        if (
          !currentPath.startsWith("/signin") &&
          !currentPath.startsWith("/signup") &&
          !currentPath.startsWith("/auth")
        ) {
          window.location.href = "/signin";
        }
      }

      // Handle forbidden errors (403)
      if (response.status === 403) {
        console.warn("Access forbidden - insufficient permissions");
        // Don't redirect, let the component handle the error
      }

      // Create custom API error
      throw new ApiError(response);
    } else if (error.request) {
      // Network error or no response
      console.error("Network error:", error.message);
      throw new Error("Network error: Unable to connect to server");
    } else {
      // Request setup error
      console.error("Request error:", error.message);
      throw new Error(`Request error: ${error.message}`);
    }
  }
);

// API functions
export const apiClient = {
  // User endpoints
  getUser: (id: string) => api.get(`/user/${id}`),
  updateUser: (id: string, data: any) => api.put(`/user/${id}`, data),
  getUserCourses: (userId: string) => api.get(`/users/${userId}/courses`),
  getUserRole: (courseId: string) => api.get(`/user/role/${courseId}`),
  enrollUser: (data: { user_id: string; course_id: string; role: string }) =>
    api.post("/user/enroll", data),

  // Course endpoints
  getCourses: () => api.get("/courses"),
  getCourse: (id: string) => api.get(`/course/${id}`),
  getCourseBySlug: (slug: string) => api.get(`/course/by-slug/${slug}`),
  createCourse: (data: {
    name: string;
    description?: string;
    settings?: any;
    thumbnail_url?: string;
    summary_content?: string;
  }) => api.post("/course", data),
  updateCourse: (
    id: string,
    data: {
      name?: string;
      description?: string;
      settings?: any;
      thumbnail_url?: string;
      summary_content?: string;
    }
  ) => api.put(`/course/${id}`, data),
  joinCourse: (data: { slug: string }) => api.post("/course/join", data),
  getCourseStudents: (courseId: string) =>
    api.get(`/course/${courseId}/students`),
  getCourseEnrollments: (courseId: string) =>
    api.get(`/course/${courseId}/enrollments`),
  getCurrentUserEnrollment: (courseId: string) =>
    api.get(`/course/${courseId}/my-enrollment`),

  // Section endpoints
  getCourseSections: (courseId: string) =>
    api.get(`/sections/by-course/${courseId}`),
  createSection: (data: {
    course_id: string;
    name: string;
    description?: string;
  }) => api.post("/sections", data),

  // Enrollment endpoints
  updateEnrollment: (
    enrollmentId: string,
    data: {
      section_id?: string | null;
      role?: string;
    }
  ) => api.put(`/enrollments/${enrollmentId}`, data),
  deleteEnrollment: (enrollmentId: string) =>
    api.delete(`/enrollments/${enrollmentId}`),

  // Assignment endpoints
  getCourseAssignments: (courseId: string) =>
    api.get(`/course/${courseId}/assignments`),
  getAssignment: (id: string) => api.get(`/assignment/${id}`),
  getAssignmentForStudent: (id: string) => api.get(`/assignment/${id}/student`),
  createAssignment: (data: {
    name: string;
    course_id: string;
    settings?: any;
    content?: string;
    published_to?: string[];
    due_dates_map?: Record<string, string>;
    module_path?: string[];
    is_lockdown?: boolean;
    lockdown_time_map?: Record<string, number>;
  }) => api.post("/assignment", data),
  updateAssignment: (
    id: string,
    data: {
      name?: string;
      settings?: any;
      content?: string;
      published_to?: string[];
      due_dates_map?: Record<string, string>;
      module_path?: string[];
      is_lockdown?: boolean;
      lockdown_time_map?: Record<string, number>;
    }
  ) => api.put(`/assignment/${id}`, data),
  deleteAssignment: (id: string) => api.delete(`/assignment/${id}`),
};

export default api;
