import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Course, UserRole } from "../../../types";
import { Users, Copy, Check, Link, FileText, Sparkles } from "lucide-react";
import { Card } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { useToast } from "../../../hooks/use-toast";
import { apiClient } from "../../../lib/api";
import CourseEditor from "../components/CourseEditor";
import CreateJoinLinkModal from "../components/CreateJoinLinkModal";
import CourseSummarySkeleton from "./CourseSummarySkeleton";

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
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isJoinLinkModalOpen, setIsJoinLinkModalOpen] = useState(false);
  const [isUsingTemplate, setIsUsingTemplate] = useState(false);

  const handleUseTemplate = async () => {
    if (!course?.id) return;

    setIsUsingTemplate(true);
    try {
      const response = await apiClient.cloneTemplate(course.id);
      toast({
        title: "Course created!",
        description: `Course has been created from template. Join code: ${response.data.slug}`,
      });
      navigate(`/course/${response.data.slug}/summary`);
    } catch (error: any) {
      console.error("Failed to use template:", error);
      toast({
        title: "Failed to create course",
        description: error.message || "An error occurred while creating the course",
        variant: "destructive",
      });
    } finally {
      setIsUsingTemplate(false);
    }
  };
  // If props are not provided, show loading or error state
  if (!course || !setCourse) {
    return <CourseSummarySkeleton />;
  }

  // Default to student if userRole is not available yet
  const effectiveIsStudent = isStudent ?? true;
  const effectiveIsInstructor = isInstructor ?? false;

  return (
    <div className="h-full flex flex-col">
      {/* Course Header */}
      <Card className="bg-purple-600 dark:bg-purple-900 text-white border-0 rounded-3xl mx-6 mt-6 flex-shrink-0">
        <div className="p-6">
          <div className="flex justify-between items-start">
            <div className="space-y-4">
              <h1 className="text-3xl font-bold">{course.name}</h1>
              {course.is_template ? (
                <div className="flex items-center space-x-2">
                  <FileText className="w-5 h-5" />
                  <span className="text-lg font-semibold">Course Template</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Users className="w-5 h-5" />
                  <span className="text-lg font-semibold">
                    {course.student_count ?? 0}
                  </span>
                </div>
              )}
            </div>

            {course.is_template && effectiveIsInstructor ? (
              <Button
                onClick={handleUseTemplate}
                disabled={isUsingTemplate}
                className="bg-white text-purple-600 hover:bg-primary/10"
                size="lg"
              >
                <Sparkles className="w-5 h-5 mr-2" />
                {isUsingTemplate ? "Creating Course..." : "Use Template"}
              </Button>
            ) : (
              effectiveIsInstructor && handleCopyJoinCode && (
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
              )
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
