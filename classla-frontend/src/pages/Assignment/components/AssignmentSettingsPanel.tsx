import React, { useState, useEffect } from "react";
import { HelpCircle, ChevronDown, ChevronRight } from "lucide-react";
import { Assignment, AssignmentSettings, RubricSchema } from "../../../types";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import RubricEditor from "./grader/rubric/RubricEditor";

interface AssignmentSettingsPanelProps {
  assignment: Assignment;
  onAssignmentUpdated: (assignment: Assignment) => void;
}

const AssignmentSettingsPanel: React.FC<AssignmentSettingsPanelProps> = ({
  assignment,
  onAssignmentUpdated,
}) => {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [rubricSchema, setRubricSchema] = useState<RubricSchema | null>(null);
  const [isLoadingRubric, setIsLoadingRubric] = useState(true);
  const [showRubricSection, setShowRubricSection] = useState(false);

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
      </div>

      {/* Save Status */}
      {isSaving && (
        <div className="border-t border-gray-200 p-4">
          <div className="text-sm text-gray-600 text-center">Saving...</div>
        </div>
      )}
    </div>
  );
};

export default AssignmentSettingsPanel;
