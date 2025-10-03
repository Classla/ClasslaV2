import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Tree } from "react-arborist";

import { apiClient } from "../lib/api";
import { useToast } from "../hooks/use-toast";
import { Button } from "./ui/button";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  FileText,
  FileLock,
  Folder as FolderIcon,
  Edit,
  Trash2,
} from "lucide-react";
import { Assignment, Folder, UserRole } from "../types";

interface ModuleTreeProps {
  courseId: string;
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

const ModuleTree: React.FC<ModuleTreeProps> = ({ courseId, isInstructor }) => {
  const navigate = useNavigate();
  const { courseSlug } = useParams<{ courseSlug: string }>();
  const { toast } = useToast();

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [rootContextMenu, setRootContextMenu] = useState<{
    x: number;
    y: number;
    show: boolean;
  }>({ x: 0, y: 0, show: false });

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
      return rootNodes;
    };

    return buildTree();
  }, [assignments, folders]);

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

  const handleDeleteFolder = async (folder: Folder) => {
    if (!effectiveIsInstructor) return;

    if (
      !confirm(`Are you sure you want to delete the folder "${folder.name}"?`)
    ) {
      return;
    }

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
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      show: boolean;
    }>({ x: 0, y: 0, show: false });

    return (
      <div
        style={style}
        ref={dragHandle}
        className={`flex items-center space-x-2 px-3 rounded group h-full ${
          isEmptyIndicator
            ? "cursor-default"
            : `hover:bg-gray-50 cursor-pointer ${
                node.isSelected ? "bg-blue-50" : ""
              }`
        }`}
        onClick={() => {
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
          if (effectiveIsInstructor && !isEmptyIndicator) {
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
            isEmptyIndicator ? "text-gray-400 italic text-sm" : "text-gray-700"
          }`}
          title={nodeData.name}
        >
          {nodeData.name}
        </span>

        {/* Custom right-click context menu */}
        {contextMenu.show && effectiveIsInstructor && !isEmptyIndicator && (
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
            </div>
          </>
        )}
      </div>
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
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
          Assignments
        </h3>
      </div>

      {treeData.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 mb-4">No assignments yet</p>
          {effectiveIsInstructor && (
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
          className="h-96 relative"
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
            height={384}
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

      {/* Root level context menu */}
      {rootContextMenu.show && effectiveIsInstructor && (
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
        </>
      )}
    </div>
  );
};

export default ModuleTree;
