import React, { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../lib/api";
import { useToast } from "../hooks/use-toast";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Calendar, Users, Eye, Settings } from "lucide-react";
import { Assignment, UserRole } from "../types";
import PublishAssignmentModal from "../components/PublishAssignmentModal";
import DueDatesModal from "../components/DueDatesModal";
import { Popover } from "../components/ui/popover";
import PublishedStudentsList from "../components/PublishedStudentsList";

interface AssignmentPageProps {
  userRole?: UserRole;
  isStudent?: boolean;
  isInstructor?: boolean;
}

const AssignmentPage: React.FC<AssignmentPageProps> = ({
  isStudent,
  isInstructor,
}) => {
  const { courseSlug } = useParams<{ courseSlug: string }>();

  // Extract assignment ID from the URL path
  const location = useLocation();
  const pathParts = location.pathname.split("/");
  const assignmentIndex = pathParts.indexOf("assignment");
  const assignmentId =
    assignmentIndex !== -1 && assignmentIndex + 1 < pathParts.length
      ? pathParts[assignmentIndex + 1]
      : undefined;
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [userDueDate, setUserDueDate] = useState<Date | null>(null);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isDueDatesModalOpen, setIsDueDatesModalOpen] = useState(false);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<
    "grader" | "settings" | null
  >(null);

  // Wait for user role to be determined before making API calls
  const effectiveIsStudent = isStudent ?? false;
  const effectiveIsInstructor = isInstructor ?? false;
  const rolesDetermined = isStudent !== undefined && isInstructor !== undefined;

  // Check if user has instructional privileges (can see sidebar)
  const hasInstructionalPrivileges = effectiveIsInstructor; // This already covers instructor, TA, and admin roles

  useEffect(() => {
    const fetchAssignment = async () => {
      console.log("AssignmentPage debug:", {
        assignmentId,
        userId: user?.id,
        rolesDetermined,
        isStudent,
        isInstructor,
        effectiveIsStudent,
        effectiveIsInstructor,
      });

      if (!assignmentId || !user?.id || !rolesDetermined) {
        console.log("Skipping fetch due to missing data");
        setLoading(false);
        return;
      }

      try {
        let response;

        // Use appropriate endpoint based on user role
        if (effectiveIsStudent) {
          console.log("Using student endpoint");
          response = await apiClient.getAssignmentForStudent(assignmentId);
        } else if (effectiveIsInstructor) {
          console.log("Using instructor endpoint");
          response = await apiClient.getAssignment(assignmentId);
        } else {
          console.log("Role unclear, trying instructor endpoint first");
          // If role is unclear, try instructor endpoint first, then student
          try {
            response = await apiClient.getAssignment(assignmentId);
          } catch (instructorError) {
            console.log("Instructor endpoint failed, trying student endpoint");
            response = await apiClient.getAssignmentForStudent(assignmentId);
          }
        }

        const assignmentData = response.data;
        setAssignment(assignmentData);
        setEditedName(assignmentData.name);

        // Get user's due date if it exists
        if (
          assignmentData.due_dates_map &&
          assignmentData.due_dates_map[user.id]
        ) {
          setUserDueDate(assignmentData.due_dates_map[user.id]);
        }
      } catch (error: any) {
        console.error("Failed to fetch assignment:", error);
        toast({
          title: "Error loading assignment",
          description: error.message || "Failed to load assignment data",
          variant: "destructive",
        });
        navigate(`/course/${courseSlug}/summary`);
      } finally {
        setLoading(false);
      }
    };

    fetchAssignment();
  }, [
    assignmentId,
    user?.id,
    effectiveIsStudent,
    rolesDetermined,
    navigate,
    toast,
    courseSlug,
  ]);

  const handleSaveName = async () => {
    if (!assignment || !effectiveIsInstructor) return;

    // Don't save if name hasn't changed
    if (editedName === assignment.name) {
      setIsEditing(false);
      return;
    }

    try {
      await apiClient.updateAssignment(assignment.id, {
        name: editedName,
      });

      setAssignment({ ...assignment, name: editedName });
      setIsEditing(false);
      toast({
        title: "Assignment updated",
        description: "Assignment name has been updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error updating assignment",
        description: error.message || "Failed to update assignment",
        variant: "destructive",
      });
      // Reset to original name on error
      setEditedName(assignment.name);
      setIsEditing(false);
    }
  };

  const handleCancelEdit = () => {
    setEditedName(assignment.name);
    setIsEditing(false);
  };

  const handlePublishClick = () => {
    setIsPublishModalOpen(true);
  };

  const handleConfigureDueDates = () => {
    setIsDueDatesModalOpen(true);
  };

  const toggleSidebarPanel = (panel: "grader" | "settings") => {
    setActiveSidebarPanel(activeSidebarPanel === panel ? null : panel);
  };

  const handleAssignmentUpdated = (updatedAssignment: Assignment) => {
    setAssignment(updatedAssignment);

    // Update user due date if it exists
    if (
      updatedAssignment.due_dates_map &&
      updatedAssignment.due_dates_map[user?.id || ""]
    ) {
      setUserDueDate(updatedAssignment.due_dates_map[user?.id || ""]);
    } else {
      setUserDueDate(null);
    }
  };

  const formatDueDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getTotalPoints = () => {
    // TODO: Calculate from assignment content/settings
    return 0;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        <span className="ml-3 text-gray-600">Loading assignment...</span>
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Assignment not found
        </h3>
        <p className="text-gray-600 mb-6">
          The assignment you're looking for doesn't exist or you don't have
          access to it.
        </p>
        <Button
          onClick={() => navigate(`/course/${courseSlug}/summary`)}
          className="bg-purple-600 hover:bg-purple-700"
        >
          Back to Course
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Assignment Header */}
        <Card className="bg-purple-600 text-white border-0 rounded-3xl mx-6 mt-4 flex-shrink-0">
          <div className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2 flex-1">
                {/* Title */}
                <div className="flex items-center space-x-2">
                  {isEditing ? (
                    <div className="flex items-center space-x-2 flex-1">
                      <Input
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        className="text-3xl font-bold bg-white/10 border-white/20 text-white placeholder-white/70"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveName();
                          if (e.key === "Escape") handleCancelEdit();
                        }}
                        onBlur={handleSaveName}
                        autoFocus
                      />
                    </div>
                  ) : (
                    <h1
                      className={`text-3xl font-bold ${
                        effectiveIsInstructor
                          ? "cursor-pointer hover:text-purple-100"
                          : ""
                      }`}
                      onClick={() =>
                        effectiveIsInstructor && setIsEditing(true)
                      }
                    >
                      {assignment.name}
                    </h1>
                  )}
                </div>

                {/* Publishing Status (Instructor only) */}
                {effectiveIsInstructor && (
                  <div className="flex items-center space-x-2">
                    <Users className="w-4 h-4" />
                    <Popover
                      trigger={
                        <button className="text-white hover:text-purple-100 text-sm flex items-center space-x-1">
                          <span>
                            Published to {assignment.published_to?.length || 0}{" "}
                            students
                          </span>
                        </button>
                      }
                      content={
                        <PublishedStudentsList assignment={assignment} />
                      }
                      className="left-0"
                    />
                  </div>
                )}

                {/* Due Date (Student view) */}
                {effectiveIsStudent && userDueDate && (
                  <div className="flex items-center space-x-2">
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm">
                      Due: {formatDueDate(userDueDate)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end space-y-3">
                {/* Management Buttons (Instructor only) */}
                {effectiveIsInstructor && (
                  <div className="flex items-center space-x-3">
                    <Button
                      onClick={handlePublishClick}
                      className="bg-white text-purple-600 hover:bg-gray-100 font-semibold"
                    >
                      Manage Publishing
                    </Button>
                    <Button
                      onClick={handleConfigureDueDates}
                      className="bg-white text-purple-600 hover:bg-gray-100 font-semibold"
                    >
                      Manage Due Dates
                    </Button>
                  </div>
                )}

                {/* Points */}
                <div className="flex items-center space-x-2">
                  <span className="text-lg font-semibold">
                    Points: {getTotalPoints()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Assignment Content */}
        <div className="flex-1 mx-6">
          <Card className="h-full p-6">
            <div className="text-gray-600">
              {assignment.content ? (
                <div>
                  Assignment content will be rendered here with TipTap editor
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-lg">No content yet</p>
                  {effectiveIsInstructor && (
                    <p className="text-sm mt-2">
                      Click to add assignment content
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Sidebar Panel */}
      {hasInstructionalPrivileges && activeSidebarPanel && (
        <div className="w-80 bg-white border-l border-gray-200 shadow-xl">
          <div className="h-full flex flex-col">
            <div className="p-4 border-b bg-gray-50">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold capitalize">
                  {activeSidebarPanel}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveSidebarPanel(null)}
                  className="w-8 h-8 p-0"
                >
                  ×
                </Button>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
              <div className="text-gray-600 text-center py-12">
                <p className="text-lg">
                  {activeSidebarPanel === "grader"
                    ? "Grader Panel"
                    : "Settings Panel"}
                </p>
                <p className="text-sm mt-2">Content coming soon...</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right Sidebar Strip */}
      {hasInstructionalPrivileges && (
        <div className="w-12 bg-gray-100 border-l border-gray-200 flex flex-col">
          <button
            onClick={() => toggleSidebarPanel("grader")}
            className={`w-12 h-12 flex items-center justify-center border-b border-gray-200 transition-colors ${
              activeSidebarPanel === "grader"
                ? "bg-purple-100 text-purple-600"
                : "hover:bg-gray-200 text-gray-600"
            }`}
            title="Grader Panel"
          >
            <Eye className="w-5 h-5" />
          </button>
          <button
            onClick={() => toggleSidebarPanel("settings")}
            className={`w-12 h-12 flex items-center justify-center border-b border-gray-200 transition-colors ${
              activeSidebarPanel === "settings"
                ? "bg-purple-100 text-purple-600"
                : "hover:bg-gray-200 text-gray-600"
            }`}
            title="Assignment Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Modals */}
      {assignment && (
        <>
          <PublishAssignmentModal
            isOpen={isPublishModalOpen}
            onClose={() => setIsPublishModalOpen(false)}
            assignment={assignment}
            onAssignmentUpdated={handleAssignmentUpdated}
          />
          <DueDatesModal
            isOpen={isDueDatesModalOpen}
            onClose={() => setIsDueDatesModalOpen(false)}
            assignment={assignment}
            onAssignmentUpdated={handleAssignmentUpdated}
          />
        </>
      )}
    </div>
  );
};

export default AssignmentPage;
