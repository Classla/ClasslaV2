import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { io } from "socket.io-client";
import { apiClient } from "../lib/api";
import { Grader } from "../types";

const getBaseURL = () => {
  const apiUrl =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
  return apiUrl.replace(/\/api$/, "") || "http://localhost:8000";
};

/**
 * Hook to fetch submissions with student information for an assignment
 */
export function useSubmissionsWithStudents(assignmentId: string) {
  return useQuery({
    queryKey: ["submissions", "with-students", assignmentId],
    queryFn: async () => {
      const response = await apiClient.getSubmissionsWithStudents(assignmentId);
      return response.data;
    },
    enabled: !!assignmentId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/**
 * Subscribe to real-time submission updates for an assignment.
 * Invalidates the submissions query when a student starts or submits.
 */
export function useSubmissionUpdates(assignmentId: string, courseId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!courseId || !assignmentId) return;

    const socket = io(`${getBaseURL()}/course-tree`, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });

    socket.on("connect", () => {
      socket.emit("join-course", courseId);
    });

    socket.on("submission-update", (data: { assignmentId: string }) => {
      if (data.assignmentId === assignmentId) {
        queryClient.invalidateQueries({
          queryKey: ["submissions", "with-students", assignmentId],
        });
      }
    });

    return () => {
      socket.emit("leave-course", courseId);
      socket.disconnect();
    };
  }, [courseId, assignmentId, queryClient]);
}

/**
 * Hook to fetch course sections
 */
export function useCourseSections(courseId: string) {
  return useQuery({
    queryKey: ["sections", courseId],
    queryFn: async () => {
      const response = await apiClient.getCourseSections(courseId);
      return response.data.data;
    },
    enabled: !!courseId,
  });
}

/**
 * Hook to fetch gradebook data for a course
 */
export function useCourseGradebook(courseId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ["gradebook", courseId],
    queryFn: async () => {
      const response = await apiClient.getCourseGradebook(courseId);
      return response.data;
    },
    enabled: !!courseId && enabled,
  });
}

/**
 * Subscribe to real-time gradebook updates for a course.
 * Invalidates the gradebook query when submissions or grader reviews change.
 */
export function useGradebookUpdates(courseId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!courseId) return;

    const socket = io(`${getBaseURL()}/course-tree`, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });

    socket.on("connect", () => {
      socket.emit("join-course", courseId);
    });

    const invalidateGradebook = () => {
      queryClient.invalidateQueries({
        queryKey: ["gradebook", courseId],
      });
    };

    socket.on("submission-update", invalidateGradebook);
    socket.on("grader-review-update", invalidateGradebook);

    return () => {
      socket.emit("leave-course", courseId);
      socket.disconnect();
    };
  }, [courseId, queryClient]);
}

/**
 * Hook to fetch student grades
 */
export function useStudentGrades(courseId: string) {
  return useQuery({
    queryKey: ["student-grades", courseId],
    queryFn: async () => {
      const response = await apiClient.getStudentGrades(courseId);
      return response.data;
    },
    enabled: !!courseId,
  });
}

/**
 * Hook to auto-save grader updates with optimistic updates
 */
export function useAutoSaveGrader() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      graderId,
      updates,
    }: {
      graderId: string;
      updates: Partial<Grader> & { reviewed?: boolean };
    }) => {
      const response = await apiClient.autoSaveGrader(graderId, updates);
      return response.data;
    },
    onSuccess: (updatedGrader, variables) => {
      // Invalidate related queries to refetch data
      queryClient.invalidateQueries({
        queryKey: ["submissions", "with-students"],
      });
      queryClient.invalidateQueries({
        queryKey: ["gradebook"],
      });
    },
  });
}
