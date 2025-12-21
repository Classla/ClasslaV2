import axios, { AxiosError, AxiosResponse } from "axios";
import type {
  SubmissionWithStudent,
  GradebookData,
  StudentGradesData,
  Grader,
  CreateGraderWithSubmissionRequest,
  CreateGraderWithSubmissionResponse,
  AutogradeResponse,
} from "../types";

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
  timeout: 10000, // 10 second timeout for most requests
  withCredentials: true, // Include cookies for session-based auth (required for WorkOS sessions)
});

// Create separate axios instance for AI calls with no timeout
// AI generation can take 30+ seconds, so we don't want to timeout
const aiApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 0, // No timeout for AI generation
  withCredentials: true,
});

// Add response interceptor for AI API (same error handling)
aiApi.interceptors.response.use(
  (response) => {
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
    if (error.response) {
      const response = error.response as AxiosResponse<ApiErrorResponse>;
      if (import.meta.env.DEV) {
        console.error(
          `❌ ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
          {
            status: response.status,
            error: response.data,
          }
        );
      }
      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent("auth:session-expired"));
        const currentPath = window.location.pathname;
        if (
          !currentPath.startsWith("/signin") &&
          !currentPath.startsWith("/signup") &&
          !currentPath.startsWith("/auth")
        ) {
          window.location.href = "/signin";
        }
      }
      if (response.status === 403) {
        console.warn("Access forbidden - insufficient permissions");
      }
      throw new ApiError(response);
    } else if (error.request) {
      console.error("Network error:", error.message);
      throw new Error("Network error: Unable to connect to server");
    } else {
      console.error("Request error:", error.message);
      throw new Error(`Request error: ${error.message}`);
    }
  }
);

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
  deleteCourse: (id: string) => api.delete(`/course/${id}`),
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

  // Folder endpoints
  getCourseFolders: (courseId: string) =>
    api.get(`/course/${courseId}/folders`),
  createFolder: (data: {
    course_id: string;
    path: string[];
    name: string;
    order_index?: number;
  }) => api.post("/folder", data),
  updateFolder: (
    id: string,
    data: {
      name?: string;
      order_index?: number;
    }
  ) => api.put(`/folder/${id}`, data),
  deleteFolder: (id: string) => api.delete(`/folder/${id}`),
  moveFolder: (id: string, newPath: string[]) =>
    api.put(`/folder/${id}/move`, { newPath }),
  reorderItems: (
    courseId: string,
    items: Array<{
      id: string;
      type: "folder" | "assignment";
      order_index: number;
    }>
  ) => api.put(`/course/${courseId}/reorder`, { items }),

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
    order_index?: number;
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
      order_index?: number;
    }
  ) => api.put(`/assignment/${id}`, data),
  deleteAssignment: (id: string) => api.delete(`/assignment/${id}`),
  duplicateAssignment: (id: string) => api.post(`/assignment/${id}/duplicate`),
  cloneAssignmentToCourse: (id: string, targetCourseId: string) =>
    api.post(`/assignment/${id}/clone-to-course`, { targetCourseId }),

  // Submission endpoints
  getSubmission: (id: string) => api.get(`/submission/${id}`),
  getSubmissionsByAssignment: (assignmentId: string) =>
    api.get(`/submissions/by-assignment/${assignmentId}`),
  getSubmissionsWithStudents: (
    assignmentId: string
  ): Promise<AxiosResponse<SubmissionWithStudent[]>> =>
    api.get(`/submissions/by-assignment/${assignmentId}/with-students`),
  createOrUpdateSubmission: (data: {
    assignment_id: string;
    values: Record<string, any>;
    course_id: string;
  }) => api.post("/submission", data),
  updateSubmissionValues: (id: string, values: Record<string, any>) =>
    api.put(`/submission/${id}`, { values }),
  submitSubmission: (id: string) => api.post(`/submission/${id}/submit`),
  gradeSubmission: (id: string, grade: number, grader_id?: string) =>
    api.put(`/submission/${id}/grade`, { grade, grader_id }),

  // Grader endpoints
  autoSaveGrader: (
    graderId: string,
    updates: Partial<Grader>
  ): Promise<AxiosResponse<Grader>> =>
    api.put(`/grader/${graderId}/auto-save`, updates),
  updateGrader: (
    graderId: string,
    updates: Partial<Grader>
  ): Promise<AxiosResponse<Grader>> => api.put(`/grader/${graderId}`, updates),
  createGrader: (data: {
    feedback: string;
    rubric_id?: string;
    raw_assignment_score: number;
    raw_rubric_score: number;
    score_modifier: string;
    submission_id: string;
  }) => api.post("/grader", data),
  createGraderWithSubmission: (
    data: CreateGraderWithSubmissionRequest
  ): Promise<AxiosResponse<CreateGraderWithSubmissionResponse>> =>
    api.post("/grader/create-with-submission", data),

  // Gradebook endpoints
  getCourseGradebook: (
    courseId: string
  ): Promise<AxiosResponse<GradebookData>> =>
    api.get(`/course/${courseId}/gradebook`),
  getStudentGrades: (
    courseId: string
  ): Promise<AxiosResponse<StudentGradesData>> =>
    api.get(`/course/${courseId}/grades/student`),

  // Block autograding endpoints
  autogradeBlocks: (
    assignmentId: string,
    submissionValues: Record<string, any>
  ) => api.post(`/blocks/autograde/${assignmentId}`, { submissionValues }),
  extractBlocks: (assignmentId: string) =>
    api.get(`/blocks/extract/${assignmentId}`),

  // Autograding endpoint
  autogradeSubmission: (
    submissionId: string
  ): Promise<AxiosResponse<AutogradeResponse>> =>
    api.post(`/autograder/grade/${submissionId}`),

  // Rubric endpoints
  getRubricSchema: (assignmentId: string) =>
    api.get(`/rubric-schema/${assignmentId}`),
  createRubricSchema: (data: {
    assignment_id: string;
    title: string;
    type: string;
    use_for_grading?: boolean;
    items: Array<{ title: string; points: number }>;
  }) => api.post("/rubric-schema", data),
  updateRubricSchema: (
    id: string,
    data: {
      title?: string;
      type?: string;
      use_for_grading?: boolean;
      items?: Array<{ title: string; points: number }>;
    }
  ) => api.put(`/rubric-schema/${id}`, data),
  deleteRubricSchema: (id: string) => api.delete(`/rubric-schema/${id}`),
  getRubric: (submissionId: string) => api.get(`/rubric/${submissionId}`),
  createRubric: (data: {
    submission_id: string;
    rubric_schema_id: string;
    values: number[];
  }) => api.post("/rubric", data),
  updateRubric: (id: string, data: { values: number[] }) =>
    api.put(`/rubric/${id}`, data),

  // AI endpoints (uses separate axios instance with no timeout)
  generateAIContent: (prompt: string, assignmentId: string) =>
    aiApi.post("/ai/generate", { prompt, assignmentId }),

  // IDE Block endpoints
  startIDEContainer: (data: {
    s3Bucket: string;
    s3Region: string;
    userId?: string;
    useLocalIDE?: boolean;
  }) => {
    const headers: Record<string, string> = {};
    if (data.useLocalIDE) {
      headers["X-IDE-Environment"] = "local";
    }
    // Remove useLocalIDE from body before sending
    const { useLocalIDE, ...bodyData } = data;
    return api.post("/ide-blocks/start-container", bodyData, { headers });
  },
  checkContainerStatus: (containerId: string, useLocalIDE?: boolean) => {
    const headers: Record<string, string> = {};
    if (useLocalIDE) {
      headers["X-IDE-Environment"] = "local";
    }
    return api.get(`/ide-blocks/container/${containerId}`, { headers });
  },
  getS3Bucket: (bucketId: string) => api.get(`/s3buckets/${bucketId}`),
  createS3Bucket: (data: {
    user_id: string;
    course_id?: string;
    assignment_id?: string;
    region?: string;
  }) => api.post("/s3buckets", data),

  // Organization endpoints
  getOrganizations: () => api.get("/organizations"),
  getOrganization: (id: string) => api.get(`/organization/${id}`),
  getOrganizationBySlug: (slug: string) =>
    api.get(`/organization/by-slug/${slug}`),
  createOrganization: (data: { name: string }) =>
    api.post("/organization", data),
  updateOrganization: (
    id: string,
    data: {
      name?: string;
    }
  ) => api.put(`/organization/${id}`, data),
  deleteOrganization: (id: string) => api.delete(`/organization/${id}`),
  joinOrganization: (data: { slug: string }) =>
    api.post("/organization/join", data),
  getOrganizationMembers: (organizationId: string) =>
    api.get(`/organization/${organizationId}/members`),
  addOrganizationMember: (
    organizationId: string,
    data: { user_id: string; role?: string }
  ) => api.post(`/organization/${organizationId}/members`, data),
  updateOrganizationMember: (
    organizationId: string,
    userId: string,
    data: { role: string }
  ) => api.put(`/organization/${organizationId}/members/${userId}`, data),
  removeOrganizationMember: (organizationId: string, userId: string) =>
    api.delete(`/organization/${organizationId}/members/${userId}`),

  // Course template endpoints
  getTemplates: (organizationId: string) =>
    api.get(`/organization/${organizationId}/templates`),
  getTemplate: (id: string) => api.get(`/template/${id}`),
  createTemplate: (
    organizationId: string,
    data: {
      name: string;
      settings?: any;
      thumbnail_url?: string;
      summary_content?: string;
      slug?: string;
    }
  ) => api.post(`/organization/${organizationId}/templates`, data),
  updateTemplate: (
    id: string,
    data: {
      name?: string;
      settings?: any;
      thumbnail_url?: string;
      summary_content?: string;
      slug?: string;
    }
  ) => api.put(`/template/${id}`, data),
  deleteTemplate: (id: string) => api.delete(`/template/${id}`),
  cloneTemplate: (id: string) => api.post(`/template/${id}/clone`),
  exportCourseToTemplate: (courseId: string, data: { organizationId: string; name: string }) =>
    api.post(`/export-to-template/${courseId}`, data),
};

export default api;
