import React, { useState, useEffect } from "react";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../../components/ui/dialog";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { Calendar, Clock, Users, User, X } from "lucide-react";
import { Assignment, Section, CourseEnrollment } from "../../../types";

interface DueDatesModalProps {
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
}

interface DueDateOverride {
  id: string;
  name: string;
  type: "course" | "section" | "student";
  dueDate: string;
  sectionId?: string;
  userId?: string;
}

const DueDatesModal: React.FC<DueDatesModalProps> = ({
  isOpen,
  onClose,
  assignment,
  onAssignmentUpdated,
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<SectionWithEnrollments[]>([]);
  const [courseDueDate, setCourseDueDate] = useState<string>("");
  const [sectionDueDates, setSectionDueDates] = useState<
    Record<string, string>
  >({});
  const [studentDueDates, setStudentDueDates] = useState<
    Record<string, string>
  >({});
  const [overrides, setOverrides] = useState<DueDateOverride[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetchSectionsAndEnrollments();
      initializeDueDates();
    }
  }, [isOpen, assignment]);

  const fetchSectionsAndEnrollments = async () => {
    try {
      setLoading(true);

      // Fetch sections
      const sectionsResponse = await apiClient.getCourseSections(
        assignment.course_id
      );
      const sectionsData = sectionsResponse.data.data || [];

      // Fetch enrollments
      const enrollmentsResponse = await apiClient.getCourseEnrollments(
        assignment.course_id
      );
      const enrollmentsData = enrollmentsResponse.data.data; // The actual array is in .data.data

      // Transform the API response to match our expected format
      // Filter out instructors, TAs, and admins - they don't need due dates
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
        (Array.isArray(sectionsData) ? sectionsData : []).map((section: Section) => ({
          ...section,
          enrollments: transformedEnrollments.filter(
            (enrollment: EnrollmentWithUser) =>
              enrollment.section_id === section.id
          ),
        }));

      setSections(sectionsWithEnrollments);
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

  const initializeDueDates = () => {
    // Initialize from assignment.due_dates_map
    const dueDatesMap = assignment.due_dates_map || {};

    // Find course-wide due date (if all students have the same date)
    const allDates = Object.values(dueDatesMap);
    const uniqueDates = [...new Set(allDates)];

    if (uniqueDates.length === 1 && allDates.length > 0) {
      setCourseDueDate(formatDateForInput(uniqueDates[0]));
    }

    // Initialize student due dates
    const studentDates: Record<string, string> = {};
    Object.entries(dueDatesMap).forEach(([userId, date]) => {
      studentDates[userId] = formatDateForInput(date);
    });
    setStudentDueDates(studentDates);

    // Build overrides list for display
    buildOverridesList(dueDatesMap);
  };

  const buildOverridesList = (dueDatesMap: Record<string, Date | string>) => {
    const overridesList: DueDateOverride[] = [];

    // Add course-wide due date if exists
    const allDates = Object.values(dueDatesMap);
    const uniqueDates = [...new Set(allDates.map((d) => d.toString()))];

    if (uniqueDates.length === 1 && allDates.length > 0) {
      overridesList.push({
        id: "course",
        name: "Entire Course",
        type: "course",
        dueDate: formatDateForInput(uniqueDates[0]),
      });
    }

    // Add section overrides (if all students in a section have the same date)
    sections.forEach((section) => {
      const sectionStudentIds = section.enrollments.map((e) => e.user.id);
      const sectionDates = sectionStudentIds
        .map((id) => dueDatesMap[id])
        .filter(Boolean)
        .map((d) => d.toString());

      const uniqueSectionDates = [...new Set(sectionDates)];
      if (
        uniqueSectionDates.length === 1 &&
        sectionDates.length === sectionStudentIds.length
      ) {
        overridesList.push({
          id: `section-${section.id}`,
          name: section.name,
          type: "section",
          dueDate: formatDateForInput(uniqueSectionDates[0]),
          sectionId: section.id,
        });
      }
    });

    // Add individual student overrides
    Object.entries(dueDatesMap).forEach(([userId, date]) => {
      // Find the user
      let userName = userId;
      sections.forEach((section) => {
        const enrollment = section.enrollments.find(
          (e) => e.user.id === userId
        );
        if (enrollment) {
          userName = getStudentDisplayName(enrollment);
        }
      });

      overridesList.push({
        id: `student-${userId}`,
        name: userName,
        type: "student",
        dueDate: formatDateForInput(date),
        userId,
      });
    });

    setOverrides(overridesList);
  };

  const formatDateForInput = (date: Date | string): string => {
    const d = new Date(date);
    return d.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:MM
  };

  const getStudentDisplayName = (enrollment: EnrollmentWithUser) => {
    const { first_name, last_name, email } = enrollment.user;
    if (first_name || last_name) {
      return `${first_name || ""} ${last_name || ""}`.trim();
    }
    return email;
  };

  const setCourseDueDateHandler = (date: string) => {
    setCourseDueDate(date);

    // Apply to all students
    const newStudentDates: Record<string, string> = {};
    sections.forEach((section) => {
      section.enrollments.forEach((enrollment) => {
        newStudentDates[enrollment.user.id] = date;
      });
    });
    setStudentDueDates(newStudentDates);
    setSectionDueDates({});
  };

  const setSectionDueDateHandler = (sectionId: string, date: string) => {
    const newSectionDates = { ...sectionDueDates, [sectionId]: date };
    setSectionDueDates(newSectionDates);

    // Apply to all students in this section
    const section = sections.find((s) => s.id === sectionId);
    if (section) {
      const newStudentDates = { ...studentDueDates };
      section.enrollments.forEach((enrollment) => {
        newStudentDates[enrollment.user.id] = date;
      });
      setStudentDueDates(newStudentDates);
    }
  };

  const setStudentDueDateHandler = (userId: string, date: string) => {
    const newStudentDates = { ...studentDueDates, [userId]: date };
    setStudentDueDates(newStudentDates);
  };

  const removeOverride = (overrideId: string) => {
    const override = overrides.find((o) => o.id === overrideId);
    if (!override) return;

    if (override.type === "course") {
      setCourseDueDate("");
      setStudentDueDates({});
      setSectionDueDates({});
    } else if (override.type === "section" && override.sectionId) {
      const newSectionDates = { ...sectionDueDates };
      delete newSectionDates[override.sectionId];
      setSectionDueDates(newSectionDates);

      // Remove from students in this section
      const section = sections.find((s) => s.id === override.sectionId);
      if (section) {
        const newStudentDates = { ...studentDueDates };
        section.enrollments.forEach((enrollment) => {
          delete newStudentDates[enrollment.user.id];
        });
        setStudentDueDates(newStudentDates);
      }
    } else if (override.type === "student" && override.userId) {
      const newStudentDates = { ...studentDueDates };
      delete newStudentDates[override.userId];
      setStudentDueDates(newStudentDates);
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);

      // Build the due_dates_map from current state
      const dueDatesMap: Record<string, string> = {};

      // Apply student-specific dates
      Object.entries(studentDueDates).forEach(([userId, date]) => {
        if (date) {
          dueDatesMap[userId] = new Date(date).toISOString();
        }
      });

      const updatedAssignment = await apiClient.updateAssignment(
        assignment.id,
        {
          due_dates_map: dueDatesMap,
        }
      );

      onAssignmentUpdated(updatedAssignment.data);
      toast({
        title: "Due dates updated",
        description: "Assignment due dates have been updated successfully",
      });
      onClose();
    } catch (error: any) {
      toast({
        title: "Error updating due dates",
        description: error.message || "Failed to update due dates",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Configure Due Dates</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="hierarchy" className="w-full flex flex-col flex-1 min-h-0 overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="hierarchy">Hierarchy</TabsTrigger>
            <TabsTrigger value="overrides">Current Overrides</TabsTrigger>
          </TabsList>

          <TabsContent value="hierarchy" className="space-y-4 flex-1 overflow-y-auto min-h-0">
            <div className="text-sm text-muted-foreground mb-4">
              Set due dates hierarchically. Section dates override course dates,
              and individual student dates override section dates.
            </div>

            {/* Course-wide Due Date */}
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-muted-foreground" />
                <Label className="text-base font-medium">
                  Course-wide Due Date
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Input
                  type="datetime-local"
                  value={courseDueDate}
                  onChange={(e) => setCourseDueDateHandler(e.target.value)}
                  className="max-w-xs"
                />
                {courseDueDate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCourseDueDateHandler("")}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Section Due Dates */}
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-muted-foreground" />
                <Label className="text-base font-medium">
                  Section Overrides
                </Label>
              </div>
              <div className="space-y-2">
                {sections.map((section) => (
                  <div key={section.id} className="flex items-center space-x-2">
                    <Label className="w-32 text-sm">{section.name}:</Label>
                    <Input
                      type="datetime-local"
                      value={sectionDueDates[section.id] || ""}
                      onChange={(e) =>
                        setSectionDueDateHandler(section.id, e.target.value)
                      }
                      className="max-w-xs"
                    />
                    {sectionDueDates[section.id] && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSectionDueDateHandler(section.id, "")}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Individual Student Overrides */}
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center space-x-2">
                <User className="w-5 h-5 text-muted-foreground" />
                <Label className="text-base font-medium">
                  Individual Student Overrides
                </Label>
              </div>
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {sections.map((section) =>
                    section.enrollments.map((enrollment) => (
                      <div
                        key={enrollment.id}
                        className="flex items-center space-x-2"
                      >
                        <Label className="w-48 text-sm truncate">
                          {getStudentDisplayName(enrollment)}
                          <span className="text-xs text-muted-foreground ml-1">
                            ({section.name})
                          </span>
                        </Label>
                        <Input
                          type="datetime-local"
                          value={studentDueDates[enrollment.user.id] || ""}
                          onChange={(e) =>
                            setStudentDueDateHandler(
                              enrollment.user.id,
                              e.target.value
                            )
                          }
                          className="max-w-xs"
                        />
                        {studentDueDates[enrollment.user.id] && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setStudentDueDateHandler(enrollment.user.id, "")
                            }
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="overrides" className="space-y-4 flex-1 overflow-y-auto min-h-0">
            <div className="text-sm text-muted-foreground mb-4">
              Current due date overrides. Remove overrides to inherit from
              higher levels.
            </div>

            <ScrollArea className="h-96 border rounded-lg p-4">
              <div className="space-y-2">
                {overrides.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No due dates set
                  </p>
                ) : (
                  overrides.map((override) => (
                    <div
                      key={override.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center space-x-3">
                        {override.type === "course" && (
                          <Users className="w-4 h-4 text-blue-500" />
                        )}
                        {override.type === "section" && (
                          <Users className="w-4 h-4 text-green-500" />
                        )}
                        {override.type === "student" && (
                          <User className="w-4 h-4 text-orange-500" />
                        )}
                        <div>
                          <div className="font-medium">{override.name}</div>
                          <div className="text-sm text-muted-foreground capitalize">
                            {override.type} level
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className="flex items-center space-x-1 text-sm">
                          <Calendar className="w-4 h-4" />
                          <span>
                            {new Date(override.dueDate).toLocaleString()}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeOverride(override.id)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-auto flex-shrink-0">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DueDatesModal;
