import React from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, X } from "lucide-react";
import { Button } from "./ui/button";

interface SubmissionSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignmentName: string;
  assignmentId: string;
  courseSlug: string;
}

const SubmissionSuccessModal: React.FC<SubmissionSuccessModalProps> = ({
  isOpen,
  onClose,
  assignmentName,
  assignmentId,
  courseSlug,
}) => {
  const navigate = useNavigate();
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
      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Success Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
        </div>

        {/* Content */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Assignment Submitted!
          </h2>
          <p className="text-gray-600 mb-6">
            Your submission for{" "}
            <span className="font-medium">{assignmentName}</span> has been
            successfully submitted. Your instructor will review it soon.
          </p>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <Button
              onClick={() => {
                navigate(
                  `/course/${courseSlug}/assignment/${assignmentId}/submissions`
                );
              }}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white"
            >
              View My Submissions
            </Button>
            <Button onClick={onClose} variant="outline" className="w-full">
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubmissionSuccessModal;
