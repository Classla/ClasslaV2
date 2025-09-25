import React, { useState, useEffect } from "react";
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
  Calendar,
} from "lucide-react";
import { Assignment, ModuleTreeNode, UserRole } from "../types";

interface ModuleTreeProps {
  courseId: string;
  userRole?: UserRole;
  isStudent?: boolean;
  isInstructor?: boolean;
}

const ModuleTree: React.FC<ModuleTreeProps> = ({
  courseId,
  userRole,
  isStudent,
  isInstructor,
}) => {
  const navigate = useNavigate();
  const { courseSlug } = useParams<{ courseSlug: string }>();
  const { user } = useAuth();
  const { toast } = useToast();

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [moduleTree, setModuleTree] = useState<ModuleTreeNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Default to student if userRole is not available yet
  const effectiveIsStudent = isStudent ?? true;
  const effectiveIsInstructor = isInstructor ?? false;

  useEffect(() => {
    const fetchAssignments = async () => {
      try {
        const response = await apiClient.getCourseAssignments(courseId);
        let assignmentsData = response.data;

        // Backend handles filtering for students based on published_to and section enrollment

        setAssignments(assignmentsData);

        // Build module tree
        const tree = buildModuleTree(assignmentsData);
        setModuleTree(tree);
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

  const buildModuleTree = (assignments: Assignment[]): ModuleTreeNode => {
    const root: ModuleTreeNode = {
      path: [],
      name: "Root",
      assignments: [],
      children: [],
    };

    // Add assignments to the tree
    assignments.forEach((assignment) => {
      let currentNode = root;

      // Navigate to the correct node based on module_path
      assignment.module_path.forEach((pathSegment, index) => {
        const currentPath = assignment.module_path.slice(0, index + 1);
        const pathKey = currentPath.join("/");

        let childNode = currentNode.children.find(
          (child) => child.path.join("/") === pathKey
        );

        if (!childNode) {
          childNode = {
            path: currentPath,
            name: pathSegment,
            assignments: [],
            children: [],
          };
          currentNode.children.push(childNode);
        }

        currentNode = childNode;
      });

      // Add assignment to the final node
      currentNode.assignments.push(assignment);
    });

    // Sort children and assignments
    const sortNode = (node: ModuleTreeNode) => {
      node.children.sort((a, b) => a.name.localeCompare(b.name));
      node.assignments.sort((a, b) => a.name.localeCompare(b.name));
      node.children.forEach(sortNode);
    };

    sortNode(root);
    return root;
  };

  const toggleExpanded = (path: string[]) => {
    const pathKey = path.join("/");
    const newExpanded = new Set(expandedPaths);

    if (newExpanded.has(pathKey)) {
      newExpanded.delete(pathKey);
    } else {
      newExpanded.add(pathKey);
    }

    setExpandedPaths(newExpanded);
  };

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
      });

      const newAssignment = response.data;

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

  const handleAssignmentClick = (assignment: Assignment) => {
    navigate(`/course/${courseSlug}/assignment/${assignment.id}`);
  };

  const formatDueDate = (assignment: Assignment, userId?: string) => {
    if (!userId || !assignment.due_dates_map[userId]) {
      return null;
    }

    const date = new Date(assignment.due_dates_map[userId]);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const renderModuleNode = (
    node: ModuleTreeNode,
    depth: number = 0
  ): React.ReactNode => {
    const pathKey = node.path.join("/");
    const isExpanded = expandedPaths.has(pathKey);
    const hasChildren = node.children.length > 0;

    return (
      <div key={pathKey} className={`${depth > 0 ? "ml-4" : ""}`}>
        {/* Module Header (skip for root) */}
        {depth > 0 && (
          <div
            className="flex items-center space-x-2 py-2 px-3 hover:bg-gray-50 rounded cursor-pointer"
            onClick={() => toggleExpanded(node.path)}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )
            ) : (
              <div className="w-4 h-4" />
            )}
            <span className="font-medium text-gray-700">{node.name}</span>
            {effectiveIsInstructor && (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCreateAssignment(node.path);
                }}
                className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Plus className="w-3 h-3" />
              </Button>
            )}
          </div>
        )}

        {/* Assignments in this module */}
        {(depth === 0 || isExpanded) && (
          <div className={depth > 0 ? "ml-6" : ""}>
            {node.assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="flex items-center space-x-3 py-2 px-3 hover:bg-gray-50 rounded cursor-pointer group"
                onClick={() => handleAssignmentClick(assignment)}
              >
                <FileText className="w-4 h-4 text-gray-500" />
                <span className="flex-1 text-gray-700">{assignment.name}</span>

                {/* Due date for students */}
                {effectiveIsStudent && (
                  <div className="flex items-center space-x-1 text-sm text-gray-500">
                    <Calendar className="w-3 h-3" />
                    <span>
                      {formatDueDate(assignment, user?.id) || "No due date"}
                    </span>
                  </div>
                )}

                {/* Publishing status for instructors */}
                {effectiveIsInstructor && (
                  <div className="text-xs text-gray-500">
                    {assignment.published_to.length > 0 ? "Published" : "Draft"}
                  </div>
                )}
              </div>
            ))}

            {/* Create assignment button for this level */}
            {effectiveIsInstructor && (depth === 0 || isExpanded) && (
              <Button
                variant="ghost"
                onClick={() =>
                  handleCreateAssignment(depth === 0 ? [] : node.path)
                }
                className="w-full justify-start text-gray-500 hover:text-gray-700 py-2 px-3"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Assignment
              </Button>
            )}
          </div>
        )}

        {/* Child modules */}
        {(depth === 0 || isExpanded) &&
          node.children.map((child) => renderModuleNode(child, depth + 1))}
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

  if (!moduleTree) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-600">Failed to load assignments</p>
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
        <div className="group">{renderModuleNode(moduleTree)}</div>
      )}
    </div>
  );
};

export default ModuleTree;
