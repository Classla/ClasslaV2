import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useToast } from "../../../hooks/use-toast";
import { apiClient } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../components/ui/dialog";
import { Badge } from "../../../components/ui/badge";
import {
  Users,
  Plus,
  Settings,
  Trash2,
  UserCheck,
  UserX,
  FolderPlus,
} from "lucide-react";
import { Course, Section, User, CourseEnrollment, UserRole } from "../../../types";
import { getDisplayName, getInitials, compareByLastFirstName } from "../../../lib/utils";
import { hasTAPermission } from "../../../lib/taPermissions";
import { useAuth } from "../../../contexts/AuthContext";

interface StudentsPageProps {
  course?: Course;
  userRole?: UserRole;
  isStudent?: boolean;
  isInstructor?: boolean;
}

interface EnrolledStudent extends User {
  enrollment: CourseEnrollment;
  section?: Section;
}

const StudentsPage: React.FC<StudentsPageProps> = ({
  course,
  userRole,
  isStudent,
  isInstructor,
}) => {
  const { courseSlug } = useParams<{ courseSlug: string }>();
  const { toast } = useToast();
  const { user } = useAuth();

  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [currentUserEnrollment, setCurrentUserEnrollment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSection, setSelectedSection] = useState<string>("all");
  const [newSectionName, setNewSectionName] = useState("");
  const [showCreateSection, setShowCreateSection] = useState(false);

  // Check if TA has canViewStudents permission
  const canViewStudents = isInstructor && (
    userRole !== UserRole.TEACHING_ASSISTANT ||
    hasTAPermission(course ?? null, user?.id, userRole, "canViewStudents")
  );

  useEffect(() => {
    if (course?.id) {
      // Check permission before fetching
      if (!canViewStudents && userRole === UserRole.TEACHING_ASSISTANT) {
        setLoading(false);
        return;
      }
      fetchStudentsAndSections();
    }
  }, [course?.id, canViewStudents, userRole]);

  const fetchStudentsAndSections = async () => {
    if (!course?.id) return;

    try {
      setLoading(true);

      // Fetch current user's enrollment to determine section filtering
      const currentUserResponse = await apiClient.getCurrentUserEnrollment(
        course.id
      );
      setCurrentUserEnrollment(currentUserResponse.data.data);

      // Check permission before fetching
      if (!canViewStudents && userRole === UserRole.TEACHING_ASSISTANT) {
        throw new Error("You don't have permission to view students in this course");
      }

      // Fetch enrolled users - instructors see all enrollments, students see only students
      const studentsResponse = isInstructor
        ? await apiClient.getCourseEnrollments(course.id)
        : await apiClient.getCourseStudents(course.id);
      setStudents(studentsResponse.data.data);

      // Fetch sections if instructor
      if (isInstructor) {
        const sectionsResponse = await apiClient.getCourseSections(course.id);
        setSections(sectionsResponse.data.data);
      }
    } catch (error: any) {
      console.error("Failed to fetch students and sections:", error);
      toast({
        title: "Error loading data",
        description: error.message || "Failed to load students and sections",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createSection = async () => {
    if (!course?.id || !newSectionName.trim()) return;

    try {
      await apiClient.createSection({
        course_id: course.id,
        name: newSectionName.trim(),
      });

      toast({
        title: "Section created",
        description: `Section "${newSectionName}" has been created successfully`,
      });

      setNewSectionName("");
      setShowCreateSection(false);
      fetchStudentsAndSections();
    } catch (error: any) {
      toast({
        title: "Error creating section",
        description: error.message || "Failed to create section",
        variant: "destructive",
      });
    }
  };

  const updateStudentSection = async (
    enrollmentId: string,
    sectionId: string | null
  ) => {
    try {
      await apiClient.updateEnrollment(enrollmentId, { section_id: sectionId });

      toast({
        title: "Student moved",
        description: sectionId
          ? "Student moved to section"
          : "Student removed from section",
      });

      fetchStudentsAndSections();
    } catch (error: any) {
      toast({
        title: "Error updating student",
        description: error.message || "Failed to update student section",
        variant: "destructive",
      });
    }
  };

  const updateStudentRole = async (enrollmentId: string, newRole: UserRole) => {
    try {
      await apiClient.updateEnrollment(enrollmentId, { role: newRole });

      toast({
        title: "Role updated",
        description: "Student role has been updated successfully",
      });

      fetchStudentsAndSections();
    } catch (error: any) {
      toast({
        title: "Error updating role",
        description: error.message || "Failed to update student role",
        variant: "destructive",
      });
    }
  };

  const removeStudent = async (enrollmentId: string, studentName: string) => {
    if (
      !confirm(
        `Are you sure you want to remove ${studentName} from this course?`
      )
    ) {
      return;
    }

    try {
      await apiClient.deleteEnrollment(enrollmentId);

      toast({
        title: "Student removed",
        description: `${studentName} has been removed from the course`,
      });

      fetchStudentsAndSections();
    } catch (error: any) {
      toast({
        title: "Error removing student",
        description: error.message || "Failed to remove student",
        variant: "destructive",
      });
    }
  };

  const getRoleColor = (role: UserRole) => {
    switch (role) {
      case UserRole.INSTRUCTOR:
        return "bg-primary/20 text-purple-800";
      case UserRole.ADMIN:
        return "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-400";
      case UserRole.TEACHING_ASSISTANT:
        return "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-400";
      case UserRole.STUDENT:
        return "bg-green-100 text-green-800";
      case UserRole.AUDIT:
        return "bg-muted text-foreground";
      default:
        return "bg-muted text-foreground";
    }
  };

  // Apply instructor filtering first (if instructor), then sort by last name, first name
  const instructorFilteredStudents = isInstructor
    ? students
        .filter((student) => {
          if (selectedSection === "all") return true;
          if (selectedSection === "none") return !student.enrollment.section_id;
          return student.enrollment.section_id === selectedSection;
        })
        .sort(compareByLastFirstName)
    : students;

  // For students, filter and sort to show instructors/TAs first, then classmates
  const visibleStudents =
    isStudent && currentUserEnrollment
      ? instructorFilteredStudents
          .filter((student) => {
            const role = student.enrollment.role;

            // Always show instructors and admins (they have global access)
            if (role === UserRole.INSTRUCTOR || role === UserRole.ADMIN) {
              return true;
            }

            // Show TAs that are either course-wide (no section) or in the same section
            if (role === UserRole.TEACHING_ASSISTANT) {
              // Course-wide TAs (no section)
              if (!student.enrollment.section_id) {
                return true;
              }
              // Section-specific TAs in the same section
              if (
                currentUserEnrollment.section_id &&
                student.enrollment.section_id ===
                  currentUserEnrollment.section_id
              ) {
                return true;
              }
              return false;
            }

            // For students and audit users, apply section filtering
            if (role === UserRole.STUDENT || role === UserRole.AUDIT) {
              // If current user has a section, only show students in the same section
              if (currentUserEnrollment.section_id) {
                return (
                  student.enrollment.section_id ===
                  currentUserEnrollment.section_id
                );
              }
              // If current user has no section, only show students with no section
              return !student.enrollment.section_id;
            }

            return false;
          })
          .sort((a, b) => {
            // Sort by role hierarchy: Instructor/Admin -> TA -> Student/Audit
            const roleOrder = {
              [UserRole.INSTRUCTOR]: 1,
              [UserRole.ADMIN]: 1,
              [UserRole.TEACHING_ASSISTANT]: 2,
              [UserRole.STUDENT]: 3,
              [UserRole.AUDIT]: 3,
            };

            const aOrder = roleOrder[a.enrollment.role] || 4;
            const bOrder = roleOrder[b.enrollment.role] || 4;

            if (aOrder !== bOrder) {
              return aOrder - bOrder;
            }

            // Within the same role, sort by last name then first name
            return compareByLastFirstName(a, b);
          })
      : instructorFilteredStudents;

  // Show permission denied message for TAs without canViewStudents
  if (!canViewStudents && userRole === UserRole.TEACHING_ASSISTANT) {
    return (
      <div className="p-8 text-center">
        <div className="max-w-md mx-auto">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Permission Denied
          </h2>
          <p className="text-muted-foreground">
            You don't have permission to view students in this course.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        <span className="ml-3 text-muted-foreground">Loading students...</span>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6" />
            {isInstructor ? "Course Members" : "Students"}
          </h1>
          {isStudent && currentUserEnrollment?.section && (
            <div className="mt-2 mb-1">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-400">
                Section: {currentUserEnrollment.section.name}
              </span>
            </div>
          )}
          <p className="text-muted-foreground mt-1">
            {(() => {
              // Count only actual students (not instructors, TAs, admins, or audit users)
              const actualStudentCount = visibleStudents.filter(
                (student) => student.enrollment.role === UserRole.STUDENT
              ).length;

              if (isInstructor) {
                return `${actualStudentCount} student${
                  actualStudentCount !== 1 ? "s" : ""
                } enrolled`;
              } else {
                return `${actualStudentCount} student${
                  actualStudentCount !== 1 ? "s" : ""
                } enrolled`;
              }
            })()}
          </p>
        </div>

        {isInstructor && (
          <div className="flex gap-2">
            <Dialog
              open={showCreateSection}
              onOpenChange={setShowCreateSection}
            >
              <DialogTrigger asChild>
                <Button className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900">
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Create Section
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Section</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Section Name
                    </label>
                    <Input
                      value={newSectionName}
                      onChange={(e) => setNewSectionName(e.target.value)}
                      placeholder="e.g., Section A, Morning Class"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      A unique section code will be automatically generated
                    </p>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setShowCreateSection(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={createSection}
                      disabled={!newSectionName.trim()}
                      className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900"
                    >
                      Create Section
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {isInstructor && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-foreground mb-2">
            Filter by Section
          </label>
          <Select value={selectedSection} onValueChange={setSelectedSection}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Members</SelectItem>
              <SelectItem value="none">No Section</SelectItem>
              {sections?.map((section) => {
                // Count students in this section
                const studentsInSection = students.filter(
                  (s) => s.enrollment.section_id === section.id
                ).length;
                const isEmpty = studentsInSection === 0;

                return (
                  <SelectItem
                    key={section.id}
                    value={section.id}
                    className={isEmpty ? "text-muted-foreground" : ""}
                  >
                    {section.name}
                    {isEmpty && (
                      <span className="text-muted-foreground ml-1">(empty)</span>
                    )}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-4">
        {(() => {
          if (isStudent) {
            // For students, group by role and add section headers
            const instructorsAndAdmins = visibleStudents.filter(
              (s) =>
                s.enrollment.role === UserRole.INSTRUCTOR ||
                s.enrollment.role === UserRole.ADMIN
            );
            const tas = visibleStudents.filter(
              (s) => s.enrollment.role === UserRole.TEACHING_ASSISTANT
            );
            const students = visibleStudents.filter(
              (s) =>
                s.enrollment.role === UserRole.STUDENT ||
                s.enrollment.role === UserRole.AUDIT
            );

            return (
              <>
                {/* Instructors and Admins */}
                {instructorsAndAdmins.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 mt-2">
                      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                        Instructors
                      </h3>
                      <div className="flex-1 h-px bg-border"></div>
                    </div>
                    {instructorsAndAdmins.map((student) => (
                      <Card key={student.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                                <span className="text-primary font-medium">
                                  {getInitials(student)}
                                </span>
                              </div>
                              <div>
                                <h3 className="font-medium text-foreground">
                                  {getDisplayName(student)}
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                  {student.email}
                                </p>
                              </div>
                            </div>
                            <Badge
                              className={getRoleColor(student.enrollment.role)}
                            >
                              {student.enrollment.role.replace("_", " ")}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </>
                )}

                {/* Teaching Assistants */}
                {tas.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 mt-4">
                      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                        Teaching Assistants
                      </h3>
                      <div className="flex-1 h-px bg-border"></div>
                    </div>
                    {tas.map((student) => (
                      <Card key={student.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                                <span className="text-primary font-medium">
                                  {getInitials(student)}
                                </span>
                              </div>
                              <div>
                                <h3 className="font-medium text-foreground">
                                  {getDisplayName(student)}
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                  {student.email}
                                </p>
                                {student.section && (
                                  <p className="text-xs text-muted-foreground">
                                    Section: {student.section.name}
                                  </p>
                                )}
                              </div>
                            </div>
                            <Badge
                              className={getRoleColor(student.enrollment.role)}
                            >
                              {student.enrollment.role.replace("_", " ")}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </>
                )}

                {/* Students */}
                {students.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 mt-4">
                      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                        Classmates
                      </h3>
                      <div className="flex-1 h-px bg-border"></div>
                    </div>
                    {students.map((student) => (
                      <Card key={student.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                                <span className="text-primary font-medium">
                                  {getInitials(student)}
                                </span>
                              </div>
                              <div>
                                <h3 className="font-medium text-foreground">
                                  {getDisplayName(student)}
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                  {student.email}
                                </p>
                                {student.section && (
                                  <p className="text-xs text-muted-foreground">
                                    Section: {student.section.name}
                                  </p>
                                )}
                              </div>
                            </div>
                            <Badge
                              className={getRoleColor(student.enrollment.role)}
                            >
                              {student.enrollment.role.replace("_", " ")}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </>
                )}
              </>
            );
          } else {
            // For instructors, show the original layout with management controls
            return visibleStudents.map((student) => (
              <Card key={student.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                        <span className="text-primary font-medium">
                          {getInitials(student)}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-medium text-foreground">
                          {getDisplayName(student)}
                        </h3>
                        <p className="text-sm text-muted-foreground">{student.email}</p>
                        {student.section && (
                          <p className="text-xs text-muted-foreground">
                            Section: {student.section.name}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge className={getRoleColor(student.enrollment.role)}>
                        {student.enrollment.role.replace("_", " ")}
                      </Badge>

                      {isInstructor && (
                        <div className="flex items-center gap-2">
                          {/* Only show section selector for students and audit users */}
                          {(student.enrollment.role === UserRole.STUDENT ||
                            student.enrollment.role === UserRole.AUDIT) && (
                            <Select
                              value={student.enrollment.section_id || "none"}
                              onValueChange={(value) =>
                                updateStudentSection(
                                  student.enrollment.id,
                                  value === "none" ? null : value
                                )
                              }
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No Section</SelectItem>
                                {sections?.map((section) => {
                                  // Count students in this section
                                  const studentsInSection = students.filter(
                                    (s) =>
                                      s.enrollment.section_id === section.id
                                  ).length;
                                  const isEmpty = studentsInSection === 0;

                                  return (
                                    <SelectItem
                                      key={section.id}
                                      value={section.id}
                                      className={isEmpty ? "text-muted-foreground" : ""}
                                    >
                                      {section.name}
                                      {isEmpty && (
                                        <span className="text-muted-foreground ml-1">
                                          (empty)
                                        </span>
                                      )}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          )}

                          <Select
                            value={student.enrollment.role}
                            onValueChange={(value: UserRole) =>
                              updateStudentRole(student.enrollment.id, value)
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UserRole.STUDENT}>
                                Student
                              </SelectItem>
                              <SelectItem value={UserRole.TEACHING_ASSISTANT}>
                                TA
                              </SelectItem>
                              <SelectItem value={UserRole.INSTRUCTOR}>
                                Instructor
                              </SelectItem>
                              <SelectItem value={UserRole.ADMIN}>
                                Admin
                              </SelectItem>
                              <SelectItem value={UserRole.AUDIT}>
                                Audit
                              </SelectItem>
                            </SelectContent>
                          </Select>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              removeStudent(
                                student.enrollment.id,
                                getDisplayName(student)
                              )
                            }
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ));
          }
        })()}

        {visibleStudents.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {isInstructor ? "No members found" : "No students found"}
              </h3>
              <p className="text-muted-foreground">
                {selectedSection === "all"
                  ? isInstructor
                    ? "No members are enrolled in this course yet."
                    : "No students are enrolled in this course yet."
                  : selectedSection === "none"
                  ? isInstructor
                    ? "No members without a section."
                    : "No students without a section."
                  : isInstructor
                  ? "No members in this section."
                  : "No students in this section."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default StudentsPage;
