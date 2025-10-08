import React, { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Assignment, AssignmentSettings } from "../types";
import { apiClient } from "../lib/api";
import { useToast } from "../hooks/use-toast";

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

  // Initialize settings with defaults
  const [settings, setSettings] = useState<AssignmentSettings>({
    allowLateSubmissions: assignment.settings?.allowLateSubmissions ?? false,
    allowResubmissions: assignment.settings?.allowResubmissions ?? false,
    showResponsesAfterSubmission:
      assignment.settings?.showResponsesAfterSubmission ?? false,
    showScoreAfterSubmission:
      assignment.settings?.showScoreAfterSubmission ?? false,
  });

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
