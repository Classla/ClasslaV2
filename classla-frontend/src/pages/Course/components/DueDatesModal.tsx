import React, { useState, useEffect, useMemo } from "react";
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
import { Calendar, Users, User, X, Pencil } from "lucide-react";
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
  // Track which students have the override input expanded
  const [expandedOverrides, setExpandedOverrides] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      fetchSectionsAndEnrollments();
      initializeDueDates();
      setExpandedOverrides(new Set());
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

      // Add virtual "No Section" group for students not assigned to any section
      const unsectionedEnrollments = transformedEnrollments.filter(
        (e) => !e.section_id
      );
      if (unsectionedEnrollments.length > 0) {
        sectionsWithEnrollments.push({
          id: "__no_section__",
          course_id: assignment.course_id,
          name: "No Section",
          description: "",
          slug: "",
          enrollments: unsectionedEnrollments,
        } as SectionWithEnrollments);
      }

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
    const config = assignment.due_date_config || {};

    // Restore course-wide and section dates from saved config
    setCourseDueDate(config.courseDueDate ? formatDateForInput(config.courseDueDate) : "");
    setSectionDueDates(
      config.sectionDueDates
        ? Object.fromEntries(
            Object.entries(config.sectionDueDates).map(([id, date]) => [id, formatDateForInput(date)])
          )
        : {}
    );

    // Initialize individual student due dates from the stored map
    const studentDates: Record<string, string> = {};
    Object.entries(dueDatesMap).forEach(([userId, date]) => {
      studentDates[userId] = formatDateForInput(date);
    });
    setStudentDueDates(studentDates);
  };

  const formatDateForInput = (date: Date | string): string => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const formatDateTimeDisplay = (date: string): string => {
    if (!date) return "";
    return new Date(date).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getStudentDisplayName = (enrollment: EnrollmentWithUser) => {
    const { first_name, last_name, email } = enrollment.user;
    if (first_name || last_name) {
      return `${first_name || ""} ${last_name || ""}`.trim();
    }
    return email;
  };

  // Compute overrides list from current state (replaces buildOverridesList)
  const overrides = useMemo(() => {
    const overridesList: DueDateOverride[] = [];

    // Course-wide due date
    if (courseDueDate) {
      overridesList.push({
        id: "course",
        name: "Entire Course",
        type: "course",
        dueDate: courseDueDate,
      });
    }

    // Section overrides
    Object.entries(sectionDueDates).forEach(([sectionId, date]) => {
      if (date) {
        const section = sections.find((s) => s.id === sectionId);
        overridesList.push({
          id: `section-${sectionId}`,
          name: section?.name || sectionId,
          type: "section",
          dueDate: date,
          sectionId,
        });
      }
    });

    // Individual student overrides (only those who differ from inherited)
    Object.entries(studentDueDates).forEach(([userId, date]) => {
      if (!date) return;

      // Find student's section
      const studentSection = sections.find((s) =>
        s.enrollments.some((e) => e.user.id === userId)
      );
      const inheritedDate =
        (studentSection && sectionDueDates[studentSection.id]) || courseDueDate;

      // Only show as override if different from inherited
      if (date !== inheritedDate) {
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
          dueDate: date,
          userId,
        });
      }
    });

    return overridesList;
  }, [courseDueDate, sectionDueDates, studentDueDates, sections]);

  const setCourseDueDateHandler = (newDate: string) => {
    const oldCourse = courseDueDate;
    setCourseDueDate(newDate);

    // Only update students who were inheriting from course (not from a section override)
    const newStudentDates = { ...studentDueDates };
    sections.forEach((section) => {
      // Skip sections with their own override - their students inherit from section
      if (sectionDueDates[section.id]) return;

      section.enrollments.forEach((enrollment) => {
        const uid = enrollment.user.id;
        const current = newStudentDates[uid] || "";
        // Only update if student was inheriting from course (date matches old course date)
        if (current === oldCourse) {
          if (newDate) {
            newStudentDates[uid] = newDate;
          } else {
            delete newStudentDates[uid];
          }
        }
      });
    });
    setStudentDueDates(newStudentDates);
  };

  const setSectionDueDateHandler = (sectionId: string, newDate: string) => {
    const oldSectionDate = sectionDueDates[sectionId] || "";
    // What students in this section were previously inheriting
    const oldInherited = oldSectionDate || courseDueDate;

    const newSectionDates = { ...sectionDueDates };
    if (newDate) {
      newSectionDates[sectionId] = newDate;
    } else {
      delete newSectionDates[sectionId];
    }
    setSectionDueDates(newSectionDates);

    // Only update students who were inheriting (date matched old inherited value)
    const section = sections.find((s) => s.id === sectionId);
    if (section) {
      const newStudentDates = { ...studentDueDates };
      section.enrollments.forEach((enrollment) => {
        const uid = enrollment.user.id;
        const current = newStudentDates[uid] || "";
        if (current === oldInherited) {
          if (newDate) {
            newStudentDates[uid] = newDate;
          } else {
            // Section cleared - fall back to course date
            if (courseDueDate) {
              newStudentDates[uid] = courseDueDate;
            } else {
              delete newStudentDates[uid];
            }
          }
        }
      });
      setStudentDueDates(newStudentDates);
    }
  };

  const setStudentDueDateHandler = (userId: string, date: string) => {
    const newStudentDates = { ...studentDueDates };
    if (date) {
      newStudentDates[userId] = date;
    } else {
      delete newStudentDates[userId];
    }
    setStudentDueDates(newStudentDates);
  };

  const removeOverride = (overrideId: string) => {
    const override = overrides.find((o) => o.id === overrideId);
    if (!override) return;

    if (override.type === "course") {
      const oldCourse = courseDueDate;
      setCourseDueDate("");

      // Only clear students who were inheriting from course
      const newStudentDates = { ...studentDueDates };
      sections.forEach((section) => {
        if (sectionDueDates[section.id]) return; // Skip sections with overrides
        section.enrollments.forEach((enrollment) => {
          if ((newStudentDates[enrollment.user.id] || "") === oldCourse) {
            delete newStudentDates[enrollment.user.id];
          }
        });
      });
      setStudentDueDates(newStudentDates);
    } else if (override.type === "section" && override.sectionId) {
      const oldSectionDate = sectionDueDates[override.sectionId] || "";

      const newSectionDates = { ...sectionDueDates };
      delete newSectionDates[override.sectionId];
      setSectionDueDates(newSectionDates);

      // Fall inheriting students back to course date
      const section = sections.find((s) => s.id === override.sectionId);
      if (section) {
        const newStudentDates = { ...studentDueDates };
        section.enrollments.forEach((enrollment) => {
          if ((newStudentDates[enrollment.user.id] || "") === oldSectionDate) {
            if (courseDueDate) {
              newStudentDates[enrollment.user.id] = courseDueDate;
            } else {
              delete newStudentDates[enrollment.user.id];
            }
          }
        });
        setStudentDueDates(newStudentDates);
      }
    } else if (override.type === "student" && override.userId) {
      // Reset student to inherited value
      const uid = override.userId;
      const studentSection = sections.find((s) =>
        s.enrollments.some((e) => e.user.id === uid)
      );
      const inheritedDate =
        (studentSection && sectionDueDates[studentSection.id]) || courseDueDate;

      const newStudentDates = { ...studentDueDates };
      if (inheritedDate) {
        newStudentDates[uid] = inheritedDate;
      } else {
        delete newStudentDates[uid];
      }
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

      // Build due_date_config to remember course-wide and section-level values
      const dueDateConfig: { courseDueDate?: string; sectionDueDates?: Record<string, string> } = {};
      if (courseDueDate) {
        dueDateConfig.courseDueDate = new Date(courseDueDate).toISOString();
      }
      const savedSectionDates: Record<string, string> = {};
      Object.entries(sectionDueDates).forEach(([sectionId, date]) => {
        if (date) {
          savedSectionDates[sectionId] = new Date(date).toISOString();
        }
      });
      if (Object.keys(savedSectionDates).length > 0) {
        dueDateConfig.sectionDueDates = savedSectionDates;
      }

      const updatedAssignment = await apiClient.updateAssignment(
        assignment.id,
        {
          due_dates_map: dueDatesMap,
          due_date_config: dueDateConfig,
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
                  disabled={loading}
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
                {sections.filter((s) => s.id !== "__no_section__").map((section) => (
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
                    section.enrollments.map((enrollment) => {
                      const userId = enrollment.user.id;
                      const studentDate = studentDueDates[userId] || "";
                      const sectionDate = sectionDueDates[section.id] || "";
                      const inheritedDate = sectionDate || courseDueDate;
                      const inheritSource = sectionDate
                        ? `Section ${section.name}`
                        : "Course";
                      const isInheriting =
                        !!inheritedDate &&
                        (!studentDate || studentDate === inheritedDate);
                      const isOverrideExpanded = expandedOverrides.has(userId);

                      return (
                        <div
                          key={enrollment.id}
                          className="flex items-center space-x-2"
                        >
                          <Label className="w-48 text-sm truncate flex-shrink-0">
                            {getStudentDisplayName(enrollment)}
                            <span className="text-xs text-muted-foreground ml-1">
                              ({section.name})
                            </span>
                          </Label>

                          {isInheriting && !isOverrideExpanded ? (
                            <div className="flex items-center space-x-2 flex-1 min-w-0">
                              <span className="text-sm text-muted-foreground italic truncate">
                                Inheriting from {inheritSource}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                                onClick={() =>
                                  setExpandedOverrides((prev) => {
                                    const next = new Set(prev);
                                    next.add(userId);
                                    return next;
                                  })
                                }
                              >
                                <Pencil className="w-3 h-3 mr-1" />
                                Override
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center space-x-2 flex-1 min-w-0">
                              <Input
                                type="datetime-local"
                                value={studentDate}
                                onChange={(e) =>
                                  setStudentDueDateHandler(
                                    userId,
                                    e.target.value
                                  )
                                }
                                className="max-w-xs"
                              />
                              {studentDate && studentDate !== inheritedDate && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="flex-shrink-0"
                                  onClick={() => {
                                    // Reset to inherited value
                                    if (inheritedDate) {
                                      setStudentDueDateHandler(
                                        userId,
                                        inheritedDate
                                      );
                                    } else {
                                      setStudentDueDateHandler(userId, "");
                                    }
                                    setExpandedOverrides((prev) => {
                                      const next = new Set(prev);
                                      next.delete(userId);
                                      return next;
                                    });
                                  }}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              )}
                              {isOverrideExpanded &&
                                (!studentDate ||
                                  studentDate === inheritedDate) && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="flex-shrink-0 text-muted-foreground"
                                    onClick={() =>
                                      setExpandedOverrides((prev) => {
                                        const next = new Set(prev);
                                        next.delete(userId);
                                        return next;
                                      })
                                    }
                                  >
                                    Cancel
                                  </Button>
                                )}
                            </div>
                          )}
                        </div>
                      );
                    })
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
                            {formatDateTimeDisplay(override.dueDate)}
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
