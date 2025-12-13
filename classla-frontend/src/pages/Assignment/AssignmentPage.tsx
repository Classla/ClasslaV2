import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../lib/api";
import { useToast } from "../../hooks/use-toast";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Calendar, Users, Eye, Settings } from "lucide-react";
import { Assignment, UserRole, RubricSchema, Course } from "../../types";
import { hasTAPermission } from "../../lib/taPermissions";
import PublishAssignmentModal from "./components/PublishAssignmentModal";
import DueDatesModal from "../Course/components/DueDatesModal";
import AssignmentSettingsPanel from "./components/AssignmentSettingsPanel";
import GradingSidebar from "./components/grader/GradingSidebar";
import { Popover } from "../../components/ui/popover";
import PublishedStudentsList from "./components/PublishedStudentsList";
import AssignmentEditor from "./components/AssignmentEditor";
import AssignmentViewer from "./components/AssignmentViewer";
import AssignmentPageSkeleton from "./components/AssignmentPageSkeleton";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { calculateAssignmentPoints } from "../../utils/assignmentPoints";

interface AssignmentPageProps {
  course?: Course;
  userRole?: UserRole;
  isStudent?: boolean;
  isInstructor?: boolean;
}

const AssignmentPage: React.FC<AssignmentPageProps> = ({
  course,
  userRole,
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
  const [previousAssignmentId, setPreviousAssignmentId] = useState<string | undefined>(undefined);
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [userDueDate, setUserDueDate] = useState<Date | null>(null);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isDueDatesModalOpen, setIsDueDatesModalOpen] = useState(false);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<
    "grader" | "settings" | null
  >(null);
  const [selectedGradingStudent, setSelectedGradingStudent] = useState<
    any | null
  >(null);
  const [submissionId, setSubmissionId] = useState<string | undefined>(
    undefined
  );
  const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);
  const [submissionTimestamp, setSubmissionTimestamp] = useState<
    Date | string | null
  >(null);
  const [isStarting, setIsStarting] = useState(false);
  const [allSubmissions, setAllSubmissions] = useState<any[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<
    string | undefined
  >(undefined);
  const [rubricSchema, setRubricSchema] = useState<RubricSchema | null>(null);

  // Wait for user role to be determined before making API calls
  const effectiveIsStudent = isStudent ?? false;
  const effectiveIsInstructor = isInstructor ?? false;
  const rolesDetermined = isStudent !== undefined && isInstructor !== undefined;

  // Check if TA has canEdit permission
  const canEdit = useMemo(() => {
    if (!effectiveIsInstructor) return false;
    if (userRole !== UserRole.TEACHING_ASSISTANT) return true; // Instructors/admins always can edit
    return hasTAPermission(course, user?.id, userRole, "canEdit");
  }, [effectiveIsInstructor, userRole, course, user?.id]);

  // Check if user has instructional privileges (can see sidebar)
  const hasInstructionalPrivileges = effectiveIsInstructor; // This already covers instructor, TA, and admin roles

  // Set loading immediately when assignmentId changes
  useEffect(() => {
    if (assignmentId && assignmentId !== previousAssignmentId) {
      setLoading(true);
      setPreviousAssignmentId(assignmentId);
      setAssignment(null); // Clear previous assignment immediately
    }
  }, [assignmentId, previousAssignmentId]);

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

        // Fetch submission if student
        if (effectiveIsStudent) {
          try {
            const submissionsResponse =
              await apiClient.getSubmissionsByAssignment(assignmentId);
            const submissions = submissionsResponse.data;

            // Filter to only this user's submissions and sort by timestamp
            const userSubmissions = submissions
              .filter((sub: any) => sub.student_id === user.id)
              .sort(
                (a: any, b: any) =>
                  new Date(b.timestamp).getTime() -
                  new Date(a.timestamp).getTime()
              );

            setAllSubmissions(userSubmissions);

            // Use the most recent submission
            if (userSubmissions.length > 0) {
              const latestSubmission = userSubmissions[0];
              setSubmissionId(latestSubmission.id);
              setSelectedSubmissionId(latestSubmission.id);
              setSubmissionStatus(latestSubmission.status);
              setSubmissionTimestamp(latestSubmission.timestamp);
            }
          } catch (submissionError) {
            console.log("No submission found yet:", submissionError);
            // This is okay - student hasn't started yet
          }
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
    if (!assignment || !canEdit) return;

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
    setEditedName(assignment?.name || "");
    setIsEditing(false);
  };

  const handlePublishClick = () => {
    setIsPublishModalOpen(true);
  };

  const handleConfigureDueDates = () => {
    setIsDueDatesModalOpen(true);
  };

  const toggleSidebarPanel = (panel: "grader" | "settings") => {
    // Prevent opening settings panel if TA doesn't have canEdit permission
    if (panel === "settings" && !canEdit) {
      return;
    }
    const newPanel = activeSidebarPanel === panel ? null : panel;
    setActiveSidebarPanel(newPanel);
    // Reset selected student when closing grader panel
    if (newPanel !== "grader") {
      setSelectedGradingStudent(null);
    }
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

  // Load rubric schema
  useEffect(() => {
    const loadRubricSchema = async () => {
      if (!assignmentId) return;

      try {
        const response = await apiClient.getRubricSchema(assignmentId);
        setRubricSchema(response.data);
      } catch (error: any) {
        // 404 is expected if no rubric exists
        if (error.statusCode !== 404) {
          console.error("Failed to load rubric schema:", error);
        }
      }
    };

    loadRubricSchema();
  }, [assignmentId]);

  // Calculate total points from assignment content and rubric using memoization
  const totalPoints = useMemo(() => {
    if (!assignment?.content) return 0;
    return calculateAssignmentPoints(assignment.content, rubricSchema);
  }, [assignment?.content, rubricSchema]);

  const handleStartAssignment = async () => {
    if (!assignment || !user?.id) return;

    try {
      setIsStarting(true);
      const response = await apiClient.createOrUpdateSubmission({
        assignment_id: assignment.id,
        values: {},
        course_id: assignment.course_id,
      });

      setSubmissionId(response.data.id);
      setSelectedSubmissionId(response.data.id);
      setSubmissionStatus(response.data.status);

      // Add to submissions list
      setAllSubmissions([response.data]);

      toast({
        title: "Assignment started",
        description: "You can now begin working on this assignment.",
      });
    } catch (error: any) {
      console.error("Failed to start assignment:", error);
      toast({
        title: "Error starting assignment",
        description: error.message || "Failed to start assignment",
        variant: "destructive",
      });
    } finally {
      setIsStarting(false);
    }
  };

  if (loading) {
    return <AssignmentPageSkeleton isInstructor={effectiveIsInstructor} />;
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
      <Allotment className="flex-1">
        {/* Main Scrollable Content Area */}
        <Allotment.Pane minSize={400}>
          <div className="h-full flex flex-col overflow-auto">
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
                            canEdit
                              ? "cursor-pointer hover:text-purple-100"
                              : ""
                          }`}
                          onClick={() =>
                            canEdit && setIsEditing(true)
                          }
                        >
                          {assignment.name}
                        </h1>
                      )}
                    </div>

                    {/* Publishing Status (Instructor/TA with edit permission) */}
                    {canEdit && (
                      <div className="flex items-center space-x-2">
                        <Users className="w-4 h-4" />
                        <Popover
                          trigger={
                            <button className="text-white hover:text-purple-100 text-sm flex items-center space-x-1">
                              <span>
                                Published to{" "}
                                {assignment.published_to?.length || 0} students
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

                    {/* Due Date and Status (Student view) */}
                    {effectiveIsStudent && (
                      <div className="flex items-center space-x-4">
                        {userDueDate && (
                          <div className="flex items-center space-x-2">
                            <Calendar className="w-4 h-4" />
                            <span className="text-sm">
                              Due: {formatDueDate(userDueDate)}
                            </span>
                          </div>
                        )}
                        {submissionStatus && (
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium">
                              Status:{" "}
                              {submissionStatus === "in-progress"
                                ? "In Progress"
                                : submissionStatus === "submitted"
                                ? "Submitted"
                                : submissionStatus === "graded"
                                ? "Graded"
                                : submissionStatus}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end space-y-3">
                    {/* Management Buttons (Instructor/TA with edit permission) */}
                    {canEdit && (
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
                        Total Points: {totalPoints}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Assignment Content */}
            <div className="flex-1 mx-6">
              <Card className="h-full p-0 overflow-hidden">
                {assignment && (
                  <>
                    {canEdit ? (
                      selectedGradingStudent ? (
                        <AssignmentViewer
                          assignment={assignment}
                          submissionId={
                            selectedGradingStudent.latestSubmission?.id
                          }
                          submissionStatus={
                            selectedGradingStudent.latestSubmission?.status
                          }
                          submissionTimestamp={
                            selectedGradingStudent.latestSubmission?.timestamp
                          }
                          isStudent={false}
                          studentId={selectedGradingStudent.userId}
                          locked={true}
                          grader={selectedGradingStudent.grader}
                        />
                      ) : (
                        <AssignmentEditor
                          key={assignment.id}
                          assignment={assignment}
                          onAssignmentUpdated={handleAssignmentUpdated}
                          isReadOnly={false}
                        />
                      )
                    ) : submissionId ? (
                      <AssignmentViewer
                        assignment={assignment}
                        submissionId={submissionId}
                        submissionStatus={submissionStatus}
                        submissionTimestamp={submissionTimestamp}
                        isStudent={true}
                        courseSlug={courseSlug || ""}
                        studentId={user?.id}
                        allSubmissions={allSubmissions}
                        selectedSubmissionId={selectedSubmissionId}
                        locked={
                          submissionStatus === "submitted" ||
                          submissionStatus === "graded"
                        }
                        onSubmissionSelect={(id) => {
                          const selected = allSubmissions.find(
                            (s) => s.id === id
                          );
                          if (selected) {
                            setSelectedSubmissionId(id);
                            setSubmissionId(id);
                            setSubmissionStatus(selected.status);
                            setSubmissionTimestamp(selected.timestamp);
                          }
                        }}
                        onSubmissionCreated={(id) => {
                          setSubmissionId(id);
                          setSelectedSubmissionId(id);
                          // Refresh submissions list
                          if (assignmentId && user?.id) {
                            apiClient
                              .getSubmissionsByAssignment(assignmentId)
                              .then((response) => {
                                const userSubmissions = response.data
                                  .filter(
                                    (sub: any) => sub.student_id === user.id
                                  )
                                  .sort(
                                    (a: any, b: any) =>
                                      new Date(b.timestamp).getTime() -
                                      new Date(a.timestamp).getTime()
                                  );
                                setAllSubmissions(userSubmissions);
                              });
                          }
                        }}
                        onSubmissionStatusChange={(status) => {
                          setSubmissionStatus(status);
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <div className="text-center max-w-md">
                          <h3 className="text-2xl font-semibold text-gray-900 mb-4">
                            Assignment Not Started
                          </h3>
                          <p className="text-gray-600 mb-6">
                            Click the button below to begin working on this
                            assignment. Your progress will be saved
                            automatically.
                          </p>
                          <Button
                            onClick={handleStartAssignment}
                            disabled={isStarting}
                            className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 text-lg"
                          >
                            {isStarting ? (
                              <>
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                                Starting...
                              </>
                            ) : (
                              "Start Assignment"
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </Card>
            </div>
          </div>
        </Allotment.Pane>

        {/* Sidebar Panel - Resizable */}
        {hasInstructionalPrivileges && activeSidebarPanel && assignment && (
          <Allotment.Pane minSize={280} maxSize={600} preferredSize={320}>
            <div className="h-full bg-white border-l border-gray-200 shadow-xl flex flex-col">
              <div className="p-4 border-b bg-gray-50 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold capitalize">
                    {activeSidebarPanel === "grader"
                      ? "Grading"
                      : activeSidebarPanel}
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
              <div className="flex-1 overflow-y-auto min-h-0">
                {activeSidebarPanel === "grader" ? (
                  <GradingSidebar
                    assignment={assignment}
                    courseId={assignment.course_id}
                    onStudentSelect={setSelectedGradingStudent}
                    selectedStudent={selectedGradingStudent}
                  />
                ) : canEdit ? (
                  <AssignmentSettingsPanel
                    assignment={assignment}
                    course={course}
                    userRole={userRole}
                    isInstructor={effectiveIsInstructor}
                    onAssignmentUpdated={handleAssignmentUpdated}
                  />
                ) : (
                  <div className="p-4 text-center text-gray-500">
                    You don't have permission to edit assignment settings.
                  </div>
                )}
              </div>
            </div>
          </Allotment.Pane>
        )}
      </Allotment>

      {/* Right Sidebar Strip - Fixed, outside Allotment */}
      {hasInstructionalPrivileges && (
        <div className="w-12 bg-gray-100 border-l border-gray-200 flex flex-col flex-shrink-0">
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
          {canEdit && (
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
          )}
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
