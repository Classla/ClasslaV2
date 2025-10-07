import React, { useMemo } from "react";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Section, Submission, Grader, StudentSubmissionInfo } from "../types";
import { Search } from "lucide-react";

// Re-export for backward compatibility
export type { StudentSubmissionInfo };

interface StudentListProps {
  students: StudentSubmissionInfo[];
  selectedStudentId: string | null;
  onStudentSelect: (studentId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sections: Section[];
  selectedSectionId: string | null;
  onSectionChange: (sectionId: string | null) => void;
}

const StudentList: React.FC<StudentListProps> = React.memo(
  ({
    students,
    selectedStudentId,
    onStudentSelect,
    searchQuery,
    onSearchChange,
    sections,
    selectedSectionId,
    onSectionChange,
  }) => {
    // Students are already filtered and sorted in parent component
    // No need to duplicate the logic here
    const filteredStudents = students;

    // Get submission status display
    const getSubmissionStatus = (student: StudentSubmissionInfo): string => {
      if (!student.latestSubmission) return "Not Started";

      const status = student.latestSubmission.status;
      if (status === "in-progress") return "In Progress";
      if (status === "submitted") return "Submitted";
      if (status === "graded") return "Graded";
      if (status === "returned") return "Returned";

      return status;
    };

    // Get status badge variant
    const getStatusVariant = (
      status: string
    ): "default" | "secondary" | "destructive" | "outline" => {
      if (status === "Not Started") return "destructive";
      if (status === "In Progress") return "secondary";
      if (status === "Submitted") return "outline";
      if (status === "Graded" || status === "Returned") return "default";
      return "outline";
    };

    // Calculate final grade
    const calculateFinalGrade = (student: StudentSubmissionInfo): string => {
      if (!student.grader || !student.latestSubmission) return "";

      const rawScore =
        student.grader.raw_assignment_score + student.grader.raw_rubric_score;
      const modifier = parseFloat(student.grader.score_modifier) || 0;
      const finalGrade = rawScore + modifier;

      return `${finalGrade}`;
    };

    return (
      <div className="flex flex-col h-full bg-white">
        {/* Search and Filter Section */}
        <div className="p-4 space-y-3 border-b border-gray-200 bg-gray-50">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search students..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500"
            />
          </div>

          {/* Section Filter */}
          <Select
            value={selectedSectionId || "all"}
            onValueChange={(value) =>
              onSectionChange(value === "all" ? null : value)
            }
          >
            <SelectTrigger className="bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500">
              <SelectValue placeholder="All Sections" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sections</SelectItem>
              {sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Student List */}
        <div className="flex-1 overflow-y-auto">
          {filteredStudents.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-gray-400 mb-2">
                <svg
                  className="w-12 h-12 mx-auto"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <p className="text-gray-500 font-medium">No students found</p>
              <p className="text-sm text-gray-400 mt-1">
                Try adjusting your search or filters
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredStudents.map((student) => {
                const isSelected = student.userId === selectedStudentId;
                const status = getSubmissionStatus(student);
                const grade = calculateFinalGrade(student);
                const isReviewed = student.grader?.reviewed_at != null;

                return (
                  <div
                    key={student.userId}
                    onClick={() => onStudentSelect(student.userId)}
                    className={`p-4 cursor-pointer transition-all duration-150 ${
                      isSelected
                        ? "bg-purple-50 border-l-4 border-l-purple-600 shadow-sm"
                        : "hover:bg-gray-50 border-l-4 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {/* Student Name */}
                        <div
                          className={`font-semibold truncate ${
                            isSelected ? "text-purple-900" : "text-gray-900"
                          }`}
                        >
                          {student.lastName}, {student.firstName}
                        </div>

                        {/* Status and Grade */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Badge
                            variant={getStatusVariant(status)}
                            className="text-xs"
                          >
                            {status}
                          </Badge>
                          {grade && (
                            <span className="text-sm font-medium text-gray-700">
                              Grade: {grade}
                            </span>
                          )}
                          {isReviewed && (
                            <Badge
                              variant="default"
                              className="bg-green-600 hover:bg-green-700 text-xs"
                            >
                              ✓ Reviewed
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }
);

StudentList.displayName = "StudentList";

export default StudentList;
