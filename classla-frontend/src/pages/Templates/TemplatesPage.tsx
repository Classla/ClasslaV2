import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../lib/api";
import { useToast } from "../../hooks/use-toast";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Plus, Users, FileText, Building2, Copy, Sparkles, Settings, Crown, Trash2 } from "lucide-react";
import { OrganizationMembership, CourseTemplate, Organization, OrganizationRole } from "../../types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../components/ui/accordion";

interface OrganizationWithTemplates {
  organization: Organization;
  membership: OrganizationMembership;
  templates: CourseTemplate[];
}

const TemplatesPage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [organizationsWithTemplates, setOrganizationsWithTemplates] = useState<
    OrganizationWithTemplates[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);
  const [joinOrgDialogOpen, setJoinOrgDialogOpen] = useState(false);
  const [createTemplateDialogOpen, setCreateTemplateDialogOpen] =
    useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  // Form states
  const [newOrgName, setNewOrgName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [newTemplateName, setNewTemplateName] = useState("");
  const [manageOrgDialogOpen, setManageOrgDialogOpen] = useState(false);
  const [selectedOrgForManagement, setSelectedOrgForManagement] = useState<OrganizationWithTemplates | null>(null);
  const [orgMembers, setOrgMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const orgsResponse = await apiClient.getOrganizations();
        const memberships = orgsResponse.data || [];

        // Fetch templates for each organization
        const orgsWithTemplates = await Promise.all(
          memberships.map(async (membership: any) => {
            const org = membership.organizations as Organization;
            if (!org) return null;

            try {
              const templatesResponse = await apiClient.getTemplates(org.id);
              return {
                organization: org,
                membership: membership,
                templates: templatesResponse.data || [],
              };
            } catch (error) {
              console.error(`Failed to fetch templates for org ${org.id}:`, error);
              return {
                organization: org,
                membership: membership,
                templates: [],
              };
            }
          })
        );

        setOrganizationsWithTemplates(
          orgsWithTemplates.filter((org) => org !== null) as OrganizationWithTemplates[]
        );
      } catch (error) {
        console.error("Failed to fetch organizations:", error);
        setOrganizationsWithTemplates([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.id]);

  const handleCreateOrganization = async () => {
    if (!newOrgName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter an organization name",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await apiClient.createOrganization({
        name: newOrgName.trim(),
      });

      toast({
        title: "Organization created successfully!",
        description: `${newOrgName} has been created with join code: ${response.data.slug}`,
      });

      // Refresh data
      const orgsResponse = await apiClient.getOrganizations();
      const memberships = orgsResponse.data || [];

      const orgsWithTemplates = await Promise.all(
        memberships.map(async (membership: any) => {
          const org = membership.organizations as Organization;
          if (!org) return null;

          try {
            const templatesResponse = await apiClient.getTemplates(org.id);
            return {
              organization: org,
              membership: membership,
              templates: templatesResponse.data || [],
            };
          } catch (error) {
            return {
              organization: org,
              membership: membership,
              templates: [],
            };
          }
        })
      );

      setOrganizationsWithTemplates(
        orgsWithTemplates.filter((org) => org !== null) as OrganizationWithTemplates[]
      );

      setCreateOrgDialogOpen(false);
      setNewOrgName("");
    } catch (error: any) {
      console.error("Failed to create organization:", error);
      toast({
        title: "Failed to create organization",
        description:
          error.message || "An error occurred while creating the organization",
        variant: "destructive",
      });
    }
  };

  const handleJoinOrganization = async () => {
    if (!joinCode.trim()) {
      toast({
        title: "Join code required",
        description: "Please enter an organization join code",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await apiClient.joinOrganization({
        slug: joinCode.toUpperCase(),
      });

      toast({
        title: "Successfully joined organization!",
        description: `You have joined ${response.data.organization.name}`,
      });

      // Refresh data
      const orgsResponse = await apiClient.getOrganizations();
      const memberships = orgsResponse.data || [];

      const orgsWithTemplates = await Promise.all(
        memberships.map(async (membership: any) => {
          const org = membership.organizations as Organization;
          if (!org) return null;

          try {
            const templatesResponse = await apiClient.getTemplates(org.id);
            return {
              organization: org,
              membership: membership,
              templates: templatesResponse.data || [],
            };
          } catch (error) {
            return {
              organization: org,
              membership: membership,
              templates: [],
            };
          }
        })
      );

      setOrganizationsWithTemplates(
        orgsWithTemplates.filter((org) => org !== null) as OrganizationWithTemplates[]
      );

      setJoinOrgDialogOpen(false);
      setJoinCode("");
    } catch (error: any) {
      console.error("Failed to join organization:", error);
      toast({
        title: "Failed to join organization",
        description:
          error.message || "Organization not found or you may already be a member",
        variant: "destructive",
      });
    }
  };

  const handleUseTemplate = async (templateId: string) => {
    try {
      const response = await apiClient.cloneTemplate(templateId);
      toast({
        title: "Course created!",
        description: `Course has been created from template. Join code: ${response.data.slug}`,
      });
      navigate(`/course/${response.data.slug}/summary`);
    } catch (error: any) {
      console.error("Failed to use template:", error);
      toast({
        title: "Failed to create course",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const loadOrgMembers = async (organizationId: string) => {
    setLoadingMembers(true);
    try {
      const response = await apiClient.getOrganizationMembers(organizationId);
      setOrgMembers(response.data || []);
    } catch (error: any) {
      console.error("Failed to load organization members:", error);
      toast({
        title: "Error loading members",
        description: error.message || "Failed to load organization members",
        variant: "destructive",
      });
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleUpdateMemberRole = async (userId: string, newRole: OrganizationRole) => {
    if (!selectedOrgForManagement) return;

    try {
      await apiClient.updateOrganizationMember(selectedOrgForManagement.organization.id, userId, {
        role: newRole,
      });

      toast({
        title: "Role updated",
        description: "Member role has been updated",
      });

      // Refresh members
      await loadOrgMembers(selectedOrgForManagement.organization.id);
    } catch (error: any) {
      console.error("Failed to update member role:", error);
      toast({
        title: "Failed to update role",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm("Are you sure you want to delete this template? This action cannot be undone.")) {
      return;
    }

    try {
      await apiClient.deleteTemplate(templateId);
      toast({
        title: "Template deleted",
        description: "Template has been deleted successfully",
      });

      // Refresh data
      const orgsResponse = await apiClient.getOrganizations();
      const memberships = orgsResponse.data || [];

      const orgsWithTemplates = await Promise.all(
        memberships.map(async (membership: any) => {
          const org = membership.organizations as Organization;
          if (!org) return null;

          try {
            const templatesResponse = await apiClient.getTemplates(org.id);
            return {
              organization: org,
              membership: membership,
              templates: templatesResponse.data || [],
            };
          } catch (error) {
            return {
              organization: org,
              membership: membership,
              templates: [],
            };
          }
        })
      );

      setOrganizationsWithTemplates(
        orgsWithTemplates.filter((org) => org !== null) as OrganizationWithTemplates[]
      );
    } catch (error: any) {
      console.error("Failed to delete template:", error);
      toast({
        title: "Failed to delete template",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim() || !selectedOrgId) return;

    try {
      await apiClient.createTemplate(selectedOrgId, {
        name: newTemplateName.trim(),
        settings: {},
      });

      toast({
        title: "Template created!",
        description: `${newTemplateName} has been created`,
      });

      // Refresh data
      const orgsResponse = await apiClient.getOrganizations();
      const memberships = orgsResponse.data || [];

      const orgsWithTemplates = await Promise.all(
        memberships.map(async (membership: any) => {
          const org = membership.organizations as Organization;
          if (!org) return null;

          try {
            const templatesResponse = await apiClient.getTemplates(org.id);
            return {
              organization: org,
              membership: membership,
              templates: templatesResponse.data || [],
            };
          } catch (error) {
            return {
              organization: org,
              membership: membership,
              templates: [],
            };
          }
        })
      );

      setOrganizationsWithTemplates(
        orgsWithTemplates.filter((org) => org !== null) as OrganizationWithTemplates[]
      );

      setCreateTemplateDialogOpen(false);
      setNewTemplateName("");
      setSelectedOrgId(null);
    } catch (error: any) {
      console.error("Failed to create template:", error);
      toast({
        title: "Failed to create template",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-3 text-muted-foreground">Loading templates...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Templates</h1>
          <p className="text-muted-foreground mt-1">
            Create and manage course templates organized by organization
          </p>
        </div>

        <div className="flex space-x-3">
          <Dialog open={joinOrgDialogOpen} onOpenChange={setJoinOrgDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="border-primary text-primary hover:bg-primary/10"
              >
                <Users className="w-4 h-4 mr-2" />
                Join Organization
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Join Organization</DialogTitle>
                <DialogDescription>
                  Enter the organization join code to join an existing
                  organization.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="join-code">Organization Join Code</Label>
                  <Input
                    id="join-code"
                    placeholder="Enter join code (e.g., ABC123)"
                    value={joinCode}
                    onChange={(e) => {
                      const value = e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, "");
                      setJoinCode(value);
                    }}
                    maxLength={6}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setJoinOrgDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleJoinOrganization}
                  disabled={joinCode.length !== 6}
                  className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900"
                >
                  Join Organization
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={createOrgDialogOpen} onOpenChange={setCreateOrgDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-purple-600 hover:bg-purple-700">
                <Plus className="w-4 h-4 mr-2" />
                Create Organization
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Organization</DialogTitle>
                <DialogDescription>
                  Create a new organization to house course templates.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Organization Name</Label>
                  <Input
                    id="org-name"
                    placeholder="Enter organization name"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    maxLength={150}
                  />
                  <p className="text-sm text-muted-foreground text-right">
                    {newOrgName.length}/150
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateOrgDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateOrganization}
                  disabled={!newOrgName.trim()}
                  className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900"
                >
                  Create Organization
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Templates by Organization */}
      {organizationsWithTemplates.length === 0 ? (
        <div className="text-center py-12">
          <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">
            No organizations found
          </h3>
          <p className="text-muted-foreground mb-6">
            Create or join an organization to start creating course templates!
          </p>
          <div className="flex justify-center space-x-3">
            <Button
              variant="outline"
              onClick={() => setJoinOrgDialogOpen(true)}
              className="border-primary text-primary hover:bg-primary/10"
            >
              Join Organization
            </Button>
            <Button
              onClick={() => setCreateOrgDialogOpen(true)}
              className="bg-purple-600 hover:bg-purple-700"
            >
              Create Organization
            </Button>
          </div>
        </div>
      ) : (
        <Accordion type="multiple" defaultValue={organizationsWithTemplates.map(org => org.organization.id)}>
          {organizationsWithTemplates.map((orgData) => (
            <AccordionItem key={orgData.organization.id} value={orgData.organization.id}>
              <AccordionTrigger>
                <div className="flex items-center justify-between w-full pr-4">
                  <div className="flex items-center space-x-3">
                    <Building2 className="h-5 w-5 text-primary" />
                    <div className="text-left">
                      <h3 className="text-lg font-semibold text-foreground">
                        {orgData.organization.name}
                      </h3>
                      <div className="flex items-center space-x-2">
                        <p className="text-sm text-muted-foreground">
                          {orgData.templates.length}{" "}
                          {orgData.templates.length === 1 ? "template" : "templates"}
                        </p>
                        <span className="text-muted-foreground">•</span>
                        <p className="text-sm text-muted-foreground">
                          Join code: <span className="font-mono font-semibold text-primary">{orgData.organization.slug}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedOrgForManagement(orgData);
                        setManageOrgDialogOpen(true);
                        loadOrgMembers(orgData.organization.id);
                      }}
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      Manage Organization
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedOrgId(orgData.organization.id);
                        setCreateTemplateDialogOpen(true);
                      }}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Create Template
                    </Button>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                {orgData.templates.length === 0 ? (
                  <div className="text-center py-8">
                    <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">
                      No Templates
                    </h3>
                    <p className="text-muted-foreground mb-4">
                      Create your first template for this organization.
                    </p>
                    <Button
                      onClick={() => {
                        setSelectedOrgId(orgData.organization.id);
                        setCreateTemplateDialogOpen(true);
                      }}
                      className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Create Template
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {orgData.templates.map((template) => (
                      <Card
                        key={template.id}
                        className="hover:shadow-lg transition-shadow duration-200 cursor-pointer group"
                        onClick={() => navigate(`/course/${template.id}/summary`)}
                      >
                        <CardHeader className="pb-3">
                          <div className="w-full h-48 rounded-md mb-3 overflow-hidden bg-muted flex items-center justify-center">
                            <FileText className="h-16 w-16 text-muted-foreground" />
                          </div>
                          <CardTitle className="text-lg group-hover:text-primary transition-colors">
                            {template.name}
                          </CardTitle>
                          <CardDescription>
                            Created {new Date(template.created_at).toLocaleDateString()}
                          </CardDescription>
                        </CardHeader>
                        <CardFooter className="pt-0">
                          <div className="flex items-center justify-between w-full">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUseTemplate(template.id);
                              }}
                            >
                              <Sparkles className="w-4 h-4 mr-2" />
                              Use Template
                            </Button>
                          </div>
                        </CardFooter>
                      </Card>
                    ))}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {/* Create Template Dialog */}
      <Dialog
        open={createTemplateDialogOpen}
        onOpenChange={setCreateTemplateDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Template</DialogTitle>
            <DialogDescription>
              Create a new course template for this organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name</Label>
              <Input
                id="template-name"
                placeholder="Enter template name"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                maxLength={150}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTemplateName.trim()) {
                    handleCreateTemplate();
                  }
                }}
              />
              <p className="text-sm text-muted-foreground text-right">
                {newTemplateName.length}/150
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateTemplateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateTemplate}
              disabled={!newTemplateName.trim()}
              className="bg-purple-600 hover:bg-purple-700"
            >
              Create Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Organization Dialog */}
      <Dialog open={manageOrgDialogOpen} onOpenChange={setManageOrgDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Manage Organization: {selectedOrgForManagement?.organization.name}
            </DialogTitle>
            <DialogDescription>
              View and manage organization members. Join code: <span className="font-mono font-semibold">{selectedOrgForManagement?.organization.slug}</span>
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">Members</h3>
              {loadingMembers ? (
                <div className="text-center py-8">Loading members...</div>
              ) : (
                <div className="bg-card rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Joined</TableHead>
                        {selectedOrgForManagement?.membership.role === OrganizationRole.ADMIN && (
                          <TableHead>Actions</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orgMembers.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={
                              selectedOrgForManagement?.membership.role === OrganizationRole.ADMIN ? 5 : 4
                            }
                            className="text-center py-8"
                          >
                            No members found
                          </TableCell>
                        </TableRow>
                      ) : (
                        orgMembers.map((member: any) => {
                          const memberUser = member.users;
                          if (!memberUser) return null;

                          const isAdmin = selectedOrgForManagement?.membership.role === OrganizationRole.ADMIN;

                          return (
                            <TableRow key={member.id}>
                              <TableCell>
                                {memberUser.first_name || memberUser.last_name
                                  ? `${memberUser.first_name || ""} ${memberUser.last_name || ""}`.trim()
                                  : "Unknown"}
                              </TableCell>
                              <TableCell>{memberUser.email}</TableCell>
                              <TableCell>
                                <div className="flex items-center space-x-2">
                                  {member.role === OrganizationRole.ADMIN && (
                                    <Crown className="h-4 w-4 text-yellow-500" />
                                  )}
                                  <span className="capitalize">{member.role}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {new Date(member.joined_at).toLocaleDateString()}
                              </TableCell>
                              {isAdmin && (
                                <TableCell>
                                  <div className="flex items-center space-x-2">
                                    {member.role !== OrganizationRole.ADMIN && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          handleUpdateMemberRole(
                                            member.user_id,
                                            OrganizationRole.ADMIN
                                          )
                                        }
                                      >
                                        Promote to Admin
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Templates with delete options */}
            {selectedOrgForManagement && selectedOrgForManagement.templates.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Templates</h3>
                <div className="space-y-2">
                  {selectedOrgForManagement.templates.map((template) => {
                    const isAdmin = selectedOrgForManagement.membership.role === OrganizationRole.ADMIN;
                    const isCreator = template.created_by_id === user?.id;
                    const canDelete = isAdmin || (isCreator && !isAdmin);

                    return (
                      <div
                        key={template.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div>
                          <div className="font-medium text-foreground">{template.name}</div>
                          <div className="text-sm text-muted-foreground">
                            Created {new Date(template.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteTemplate(template.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setManageOrgDialogOpen(false);
                setSelectedOrgForManagement(null);
                setOrgMembers([]);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TemplatesPage;
