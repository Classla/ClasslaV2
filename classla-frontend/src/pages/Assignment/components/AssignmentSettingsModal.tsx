import React, { useState } from "react";
import { X, HelpCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Assignment, AssignmentSettings } from "../../../types";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";

interface AssignmentSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignment: Assignment;
  onAssignmentUpdated: (assignment: Assignment) => void;
}

const AssignmentSettingsModal: React.FC<AssignmentSettingsModalProps> = ({
  isOpen,
  onClose,
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
    ...assignment.settings,
  });

  const handleToggle = (key: keyof AssignmentSettings) => {
    setSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const response = await apiClient.updateAssignment(assignment.id, {
        settings,
      });

      onAssignmentUpdated(response.data);
      toast({
        title: "Settings saved",
        description: "Assignment settings have been updated successfully.",
      });
      onClose();
    } catch (error: any) {
      console.error("Failed to save settings:", error);
      toast({
        title: "Error saving settings",
        description: error.message || "Failed to update assignment settings",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">
            Assignment Settings
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Allow Late Submissions */}
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 flex-1">
              <div className="mt-1">
                <HelpCircle className="w-5 h-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-gray-900 mb-1">
                  Allow Late Submissions
                </h3>
                <p className="text-sm text-gray-600">
                  Students can submit their work after the due date has passed.
                  Late submissions will be marked as late but will still be
                  accepted.
                </p>
              </div>
            </div>
            <button
              onClick={() => handleToggle("allowLateSubmissions")}
              className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                settings.allowLateSubmissions ? "bg-purple-600" : "bg-gray-200"
              }`}
              role="switch"
              aria-checked={settings.allowLateSubmissions}
            >
              <span
                className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  settings.allowLateSubmissions
                    ? "translate-x-6"
                    : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Allow Resubmissions */}
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 flex-1">
              <div className="mt-1">
                <HelpCircle className="w-5 h-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-gray-900 mb-1">
                  Allow Resubmissions
                </h3>
                <p className="text-sm text-gray-600">
                  Students can submit multiple times. Each submission creates a
                  new entry, and all previous submissions are preserved. You can
                  choose which submission to grade.
                </p>
              </div>
            </div>
            <button
              onClick={() => handleToggle("allowResubmissions")}
              className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                settings.allowResubmissions ? "bg-purple-600" : "bg-gray-200"
              }`}
              role="switch"
              aria-checked={settings.allowResubmissions}
            >
              <span
                className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  settings.allowResubmissions
                    ? "translate-x-6"
                    : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Show Responses After Submission */}
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 flex-1">
              <div className="mt-1">
                <HelpCircle className="w-5 h-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-gray-900 mb-1">
                  Show Responses After Submission
                </h3>
                <p className="text-sm text-gray-600">
                  After submitting, students can view their answers. If
                  disabled, students will only see a confirmation that their
                  work was submitted.
                </p>
              </div>
            </div>
            <button
              onClick={() => handleToggle("showResponsesAfterSubmission")}
              className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                settings.showResponsesAfterSubmission
                  ? "bg-purple-600"
                  : "bg-gray-200"
              }`}
              role="switch"
              aria-checked={settings.showResponsesAfterSubmission}
            >
              <span
                className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  settings.showResponsesAfterSubmission
                    ? "translate-x-6"
                    : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AssignmentSettingsModal;
