import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { Tree } from "react-arborist";

import { apiClient } from "../lib/api";
import { useToast } from "../hooks/use-toast";
import { Button } from "./ui/button";
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
  ChevronRight,
  ChevronDown,
  Plus,
  FileText,
  FileLock,
  Folder as FolderIcon,
  Edit,
  Trash2,
  Copy,
} from "lucide-react";
import { Assignment, Folder, UserRole, Course } from "../types";
import { hasTAPermission } from "../lib/taPermissions";
import { useAuth } from "../contexts/AuthContext";

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
  const { toast } = useToast();
  const { user } = useAuth();

  // Check TA permissions
  const canCreate = useMemo(() => {
    if (!isInstructor) return false;
    if (userRole !== UserRole.TEACHING_ASSISTANT) return true; // Instructors/admins always can create
    return hasTAPermission(course ?? null, user?.id, userRole, "canCreate");
  }, [isInstructor, userRole, course, user?.id]);

  const canEdit = useMemo(() => {
    if (!isInstructor) return false;
    if (userRole !== UserRole.TEACHING_ASSISTANT) return true; // Instructors/admins always can edit
    return hasTAPermission(course ?? null, user?.id, userRole, "canEdit");
  }, [isInstructor, userRole, course, user?.id]);

  const canDelete = useMemo(() => {
    if (!isInstructor) return false;
    if (userRole !== UserRole.TEACHING_ASSISTANT) return true; // Instructors/admins always can delete
    return hasTAPermission(course ?? null, user?.id, userRole, "canDelete");
  }, [isInstructor, userRole, course, user?.id]);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [treeHeight, setTreeHeight] = useState(384);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [rootContextMenu, setRootContextMenu] = useState<{
    x: number;
    y: number;
    show: boolean;
  }>({ x: 0, y: 0, show: false });
  const [deleteFolderDialog, setDeleteFolderDialog] = useState<{
    open: boolean;
    folder: Folder | null;
  }>({ open: false, folder: null });
  const [deleteAssignmentDialog, setDeleteAssignmentDialog] = useState<{
    open: boolean;
    assignment: Assignment | null;
  }>({ open: false, assignment: null });

  // Default to instructor false if not specified
  const effectiveIsInstructor = isInstructor ?? false;

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch assignments
        const assignmentsResponse = await apiClient.getCourseAssignments(
          courseId
        );
        let assignmentsData = assignmentsResponse.data;
        setAssignments(assignmentsData);

        // Fetch folders (only for instructors/TAs)
        let foldersData: Folder[] = [];
        if (effectiveIsInstructor) {
          try {
            const foldersResponse = await apiClient.getCourseFolders(courseId);
            foldersData = foldersResponse.data;
            setFolders(foldersData);
          } catch (error: any) {
            // If folders endpoint fails (e.g., insufficient permissions), continue without folders
            console.warn("Could not fetch folders:", error.message);
          }
        }
      } catch (error: any) {
        console.error("Failed to fetch data:", error);
        toast({
          title: "Error loading assignments",
          description: error.message || "Failed to load assignments",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [courseId, effectiveIsInstructor, toast]);

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
          // Root level folder
          rootNodes.push(folderNode);
        } else {
          // Find parent folder
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
          // Root level assignment
          rootNodes.push(assignmentNode);
        } else {
          // Find parent folder
          const parentPathKey = assignment.module_path.join("/");
          const parent = pathToFolderMap.get(parentPathKey);
          if (parent && parent.children) {
            parent.children.push(assignmentNode);
          } else {
            // Fallback to root if parent not found
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
            // Add empty folder indicator if folder has no children
            if (node.type === "folder" && node.children.length === 0) {
              node.children.push({
                id: `empty-${node.id}`,
                name: "This folder is empty",
                type: "assignment", // Use assignment type to avoid expand/collapse
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
          type: "assignment", // Use assignment type to avoid expand/collapse
          path: [],
          order_index: 999999, // Ensure it's always last
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
          setTreeHeight(Math.max(height, 200)); // Minimum height of 200px
        }
      }
    };

    // Initial height
    updateHeight();
    
    // Use ResizeObserver to track container size changes
    const resizeObserver = new ResizeObserver(updateHeight);
    if (treeContainerRef.current) {
      resizeObserver.observe(treeContainerRef.current);
    }

    // Also listen to window resize as fallback
    window.addEventListener("resize", updateHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [treeData]);

  const handleCreateAssignment = async (modulePath: string[] = []) => {
    if (!effectiveIsInstructor) return;

    try {
      const response = await apiClient.createAssignment({
        name: "New Assignment",
        course_id: courseId,
        module_path: modulePath,
        settings: {},
        content: "",
        published_to: [],
        due_dates_map: {},
        is_lockdown: false,
        lockdown_time_map: {},
        order_index: 0,
      });

      const newAssignment = response.data;

      // Update local state
      setAssignments((prev) => [...prev, newAssignment]);

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

  const handleCreateFolder = async (parentPath: string[] = []) => {
    if (!effectiveIsInstructor) return;

    const folderName = prompt("Enter folder name:");
    if (!folderName?.trim()) return;

    const newPath = [...parentPath, folderName.trim()];

    try {
      const response = await apiClient.createFolder({
        course_id: courseId,
        path: newPath,
        name: folderName.trim(),
        order_index: 0,
      });

      const newFolder = response.data;
      setFolders((prev) => [...prev, newFolder]);

      toast({
        title: "Folder created",
        description: "New folder has been created successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error creating folder",
        description: error.message || "Failed to create folder",
        variant: "destructive",
      });
    }
  };

  const handleRenameFolder = async (folder: Folder) => {
    if (!effectiveIsInstructor) return;

    const newName = prompt("Enter new folder name:", folder.name);
    if (!newName?.trim() || newName.trim() === folder.name) return;

    try {
      const response = await apiClient.updateFolder(folder.id, {
        name: newName.trim(),
      });

      const updatedFolder = response.data;
      setFolders((prev) =>
        prev.map((f) => (f.id === folder.id ? updatedFolder : f))
      );

      toast({
        title: "Folder renamed",
        description: "Folder has been renamed successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error renaming folder",
        description: error.message || "Failed to rename folder",
        variant: "destructive",
      });
    }
  };

  const handleDeleteFolder = (folder: Folder) => {
    if (!effectiveIsInstructor) return;
    setDeleteFolderDialog({ open: true, folder });
  };

  const confirmDeleteFolder = async () => {
    if (!deleteFolderDialog.folder) return;

    const folder = deleteFolderDialog.folder;
    setDeleteFolderDialog({ open: false, folder: null });

    try {
      await apiClient.deleteFolder(folder.id);

      setFolders((prev) => prev.filter((f) => f.id !== folder.id));

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

  const handleRenameAssignment = async (assignment: Assignment) => {
    if (!effectiveIsInstructor) return;

    const newName = prompt("Enter new assignment name:", assignment.name);
    if (!newName?.trim() || newName.trim() === assignment.name) return;

    try {
      const response = await apiClient.updateAssignment(assignment.id, {
        name: newName.trim(),
      });

      const updatedAssignment = response.data;
      setAssignments((prev) =>
        prev.map((a) => (a.id === assignment.id ? updatedAssignment : a))
      );

      toast({
        title: "Assignment renamed",
        description: "Assignment has been renamed successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error renaming assignment",
        description: error.message || "Failed to rename assignment",
        variant: "destructive",
      });
    }
  };

  const handleDuplicateAssignment = async (assignment: Assignment) => {
    if (!canCreate) return;

    try {
      const response = await apiClient.duplicateAssignment(assignment.id);
      const newAssignment = response.data;

      // Update local state
      setAssignments((prev) => [...prev, newAssignment]);

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

    // Optimistically update the UI immediately
    const previousAssignments = assignments;
    setAssignments((prev) => prev.filter((a) => a.id !== assignment.id));

    try {
      await apiClient.deleteAssignment(assignment.id);

      toast({
        title: "Assignment deleted",
        description: "Assignment has been deleted successfully",
      });
    } catch (error: any) {
      // Revert on error
      setAssignments(previousAssignments);
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

  // Helper function to update folder hierarchy when a folder is moved
  const updateFolderHierarchy = async (
    movedFolder: Folder,
    newPath: string[]
  ) => {
    // Use the new moveFolder API that handles all nested updates
    await apiClient.moveFolder(movedFolder.id, newPath);
  };

  // Handle drag and drop reordering
  const handleMove = async ({ dragIds, parentId, index }: any) => {
    if (!effectiveIsInstructor) return;

    try {
      // Determine the new parent path
      let newParentPath: string[] = [];
      if (parentId && !parentId.startsWith("empty-")) {
        if (parentId.startsWith("folder-")) {
          const parentFolderId = parentId.replace("folder-", "");
          const parentFolder = folders.find((f) => f.id === parentFolderId);
          if (parentFolder) {
            newParentPath = parentFolder.path;
          }
        } else if (parentId.startsWith("implicit-")) {
          // Handle implicit folders
          const pathKey = parentId.replace("implicit-", "");
          newParentPath = pathKey.split("/").filter(Boolean);
        }
      }

      // Process each dragged item
      await Promise.all(
        dragIds.map(async (dragId: string, i: number) => {
          // Skip create node
          if (dragId === "create-node") {
            return;
          }
          
          const newOrderIndex = index + i;

          if (dragId.startsWith("assignment-")) {
            const assignmentId = dragId.replace("assignment-", "");
            const assignment = assignments.find((a) => a.id === assignmentId);
            if (assignment) {
              // Update assignment with new path and order
              await apiClient.updateAssignment(assignmentId, {
                module_path: newParentPath,
                order_index: newOrderIndex,
              });
            }
          } else if (dragId.startsWith("folder-")) {
            const folderId = dragId.replace("folder-", "");
            const folder = folders.find((f) => f.id === folderId);
            if (folder) {
              // Calculate new folder path
              const newFolderPath = [...newParentPath, folder.name];

              // Update folder with new path and order
              await apiClient.updateFolder(folderId, {
                order_index: newOrderIndex,
              });

              // If the folder path changed, we need to update the folder's path
              // and all nested items (assignments and subfolders)
              if (
                JSON.stringify(folder.path) !== JSON.stringify(newFolderPath)
              ) {
                await updateFolderHierarchy(folder, newFolderPath);
              }
            }
          }
        })
      );

      // Refresh data to reflect new structure
      const [assignmentsResponse, foldersResponse] = await Promise.all([
        apiClient.getCourseAssignments(courseId),
        effectiveIsInstructor
          ? apiClient.getCourseFolders(courseId)
          : Promise.resolve({ data: [] }),
      ]);

      setAssignments(assignmentsResponse.data);
      if (effectiveIsInstructor) {
        setFolders(foldersResponse.data);
      }

      toast({
        title: "Items moved",
        description: "Items have been moved successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error moving items",
        description: error.message || "Failed to move items",
        variant: "destructive",
      });
    }
  };

  // Node renderer for react-arborist
  const Node = ({ node, style, dragHandle }: any) => {
    const nodeData = node.data as TreeNodeData;
    const isFolder = nodeData.type === "folder";
    const assignment = nodeData.assignment;
    const folder = nodeData.folder;
    const isEmptyIndicator = nodeData.id.startsWith("empty-");
    const isCreateNode = nodeData.id === "create-node";
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      show: boolean;
    }>({ x: 0, y: 0, show: false });

    const nodeContent = (
      <div
        style={style}
        ref={isCreateNode ? undefined : dragHandle}
        className={`flex items-center space-x-2 px-3 rounded group h-full ${
          isEmptyIndicator
            ? "cursor-default"
            : isCreateNode
            ? "cursor-pointer hover:bg-gray-100"
            : `hover:bg-gray-50 cursor-pointer ${
                node.isSelected ? "bg-blue-50" : ""
              }`
        }`}
        onClick={isCreateNode ? undefined : (e) => {
          if (isEmptyIndicator) {
            // Do nothing for empty indicators
            return;
          }
          if (assignment) {
            handleAssignmentClick(assignment);
          } else {
            node.toggle();
          }
        }}
        onContextMenu={(e) => {
          if (effectiveIsInstructor && !isEmptyIndicator && !isCreateNode) {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              show: true,
            });
          }
        }}
      >
        {/* Expand/collapse icon for folders */}
        {isFolder && (
          <div className="w-4 h-4 flex items-center justify-center">
            {node.isOpen ? (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-500" />
            )}
          </div>
        )}

        {/* Icon */}
        {isEmptyIndicator ? (
          <div className="w-4 h-4" /> // Empty space for alignment
        ) : isCreateNode ? (
          <div className="w-4 h-4" /> // Empty space for alignment
        ) : isFolder ? (
          <FolderIcon className="w-4 h-4 text-gray-500" />
        ) : assignment && assignment.published_to.length > 0 ? (
          <div title="Published Assignment">
            <FileText className="w-4 h-4 text-gray-500" />
          </div>
        ) : (
          <div title="Unpublished Assignment">
            <FileLock className="w-4 h-4 text-amber-500" />
          </div>
        )}

        {/* Name */}
        <span
          className={`flex-1 truncate ${
            isEmptyIndicator
              ? "text-gray-400 italic text-sm"
              : isCreateNode
              ? "text-gray-500 text-sm"
              : "text-gray-700"
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
                handleCreateFolder([]);
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
        {contextMenu.show && effectiveIsInstructor && !isEmptyIndicator &&
          createPortal(
            <>
              {/* Backdrop to close menu */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setContextMenu({ ...contextMenu, show: false })}
              />
              {/* Context menu */}
              <div
                className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[160px]"
                style={{
                  left: contextMenu.x,
                  top: contextMenu.y,
                }}
              >
                {/* Only show "Add Assignment" and "Add Folder" when right-clicking on folders */}
                {isFolder && (
                  <>
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center"
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
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateFolder(nodeData.path);
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
                    <hr className="my-1 border-gray-200" />
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRenameFolder(folder);
                        setContextMenu({ ...contextMenu, show: false });
                      }}
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Rename Folder
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFolder(folder);
                        setContextMenu({ ...contextMenu, show: false });
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Folder
                    </button>
                  </>
                )}

                {/* Assignment-specific actions */}
                {!isFolder && assignment && (
                  <>
                    <button
                      className={`w-full text-left px-3 py-2 text-sm flex items-center ${
                        canEdit
                          ? "hover:bg-gray-100"
                          : "opacity-50 cursor-not-allowed text-gray-400"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canEdit) {
                          handleRenameAssignment(assignment);
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
                          ? "hover:bg-gray-100"
                          : "opacity-50 cursor-not-allowed text-gray-400"
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
                          ? "hover:bg-gray-100 text-red-600"
                          : "opacity-50 cursor-not-allowed text-gray-400"
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
                  </>
                )}
              </div>
            </>,
            document.body
          )}
      </>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
        <span className="ml-3 text-gray-600">Loading assignments...</span>
      </div>
    );
  }

  return (
    <div className="space-y-1 flex flex-col" style={{ height: "100%" }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
          Assignments
        </h3>
      </div>

      {treeData.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 mb-4">No assignments yet</p>
          {canCreate && (
            <Button
              onClick={() => handleCreateAssignment([])}
              className="bg-purple-600 hover:bg-purple-700"
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
              // Show context menu for root level actions
              const x = e.clientX;
              const y = e.clientY;

              // Create a temporary context menu state for root actions
              setRootContextMenu({
                x,
                y,
                show: true,
              });
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
          >
            {Node}
          </Tree>
        </div>
      )}

      {/* Root level context menu - portalled outside */}
      {rootContextMenu.show && effectiveIsInstructor &&
        createPortal(
          <>
            {/* Backdrop to close menu */}
            <div
              className="fixed inset-0 z-40"
              onClick={() =>
                setRootContextMenu({ ...rootContextMenu, show: false })
              }
            />
            {/* Context menu */}
            <div
              className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[160px]"
              style={{
                left: rootContextMenu.x,
                top: rootContextMenu.y,
              }}
            >
              {canCreate && (
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center"
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
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCreateFolder([]);
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

      {/* Delete Folder Confirmation Dialog */}
      <Dialog
        open={deleteFolderDialog.open}
        onOpenChange={(open) =>
          setDeleteFolderDialog({ open, folder: deleteFolderDialog.folder })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the folder "
              {deleteFolderDialog.folder?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteFolderDialog({ open: false, folder: null })}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteFolder}>
              Delete Folder
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
    </div>
  );
};

export default ModuleTree;
