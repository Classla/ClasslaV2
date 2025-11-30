import React, { useState, useEffect } from "react";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../../components/ui/button";
import { Label } from "../../../components/ui/label";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../../components/ui/dialog";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { ChevronRight, ChevronDown, Users, User } from "lucide-react";
import { Assignment, Section, CourseEnrollment } from "../../../types";

interface PublishAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignment: Assignment;
  onAssignmentUpdated: (assignment: Assignment) => void;
}

interface EnrollmentWithUser extends CourseEnrollment {
  user: {
    id: string;
    first_name?: string;
    last_name?: string;
    email: string;
  };
}

interface SectionWithEnrollments extends Section {
  enrollments: EnrollmentWithUser[];
  expanded?: boolean;
}

const PublishAssignmentModal: React.FC<PublishAssignmentModalProps> = ({
  isOpen,
  onClose,
  assignment,
  onAssignmentUpdated,
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<SectionWithEnrollments[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    if (isOpen) {
      fetchSectionsAndEnrollments();
    }
  }, [isOpen]);

  const fetchSectionsAndEnrollments = async () => {
    try {
      setLoading(true);

      // Fetch sections
      const sectionsResponse = await apiClient.getCourseSections(
        assignment.course_id
      );
      const sectionsData = sectionsResponse.data.data;

      // Fetch enrollments
      const enrollmentsResponse = await apiClient.getCourseEnrollments(
        assignment.course_id
      );
      const enrollmentsData = enrollmentsResponse.data.data; // The actual array is in .data.data

      // Transform the API response to match our expected format
      // Filter out instructors, TAs, and admins - they can see all assignments anyway
      const transformedEnrollments: EnrollmentWithUser[] = enrollmentsData
        .filter(
          (item: any) =>
            item.enrollment.role === "student" ||
            item.enrollment.role === "audit"
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

      // Group enrollments by section
      const sectionsWithEnrollments: SectionWithEnrollments[] =
        sectionsData.map((section: Section) => ({
          ...section,
          enrollments: transformedEnrollments.filter(
            (enrollment: EnrollmentWithUser) =>
              enrollment.section_id === section.id
          ),
        }));

      // Add a "No Section" group for students not in any section
      const noSectionEnrollments = transformedEnrollments.filter(
        (enrollment: EnrollmentWithUser) => !enrollment.section_id
      );

      if (noSectionEnrollments.length > 0) {
        sectionsWithEnrollments.push({
          id: "no-section",
          course_id: assignment.course_id,
          name: "No Section",
          slug: "no-section",
          enrollments: noSectionEnrollments,
        });
      }

      setSections(sectionsWithEnrollments);

      // Expand all sections by default so users can see students
      const allSectionIds = new Set(sectionsWithEnrollments.map((s) => s.id));
      setExpandedSections(allSectionIds);

      // Initialize selection state based on published_to user IDs
      initializeSelectionState(sectionsWithEnrollments);
    } catch (error: any) {
      toast({
        title: "Error loading data",
        description: error.message || "Failed to load sections and enrollments",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const initializeSelectionState = (
    sectionsWithEnrollments: SectionWithEnrollments[]
  ) => {
    const publishedUserIds = new Set(assignment.published_to);
    const newSelectedItems = new Set<string>();

    // Add all published user IDs to selection
    publishedUserIds.forEach((userId) => {
      newSelectedItems.add(userId);
    });

    // Check if entire sections should be selected
    sectionsWithEnrollments.forEach((section) => {
      const sectionUserIds = section.enrollments.map((e) => e.user.id);
      const allUsersInSectionSelected =
        sectionUserIds.length > 0 &&
        sectionUserIds.every((userId) => publishedUserIds.has(userId));

      if (allUsersInSectionSelected) {
        newSelectedItems.add(section.id);
      }
    });

    // Check if entire course should be selected
    const allUserIds = sectionsWithEnrollments.flatMap((section) =>
      section.enrollments.map((e) => e.user.id)
    );
    const allUsersSelected =
      allUserIds.length > 0 &&
      allUserIds.every((userId) => publishedUserIds.has(userId));

    if (allUsersSelected) {
      newSelectedItems.add(assignment.course_id);
    }

    setSelectedItems(newSelectedItems);
  };

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  const toggleSectionSelection = (section: SectionWithEnrollments) => {
    const newSelected = new Set(selectedItems);
    const sectionSelected = newSelected.has(section.id);

    if (sectionSelected) {
      // Deselect section and all its students
      newSelected.delete(section.id);
      section.enrollments.forEach((enrollment) => {
        newSelected.delete(enrollment.user.id);
      });
      // Deselect course-wide if it was selected
      newSelected.delete(assignment.course_id);
    } else {
      // Select section and all its students
      newSelected.add(section.id);
      section.enrollments.forEach((enrollment) => {
        newSelected.add(enrollment.user.id);
      });

      // Check if all sections are now selected (course-wide)
      const allSectionIds = sections.map((s) => s.id);
      const allSectionsSelected = allSectionIds.every((id) =>
        newSelected.has(id)
      );
      if (allSectionsSelected) {
        newSelected.add(assignment.course_id);
      }
    }

    setSelectedItems(newSelected);
  };

  const toggleStudentSelection = (studentId: string, sectionId: string) => {
    const newSelected = new Set(selectedItems);

    if (newSelected.has(studentId)) {
      newSelected.delete(studentId);

      // Deselect course-wide if it was selected
      newSelected.delete(assignment.course_id);

      // If this was the last student in the section, deselect the section too
      const section = sections.find((s) => s.id === sectionId);
      if (section) {
        const sectionStudentIds = section.enrollments.map((e) => e.user.id);
        const selectedStudentsInSection = sectionStudentIds.filter((id) =>
          newSelected.has(id)
        );
        if (selectedStudentsInSection.length === 0) {
          newSelected.delete(sectionId);
        }
      }
    } else {
      newSelected.add(studentId);
      // Check if all students in the section are now selected
      const section = sections.find((s) => s.id === sectionId);
      if (section) {
        const sectionStudentIds = section.enrollments.map((e) => e.user.id);
        const allStudentsSelected = sectionStudentIds.every(
          (id) => newSelected.has(id) || id === studentId
        );
        if (allStudentsSelected) {
          newSelected.add(sectionId);

          // Check if all sections are now selected (course-wide)
          const allSectionIds = sections.map((s) => s.id);
          const allSectionsSelected = allSectionIds.every((id) =>
            newSelected.has(id)
          );
          if (allSectionsSelected) {
            newSelected.add(assignment.course_id);
          }
        }
      }
    }

    setSelectedItems(newSelected);
  };

  const selectAll = () => {
    const newSelected = new Set<string>();

    // Add course-wide selection
    newSelected.add(assignment.course_id);

    // Add all sections and students
    sections.forEach((section) => {
      newSelected.add(section.id);
      section.enrollments.forEach((enrollment) => {
        newSelected.add(enrollment.user.id);
      });
    });

    setSelectedItems(newSelected);
  };

  const deselectAll = () => {
    setSelectedItems(new Set());
  };

  const handleSave = async () => {
    try {
      setLoading(true);

      // Convert selected items to published_to array containing ONLY user IDs
      const userIds = new Set<string>();

      selectedItems.forEach((itemId) => {
        if (itemId === assignment.course_id) {
          // Course-wide selection: add all student user IDs
          sections.forEach((section) => {
            section.enrollments.forEach((enrollment) => {
              userIds.add(enrollment.user.id);
            });
          });
        } else {
          // Check if this is a section ID
          const section = sections.find((s) => s.id === itemId);
          if (section) {
            // Section selection: add all student user IDs in this section
            section.enrollments.forEach((enrollment) => {
              userIds.add(enrollment.user.id);
            });
          } else {
            // Individual user selection: add the user ID directly
            userIds.add(itemId);
          }
        }
      });

      const publishedTo = Array.from(userIds);

      const updatedAssignment = await apiClient.updateAssignment(
        assignment.id,
        {
          published_to: publishedTo,
        }
      );

      onAssignmentUpdated(updatedAssignment.data);
      toast({
        title: "Assignment published",
        description: "Assignment publishing settings have been updated",
      });
      onClose();
    } catch (error: any) {
      toast({
        title: "Error publishing assignment",
        description: error.message || "Failed to update publishing settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const isSectionSelected = (section: SectionWithEnrollments) => {
    return selectedItems.has(section.id);
  };

  const isSectionPartiallySelected = (section: SectionWithEnrollments) => {
    if (selectedItems.has(section.id)) return false;
    return section.enrollments.some((enrollment) =>
      selectedItems.has(enrollment.user.id)
    );
  };

  const getStudentDisplayName = (enrollment: EnrollmentWithUser) => {
    const { first_name, last_name, email } = enrollment.user;
    if (first_name || last_name) {
      return `${first_name || ""} ${last_name || ""}`.trim();
    }
    return email;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Publish Assignment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Select sections and students to publish this assignment to:
            </p>
            <div className="space-x-2">
              <Button variant="outline" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={deselectAll}>
                Deselect All
              </Button>
            </div>
          </div>

          {/* Course-wide option */}
          <div className="border rounded-lg p-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                checked={selectedItems.has(assignment.course_id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    selectAll();
                  } else {
                    deselectAll();
                  }
                }}
              />
              <Users className="w-4 h-4 text-gray-500" />
              <Label className="font-medium">Entire Course</Label>
            </div>
          </div>

          <ScrollArea className="h-96 border rounded-lg p-3">
            <div className="space-y-2">
              {sections.map((section) => (
                <div key={section.id} className="space-y-1">
                  {/* Section Header */}
                  <div className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded">
                    <button
                      onClick={() => toggleSection(section.id)}
                      className="flex items-center space-x-1"
                    >
                      {expandedSections.has(section.id) ? (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      )}
                    </button>

                    <Checkbox
                      checked={isSectionSelected(section)}
                      ref={(el) => {
                        if (el) {
                          (el as HTMLInputElement).indeterminate =
                            isSectionPartiallySelected(section);
                        }
                      }}
                      onCheckedChange={() => toggleSectionSelection(section)}
                    />

                    <Users className="w-4 h-4 text-gray-500" />
                    <Label
                      className="font-medium cursor-pointer"
                      onClick={() => toggleSection(section.id)}
                    >
                      {section.name} ({section.enrollments.length} students)
                    </Label>
                  </div>

                  {/* Students in Section */}
                  {expandedSections.has(section.id) && (
                    <div className="ml-6 space-y-1">
                      {section.enrollments.map((enrollment) => (
                        <div
                          key={enrollment.id}
                          className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded"
                        >
                          <Checkbox
                            checked={selectedItems.has(enrollment.user.id)}
                            onCheckedChange={() =>
                              toggleStudentSelection(
                                enrollment.user.id,
                                section.id
                              )
                            }
                          />
                          <User className="w-4 h-4 text-gray-400" />
                          <Label className="cursor-pointer">
                            {getStudentDisplayName(enrollment)}
                            <span className="text-xs text-gray-500 ml-2">
                              ({enrollment.role})
                            </span>
                          </Label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PublishAssignmentModal;
