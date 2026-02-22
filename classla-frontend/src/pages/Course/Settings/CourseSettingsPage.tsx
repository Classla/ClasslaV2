import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { Checkbox } from "../../../components/ui/checkbox";
import { Label } from "../../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../components/ui/dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Trash2, Save, Users, RotateCcw, FileText, Download } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { TAPermissions, UserRole, CourseEnrollment, User } from "../../../types";
import { getDisplayName } from "../../../lib/utils";
import AIMemoryTab from "./AIMemoryTab";

interface CourseSettingsPageProps {
  course?: any;
  setCourse?: (course: any) => void;
  isInstructor?: boolean;
}

interface EnrolledTA extends User {
  enrollment: CourseEnrollment;
}

const CourseSettingsPage: React.FC<CourseSettingsPageProps> = ({
  course,
  setCourse,
  isInstructor,
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: course?.name || "",
    description: course?.description || "",
  });
  const [tas, setTas] = useState<EnrolledTA[]>([]);
  const [loadingTAs, setLoadingTAs] = useState(false);
  const [defaultPermissions, setDefaultPermissions] = useState<TAPermissions>({
    canCreate: false,
    canEdit: false,
    canDelete: false,
    canViewStudents: false,
    canViewGrades: false,
  });
  const [taPermissions, setTAPermissions] = useState<Record<string, TAPermissions>>({});
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [loadingOrganizations, setLoadingOrganizations] = useState(false);
  const [exportFormData, setExportFormData] = useState({
    organizationId: "",
    name: course?.name || "",
  });

  // Load TAs and permissions on mount
  useEffect(() => {
    if (course?.id && isInstructor) {
      loadTAsAndPermissions();
    }
  }, [course?.id, isInstructor]);

  // Load organizations when export dialog opens
  useEffect(() => {
    if (exportDialogOpen && organizations.length === 0) {
      loadOrganizations();
    }
  }, [exportDialogOpen]);

  const loadOrganizations = async () => {
    setLoadingOrganizations(true);
    try {
      const response = await apiClient.getOrganizations();
      const memberships = response.data || [];
      const orgs = memberships
        .map((m: any) => m.organizations)
        .filter((org: any) => org !== null);
      setOrganizations(orgs);
    } catch (error: any) {
      console.error("Error loading organizations:", error);
      toast({
        title: "Error loading organizations",
        description: error.message || "Failed to load organizations",
        variant: "destructive",
      });
    } finally {
      setLoadingOrganizations(false);
    }
  };

  const loadTAsAndPermissions = async () => {
    if (!course?.id) return;

    setLoadingTAs(true);
    try {
      // Load default permissions
      const defaultPerms = course.settings?.ta_permissions_default || {
        canCreate: false,
        canEdit: false,
        canDelete: false,
        canViewStudents: false,
        canViewGrades: false,
      };
      setDefaultPermissions(defaultPerms as TAPermissions);

      // Load individual TA permissions
      const individualPerms = course.settings?.ta_permissions || {};
      setTAPermissions(individualPerms as Record<string, TAPermissions>);

      // Fetch enrollments to get TAs
      const enrollmentsResponse = await apiClient.getCourseEnrollments(course.id);
      const enrollments = enrollmentsResponse.data.data || [];

      // Filter to only TAs
      const taEnrollments = enrollments.filter(
        (e: any) => e.enrollment?.role === UserRole.TEACHING_ASSISTANT
      );

      setTas(taEnrollments);
    } catch (error: any) {
      console.error("Error loading TAs and permissions:", error);
      toast({
        title: "Error loading TA permissions",
        description: error.message || "Failed to load TA permissions",
        variant: "destructive",
      });
    } finally {
      setLoadingTAs(false);
    }
  };

  // Only instructors can access settings
  if (!isInstructor) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>You don't have permission to access course settings.</p>
      </div>
    );
  }

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleDefaultPermissionChange = (key: keyof TAPermissions, checked: boolean) => {
    setDefaultPermissions((prev) => ({
      ...prev,
      [key]: checked,
    }));
  };

  const handleTAPermissionChange = (userId: string, key: keyof TAPermissions, checked: boolean) => {
    setTAPermissions((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] || defaultPermissions),
        [key]: checked,
      },
    }));
  };

  const resetTAToDefault = (userId: string) => {
    setTAPermissions((prev) => {
      const newPerms = { ...prev };
      delete newPerms[userId];
      return newPerms;
    });
  };

  const getEffectivePermissions = (userId: string): TAPermissions => {
    return taPermissions[userId] || defaultPermissions;
  };

  const hasPermissionOverride = (userId: string): boolean => {
    if (!taPermissions[userId]) return false;
    const override = taPermissions[userId];
    const defaultPerms = defaultPermissions;
    return (
      override.canCreate !== defaultPerms.canCreate ||
      override.canEdit !== defaultPerms.canEdit ||
      override.canDelete !== defaultPerms.canDelete ||
      override.canViewStudents !== defaultPerms.canViewStudents ||
      override.canViewGrades !== defaultPerms.canViewGrades
    );
  };

  const handleSave = async () => {
    if (!course?.id) return;

    setIsLoading(true);
    try {
      // Prepare settings with TA permissions
      // Always send ta_permissions (even if empty) so backend can clear removed overrides
      const settings = {
        ...course.settings,
        ta_permissions_default: defaultPermissions,
        ta_permissions: taPermissions, // Always include, even if empty object
      };

      console.log("[CourseSettingsPage] Saving TA permissions:", {
        defaultPermissions,
        taPermissions,
        settingsToSave: settings,
      });

      const response = await apiClient.updateCourse(course.id, {
        name: formData.name,
        description: formData.description,
        settings,
      });

      // Update the course in parent component
      if (setCourse) {
        setCourse(response.data);
      }

      toast({
        title: "Settings saved",
        description: "Course settings and TA permissions have been updated successfully.",
      });
    } catch (error: any) {
      console.error("Error updating course:", error);
      toast({
        title: "Error saving settings",
        description: error.message || "Failed to update course settings",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!course?.id) return;

    setIsDeleting(true);
    try {
      await apiClient.deleteCourse(course.id);

      // Navigate back to dashboard after successful deletion
      navigate("/dashboard");
    } catch (error) {
      console.error("Error deleting course:", error);
      // Handle error (you might want to show an error toast here)
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const handleExportToTemplate = async () => {
    if (!course?.id || !exportFormData.organizationId || !exportFormData.name.trim()) {
      toast({
        title: "Missing information",
        description: "Please select an organization and enter a template name",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    try {
      await apiClient.exportCourseToTemplate(course.id, {
        organizationId: exportFormData.organizationId,
        name: exportFormData.name.trim(),
      });

      toast({
        title: "Template created!",
        description: `Course has been exported as template "${exportFormData.name}"`,
      });

      setExportDialogOpen(false);
      setExportFormData({
        organizationId: "",
        name: course?.name || "",
      });
    } catch (error: any) {
      console.error("Error exporting course to template:", error);
      toast({
        title: "Error exporting course",
        description: error.message || "Failed to export course to template",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Course Settings
        </h1>
        <p className="text-muted-foreground">
          Manage your course information and settings.
        </p>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="mb-6">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="ta-permissions">TA Permissions</TabsTrigger>
          <TabsTrigger value="ai-memory">AI Memory</TabsTrigger>
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general">
          <div className="space-y-6">
            {/* Course Name */}
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-foreground mb-2"
              >
                Course Name
              </label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="Enter course name"
                className="w-full"
              />
            </div>

            {/* Course Description */}
            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-foreground mb-2"
              >
                Description
              </label>
              <Textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Enter course description"
                className="w-full"
                rows={4}
              />
            </div>

            {/* Export to Template Section */}
            {!course?.is_template && (
              <div className="pt-6 border-t">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Export to Template
                    </CardTitle>
                    <CardDescription>
                      Create a template from this course to share with your organization
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="flex items-center gap-2">
                          <Download className="h-4 w-4" />
                          Export Course to Template
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Export Course to Template</DialogTitle>
                          <DialogDescription>
                            Create a template from this course. All assignments and folders will be copied, but student enrollments and grades will not be included.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div>
                            <Label htmlFor="export-org">Organization</Label>
                            <Select
                              value={exportFormData.organizationId}
                              onValueChange={(value) =>
                                setExportFormData((prev) => ({ ...prev, organizationId: value }))
                              }
                            >
                              <SelectTrigger id="export-org">
                                <SelectValue placeholder="Select an organization" />
                              </SelectTrigger>
                              <SelectContent>
                                {loadingOrganizations ? (
                                  <SelectItem value="loading" disabled>Loading...</SelectItem>
                                ) : organizations.length === 0 ? (
                                  <SelectItem value="none" disabled>No organizations available</SelectItem>
                                ) : (
                                  organizations.map((org: any) => (
                                    <SelectItem key={org.id} value={org.id}>
                                      {org.name}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor="export-name">Template Name</Label>
                            <Input
                              id="export-name"
                              value={exportFormData.name}
                              onChange={(e) =>
                                setExportFormData((prev) => ({ ...prev, name: e.target.value }))
                              }
                              placeholder="Enter template name"
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setExportDialogOpen(false)}
                            disabled={isExporting}
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={handleExportToTemplate}
                            disabled={isExporting || !exportFormData.organizationId || !exportFormData.name.trim()}
                            className="flex items-center gap-2"
                          >
                            <Download className="h-4 w-4" />
                            {isExporting ? "Exporting..." : "Export to Template"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-between pt-6 border-t">
              <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4" />
                    Delete Course
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Course</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to delete "{course?.name}"? This action
                      cannot be undone. All assignments, submissions, and
                      enrollments will be permanently removed.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setDeleteDialogOpen(false)}
                      disabled={isDeleting}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={isDeleting}
                    >
                      {isDeleting ? "Deleting..." : "Delete Course"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button
                onClick={handleSave}
                disabled={isLoading}
                className="flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                {isLoading ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* TA Permissions Tab */}
        <TabsContent value="ta-permissions">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                TA Permissions
              </CardTitle>
              <CardDescription>
                Configure default permissions for all TAs and individual overrides
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Default Permissions */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">
                  Default TA Permissions
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Applies to all TAs except those with custom permissions below. Reset a TA's custom permissions to use these defaults.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="default-canCreate"
                      checked={defaultPermissions.canCreate}
                      onCheckedChange={(checked) =>
                        handleDefaultPermissionChange("canCreate", checked as boolean)
                      }
                    />
                    <Label htmlFor="default-canCreate" className="cursor-pointer">
                      Create Assignments
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="default-canEdit"
                      checked={defaultPermissions.canEdit}
                      onCheckedChange={(checked) =>
                        handleDefaultPermissionChange("canEdit", checked as boolean)
                      }
                    />
                    <Label htmlFor="default-canEdit" className="cursor-pointer">
                      Edit Assignments
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="default-canDelete"
                      checked={defaultPermissions.canDelete}
                      onCheckedChange={(checked) =>
                        handleDefaultPermissionChange("canDelete", checked as boolean)
                      }
                    />
                    <Label htmlFor="default-canDelete" className="cursor-pointer">
                      Delete Assignments
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="default-canViewStudents"
                      checked={defaultPermissions.canViewStudents}
                      onCheckedChange={(checked) =>
                        handleDefaultPermissionChange("canViewStudents", checked as boolean)
                      }
                    />
                    <Label htmlFor="default-canViewStudents" className="cursor-pointer">
                      View Students
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="default-canViewGrades"
                      checked={defaultPermissions.canViewGrades}
                      onCheckedChange={(checked) =>
                        handleDefaultPermissionChange("canViewGrades", checked as boolean)
                      }
                    />
                    <Label htmlFor="default-canViewGrades" className="cursor-pointer">
                      View Grades
                    </Label>
                  </div>
                </div>
              </div>

              {/* Individual TA Permissions */}
              {loadingTAs ? (
                <div className="text-center text-muted-foreground py-4">Loading TAs...</div>
              ) : tas.length === 0 ? (
                <div className="text-center text-muted-foreground py-4">
                  No TAs enrolled in this course
                </div>
              ) : (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">
                    Individual TA Permissions
                  </h3>
                  <div className="space-y-4">
                    {tas.map((ta) => {
                      const effectivePerms = getEffectivePermissions(ta.id);
                      const hasOverride = hasPermissionOverride(ta.id);
                      return (
                        <Card key={ta.id} className={hasOverride ? "border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-950/20" : ""}>
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <div className="font-medium text-foreground">
                                  {getDisplayName(ta)}
                                </div>
                                <div className="text-sm text-muted-foreground">{ta.email}</div>
                              </div>
                              {hasOverride && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => resetTAToDefault(ta.id)}
                                  className="flex items-center gap-2"
                                >
                                  <RotateCcw className="h-4 w-4" />
                                  Reset to Default
                                </Button>
                              )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="flex items-center space-x-2">
                                <Checkbox
                                  id={`ta-${ta.id}-canCreate`}
                                  checked={effectivePerms.canCreate}
                                  onCheckedChange={(checked) =>
                                    handleTAPermissionChange(ta.id, "canCreate", checked as boolean)
                                  }
                                />
                                <Label
                                  htmlFor={`ta-${ta.id}-canCreate`}
                                  className={`cursor-pointer ${
                                    effectivePerms.canCreate !== defaultPermissions.canCreate
                                      ? "font-semibold text-blue-700"
                                      : ""
                                  }`}
                                >
                                  Create Assignments
                                </Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Checkbox
                                  id={`ta-${ta.id}-canEdit`}
                                  checked={effectivePerms.canEdit}
                                  onCheckedChange={(checked) =>
                                    handleTAPermissionChange(ta.id, "canEdit", checked as boolean)
                                  }
                                />
                                <Label
                                  htmlFor={`ta-${ta.id}-canEdit`}
                                  className={`cursor-pointer ${
                                    effectivePerms.canEdit !== defaultPermissions.canEdit
                                      ? "font-semibold text-blue-700"
                                      : ""
                                  }`}
                                >
                                  Edit Assignments
                                </Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Checkbox
                                  id={`ta-${ta.id}-canDelete`}
                                  checked={effectivePerms.canDelete}
                                  onCheckedChange={(checked) =>
                                    handleTAPermissionChange(ta.id, "canDelete", checked as boolean)
                                  }
                                />
                                <Label
                                  htmlFor={`ta-${ta.id}-canDelete`}
                                  className={`cursor-pointer ${
                                    effectivePerms.canDelete !== defaultPermissions.canDelete
                                      ? "font-semibold text-blue-700"
                                      : ""
                                  }`}
                                >
                                  Delete Assignments
                                </Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Checkbox
                                  id={`ta-${ta.id}-canViewStudents`}
                                  checked={effectivePerms.canViewStudents}
                                  onCheckedChange={(checked) =>
                                    handleTAPermissionChange(
                                      ta.id,
                                      "canViewStudents",
                                      checked as boolean
                                    )
                                  }
                                />
                                <Label
                                  htmlFor={`ta-${ta.id}-canViewStudents`}
                                  className={`cursor-pointer ${
                                    effectivePerms.canViewStudents !== defaultPermissions.canViewStudents
                                      ? "font-semibold text-blue-700"
                                      : ""
                                  }`}
                                >
                                  View Students
                                </Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Checkbox
                                  id={`ta-${ta.id}-canViewGrades`}
                                  checked={effectivePerms.canViewGrades}
                                  onCheckedChange={(checked) =>
                                    handleTAPermissionChange(ta.id, "canViewGrades", checked as boolean)
                                  }
                                />
                                <Label
                                  htmlFor={`ta-${ta.id}-canViewGrades`}
                                  className={`cursor-pointer ${
                                    effectivePerms.canViewGrades !== defaultPermissions.canViewGrades
                                      ? "font-semibold text-blue-700"
                                      : ""
                                  }`}
                                >
                                  View Grades
                                </Label>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Save button for TA permissions */}
              <div className="flex justify-end pt-4 border-t">
                <Button
                  onClick={handleSave}
                  disabled={isLoading}
                  className="flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {isLoading ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Memory Tab */}
        <TabsContent value="ai-memory">
          <AIMemoryTab course={course} setCourse={setCourse} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CourseSettingsPage;
