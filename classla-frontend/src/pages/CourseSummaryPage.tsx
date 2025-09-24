import React, { useState } from "react";
import { Course, UserRole } from "../types";
import { Users, Copy, Check, Link } from "lucide-react";
import { Card } from "../components/ui/card";
import CourseEditor from "../components/CourseEditor";
import CreateJoinLinkModal from "../components/CreateJoinLinkModal";

interface CourseSummaryPageProps {
  course?: Course;
  setCourse?: (course: Course) => void;
  userRole?: UserRole;
  isStudent?: boolean;
  isInstructor?: boolean;
  handleCopyJoinCode?: () => void;
  copied?: boolean;
}

const CourseSummaryPage: React.FC<CourseSummaryPageProps> = ({
  course,
  setCourse,
  isStudent,
  isInstructor,
  handleCopyJoinCode,
  copied,
}) => {
  const [isJoinLinkModalOpen, setIsJoinLinkModalOpen] = useState(false);
  // If props are not provided, show loading or error state
  if (!course || !setCourse) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        <span className="ml-3 text-gray-600">Loading course summary...</span>
      </div>
    );
  }

  // Default to student if userRole is not available yet
  const effectiveIsStudent = isStudent ?? true;
  const effectiveIsInstructor = isInstructor ?? false;

  return (
    <div className="h-full flex flex-col">
      {/* Course Header */}
      <Card className="bg-purple-600 text-white border-0 rounded-3xl mx-6 mt-6 flex-shrink-0">
        <div className="p-6">
          <div className="flex justify-between items-start">
            <div className="space-y-4">
              <h1 className="text-3xl font-bold">{course.name}</h1>
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5" />
                <span className="text-lg font-semibold">1</span>
              </div>
            </div>

            {effectiveIsInstructor && handleCopyJoinCode && (
              <div className="flex items-center space-x-2 bg-white/10 rounded-lg px-4 py-2">
                <span className="text-lg font-semibold">Join Code:</span>
                <button
                  onClick={handleCopyJoinCode}
                  className="flex items-center space-x-2 hover:bg-white/10 rounded px-2 py-1 transition-colors"
                >
                  <span className="text-xl font-bold">{course.slug}</span>
                  {copied ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                </button>

                <button
                  onClick={() => setIsJoinLinkModalOpen(true)}
                  className="flex items-center space-x-1 hover:bg-white/10 rounded px-2 py-1 transition-colors"
                  title="Manage join links"
                >
                  <Link className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Course Editor */}
      <div className="flex-1 mx-6 mb-6">
        <CourseEditor
          course={course}
          setCourse={setCourse}
          isReadOnly={effectiveIsStudent}
        />
      </div>

      {/* Join Link Modal */}
      <CreateJoinLinkModal
        isOpen={isJoinLinkModalOpen}
        onClose={() => setIsJoinLinkModalOpen(false)}
        courseSlug={course.slug}
        onLinkCreated={() => {
          // Optionally refresh join links or show success message
        }}
      />
    </div>
  );
};

export default CourseSummaryPage;
