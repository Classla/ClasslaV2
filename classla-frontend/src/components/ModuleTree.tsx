import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../lib/api";
import { useToast } from "../hooks/use-toast";
import { Button } from "./ui/button";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  FileText,
  Folder,
  FolderOpen,
  Lock,
} from "lucide-react";
import { Assignment, UserRole } from "../types";
import { Tree } from "react-arborist";
import { Input } from "./ui/input";

interface ModuleTreeProps {
  courseId: string;
  userRole?: UserRole;
  isInstructor?: boolean;
}

interface TreeNode {
  id: string;
  name: string;
  type: "assignment" | "folder";
  assignment?: Assignment;
  children?: TreeNode[];
  order?: number;
}

interface NodeRendererProps {
  node: any;
  style: React.CSSProperties;
  dragHandle?: (el: HTMLDivElement | null) => void;
}

const NodeRenderer: React.FC<NodeRendererProps> = ({
  node,
  style,
  dragHandle,
}) => {
  const navigate = useNavigate();
  const { courseSlug } = useParams<{ courseSlug: string }>();
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(node.data.name);

  const handleAssignmentClick = (assignment: Assignment) => {
    navigate(`/course/${courseSlug}/assignment/${assignment.id}`);
  };

  const handleCreateFolderFromAssignment = (assignment: Assignment) => {
    const folderName = prompt("Create a new folder for this assignment:");
    if (folderName && folderName.trim()) {
      // This will be handled by the parent component
      console.log("Create folder for assignment:", assignment.id, folderName);
    }
  };

  const handleRename = () => {
    if (newName.trim() && newName !== node.data.name) {
      // This will be handled by the parent component
      console.log("Rename:", node.id, newName.trim());
    }
    setIsRenaming(false);
    setNewName(node.data.name);
  };

  if (node.data.type === "assignment") {
    const assignment = node.data.assignment;
    const isPublished = assignment?.published_to.length > 0;

    return (
      <div
        style={style}
        ref={dragHandle}
        className={`flex items-center space-x-3 py-2 px-3 hover:bg-gray-50 rounded cursor-pointer group ${
          node.state.isDragging ? "opacity-50" : ""
        } ${node.state.isSelected ? "bg-blue-50" : ""}`}
        onClick={() => assignment && handleAssignmentClick(assignment)}
        onContextMenu={(e) => {
          e.preventDefault();
          const menu = document.createElement("div");
          menu.className = "fixed bg-white border rounded shadow-lg p-1 z-50";
          menu.style.left = `${e.clientX}px`;
          menu.style.top = `${e.clientY}px`;

          const items = [
            {
              label: "Create Folder",
              icon: "📁",
              action: () =>
                assignment && handleCreateFolderFromAssignment(assignment),
            },
          ];

          items.forEach((item) => {
            const button = document.createElement("button");
            button.className = `flex items-center space-x-2 w-full text-left px-3 py-1 hover:bg-gray-100 text-sm`;
            button.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
            button.onclick = () => {
              item.action();
              document.body.removeChild(menu);
            };
            menu.appendChild(button);
          });

          document.body.appendChild(menu);

          const removeMenu = () => {
            if (document.body.contains(menu)) {
              document.body.removeChild(menu);
            }
            document.removeEventListener("click", removeMenu);
          };

          setTimeout(() => document.addEventListener("click", removeMenu), 0);
        }}
      >
        <div className="relative">
          <FileText className="w-4 h-4 text-gray-500" />
          {!isPublished && (
            <Lock className="w-3 h-3 text-red-500 absolute -top-1 -right-1" />
          )}
        </div>
        <span className="flex-1 text-gray-700">{node.data.name}</span>
      </div>
    );
  }

  // Folder node
  return (
    <div
      style={style}
      ref={dragHandle}
      className={`flex items-center space-x-2 py-2 px-3 hover:bg-gray-50 rounded cursor-pointer group ${
        node.state.isDragging ? "opacity-50" : ""
      } ${node.state.isSelected ? "bg-blue-50" : ""}`}
      onClick={() => node.toggle()}
      onContextMenu={(e) => {
        e.preventDefault();
        const menu = document.createElement("div");
        menu.className = "fixed bg-white border rounded shadow-lg p-1 z-50";
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        const items = [
          {
            label: "Create Assignment",
            icon: "📄",
            action: () => console.log("Create assignment in folder:", node.id),
          },
          {
            label: "Rename",
            icon: "✏️",
            action: () => setIsRenaming(true),
          },
          {
            label: "Delete",
            icon: "🗑️",
            action: () => console.log("Delete folder:", node.id),
            className: "text-red-600",
          },
        ];

        items.forEach((item) => {
          const button = document.createElement("button");
          button.className = `flex items-center space-x-2 w-full text-left px-3 py-1 hover:bg-gray-100 text-sm ${
            item.className || ""
          }`;
          button.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
          button.onclick = () => {
            item.action();
            document.body.removeChild(menu);
          };
          menu.appendChild(button);
        });

        document.body.appendChild(menu);

        const removeMenu = () => {
          if (document.body.contains(menu)) {
            document.body.removeChild(menu);
          }
          document.removeEventListener("click", removeMenu);
        };

        setTimeout(() => document.addEventListener("click", removeMenu), 0);
      }}
    >
      {node.children &&
        node.children.length > 0 &&
        (node.isOpen ? (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        ))}
      {node.isOpen ? (
        <FolderOpen className="w-4 h-4 text-gray-500" />
      ) : (
        <Folder className="w-4 h-4 text-gray-500" />
      )}
      {isRenaming ? (
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") {
              setIsRenaming(false);
              setNewName(node.data.name);
            }
          }}
          className="h-6 text-sm"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="font-medium text-gray-700">{node.data.name}</span>
      )}
    </div>
  );
};

const ModuleTree: React.FC<ModuleTreeProps> = ({ courseId, isInstructor }) => {
  const navigate = useNavigate();
  const { courseSlug } = useParams<{ courseSlug: string }>();
  useAuth(); // Keep for potential future use
  const { toast } = useToast();

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  // Default to instructor false if not provided
  const effectiveIsInstructor = isInstructor ?? false;

  useEffect(() => {
    const fetchAssignments = async () => {
      try {
        const response = await apiClient.getCourseAssignments(courseId);
        const assignmentsData = response.data;
        setAssignments(assignmentsData);
      } catch (error: any) {
        console.error("Failed to fetch assignments:", error);
        toast({
          title: "Error loading assignments",
          description: error.message || "Failed to load assignments",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchAssignments();
  }, [courseId, toast]);

  const refreshAssignments = useCallback(async () => {
    try {
      const response = await apiClient.getCourseAssignments(courseId);
      const assignmentsData = response.data;
      setAssignments(assignmentsData);
    } catch (error: any) {
      console.error("Failed to refresh assignments:", error);
      toast({
        title: "Error refreshing assignments",
        description: error.message || "Failed to refresh assignments",
        variant: "destructive",
      });
    }
  }, [courseId, toast]);

  // Convert assignments to tree data structure with global ordering
  const treeData = useMemo(() => {
    const nodeMap = new Map<string, TreeNode>();
    const rootNodes: TreeNode[] = [];

    // Create folder nodes first
    const folderPaths = new Set<string>();
    assignments.forEach((assignment) => {
      for (let i = 1; i <= assignment.module_path.length; i++) {
        const path = assignment.module_path.slice(0, i);
        folderPaths.add(path.join("/"));
      }
    });

    // Create folder nodes
    Array.from(folderPaths)
      .sort()
      .forEach((pathStr) => {
        const path = pathStr.split("/");
        const id = `folder-${pathStr}`;
        const name = path[path.length - 1];

        const node: TreeNode = {
          id,
          name,
          type: "folder",
          children: [],
        };

        nodeMap.set(id, node);

        if (path.length === 1) {
          rootNodes.push(node);
        } else {
          const parentPath = path.slice(0, -1).join("/");
          const parentId = `folder-${parentPath}`;
          const parent = nodeMap.get(parentId);
          if (parent) {
            parent.children!.push(node);
          }
        }
      });

    // Add assignment nodes - sort by global order
    assignments
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .forEach((assignment) => {
        const node: TreeNode = {
          id: `assignment-${assignment.id}`,
          name: assignment.name,
          type: "assignment",
          assignment,
          order: assignment.order,
        };

        if (assignment.module_path.length === 0) {
          rootNodes.push(node);
        } else {
          const parentPath = assignment.module_path.join("/");
          const parentId = `folder-${parentPath}`;
          const parent = nodeMap.get(parentId);
          if (parent) {
            parent.children!.push(node);
          }
        }
      });

    // Sort children within each folder by order
    const sortChildren = (nodes: TreeNode[]) => {
      nodes.forEach((node) => {
        if (node.children) {
          node.children.sort((a, b) => {
            if (a.type === "folder" && b.type === "assignment") return -1;
            if (a.type === "assignment" && b.type === "folder") return 1;
            if (a.type === "assignment" && b.type === "assignment") {
              return (a.order || 0) - (b.order || 0);
            }
            return a.name.localeCompare(b.name);
          });
          sortChildren(node.children);
        }
      });
    };

    sortChildren(rootNodes);
    return rootNodes;
  }, [assignments]);

  const handleCreateAssignment = async (modulePath: string[] = []) => {
    if (!effectiveIsInstructor) return;

    try {
      // Calculate the next global order number (highest order + 10)
      const maxOrder = Math.max(0, ...assignments.map((a) => a.order || 0));

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
        order: maxOrder + 10, // Global order - always append to end
      });

      const newAssignment = response.data;

      // Refresh assignments to show the new one in the tree
      await refreshAssignments();

      // Navigate to the new assignment
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

  // Helper function to get all assignments in tree order (depth-first traversal)
  const getTreeOrderedAssignments = useCallback(() => {
    const orderedAssignments: Assignment[] = [];

    const traverse = (nodes: TreeNode[]) => {
      nodes.forEach((node) => {
        if (node.type === "assignment" && node.assignment) {
          orderedAssignments.push(node.assignment);
        }
        if (node.children) {
          traverse(node.children);
        }
      });
    };

    traverse(treeData);
    return orderedAssignments;
  }, [treeData]);

  const handleMove = useCallback(
    async ({
      dragIds,
      parentId,
      index,
    }: {
      dragIds: string[];
      parentId: string | null;
      index: number;
    }) => {
      if (!effectiveIsInstructor) return;

      try {
        // Handle assignment movement
        for (const dragId of dragIds) {
          if (dragId.startsWith("assignment-")) {
            const assignmentId = dragId.replace("assignment-", "");

            // Determine new module path
            let newPath: string[] = [];
            if (parentId && parentId.startsWith("folder-")) {
              const folderPath = parentId.replace("folder-", "");
              newPath = folderPath ? folderPath.split("/") : [];
            }

            // Get the current tree-ordered assignments to calculate global position
            const treeOrderedAssignments = getTreeOrderedAssignments();

            // Find the target position in the global order
            let targetGlobalIndex = 0;
            let currentIndex = 0;

            // Traverse the tree to find where this assignment should be inserted
            const findGlobalIndex = (
              nodes: TreeNode[],
              currentPath: string[] = []
            ): boolean => {
              for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];

                // Check if this is our target location
                if (JSON.stringify(currentPath) === JSON.stringify(newPath)) {
                  if (i === index) {
                    targetGlobalIndex = currentIndex;
                    return true;
                  }
                }

                if (node.type === "assignment") {
                  currentIndex++;
                }

                if (node.children && node.type === "folder") {
                  const folderPath = node.id.replace("folder-", "").split("/");
                  if (findGlobalIndex(node.children, folderPath)) {
                    return true;
                  }
                }
              }
              return false;
            };

            findGlobalIndex(treeData);

            // Calculate new order based on global position
            let newOrder: number;
            if (targetGlobalIndex === 0) {
              // First position
              newOrder =
                treeOrderedAssignments.length > 0
                  ? (treeOrderedAssignments[0].order || 0) - 10
                  : 10;
            } else if (targetGlobalIndex >= treeOrderedAssignments.length) {
              // Last position
              newOrder =
                treeOrderedAssignments.length > 0
                  ? (treeOrderedAssignments[treeOrderedAssignments.length - 1]
                      .order || 0) + 10
                  : 10;
            } else {
              // Between two assignments
              const prevOrder =
                treeOrderedAssignments[targetGlobalIndex - 1]?.order || 0;
              const nextOrder =
                treeOrderedAssignments[targetGlobalIndex]?.order || 0;
              newOrder = (prevOrder + nextOrder) / 2;
            }

            await apiClient.updateAssignment(assignmentId, {
              module_path: newPath,
              order: newOrder,
            });
          }
        }

        await refreshAssignments();
      } catch (error: any) {
        toast({
          title: "Error moving item",
          description: error.message || "Failed to move item",
          variant: "destructive",
        });
      }
    },
    [
      effectiveIsInstructor,
      getTreeOrderedAssignments,
      treeData,
      refreshAssignments,
      toast,
      apiClient,
    ]
  );

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
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Assignments
      </h3>

      {assignments.length === 0 ? (
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
        <>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <Tree
              data={treeData}
              onMove={effectiveIsInstructor ? handleMove : undefined}
              disableDrag={!effectiveIsInstructor}
              disableEdit={!effectiveIsInstructor}
              height={Math.max(200, Math.min(600, treeData.length * 50 + 100))}
              width="100%"
              indent={24}
              rowHeight={40}
              openByDefault={true}
              className="bg-white"
            >
              {NodeRenderer}
            </Tree>
          </div>

          {/* Single create button at the end */}
          {effectiveIsInstructor && (
            <div className="mt-4 pt-2 border-t border-gray-200">
              <Button
                onClick={() => handleCreateAssignment([])}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Assignment
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ModuleTree;
