import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { HelpCircle, ChevronDown, ChevronRight, Trash2, Copy, ArrowRight } from "lucide-react";
import { Label } from "../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Assignment, AssignmentSettings, RubricSchema, Course, UserRole } from "../../../types";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../components/ui/dialog";
import { useAuth } from "../../../contexts/AuthContext";
import { hasTAPermission } from "../../../lib/taPermissions";
import RubricEditor from "./grader/rubric/RubricEditor";

interface AssignmentSettingsPanelProps {
  assignment: Assignment;
  course?: Course;
  userRole?: UserRole;
  isInstructor?: boolean;
  onAssignmentUpdated: (assignment: Assignment) => void;
}

const AssignmentSettingsPanel: React.FC<AssignmentSettingsPanelProps> = ({
  assignment,
  course,
  userRole,
  isInstructor,
  onAssignmentUpdated,
}) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { courseSlug } = useParams<{ courseSlug: string }>();
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [rubricSchema, setRubricSchema] = useState<RubricSchema | null>(null);
  const [isLoadingRubric, setIsLoadingRubric] = useState(true);
  const [showRubricSection, setShowRubricSection] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [availableCourses, setAvailableCourses] = useState<any[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [cloneTargetCourseId, setCloneTargetCourseId] = useState("");

  // Check if TA has delete permission
  const canDelete = useMemo(() => {
    if (!isInstructor) return false;
    if (userRole !== UserRole.TEACHING_ASSISTANT) return true; // Instructors/admins always can delete
    return hasTAPermission(course ?? null, user?.id, userRole, "canDelete");
  }, [isInstructor, userRole, course, user?.id]);

  // Only instructors/admins can clone (not TAs)
  const canClone = useMemo(() => {
    if (!isInstructor) return false;
    return userRole === UserRole.INSTRUCTOR || userRole === UserRole.ADMIN;
  }, [isInstructor, userRole]);

  // Initialize settings with defaults
  const [settings, setSettings] = useState<AssignmentSettings>({
    allowLateSubmissions: assignment.settings?.allowLateSubmissions ?? false,
    allowResubmissions: assignment.settings?.allowResubmissions ?? false,
    showResponsesAfterSubmission:
      assignment.settings?.showResponsesAfterSubmission ?? false,
    showScoreAfterSubmission:
      assignment.settings?.showScoreAfterSubmission ?? false,
  });

  // Load rubric schema
  useEffect(() => {
    const loadRubricSchema = async () => {
      try {
        setIsLoadingRubric(true);
        const response = await apiClient.getRubricSchema(assignment.id);
        setRubricSchema(response.data);
      } catch (error: any) {
        // 404 is expected if no rubric exists
        if (error.statusCode !== 404) {
          console.error("Failed to load rubric schema:", error);
        }
      } finally {
        setIsLoadingRubric(false);
      }
    };

    loadRubricSchema();
  }, [assignment.id]);

  // Load courses when clone dialog opens
  useEffect(() => {
    if (cloneDialogOpen && availableCourses.length === 0) {
      loadAvailableCourses();
    }
  }, [cloneDialogOpen]);

  const loadAvailableCourses = async () => {
    if (!user?.id) return;
    
    setLoadingCourses(true);
    try {
      const response = await apiClient.getUserCourses(user.id);
      const courses = response.data.data || [];
      // Filter out the current course and templates
      const filtered = courses.filter(
        (c: any) => c.id !== course?.id && !c.is_template && !c.deleted_at
      );
      setAvailableCourses(filtered);
    } catch (error: any) {
      console.error("Error loading courses:", error);
      toast({
        title: "Error loading courses",
        description: error.message || "Failed to load courses",
        variant: "destructive",
      });
    } finally {
      setLoadingCourses(false);
    }
  };

  const handleCloneToCourse = async () => {
    if (!cloneTargetCourseId) {
      toast({
        title: "Missing information",
        description: "Please select a target course",
        variant: "destructive",
      });
      return;
    }

    setIsCloning(true);
    try {
      await apiClient.cloneAssignmentToCourse(assignment.id, cloneTargetCourseId);

      toast({
        title: "Assignment cloned!",
        description: "Assignment has been cloned to the selected course",
      });

      setCloneDialogOpen(false);
      setCloneTargetCourseId("");
    } catch (error: any) {
      console.error("Error cloning assignment:", error);
      toast({
        title: "Error cloning assignment",
        description: error.message || "Failed to clone assignment to course",
        variant: "destructive",
      });
    } finally {
      setIsCloning(false);
    }
  };

  const handleToggle = async (key: keyof typeof settings) => {
    const newValue = !settings[key];
    const newSettings = {
      ...settings,
      [key]: newValue,
    };

    setSettings(newSettings);

    // Auto-save immediately
    try {
      setIsSaving(true);
      const response = await apiClient.updateAssignment(assignment.id, {
        settings: {
          ...assignment.settings,
          ...newSettings,
        },
      });

      onAssignmentUpdated(response.data);
      toast({
        title: "Setting saved",
        description: "Assignment setting has been updated.",
      });
    } catch (error: any) {
      console.error("Failed to save setting:", error);
      // Revert on error
      setSettings(settings);
      toast({
        title: "Error saving setting",
        description: error.message || "Failed to update assignment setting",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveRubric = async (schema: Partial<RubricSchema>) => {
    try {
      if (rubricSchema) {
        // Update existing rubric
        const response = await apiClient.updateRubricSchema(
          rubricSchema.id,
          schema
        );
        setRubricSchema(response.data);
        toast({
          title: "Rubric updated",
          description: "Rubric has been updated successfully.",
        });
      } else {
        // Create new rubric
        const response = await apiClient.createRubricSchema({
          assignment_id: assignment.id,
          title: schema.title!,
          type: schema.type!,
          use_for_grading: schema.use_for_grading,
          items: schema.items!,
        });
        setRubricSchema(response.data);
        toast({
          title: "Rubric created",
          description: "Rubric has been created successfully.",
        });
      }
    } catch (error: any) {
      console.error("Failed to save rubric:", error);
      toast({
        title: "Error saving rubric",
        description: error.message || "Failed to save rubric",
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleDeleteRubric = async () => {
    if (!rubricSchema) return;

    try {
      await apiClient.deleteRubricSchema(rubricSchema.id);
      setRubricSchema(null);
      toast({
        title: "Rubric deleted",
        description: "Rubric has been deleted successfully.",
      });
    } catch (error: any) {
      console.error("Failed to delete rubric:", error);
      toast({
        title: "Error deleting rubric",
        description: error.message || "Failed to delete rubric",
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleDeleteAssignment = () => {
    setDeleteDialogOpen(true);
  };

  const confirmDeleteAssignment = async () => {
    setDeleteDialogOpen(false);

    try {
      setIsDeleting(true);
      await apiClient.deleteAssignment(assignment.id);
      
      toast({
        title: "Assignment deleted",
        description: "Assignment has been deleted successfully.",
      });

      // Navigate back to course page
      navigate(`/course/${courseSlug}`);
    } catch (error: any) {
      console.error("Failed to delete assignment:", error);
      toast({
        title: "Error deleting assignment",
        description: error.message || "Failed to delete assignment",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Allow Late Submissions */}
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-900 mb-1">
                Allow Late Submissions
              </h3>
              <p className="text-xs text-gray-600 mb-2">
                Students can submit their work after the due date has passed.
              </p>
            </div>
          </div>
          <button
            onClick={() => handleToggle("allowLateSubmissions")}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
              settings.allowLateSubmissions ? "bg-purple-600" : "bg-gray-200"
            }`}
            role="switch"
            aria-checked={settings.allowLateSubmissions ? "true" : "false"}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                settings.allowLateSubmissions
                  ? "translate-x-5"
                  : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Allow Resubmissions */}
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-900 mb-1">
                Allow Resubmissions
              </h3>
              <p className="text-xs text-gray-600 mb-2">
                Students can submit multiple times. Each submission creates a
                new entry.
              </p>
            </div>
          </div>
          <button
            onClick={() => handleToggle("allowResubmissions")}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
              settings.allowResubmissions ? "bg-purple-600" : "bg-gray-200"
            }`}
            role="switch"
            aria-checked={settings.allowResubmissions ? "true" : "false"}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                settings.allowResubmissions ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Show Responses After Submission */}
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-900 mb-1">
                Show Responses After Submission
              </h3>
              <p className="text-xs text-gray-600 mb-2">
                After submitting, students can view their answers.
              </p>
            </div>
          </div>
          <button
            onClick={() => handleToggle("showResponsesAfterSubmission")}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
              settings.showResponsesAfterSubmission
                ? "bg-purple-600"
                : "bg-gray-200"
            }`}
            role="switch"
            aria-checked={
              settings.showResponsesAfterSubmission ? "true" : "false"
            }
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                settings.showResponsesAfterSubmission
                  ? "translate-x-5"
                  : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Show Score After Submission */}
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-900 mb-1">
                Show Score After Submission
              </h3>
              <p className="text-xs text-gray-600 mb-2">
                When enabled, students will see their autograded score
                immediately after submitting. When disabled, scores are hidden
                until you manually release them.
              </p>
            </div>
          </div>
          <button
            onClick={() => handleToggle("showScoreAfterSubmission")}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
              settings.showScoreAfterSubmission
                ? "bg-purple-600"
                : "bg-gray-200"
            }`}
            role="switch"
            aria-checked={settings.showScoreAfterSubmission ? "true" : "false"}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                settings.showScoreAfterSubmission
                  ? "translate-x-5"
                  : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Rubric Configuration */}
        <div className="space-y-2 pt-4 border-t border-gray-200">
          <button
            onClick={() => setShowRubricSection(!showRubricSection)}
            className="w-full flex items-center justify-between text-left"
          >
            <div className="flex items-start gap-2">
              <HelpCircle className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-gray-900 mb-1">
                  Grading Rubric
                </h3>
                <p className="text-xs text-gray-600">
                  Configure criteria and point values for manual grading
                </p>
              </div>
            </div>
            {showRubricSection ? (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-gray-400" />
            )}
          </button>

          {showRubricSection && (
            <div className="pl-6 pt-2">
              {isLoadingRubric ? (
                <div className="text-sm text-gray-600">Loading rubric...</div>
              ) : (
                <RubricEditor
                  rubricSchema={rubricSchema}
                  onSave={handleSaveRubric}
                  onDelete={rubricSchema ? handleDeleteRubric : undefined}
                />
              )}
            </div>
          )}
        </div>

        {/* Clone to Another Course (Instructors/Admins only) */}
        {canClone && !course?.is_template && (
          <div className="space-y-2 pt-4 border-t border-gray-200">
            <div className="flex items-start gap-2">
              <HelpCircle className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-gray-900 mb-1">
                  Clone to Another Course
                </h3>
                <p className="text-xs text-gray-600 mb-3">
                  Copy this assignment to another course. Student data and grades will not be copied.
                </p>
                <Dialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="w-full flex items-center gap-2">
                      <Copy className="w-4 h-4" />
                      Clone to Another Course
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Clone Assignment to Course</DialogTitle>
                      <DialogDescription>
                        Select a course to clone this assignment to. The assignment will be copied with all content, but student submissions and grades will not be included.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div>
                        <Label htmlFor="clone-course">Target Course</Label>
                        <Select
                          value={cloneTargetCourseId}
                          onValueChange={setCloneTargetCourseId}
                        >
                          <SelectTrigger id="clone-course">
                            <SelectValue placeholder="Select a course" />
                          </SelectTrigger>
                          <SelectContent>
                            {loadingCourses ? (
                              <SelectItem value="loading" disabled>Loading courses...</SelectItem>
                            ) : availableCourses.length === 0 ? (
                              <SelectItem value="none" disabled>No courses available</SelectItem>
                            ) : (
                              availableCourses.map((c: any) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setCloneDialogOpen(false)}
                        disabled={isCloning}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleCloneToCourse}
                        disabled={isCloning || !cloneTargetCourseId}
                        className="flex items-center gap-2"
                      >
                        <ArrowRight className="w-4 h-4" />
                        {isCloning ? "Cloning..." : "Clone Assignment"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>
        )}

        {/* Delete Assignment Section */}
        <div className="space-y-2 pt-4 border-t border-gray-200">
          <div className="flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-900 mb-1">
                Delete Assignment
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                This action cannot be undone. All submissions and grades will be permanently deleted.
              </p>
              <Button
                onClick={handleDeleteAssignment}
                disabled={isDeleting || !canDelete}
                variant="destructive"
                className="w-full"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Assignment
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Save Status */}
      {isSaving && (
        <div className="border-t border-gray-200 p-4">
          <div className="text-sm text-gray-600 text-center">Saving...</div>
        </div>
      )}

      {/* Delete Assignment Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Assignment</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the assignment "{assignment.name}"? This action cannot be undone. All submissions and grades will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteAssignment}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Assignment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AssignmentSettingsPanel;
