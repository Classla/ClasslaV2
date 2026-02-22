import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { apiClient } from "../lib/api";
import { Assignment, Folder } from "../types";

const getBaseURL = () => {
  const apiUrl =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
  return apiUrl.replace(/\/api$/, "") || "http://localhost:8000";
};

export function useModuleTree(courseId: string) {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const dragLockRef = useRef(false);

  const assignmentsQuery = useQuery<Assignment[]>({
    queryKey: ["courseAssignments", courseId],
    queryFn: async () => {
      const response = await apiClient.getCourseAssignments(courseId);
      return response.data;
    },
    enabled: !!courseId,
  });

  const foldersQuery = useQuery<Folder[]>({
    queryKey: ["courseFolders", courseId],
    queryFn: async () => {
      const response = await apiClient.getCourseFolders(courseId);
      return response.data;
    },
    enabled: !!courseId,
  });

  const invalidateTree = useCallback(() => {
    if (dragLockRef.current) return; // Suppress during drag to protect optimistic state
    queryClient.invalidateQueries({ queryKey: ["courseAssignments", courseId] });
    queryClient.invalidateQueries({ queryKey: ["courseFolders", courseId] });
  }, [queryClient, courseId]);

  // Lock/unlock to prevent WebSocket invalidations from overwriting optimistic updates during drag
  const lockForDrag = useCallback(() => {
    dragLockRef.current = true;
  }, []);

  const unlockAfterDrag = useCallback(() => {
    dragLockRef.current = false;
    invalidateTree(); // Refetch to confirm server state
  }, [invalidateTree]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!courseId) return;

    const socket = io(`${getBaseURL()}/course-tree`, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join-course", courseId);
    });

    socket.on("tree-update", () => {
      invalidateTree();
    });

    return () => {
      socket.emit("leave-course", courseId);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [courseId, invalidateTree]);

  // Mutations
  const createAssignment = useMutation({
    mutationFn: (data: Parameters<typeof apiClient.createAssignment>[0]) =>
      apiClient.createAssignment(data),
    onSuccess: () => invalidateTree(),
  });

  const updateAssignment = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof apiClient.updateAssignment>[1] }) =>
      apiClient.updateAssignment(id, data),
    onSuccess: () => invalidateTree(),
  });

  const deleteAssignment = useMutation({
    mutationFn: (id: string) => apiClient.deleteAssignment(id),
    onSuccess: () => invalidateTree(),
  });

  const duplicateAssignment = useMutation({
    mutationFn: (id: string) => apiClient.duplicateAssignment(id),
    onSuccess: () => invalidateTree(),
  });

  const createFolder = useMutation({
    mutationFn: (data: Parameters<typeof apiClient.createFolder>[0]) =>
      apiClient.createFolder(data),
    onSuccess: () => invalidateTree(),
  });

  const updateFolder = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof apiClient.updateFolder>[1] }) =>
      apiClient.updateFolder(id, data),
    onSuccess: () => invalidateTree(),
  });

  const deleteFolder = useMutation({
    mutationFn: ({ id, options }: { id: string; options?: { transferTo?: string | null; deleteChildren?: boolean } }) =>
      apiClient.deleteFolder(id, options),
    onSuccess: () => invalidateTree(),
  });

  const moveFolder = useMutation({
    mutationFn: ({ id, newPath }: { id: string; newPath: string[] }) =>
      apiClient.moveFolder(id, newPath),
    onSuccess: () => invalidateTree(),
  });

  const reorderItems = useMutation({
    mutationFn: ({ courseId: cId, items }: { courseId: string; items: Array<{ id: string; type: "folder" | "assignment"; order_index: number }> }) =>
      apiClient.reorderItems(cId, items),
    onSuccess: () => invalidateTree(),
  });

  return {
    assignments: assignmentsQuery.data || [],
    folders: foldersQuery.data || [],
    isLoading: assignmentsQuery.isLoading || foldersQuery.isLoading,
    invalidateTree,
    lockForDrag,
    unlockAfterDrag,
    mutations: {
      createAssignment,
      updateAssignment,
      deleteAssignment,
      duplicateAssignment,
      createFolder,
      updateFolder,
      deleteFolder,
      moveFolder,
      reorderItems,
    },
  };
}
