import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Tree } from "react-arborist";

import { apiClient } from "../lib/api";
import { useToast } from "../hooks/use-toast";
import { useModuleTree } from "../hooks/useModuleTree";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  FileText,
  FileLock,
  Folder as FolderIcon,
  Edit,
  Trash2,
  Copy,
  Calendar,
  ArrowRight,
} from "lucide-react";
import { Assignment, Folder, UserRole, Course } from "../types";
import { hasTAPermission } from "../lib/taPermissions";
import { useAuth } from "../contexts/AuthContext";
import PublishingModal from "./PublishingModal";
import ModuleTreeSkeleton from "./ModuleTreeSkeleton";

interface ModuleTreeProps {
  courseId: string;
  course?: Course;
  userRole?: UserRole;
  isStudent?: boolean;
  isInstructor?: boolean;
}

// Tree node data structure for react-arborist
interface TreeNodeData {
  id: string;
  name: string;
  type: "folder" | "assignment";
  path: string[];
  order_index: number;
  children?: TreeNodeData[];
  // Assignment-specific fields
  assignment?: Assignment;
  // Folder-specific fields
  folder?: Folder;
}

const ModuleTree: React.FC<ModuleTreeProps> = ({ courseId, course, userRole, isInstructor }) => {
  const navigate = useNavigate();
  const { courseSlug } = useParams<{ courseSlug: string }>();
  const location = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Default to instructor false if not specified
  const effectiveIsInstructor = isInstructor ?? false;

  // Use React Query hook for data fetching + WebSocket real-time updates
  const { assignments, folders, isLoading, invalidateTree, mutations } = useModuleTree(
    courseId,
    effectiveIsInstructor
  );

  const currentAssignmentId = useMemo(() => {
    const pathParts = location.pathname.split("/");
    const idx = pathParts.indexOf("assignment");
    return idx !== -1 && idx + 1 < pathParts.length ? pathParts[idx + 1] : null;
  }, [location.pathname]);

  // Check TA permissions
  const canCreate = useMemo(() => {
    if (!isInstructor) return false;
    if (userRole !== UserRole.TEACHING_ASSISTANT) return true;
    return hasTAPermission(course ?? null, user?.id, userRole, "canCreate");
  }, [isInstructor, userRole, course, user?.id]);

  const canEdit = useMemo(() => {
    if (!isInstructor) return false;
    if (userRole !== UserRole.TEACHING_ASSISTANT) return true;
    return hasTAPermission(course ?? null, user?.id, userRole, "canEdit");
  }, [isInstructor, userRole, course, user?.id]);

  const canDelete = useMemo(() => {
    if (!isInstructor) return false;
    if (userRole !== UserRole.TEACHING_ASSISTANT) return true;
    return hasTAPermission(course ?? null, user?.id, userRole, "canDelete");
  }, [isInstructor, userRole, course, user?.id]);

  const [treeHeight, setTreeHeight] = useState(384);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [rootContextMenu, setRootContextMenu] = useState<{
    x: number;
    y: number;
    show: boolean;
  }>({ x: 0, y: 0, show: false });

  // Name dialog state (replaces prompt() — Bug 12)
  const [nameDialog, setNameDialog] = useState<{
    open: boolean;
    mode: "create-folder" | "rename-folder" | "rename-assignment";
    itemId?: string;
    defaultValue?: string;
    parentPath?: string[];
  }>({ open: false, mode: "create-folder" });
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Delete folder dialog with transfer option (Bug 6 enhanced)
  const [deleteFolderDialog, setDeleteFolderDialog] = useState<{
    open: boolean;
    folder: Folder | null;
    childFoldersCount: number;
    childAssignmentsCount: number;
    transferTarget: string | null; // null = root, "delete" = delete children, folderId = transfer
    isLoadingCounts: boolean;
  }>({ open: false, folder: null, childFoldersCount: 0, childAssignmentsCount: 0, transferTarget: null, isLoadingCounts: false });

  const [deleteAssignmentDialog, setDeleteAssignmentDialog] = useState<{
    open: boolean;
    assignment: Assignment | null;
  }>({ open: false, assignment: null });
  const [publishingModalData, setPublishingModalData] = useState<{
    isOpen: boolean;
    mode: "assignment" | "folder";
    assignment?: Assignment;
    folder?: Folder;
    folderAssignments?: Assignment[];
  }>({ isOpen: false, mode: "assignment" });

  // Build tree data for react-arborist
  const treeData = useMemo(() => {
    const buildTree = (): TreeNodeData[] => {
      const pathToFolderMap = new Map<string, TreeNodeData>();
      const rootNodes: TreeNodeData[] = [];

      // First, create all folder nodes (both explicit and implicit)
      const allPaths = new Set<string>();

      // Add explicit folder paths
      folders.forEach((folder) => {
        const pathKey = folder.path.join("/");
        allPaths.add(pathKey);
        pathToFolderMap.set(pathKey, {
          id: `folder-${folder.id}`,
          name: folder.name,
          type: "folder",
          path: folder.path,
          order_index: folder.order_index,
          folder,
          children: [],
        });
      });

      // Add implicit folder paths from assignments
      assignments.forEach((assignment) => {
        for (let i = 1; i <= assignment.module_path.length; i++) {
          const pathSegment = assignment.module_path.slice(0, i);
          const pathKey = pathSegment.join("/");
          allPaths.add(pathKey);
        }
      });

      // Create implicit folder nodes for paths that don't have explicit folders
      Array.from(allPaths).forEach((pathKey) => {
        if (!pathToFolderMap.has(pathKey)) {
          const path = pathKey.split("/").filter(Boolean);
          if (path.length > 0) {
            pathToFolderMap.set(pathKey, {
              id: `implicit-${pathKey}`,
              name: path[path.length - 1],
              type: "folder",
              path: path,
              order_index: 0,
              children: [],
            });
          }
        }
      });

      // Build folder hierarchy
      const folderNodes = Array.from(pathToFolderMap.values());
      folderNodes.sort((a, b) => a.path.length - b.path.length);

      folderNodes.forEach((folderNode) => {
        if (folderNode.path.length === 1) {
          rootNodes.push(folderNode);
        } else {
          const parentPath = folderNode.path.slice(0, -1);
          const parentPathKey = parentPath.join("/");
          const parent = pathToFolderMap.get(parentPathKey);
          if (parent && parent.children) {
            parent.children.push(folderNode);
          }
        }
      });

      // Add assignments to their respective folders
      assignments.forEach((assignment) => {
        const assignmentNode: TreeNodeData = {
          id: `assignment-${assignment.id}`,
          name: assignment.name,
          type: "assignment",
          path: assignment.module_path,
          order_index: assignment.order_index || 0,
          assignment,
        };

        if (assignment.module_path.length === 0) {
          rootNodes.push(assignmentNode);
        } else {
          const parentPathKey = assignment.module_path.join("/");
          const parent = pathToFolderMap.get(parentPathKey);
          if (parent && parent.children) {
            parent.children.push(assignmentNode);
          } else {
            rootNodes.push(assignmentNode);
          }
        }
      });

      // Sort all children by order_index and add empty folder indicators
      const sortChildren = (nodes: TreeNodeData[]) => {
        nodes.sort((a, b) => a.order_index - b.order_index);
        nodes.forEach((node) => {
          if (node.children) {
            sortChildren(node.children);
            if (node.type === "folder" && node.children.length === 0) {
              node.children.push({
                id: `empty-${node.id}`,
                name: "This folder is empty",
                type: "assignment",
                path: [...node.path, "empty"],
                order_index: 0,
              });
            }
          }
        });
      };

      sortChildren(rootNodes);

      // Add "+ create" node at the root level if user can create
      if (canCreate) {
        rootNodes.push({
          id: "create-node",
          name: "+ create",
          type: "assignment",
          path: [],
          order_index: 999999,
        });
      }

      return rootNodes;
    };

    return buildTree();
  }, [assignments, folders, canCreate]);

  // Update tree height when container size changes
  useEffect(() => {
    const updateHeight = () => {
      if (treeContainerRef.current) {
        const height = treeContainerRef.current.clientHeight;
        if (height > 0) {
          setTreeHeight(Math.max(height, 200));
        }
      }
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    if (treeContainerRef.current) {
      resizeObserver.observe(treeContainerRef.current);
    }

    window.addEventListener("resize", updateHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [treeData]);

  const handleCreateAssignment = async (modulePath: string[] = []) => {
    if (!effectiveIsInstructor) return;

    try {
      const response = await mutations.createAssignment.mutateAsync({
        name: "New Assignment",
        course_id: courseId,
        module_path: modulePath,
        settings: {},
        content: "",
        publish_times: {},
        due_dates_map: {},
        is_lockdown: false,
        lockdown_time_map: {},
      });

      const newAssignment = response.data;
      navigate(`/course/${courseSlug}/assignment/${newAssignment.id}`);

      toast({
        title: "Assignment created",
        description: "New assignment has been created successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error creating assignment",
        description: error.message || "Failed to create assignment",
        variant: "destructive",
      });
    }
  };

  // Open name dialog for creating folder (replaces prompt())
  const openCreateFolderDialog = (parentPath: string[] = []) => {
    if (!effectiveIsInstructor) return;
    setNameDialog({
      open: true,
      mode: "create-folder",
      defaultValue: "",
      parentPath,
    });
  };

  // Open name dialog for renaming folder
  const openRenameFolderDialog = (folder: Folder) => {
    if (!effectiveIsInstructor) return;
    setNameDialog({
      open: true,
      mode: "rename-folder",
      itemId: folder.id,
      defaultValue: folder.name,
    });
  };

  // Open name dialog for renaming assignment
  const openRenameAssignmentDialog = (assignment: Assignment) => {
    if (!effectiveIsInstructor) return;
    setNameDialog({
      open: true,
      mode: "rename-assignment",
      itemId: assignment.id,
      defaultValue: assignment.name,
    });
  };

  const handleNameDialogSubmit = async () => {
    const value = nameInputRef.current?.value?.trim();
    if (!value) return;

    const { mode, itemId, parentPath } = nameDialog;
    setNameDialog({ ...nameDialog, open: false });

    try {
      if (mode === "create-folder") {
        const newPath = [...(parentPath || []), value];
        await mutations.createFolder.mutateAsync({
          course_id: courseId,
          path: newPath,
          name: value,
        });
        toast({ title: "Folder created", description: "New folder has been created successfully" });
      } else if (mode === "rename-folder" && itemId) {
        await mutations.updateFolder.mutateAsync({ id: itemId, data: { name: value } });
        toast({ title: "Folder renamed", description: "Folder has been renamed successfully" });
      } else if (mode === "rename-assignment" && itemId) {
        await mutations.updateAssignment.mutateAsync({ id: itemId, data: { name: value } });
        toast({ title: "Assignment renamed", description: "Assignment has been renamed successfully" });
      }
    } catch (error: any) {
      toast({
        title: `Error ${mode.startsWith("rename") ? "renaming" : "creating"}`,
        description: error.message || "Operation failed",
        variant: "destructive",
      });
    }
  };

  const handleDeleteFolder = async (folder: Folder) => {
    if (!effectiveIsInstructor) return;

    // Load contents count for the modal
    setDeleteFolderDialog({
      open: true,
      folder,
      childFoldersCount: 0,
      childAssignmentsCount: 0,
      transferTarget: null,
      isLoadingCounts: true,
    });

    try {
      const response = await apiClient.getFolderContentsCount(folder.id);
      setDeleteFolderDialog((prev) => ({
        ...prev,
        childFoldersCount: response.data.child_folders_count,
        childAssignmentsCount: response.data.child_assignments_count,
        isLoadingCounts: false,
      }));
    } catch {
      setDeleteFolderDialog((prev) => ({ ...prev, isLoadingCounts: false }));
    }
  };

  const confirmDeleteFolder = async () => {
    if (!deleteFolderDialog.folder) return;

    const folder = deleteFolderDialog.folder;
    const { transferTarget, childAssignmentsCount, childFoldersCount } = deleteFolderDialog;
    const hasChildren = childAssignmentsCount > 0 || childFoldersCount > 0;
    setDeleteFolderDialog({ open: false, folder: null, childFoldersCount: 0, childAssignmentsCount: 0, transferTarget: null, isLoadingCounts: false });

    try {
      let options: { transferTo?: string | null; deleteChildren?: boolean } | undefined;

      if (hasChildren) {
        if (transferTarget === "delete") {
          options = { deleteChildren: true };
        } else {
          // transferTarget is either null (root) or a folder ID
          options = { transferTo: transferTarget };
        }
      }

      await mutations.deleteFolder.mutateAsync({ id: folder.id, options });

      toast({
        title: "Folder deleted",
        description: "Folder has been deleted successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error deleting folder",
        description: error.message || "Failed to delete folder",
        variant: "destructive",
      });
    }
  };

  const handleDuplicateAssignment = async (assignment: Assignment) => {
    if (!canCreate) return;

    try {
      await mutations.duplicateAssignment.mutateAsync(assignment.id);
      toast({
        title: "Assignment duplicated",
        description: "Assignment has been duplicated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error duplicating assignment",
        description: error.message || "Failed to duplicate assignment",
        variant: "destructive",
      });
    }
  };

  const handleDeleteAssignment = (assignment: Assignment) => {
    if (!effectiveIsInstructor) return;
    setDeleteAssignmentDialog({ open: true, assignment });
  };

  const confirmDeleteAssignment = async () => {
    if (!deleteAssignmentDialog.assignment) return;

    const assignment = deleteAssignmentDialog.assignment;
    setDeleteAssignmentDialog({ open: false, assignment: null });

    try {
      await mutations.deleteAssignment.mutateAsync(assignment.id);
      toast({
        title: "Assignment deleted",
        description: "Assignment has been deleted successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error deleting assignment",
        description: error.message || "Failed to delete assignment",
        variant: "destructive",
      });
    }
  };

  const handleAssignmentClick = (assignment: Assignment) => {
    navigate(`/course/${courseSlug}/assignment/${assignment.id}`);
  };

  // Get all assignments within a folder recursively (Bug 10: renamed for clarity)
  const getAssignmentsInFolderRecursive = (folder: Folder): Assignment[] => {
    return assignments.filter((a) =>
      folder.path.every((seg, i) => a.module_path[i] === seg)
    );
  };

  const handleManagePublishing = (item: Assignment | Folder, isFolder: boolean) => {
    if (isFolder) {
      const folder = item as Folder;
      const folderAssignments = getAssignmentsInFolderRecursive(folder);
      setPublishingModalData({
        isOpen: true,
        mode: "folder",
        folder,
        folderAssignments,
      });
    } else {
      setPublishingModalData({
        isOpen: true,
        mode: "assignment",
        assignment: item as Assignment,
      });
    }
  };

  // Handle assignment/folder updates from publishing modal — invalidate React Query cache
  const handleAssignmentUpdated = (_updatedAssignment: Assignment) => {
    invalidateTree();
  };

  const handleFolderAssignmentsUpdated = (_updatedAssignments: Assignment[]) => {
    invalidateTree();
  };

  // Handle drag and drop reordering — optimistic updates with correct index mapping
  const handleMove = async ({ dragIds, parentId, index }: any) => {
    if (!effectiveIsInstructor) return;

    const realDragIds = dragIds.filter(
      (id: string) => !id.startsWith("empty-") && id !== "create-node"
    );
    if (realDragIds.length === 0) return;

    // --- Determine new parent path ---
    let newParentPath: string[] = [];
    if (parentId) {
      if (parentId.startsWith("folder-")) {
        const parentFolderId = parentId.replace("folder-", "");
        const parentFolder = folders.find((f) => f.id === parentFolderId);
        if (parentFolder) newParentPath = [...parentFolder.path];
      } else if (parentId.startsWith("implicit-")) {
        newParentPath = parentId.replace("implicit-", "").split("/").filter(Boolean);
      }
    }

    // --- Map react-arborist index to data model position ---
    // react-arborist's index includes synthetic nodes (empty-*, create-node).
    // We find the "insert before" real item by looking at the tree's children
    // AFTER the dragged items are removed.
    const getTreeChildren = (targetId: string | null | undefined): TreeNodeData[] => {
      if (!targetId) return treeData;
      const search = (nodes: TreeNodeData[]): TreeNodeData[] | null => {
        for (const node of nodes) {
          if (node.id === targetId) return node.children || [];
          if (node.children) {
            const found = search(node.children);
            if (found) return found;
          }
        }
        return null;
      };
      return search(treeData) || treeData;
    };

    const treeChildren = getTreeChildren(parentId || null);
    const afterRemoval = treeChildren.filter((c) => !realDragIds.includes(c.id));

    // Find the first non-synthetic item at or after the drop index — this is what we insert BEFORE
    let insertBeforeId: string | null = null;
    for (let i = index; i < afterRemoval.length; i++) {
      const child = afterRemoval[i];
      if (!child.id.startsWith("empty-") && child.id !== "create-node") {
        insertBeforeId = child.id;
        break;
      }
    }

    // --- Build siblings from the data model (sorted by order_index) ---
    const targetPathKey = newParentPath.join("/");
    type SibItem = { id: string; type: "folder" | "assignment"; order_index: number };
    const siblings: SibItem[] = [];

    for (const a of assignments) {
      if ((a.module_path || []).join("/") === targetPathKey) {
        siblings.push({ id: a.id, type: "assignment", order_index: a.order_index || 0 });
      }
    }
    for (const f of folders) {
      if (f.path.slice(0, -1).join("/") === targetPathKey) {
        siblings.push({ id: f.id, type: "folder", order_index: f.order_index || 0 });
      }
    }
    siblings.sort((a, b) => a.order_index - b.order_index);

    // Build dragged items list
    const dragged: SibItem[] = realDragIds.map((dragId: string) => {
      if (dragId.startsWith("assignment-")) {
        return { id: dragId.replace("assignment-", ""), type: "assignment" as const, order_index: 0 };
      }
      return { id: dragId.replace("folder-", ""), type: "folder" as const, order_index: 0 };
    });

    // Add dragged items to siblings if not already there (cross-folder move)
    for (const d of dragged) {
      if (!siblings.find((s) => s.id === d.id && s.type === d.type)) {
        siblings.push(d);
      }
    }

    // Remove dragged items, compute insertion position, splice
    const dragKeys = new Set(dragged.map((d) => `${d.type}:${d.id}`));
    const remaining = siblings.filter((s) => !dragKeys.has(`${s.type}:${s.id}`));

    let insertPos: number;
    if (insertBeforeId) {
      const beforeType = insertBeforeId.startsWith("folder-") ? "folder" : "assignment";
      const beforeRawId = insertBeforeId.replace(/^(folder-|assignment-|implicit-)/, "");
      insertPos = remaining.findIndex((s) => s.id === beforeRawId && s.type === beforeType);
      if (insertPos === -1) insertPos = remaining.length;
    } else {
      insertPos = remaining.length;
    }

    remaining.splice(insertPos, 0, ...dragged);

    // Assign sequential order_index values
    const reorderPayload = remaining.map((item, i) => ({
      id: item.id,
      type: item.type,
      order_index: i,
    }));

    // --- Optimistic update: apply changes to React Query cache immediately ---
    const prevAssignments = assignments;
    const prevFolders = folders;

    const newAssignments = assignments.map((a) => {
      const isDragged = dragged.find((d) => d.type === "assignment" && d.id === a.id);
      const reorder = reorderPayload.find((r) => r.type === "assignment" && r.id === a.id);
      if (isDragged) {
        return { ...a, module_path: newParentPath, order_index: reorder?.order_index ?? a.order_index };
      }
      if (reorder) {
        return { ...a, order_index: reorder.order_index };
      }
      return a;
    });

    const newFolders = folders.map((f) => {
      const isDragged = dragged.find((d) => d.type === "folder" && d.id === f.id);
      const reorder = reorderPayload.find((r) => r.type === "folder" && r.id === f.id);
      if (isDragged) {
        return { ...f, path: [...newParentPath, f.name], order_index: reorder?.order_index ?? f.order_index };
      }
      if (reorder) {
        return { ...f, order_index: reorder.order_index };
      }
      return f;
    });

    // Cancel in-flight queries so WebSocket-triggered refetches don't overwrite optimistic state
    queryClient.cancelQueries({ queryKey: ["courseAssignments", courseId] });
    queryClient.cancelQueries({ queryKey: ["courseFolders", courseId] });
    queryClient.setQueryData(["courseAssignments", courseId], newAssignments);
    queryClient.setQueryData(["courseFolders", courseId], newFolders);

    // --- Fire API calls in background ---
    try {
      // 1. Path updates for items that moved to a different folder
      const pathUpdates: Promise<any>[] = [];
      for (const dragId of realDragIds) {
        if (dragId.startsWith("assignment-")) {
          const id = dragId.replace("assignment-", "");
          const a = prevAssignments.find((x) => x.id === id);
          if (a && JSON.stringify(a.module_path) !== JSON.stringify(newParentPath)) {
            pathUpdates.push(apiClient.updateAssignment(id, { module_path: newParentPath }));
          }
        } else if (dragId.startsWith("folder-")) {
          const id = dragId.replace("folder-", "");
          const f = prevFolders.find((x) => x.id === id);
          if (f) {
            const newPath = [...newParentPath, f.name];
            if (JSON.stringify(f.path) !== JSON.stringify(newPath)) {
              pathUpdates.push(apiClient.moveFolder(f.id, newPath));
            }
          }
        }
      }

      if (pathUpdates.length > 0) {
        await Promise.all(pathUpdates);
      }

      // 2. Bulk reorder
      if (reorderPayload.length > 0) {
        await apiClient.reorderItems(courseId, reorderPayload);
      }
      // Success — WebSocket events will trigger a fresh refetch to confirm server state
    } catch (error: any) {
      // Revert optimistic update
      queryClient.setQueryData(["courseAssignments", courseId], prevAssignments);
      queryClient.setQueryData(["courseFolders", courseId], prevFolders);
      toast({
        title: "Error moving items",
        description: error.message || "Failed to move items",
        variant: "destructive",
      });
    }
  };

  // Clamp context menu position to viewport bounds (Bug 11)
  const clampMenuPosition = (x: number, y: number) => ({
    x: Math.min(x, window.innerWidth - 200),
    y: Math.min(y, window.innerHeight - 240),
  });

  // Node renderer for react-arborist
  const Node = ({ node, style, dragHandle }: any) => {
    const nodeData = node.data as TreeNodeData;
    const isFolder = nodeData.type === "folder";
    const assignment = nodeData.assignment;
    const folder = nodeData.folder;
    const isEmptyIndicator = nodeData.id.startsWith("empty-");
    const isCreateNode = nodeData.id === "create-node";
    const isSynthetic = isEmptyIndicator || isCreateNode;
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      show: boolean;
    }>({ x: 0, y: 0, show: false });

    const isActive = assignment?.id === currentAssignmentId;

    // Don't pass dragHandle to synthetic nodes (Bug 9)
    const effectiveDragHandle = isSynthetic ? undefined : dragHandle;

    const nodeContent = (
      <div
        style={style}
        ref={effectiveDragHandle}
        className={`flex items-center space-x-2 px-3 rounded group h-full ${
          isEmptyIndicator
            ? "cursor-default"
            : isCreateNode
            ? "cursor-pointer hover:bg-accent"
            : `cursor-pointer ${
                isActive ? "bg-primary/20" : "hover:bg-accent"
              }`
        }`}
        onClick={isCreateNode ? undefined : (e) => {
          if (isEmptyIndicator) return;
          if (assignment) {
            handleAssignmentClick(assignment);
          } else {
            node.toggle();
          }
        }}
        onContextMenu={(e) => {
          if (effectiveIsInstructor && !isSynthetic) {
            e.preventDefault();
            e.stopPropagation();
            const clamped = clampMenuPosition(e.clientX, e.clientY);
            setContextMenu({ x: clamped.x, y: clamped.y, show: true });
          }
        }}
      >
        {/* Expand/collapse icon for folders */}
        {isFolder && (
          <div className="w-4 h-4 flex items-center justify-center">
            {node.isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        )}

        {/* Icon */}
        {isEmptyIndicator ? (
          <div className="w-4 h-4" />
        ) : isCreateNode ? (
          <div className="w-4 h-4" />
        ) : isFolder ? (
          <FolderIcon className="w-4 h-4 text-muted-foreground" />
        ) : assignment && Object.keys(assignment.publish_times || {}).length > 0 ? (
          <div title="Published Assignment">
            <FileText className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
          </div>
        ) : (
          <div title="Unpublished Assignment">
            <FileLock className={`w-4 h-4 ${isActive ? "text-primary" : "text-amber-500"}`} />
          </div>
        )}

        {/* Name */}
        <span
          className={`flex-1 truncate ${
            isEmptyIndicator
              ? "text-muted-foreground italic text-sm"
              : isCreateNode
              ? "text-muted-foreground text-sm"
              : isActive
              ? "text-primary font-medium"
              : "text-foreground"
          }`}
          title={nodeData.name}
        >
          {nodeData.name}
        </span>
      </div>
    );

    // Wrap create node with DropdownMenu
    if (isCreateNode) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {nodeContent}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-48">
            {canCreate && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleCreateAssignment([]);
                }}
                className="cursor-pointer"
              >
                <FileText className="w-4 h-4 mr-2" />
                Create Assignment
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                openCreateFolderDialog([]);
              }}
              className="cursor-pointer"
            >
              <FolderIcon className="w-4 h-4 mr-2" />
              Create Folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return (
      <>
        {nodeContent}

        {/* Custom right-click context menu - portalled outside */}
        {contextMenu.show && effectiveIsInstructor && !isSynthetic &&
          createPortal(
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setContextMenu({ ...contextMenu, show: false })}
              />
              <div
                className="fixed z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px]"
                style={{
                  left: contextMenu.x,
                  top: contextMenu.y,
                }}
              >
                {/* Folder creation options */}
                {isFolder && (
                  <>
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateAssignment(nodeData.path);
                        setContextMenu({ ...contextMenu, show: false });
                      }}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Assignment
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        openCreateFolderDialog(nodeData.path);
                        setContextMenu({ ...contextMenu, show: false });
                      }}
                    >
                      <FolderIcon className="w-4 h-4 mr-2" />
                      Add Folder
                    </button>
                  </>
                )}

                {/* Folder-specific actions */}
                {isFolder && folder && (
                  <>
                    <hr className="my-1 border-border" />
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        openRenameFolderDialog(folder);
                        setContextMenu({ ...contextMenu, show: false });
                      }}
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Rename Folder
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFolder(folder);
                        setContextMenu({ ...contextMenu, show: false });
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Folder
                    </button>
                    <hr className="my-1 border-border" />
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleManagePublishing(folder, true);
                        setContextMenu({ ...contextMenu, show: false });
                      }}
                    >
                      <Calendar className="w-4 h-4 mr-2" />
                      Manage Publishing
                    </button>
                  </>
                )}

                {/* Assignment-specific actions */}
                {!isFolder && assignment && (
                  <>
                    <button
                      className={`w-full text-left px-3 py-2 text-sm flex items-center ${
                        canEdit
                          ? "hover:bg-accent"
                          : "opacity-50 cursor-not-allowed text-muted-foreground"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canEdit) {
                          openRenameAssignmentDialog(assignment);
                          setContextMenu({ ...contextMenu, show: false });
                        }
                      }}
                      disabled={!canEdit}
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Rename Assignment
                    </button>
                    <button
                      className={`w-full text-left px-3 py-2 text-sm flex items-center ${
                        canCreate
                          ? "hover:bg-accent"
                          : "opacity-50 cursor-not-allowed text-muted-foreground"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canCreate) {
                          handleDuplicateAssignment(assignment);
                          setContextMenu({ ...contextMenu, show: false });
                        }
                      }}
                      disabled={!canCreate}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Duplicate Assignment
                    </button>
                    <button
                      className={`w-full text-left px-3 py-2 text-sm flex items-center ${
                        canDelete
                          ? "hover:bg-accent text-red-600"
                          : "opacity-50 cursor-not-allowed text-muted-foreground"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canDelete) {
                          handleDeleteAssignment(assignment);
                          setContextMenu({ ...contextMenu, show: false });
                        }
                      }}
                      disabled={!canDelete}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Assignment
                    </button>
                    <hr className="my-1 border-border" />
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleManagePublishing(assignment, false);
                        setContextMenu({ ...contextMenu, show: false });
                      }}
                    >
                      <Calendar className="w-4 h-4 mr-2" />
                      Manage Publishing
                    </button>
                  </>
                )}
              </div>
            </>,
            document.body
          )}
      </>
    );
  };

  if (isLoading) {
    return <ModuleTreeSkeleton />;
  }

  // Get list of other folders for the transfer dropdown in delete modal
  const otherFolders = deleteFolderDialog.folder
    ? folders.filter((f) => {
        // Exclude the folder being deleted and its children
        const deletingPath = deleteFolderDialog.folder!.path;
        const deletingPathPrefix = deletingPath.join("/");
        return (
          f.id !== deleteFolderDialog.folder!.id &&
          !(f.path.length > deletingPath.length &&
            f.path.slice(0, deletingPath.length).join("/") === deletingPathPrefix)
        );
      })
    : [];

  const hasChildContent =
    deleteFolderDialog.childAssignmentsCount > 0 ||
    deleteFolderDialog.childFoldersCount > 0;

  return (
    <div className="space-y-1 flex flex-col" style={{ height: "100%" }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Assignments
        </h3>
      </div>

      {treeData.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground mb-4">No assignments yet</p>
          {canCreate && (
            <Button
              onClick={() => handleCreateAssignment([])}
              className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create First Assignment
            </Button>
          )}
        </div>
      ) : (
        <div
          ref={treeContainerRef}
          className="flex-1 relative min-h-0"
          onContextMenu={(e) => {
            if (effectiveIsInstructor) {
              e.preventDefault();
              e.stopPropagation();
              const clamped = clampMenuPosition(e.clientX, e.clientY);
              setRootContextMenu({ x: clamped.x, y: clamped.y, show: true });
            }
          }}
        >
          <Tree
            data={treeData}
            openByDefault={false}
            width="100%"
            height={treeHeight}
            indent={24}
            rowHeight={28}
            overscanCount={1}
            paddingTop={8}
            paddingBottom={8}
            onMove={handleMove}
            disableDrag={(node: any) => {
              const id = node.data?.id || "";
              return id.startsWith("empty-") || id === "create-node";
            }}
            disableDrop={(args: any) => {
              const id = args.parentNode?.data?.id || "";
              return id.startsWith("empty-") || id === "create-node";
            }}
          >
            {Node}
          </Tree>
        </div>
      )}

      {/* Root level context menu */}
      {rootContextMenu.show && effectiveIsInstructor &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() =>
                setRootContextMenu({ ...rootContextMenu, show: false })
              }
            />
            <div
              className="fixed z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px]"
              style={{
                left: rootContextMenu.x,
                top: rootContextMenu.y,
              }}
            >
              {canCreate && (
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateAssignment([]);
                    setRootContextMenu({ ...rootContextMenu, show: false });
                  }}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Create Assignment
                </button>
              )}
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center"
                onClick={(e) => {
                  e.stopPropagation();
                  openCreateFolderDialog([]);
                  setRootContextMenu({ ...rootContextMenu, show: false });
                }}
              >
                <FolderIcon className="w-4 h-4 mr-2" />
                Create Folder
              </button>
            </div>
          </>,
          document.body
        )}

      {/* Name Dialog (replaces all prompt() calls — Bug 12) */}
      <Dialog
        open={nameDialog.open}
        onOpenChange={(open) => setNameDialog({ ...nameDialog, open })}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {nameDialog.mode === "create-folder"
                ? "Create Folder"
                : nameDialog.mode === "rename-folder"
                ? "Rename Folder"
                : "Rename Assignment"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="name-input">Name</Label>
            <Input
              id="name-input"
              ref={nameInputRef}
              defaultValue={nameDialog.defaultValue || ""}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleNameDialogSubmit();
                }
              }}
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNameDialog({ ...nameDialog, open: false })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleNameDialogSubmit}
              className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white"
            >
              {nameDialog.mode.startsWith("rename") ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirmation Dialog (Bug 6 — enhanced with transfer option) */}
      <Dialog
        open={deleteFolderDialog.open}
        onOpenChange={(open) =>
          setDeleteFolderDialog({ ...deleteFolderDialog, open })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              {deleteFolderDialog.isLoadingCounts
                ? "Loading folder contents..."
                : hasChildContent
                ? `This folder contains ${deleteFolderDialog.childAssignmentsCount} lesson${deleteFolderDialog.childAssignmentsCount !== 1 ? "s" : ""} and ${deleteFolderDialog.childFoldersCount} subfolder${deleteFolderDialog.childFoldersCount !== 1 ? "s" : ""}. What would you like to do with the contents?`
                : `Are you sure you want to delete the folder "${deleteFolderDialog.folder?.name}"?`}
            </DialogDescription>
          </DialogHeader>
          {hasChildContent && !deleteFolderDialog.isLoadingCounts && (
            <div className="py-2">
              <Label>Move contents to:</Label>
              <Select
                value={deleteFolderDialog.transferTarget ?? "__root__"}
                onValueChange={(value) =>
                  setDeleteFolderDialog((prev) => ({
                    ...prev,
                    transferTarget: value === "__root__" ? null : value === "__delete__" ? "delete" : value,
                  }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">
                    <div className="flex items-center">
                      <ArrowRight className="w-3 h-3 mr-2" />
                      Root level (no folder)
                    </div>
                  </SelectItem>
                  {otherFolders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      <div className="flex items-center">
                        <FolderIcon className="w-3 h-3 mr-2" />
                        {f.path.join(" / ")}
                      </div>
                    </SelectItem>
                  ))}
                  <SelectItem value="__delete__">
                    <div className="flex items-center text-red-600">
                      <Trash2 className="w-3 h-3 mr-2" />
                      Delete all contents
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteFolderDialog({ ...deleteFolderDialog, open: false })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteFolder}
              disabled={deleteFolderDialog.isLoadingCounts}
            >
              {deleteFolderDialog.transferTarget === "delete"
                ? `Delete Folder & ${deleteFolderDialog.childAssignmentsCount} Lesson${deleteFolderDialog.childAssignmentsCount !== 1 ? "s" : ""}`
                : "Delete Folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Assignment Confirmation Dialog */}
      <Dialog
        open={deleteAssignmentDialog.open}
        onOpenChange={(open) =>
          setDeleteAssignmentDialog({
            open,
            assignment: deleteAssignmentDialog.assignment,
          })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Assignment</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the assignment "
              {deleteAssignmentDialog.assignment?.name}"? This action cannot be
              undone. All submissions and grades will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setDeleteAssignmentDialog({ open: false, assignment: null })
              }
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteAssignment}>
              Delete Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unified Publishing Modal */}
      {publishingModalData.isOpen && (
        <PublishingModal
          isOpen={true}
          onClose={() => setPublishingModalData({ ...publishingModalData, isOpen: false })}
          assignment={publishingModalData.mode === "assignment" ? publishingModalData.assignment : undefined}
          onAssignmentUpdated={handleAssignmentUpdated}
          folder={publishingModalData.mode === "folder" ? publishingModalData.folder : undefined}
          folderAssignments={publishingModalData.mode === "folder" ? publishingModalData.folderAssignments : undefined}
          courseId={courseId}
          onAssignmentsUpdated={handleFolderAssignmentsUpdated}
        />
      )}
    </div>
  );
};

export default ModuleTree;
