import React, { useState, useEffect } from "react";
import { apiClient } from "../lib/api";
import { useToast } from "../hooks/use-toast";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  AlertTriangle,
  Calendar,
  ChevronRight,
  ChevronDown,
  Clock,
  FileText,
  Users,
  User,
  X,
  Zap,
} from "lucide-react";
import { Assignment, Folder, Section, CourseEnrollment } from "../types";

interface PublishingModalProps {
  isOpen: boolean;
  onClose: () => void;
  // For single assignment mode
  assignment?: Assignment;
  onAssignmentUpdated?: (assignment: Assignment) => void;
  // For folder mode
  folder?: Folder;
  folderAssignments?: Assignment[];
  courseId?: string;
  onAssignmentsUpdated?: (assignments: Assignment[]) => void;
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

type PublishMode = "immediate" | "scheduled";

const PublishingModal: React.FC<PublishingModalProps> = ({
  isOpen,
  onClose,
  assignment,
  onAssignmentUpdated,
  folder,
  folderAssignments,
  courseId: propsCourseId,
  onAssignmentsUpdated,
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<SectionWithEnrollments[]>([]);

  // Mode toggle
  const [publishMode, setPublishMode] = useState<PublishMode>("immediate");

  // Immediate publishing state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Scheduled publishing state
  const [coursePublishTime, setCoursePublishTime] = useState<string>("");
  const [sectionPublishTimes, setSectionPublishTimes] = useState<Record<string, string>>({});
  const [studentPublishTimes, setStudentPublishTimes] = useState<Record<string, string>>({});

  // Folder mode state
  const [selectedAssignments, setSelectedAssignments] = useState<Set<string>>(new Set());

  const isFolderMode = !!folder && !!folderAssignments;
  const effectiveCourseId = propsCourseId || assignment?.course_id || "";
  const assignments = isFolderMode ? folderAssignments! : (assignment ? [assignment] : []);

  useEffect(() => {
    if (isOpen) {
      fetchSectionsAndEnrollments();
      if (isFolderMode) {
        // Select all assignments by default in folder mode
        setSelectedAssignments(new Set(folderAssignments!.map((a) => a.id)));
      }
      // Determine initial mode based on existing data
      if (assignment) {
        const publishTimes = assignment.publish_times || {};
        const now = new Date();
        // Check if there are any future (scheduled) publish times
        const hasFutureScheduled = Object.values(publishTimes).some(
          (time) => new Date(time) > now
        );
        // Check if there are any past (immediate) publish times
        const hasImmediate = Object.values(publishTimes).some(
          (time) => new Date(time) <= now
        );
        if (hasFutureScheduled && !hasImmediate) {
          setPublishMode("scheduled");
        } else {
          setPublishMode("immediate");
        }
      }
    }
  }, [isOpen]);

  const fetchSectionsAndEnrollments = async () => {
    try {
      setLoading(true);

      // Fetch sections
      const sectionsResponse = await apiClient.getCourseSections(effectiveCourseId);
      const sectionsData = sectionsResponse.data.data || [];

      // Fetch enrollments
      const enrollmentsResponse = await apiClient.getCourseEnrollments(effectiveCourseId);
      const enrollmentsData = enrollmentsResponse.data.data;

      // Transform the API response
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
      const sectionsWithEnrollments: SectionWithEnrollments[] = (
        Array.isArray(sectionsData) ? sectionsData : []
      ).map((section: Section) => ({
        ...section,
        enrollments: transformedEnrollments.filter(
          (enrollment: EnrollmentWithUser) =>
            enrollment.section_id === section.id
        ),
      }));

      // Add "No Section" group
      const noSectionEnrollments = transformedEnrollments.filter(
        (enrollment: EnrollmentWithUser) => !enrollment.section_id
      );

      if (noSectionEnrollments.length > 0) {
        sectionsWithEnrollments.push({
          id: "no-section",
          course_id: effectiveCourseId,
          name: "No Section",
          slug: "no-section",
          enrollments: noSectionEnrollments,
        });
      }

      setSections(sectionsWithEnrollments);

      // Expand all sections by default
      setExpandedSections(new Set(sectionsWithEnrollments.map((s) => s.id)));

      // Initialize states based on existing data
      if (assignment) {
        initializeFromAssignment(assignment, sectionsWithEnrollments);
      }
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

  const initializeFromAssignment = (
    assignment: Assignment,
    sectionsWithEnrollments: SectionWithEnrollments[]
  ) => {
    const now = new Date();
    const publishTimes = assignment.publish_times || {};

    // Users with past timestamps are "immediately published"
    const publishedUserIds = new Set(
      Object.entries(publishTimes)
        .filter(([_, time]) => new Date(time) <= now)
        .map(([userId]) => userId)
    );
    const newSelectedItems = new Set<string>();

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
      newSelectedItems.add(effectiveCourseId);
    }

    setSelectedItems(newSelectedItems);

    // Initialize scheduled publishing times (users with future timestamps)
    const studentTimes: Record<string, string> = {};
    Object.entries(publishTimes).forEach(([userId, time]) => {
      if (new Date(time) > now) {
        studentTimes[userId] = formatDateForInput(time);
      }
    });
    setStudentPublishTimes(studentTimes);

    // Check for course-wide scheduled time
    const allScheduledTimes = Object.values(studentTimes);
    const uniqueTimes = [...new Set(allScheduledTimes)];
    if (uniqueTimes.length === 1 && allScheduledTimes.length > 0) {
      setCoursePublishTime(uniqueTimes[0]);
    }
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

  const getStudentDisplayName = (enrollment: EnrollmentWithUser) => {
    const { first_name, last_name, email } = enrollment.user;
    if (first_name || last_name) {
      return `${first_name || ""} ${last_name || ""}`.trim();
    }
    return email;
  };

  // Immediate publishing handlers
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
      newSelected.delete(section.id);
      section.enrollments.forEach((enrollment) => {
        newSelected.delete(enrollment.user.id);
      });
      newSelected.delete(effectiveCourseId);
    } else {
      newSelected.add(section.id);
      section.enrollments.forEach((enrollment) => {
        newSelected.add(enrollment.user.id);
      });

      const allSectionIds = sections.map((s) => s.id);
      const allSectionsSelected = allSectionIds.every((id) =>
        newSelected.has(id)
      );
      if (allSectionsSelected) {
        newSelected.add(effectiveCourseId);
      }
    }

    setSelectedItems(newSelected);
  };

  const toggleStudentSelection = (studentId: string, sectionId: string) => {
    const newSelected = new Set(selectedItems);

    if (newSelected.has(studentId)) {
      newSelected.delete(studentId);
      newSelected.delete(effectiveCourseId);

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
      const section = sections.find((s) => s.id === sectionId);
      if (section) {
        const sectionStudentIds = section.enrollments.map((e) => e.user.id);
        const allStudentsSelected = sectionStudentIds.every(
          (id) => newSelected.has(id) || id === studentId
        );
        if (allStudentsSelected) {
          newSelected.add(sectionId);

          const allSectionIds = sections.map((s) => s.id);
          const allSectionsSelected = allSectionIds.every((id) =>
            newSelected.has(id)
          );
          if (allSectionsSelected) {
            newSelected.add(effectiveCourseId);
          }
        }
      }
    }

    setSelectedItems(newSelected);
  };

  const selectAll = () => {
    const newSelected = new Set<string>();
    newSelected.add(effectiveCourseId);
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

  // Scheduled publishing handlers
  const setCoursePublishTimeHandler = (time: string) => {
    setCoursePublishTime(time);
    const newStudentTimes: Record<string, string> = {};
    sections.forEach((section) => {
      section.enrollments.forEach((enrollment) => {
        newStudentTimes[enrollment.user.id] = time;
      });
    });
    setStudentPublishTimes(newStudentTimes);
    setSectionPublishTimes({});
  };

  const setSectionPublishTimeHandler = (sectionId: string, time: string) => {
    const newSectionTimes = { ...sectionPublishTimes, [sectionId]: time };
    setSectionPublishTimes(newSectionTimes);

    const section = sections.find((s) => s.id === sectionId);
    if (section) {
      const newStudentTimes = { ...studentPublishTimes };
      section.enrollments.forEach((enrollment) => {
        newStudentTimes[enrollment.user.id] = time;
      });
      setStudentPublishTimes(newStudentTimes);
    }
  };

  const setStudentPublishTimeHandler = (userId: string, time: string) => {
    const newStudentTimes = { ...studentPublishTimes, [userId]: time };
    setStudentPublishTimes(newStudentTimes);
  };

  // Folder mode handlers
  const toggleAssignment = (assignmentId: string) => {
    const newSelected = new Set(selectedAssignments);
    if (newSelected.has(assignmentId)) {
      newSelected.delete(assignmentId);
    } else {
      newSelected.add(assignmentId);
    }
    setSelectedAssignments(newSelected);
  };

  const selectAllAssignments = () => {
    setSelectedAssignments(new Set(folderAssignments!.map((a) => a.id)));
  };

  const deselectAllAssignments = () => {
    setSelectedAssignments(new Set());
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

  // Save handlers
  const handleSave = async () => {
    if (isFolderMode) {
      await handleSaveFolder();
    } else {
      await handleSaveAssignment();
    }
  };

  const handleSaveAssignment = async () => {
    if (!assignment) return;

    try {
      setLoading(true);

      const publishTimesMap: Record<string, string> = {};
      const nowISO = new Date().toISOString();

      if (publishMode === "immediate") {
        // Build publish_times with current timestamp for immediate publishing
        const userIds = new Set<string>();
        selectedItems.forEach((itemId) => {
          if (itemId === effectiveCourseId) {
            sections.forEach((section) => {
              section.enrollments.forEach((enrollment) => {
                userIds.add(enrollment.user.id);
              });
            });
          } else {
            const section = sections.find((s) => s.id === itemId);
            if (section) {
              section.enrollments.forEach((enrollment) => {
                userIds.add(enrollment.user.id);
              });
            } else {
              userIds.add(itemId);
            }
          }
        });
        // Set current time for all selected users (immediate publishing)
        userIds.forEach((userId) => {
          publishTimesMap[userId] = nowISO;
        });
      } else {
        // Build publish_times from scheduled times
        Object.entries(studentPublishTimes).forEach(([userId, time]) => {
          if (time) {
            publishTimesMap[userId] = new Date(time).toISOString();
          }
        });
      }

      const updatedAssignment = await apiClient.updateAssignment(
        assignment.id,
        { publish_times: publishTimesMap }
      );

      onAssignmentUpdated?.(updatedAssignment.data);
      toast({
        title: publishMode === "immediate" ? "Assignment published" : "Publishing scheduled",
        description: publishMode === "immediate"
          ? "Assignment publishing settings have been updated"
          : "Assignment scheduled publishing has been set",
      });
      onClose();
    } catch (error: any) {
      toast({
        title: "Error updating publishing",
        description: error.message || "Failed to update publishing settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFolder = async () => {
    if (selectedAssignments.size === 0) {
      toast({
        title: "No assignments selected",
        description: "Please select at least one assignment",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      const publishTimesMap: Record<string, string> = {};
      const nowISO = new Date().toISOString();

      if (publishMode === "immediate") {
        const userIds = new Set<string>();
        selectedItems.forEach((itemId) => {
          if (itemId === effectiveCourseId) {
            sections.forEach((section) => {
              section.enrollments.forEach((enrollment) => {
                userIds.add(enrollment.user.id);
              });
            });
          } else {
            const section = sections.find((s) => s.id === itemId);
            if (section) {
              section.enrollments.forEach((enrollment) => {
                userIds.add(enrollment.user.id);
              });
            } else {
              userIds.add(itemId);
            }
          }
        });
        // Set current time for all selected users (immediate publishing)
        userIds.forEach((userId) => {
          publishTimesMap[userId] = nowISO;
        });
      } else {
        Object.entries(studentPublishTimes).forEach(([userId, time]) => {
          if (time) {
            publishTimesMap[userId] = new Date(time).toISOString();
          }
        });
      }

      const updateData = { publish_times: publishTimesMap };

      // Update each selected assignment
      const updatePromises = Array.from(selectedAssignments).map((assignmentId) =>
        apiClient.updateAssignment(assignmentId, updateData)
      );

      const results = await Promise.all(updatePromises);
      const updatedAssignments = results.map((r) => r.data);

      onAssignmentsUpdated?.(updatedAssignments);
      toast({
        title: publishMode === "immediate" ? "Assignments published" : "Publishing scheduled",
        description: `Updated ${selectedAssignments.size} assignment(s)`,
      });
      onClose();
    } catch (error: any) {
      toast({
        title: "Error updating publishing",
        description: error.message || "Failed to update publishing settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClearPublishing = async () => {
    const assignmentsToUpdate = isFolderMode
      ? Array.from(selectedAssignments)
      : (assignment ? [assignment.id] : []);

    if (assignmentsToUpdate.length === 0) {
      toast({
        title: "No assignments selected",
        description: "Please select at least one assignment",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      const updatePromises = assignmentsToUpdate.map((assignmentId) =>
        apiClient.updateAssignment(assignmentId, {
          publish_times: {},
        })
      );

      const results = await Promise.all(updatePromises);
      const updatedAssignments = results.map((r) => r.data);

      if (isFolderMode) {
        onAssignmentsUpdated?.(updatedAssignments);
      } else {
        onAssignmentUpdated?.(updatedAssignments[0]);
      }

      toast({
        title: "Publishing cleared",
        description: `Cleared publishing for ${assignmentsToUpdate.length} assignment(s)`,
      });
      onClose();
    } catch (error: any) {
      toast({
        title: "Error clearing publishing",
        description: error.message || "Failed to clear publishing",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getAssignmentPublishStatus = (assignment: Assignment): string => {
    const now = new Date();
    const publishTimes = assignment.publish_times || {};
    const entries = Object.entries(publishTimes);

    const publishedCount = entries.filter(([_, time]) => new Date(time) <= now).length;
    const scheduledCount = entries.filter(([_, time]) => new Date(time) > now).length;

    if (publishedCount > 0 && scheduledCount > 0) {
      return `${publishedCount} published, ${scheduledCount} scheduled`;
    } else if (publishedCount > 0) {
      return `${publishedCount} published`;
    } else if (scheduledCount > 0) {
      return `${scheduledCount} scheduled`;
    }
    return "Not published";
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {isFolderMode ? `Manage Publishing: ${folder?.name}` : "Manage Publishing"}
          </DialogTitle>
        </DialogHeader>

        {/* Mode Toggle */}
        <div className="flex items-center justify-center space-x-4 p-4 border rounded-lg bg-muted">
          <button
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
              publishMode === "immediate"
                ? "bg-card border-2 border-purple-500 text-primary shadow-sm"
                : "text-muted-foreground hover:bg-accent"
            }`}
            onClick={() => setPublishMode("immediate")}
          >
            <Zap className="w-4 h-4" />
            <span className="font-medium">Publish Immediately</span>
          </button>
          <button
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
              publishMode === "scheduled"
                ? "bg-card border-2 border-purple-500 text-primary shadow-sm"
                : "text-muted-foreground hover:bg-accent"
            }`}
            onClick={() => setPublishMode("scheduled")}
          >
            <Calendar className="w-4 h-4" />
            <span className="font-medium">Schedule Publishing</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Folder mode: Assignment selection */}
          {isFolderMode && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Select Assignments</Label>
                <div className="space-x-2">
                  <Button variant="outline" size="sm" onClick={selectAllAssignments}>
                    Select All
                  </Button>
                  <Button variant="outline" size="sm" onClick={deselectAllAssignments}>
                    Deselect All
                  </Button>
                </div>
              </div>
              <ScrollArea className="h-40 border rounded-lg p-2">
                <div className="space-y-1">
                  {folderAssignments!.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between p-2 hover:bg-accent rounded"
                    >
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          checked={selectedAssignments.has(a.id)}
                          onCheckedChange={() => toggleAssignment(a.id)}
                        />
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{a.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {getAssignmentPublishStatus(a)}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              {isFolderMode && (
                <div className="flex items-center space-x-2 mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-700">
                    Changes will <strong>override</strong> existing publishing for selected assignments.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Immediate Publishing Mode */}
          {publishMode === "immediate" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Select sections and students to publish to:
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
                    checked={selectedItems.has(effectiveCourseId)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        selectAll();
                      } else {
                        deselectAll();
                      }
                    }}
                  />
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <Label className="font-medium">Entire Course</Label>
                </div>
              </div>

              <ScrollArea className="h-64 border rounded-lg p-3">
                <div className="space-y-2">
                  {sections.map((section) => (
                    <div key={section.id} className="space-y-1">
                      <div className="flex items-center space-x-2 p-2 hover:bg-accent rounded">
                        <button
                          onClick={() => toggleSection(section.id)}
                          className="flex items-center space-x-1"
                        >
                          {expandedSections.has(section.id) ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
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

                        <Users className="w-4 h-4 text-muted-foreground" />
                        <Label
                          className="font-medium cursor-pointer"
                          onClick={() => toggleSection(section.id)}
                        >
                          {section.name} ({section.enrollments.length})
                        </Label>
                      </div>

                      {expandedSections.has(section.id) && (
                        <div className="ml-6 space-y-1">
                          {section.enrollments.map((enrollment) => (
                            <div
                              key={enrollment.id}
                              className="flex items-center space-x-2 p-2 hover:bg-accent rounded"
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
                              <User className="w-4 h-4 text-muted-foreground" />
                              <Label className="cursor-pointer text-sm">
                                {getStudentDisplayName(enrollment)}
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
          )}

          {/* Scheduled Publishing Mode */}
          {publishMode === "scheduled" && (
            <Tabs defaultValue="hierarchy" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="hierarchy">Set Schedule</TabsTrigger>
                <TabsTrigger value="overview">Current Schedules</TabsTrigger>
              </TabsList>

              <TabsContent value="hierarchy" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Set publish times hierarchically. Section times override course times,
                  student times override section times.
                </p>

                {/* Course-wide time */}
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center space-x-2">
                    <Users className="w-5 h-5 text-muted-foreground" />
                    <Label className="text-base font-medium">Course-wide</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Input
                      type="datetime-local"
                      value={coursePublishTime}
                      onChange={(e) => setCoursePublishTimeHandler(e.target.value)}
                      className="max-w-xs"
                    />
                    {coursePublishTime && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCoursePublishTimeHandler("")}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Section times */}
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center space-x-2">
                    <Users className="w-5 h-5 text-muted-foreground" />
                    <Label className="text-base font-medium">Section Overrides</Label>
                  </div>
                  <div className="space-y-2">
                    {sections.map((section) => (
                      <div key={section.id} className="flex items-center space-x-2">
                        <Label className="w-32 text-sm">{section.name}:</Label>
                        <Input
                          type="datetime-local"
                          value={sectionPublishTimes[section.id] || ""}
                          onChange={(e) =>
                            setSectionPublishTimeHandler(section.id, e.target.value)
                          }
                          className="max-w-xs"
                        />
                        {sectionPublishTimes[section.id] && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSectionPublishTimeHandler(section.id, "")}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Student times */}
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center space-x-2">
                    <User className="w-5 h-5 text-muted-foreground" />
                    <Label className="text-base font-medium">Student Overrides</Label>
                  </div>
                  <ScrollArea className="h-48">
                    <div className="space-y-2">
                      {sections.map((section) =>
                        section.enrollments.map((enrollment) => (
                          <div key={enrollment.id} className="flex items-center space-x-2">
                            <Label className="w-48 text-sm truncate">
                              {getStudentDisplayName(enrollment)}
                              <span className="text-xs text-muted-foreground ml-1">
                                ({section.name})
                              </span>
                            </Label>
                            <Input
                              type="datetime-local"
                              value={studentPublishTimes[enrollment.user.id] || ""}
                              onChange={(e) =>
                                setStudentPublishTimeHandler(
                                  enrollment.user.id,
                                  e.target.value
                                )
                              }
                              className="max-w-xs"
                            />
                            {studentPublishTimes[enrollment.user.id] && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setStudentPublishTimeHandler(enrollment.user.id, "")
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

              <TabsContent value="overview" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Students with scheduled publish times:
                </p>
                <ScrollArea className="h-64 border rounded-lg p-4">
                  <div className="space-y-2">
                    {Object.keys(studentPublishTimes).filter(id => studentPublishTimes[id]).length === 0 ? (
                      <p className="text-muted-foreground text-center py-8">
                        No scheduled publishing times set
                      </p>
                    ) : (
                      Object.entries(studentPublishTimes)
                        .filter(([, time]) => time)
                        .map(([userId, time]) => {
                          let userName = userId;
                          sections.forEach((section) => {
                            const enrollment = section.enrollments.find(
                              (e) => e.user.id === userId
                            );
                            if (enrollment) {
                              userName = getStudentDisplayName(enrollment);
                            }
                          });
                          return (
                            <div
                              key={userId}
                              className="flex items-center justify-between p-2 border rounded"
                            >
                              <div className="flex items-center space-x-2">
                                <User className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm">{userName}</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Calendar className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">
                                  {new Date(time).toLocaleString()}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setStudentPublishTimeHandler(userId, "")}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          )}
        </div>

        <DialogFooter className="mt-auto flex-shrink-0 gap-2">
          <Button
            variant="outline"
            onClick={handleClearPublishing}
            disabled={loading}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            Clear All
          </Button>
          <div className="flex-1" />
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

export default PublishingModal;
