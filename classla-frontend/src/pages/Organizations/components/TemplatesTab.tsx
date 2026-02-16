import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Plus, FileText, Copy, Trash2, Edit } from "lucide-react";
import { CourseTemplate, OrganizationRole } from "../../../types";

const TemplatesTab: React.FC = () => {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<CourseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [userRole, setUserRole] = useState<OrganizationRole | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!orgSlug) return;

      try {
        // Get organization to get ID
        const orgResponse = await apiClient.getOrganizationBySlug(orgSlug);
        setOrganizationId(orgResponse.data.id);

        // Get user's role
        const userOrgsResponse = await apiClient.getOrganizations();
        const userOrgs = userOrgsResponse.data || [];
        const membership = userOrgs.find(
          (m: any) => m.organizations?.id === orgResponse.data.id
        );
        if (membership) {
          setUserRole(membership.role);
        }

        // Get templates
        const templatesResponse = await apiClient.getTemplates(orgResponse.data.id);
        setTemplates(templatesResponse.data || []);
      } catch (error) {
        console.error("Failed to fetch templates:", error);
        toast({
          title: "Error",
          description: "Failed to load templates",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [orgSlug, toast]);

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim() || !organizationId) return;

    try {
      const response = await apiClient.createTemplate(organizationId, {
        name: newTemplateName.trim(),
        settings: {},
      });

      toast({
        title: "Template created!",
        description: `${newTemplateName} has been created`,
      });

      // Refresh templates
      const templatesResponse = await apiClient.getTemplates(organizationId);
      setTemplates(templatesResponse.data || []);

      setCreateDialogOpen(false);
      setNewTemplateName("");
    } catch (error: any) {
      console.error("Failed to create template:", error);
      toast({
        title: "Failed to create template",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleCloneTemplate = async (templateId: string) => {
    try {
      const response = await apiClient.cloneTemplate(templateId);
      toast({
        title: "Course created!",
        description: `Course has been created from template. Join code: ${response.data.slug}`,
      });
      navigate(`/course/${response.data.slug}`);
    } catch (error: any) {
      console.error("Failed to clone template:", error);
      toast({
        title: "Failed to clone template",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm("Are you sure you want to delete this template?")) return;

    try {
      await apiClient.deleteTemplate(templateId);
      toast({
        title: "Template deleted",
        description: "Template has been deleted",
      });

      // Refresh templates
      if (organizationId) {
        const templatesResponse = await apiClient.getTemplates(organizationId);
        setTemplates(templatesResponse.data || []);
      }
    } catch (error: any) {
      console.error("Failed to delete template:", error);
      toast({
        title: "Failed to delete template",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading templates...</div>;
  }

  const canCreate = userRole === OrganizationRole.ADMIN || userRole === OrganizationRole.MEMBER;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Course Templates</h2>
        {canCreate && (
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Template
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Template</DialogTitle>
                <DialogDescription>
                  Create a new course template for this organization.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="templateName">Template Name</Label>
                  <Input
                    id="templateName"
                    placeholder="Introduction to Programming"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleCreateTemplate();
                      }
                    }}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleCreateTemplate}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {templates.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No templates yet</h3>
          <p className="text-muted-foreground mb-4">
            Create a template to get started.
          </p>
          {canCreate && (
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Template
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((template) => {
            const isCreator = template.created_by_id === user?.id;
            const canDelete = userRole === OrganizationRole.ADMIN || (userRole === OrganizationRole.MEMBER && isCreator);

            return (
              <Card key={template.id}>
                <CardHeader>
                  <CardTitle>{template.name}</CardTitle>
                  <CardDescription>
                    Created {new Date(template.created_at).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardFooter className="flex justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCloneTemplate(template.id)}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Clone
                  </Button>
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteTemplate(template.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TemplatesTab;
