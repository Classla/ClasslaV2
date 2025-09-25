import React, { useState, useEffect } from "react";
import { apiClient } from "../lib/api";
import { useToast } from "../hooks/use-toast";
import { User } from "lucide-react";
import { Assignment, CourseEnrollment } from "../types";

interface PublishedStudentsListProps {
  assignment: Assignment;
}

interface EnrollmentWithUser extends CourseEnrollment {
  user: {
    id: string;
    first_name?: string;
    last_name?: string;
    email: string;
  };
}

const PublishedStudentsList: React.FC<PublishedStudentsListProps> = ({
  assignment,
}) => {
  const { toast } = useToast();
  const [publishedStudents, setPublishedStudents] = useState<
    EnrollmentWithUser[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPublishedStudents();
  }, [assignment.published_to]);

  const fetchPublishedStudents = async () => {
    try {
      setLoading(true);

      if (!assignment.published_to || assignment.published_to.length === 0) {
        setPublishedStudents([]);
        return;
      }

      // Fetch enrollments to get user details
      const enrollmentsResponse = await apiClient.getCourseEnrollments(
        assignment.course_id
      );
      const enrollmentsData = enrollmentsResponse.data.data;

      // Filter to only published students
      const publishedUserIds = new Set(assignment.published_to);
      const publishedEnrollments = enrollmentsData
        .filter(
          (item: any) =>
            publishedUserIds.has(item.id) &&
            (item.enrollment.role === "student" ||
              item.enrollment.role === "audit")
        )
        .map((item: any) => ({
          id: item.enrollment.id,
          user_id: item.enrollment.user_id,
          course_id: item.enrollment.course_id,
          section_id: item.enrollment.section_id,
          role: item.enrollment.role,
          enrolled_at: item.enrollment.enrolled_at,
          user: {
            id: item.id,
            first_name: item.first_name,
            last_name: item.last_name,
            email: item.email,
          },
        }));

      setPublishedStudents(publishedEnrollments);
    } catch (error: any) {
      toast({
        title: "Error loading published students",
        description: error.message || "Failed to load student data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getStudentDisplayName = (enrollment: EnrollmentWithUser) => {
    const { first_name, last_name, email } = enrollment.user;
    if (first_name || last_name) {
      return `${first_name || ""} ${last_name || ""}`.trim();
    }
    return email;
  };

  if (loading) {
    return (
      <div className="p-4 w-64">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded mb-2"></div>
          <div className="h-4 bg-gray-200 rounded mb-2"></div>
          <div className="h-4 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (publishedStudents.length === 0) {
    return (
      <div className="p-4 w-64">
        <p className="text-sm text-gray-600">No students published to yet</p>
      </div>
    );
  }

  return (
    <div className="p-4 w-64 max-h-64 overflow-y-auto">
      <h4 className="font-medium text-sm text-gray-900 mb-3">
        Published to {publishedStudents.length} student
        {publishedStudents.length !== 1 ? "s" : ""}:
      </h4>
      <div className="space-y-2">
        {publishedStudents.map((enrollment) => (
          <div
            key={enrollment.id}
            className="flex items-center space-x-2 text-sm"
          >
            <User className="w-3 h-3 text-gray-400" />
            <span className="text-gray-700">
              {getStudentDisplayName(enrollment)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PublishedStudentsList;
