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
import { Plus, Users, Building2 } from "lucide-react";
import { Organization, OrganizationMembership } from "../../types";

const OrganizationsPage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<OrganizationMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);

  // Form states
  const [newOrgName, setNewOrgName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    const fetchOrganizations = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const response = await apiClient.getOrganizations();
        const orgsData = response.data || [];
        setOrganizations(orgsData);
      } catch (error) {
        console.error("Failed to fetch organizations:", error);
        setOrganizations([]);
      } finally {
        setLoading(false);
      }
    };

    fetchOrganizations();
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

      // Refresh organizations list
      const refreshResponse = await apiClient.getOrganizations();
      setOrganizations(refreshResponse.data || []);

      setCreateDialogOpen(false);
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

      // Refresh organizations list
      const refreshResponse = await apiClient.getOrganizations();
      setOrganizations(refreshResponse.data || []);

      setJoinDialogOpen(false);
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

  if (loading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-6">Organizations</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 bg-accent rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-accent rounded w-1/2"></div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Organizations</h1>
          <div className="flex gap-2">
            <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Users className="mr-2 h-4 w-4" />
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
                    <Label htmlFor="joinCode">Join Code</Label>
                    <Input
                      id="joinCode"
                      placeholder="ABC123"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleJoinOrganization();
                        }
                      }}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setJoinDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleJoinOrganization}>Join</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
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
                    <Label htmlFor="orgName">Organization Name</Label>
                    <Input
                      id="orgName"
                      placeholder="My Organization"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleCreateOrganization();
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
                  <Button onClick={handleCreateOrganization}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {organizations.length === 0 ? (
          <Card className="p-12 text-center">
            <Building2 className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              No organizations yet
            </h3>
            <p className="text-muted-foreground mb-4">
              Create or join an organization to get started with course templates.
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Organization
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {organizations.map((membership) => {
              const org = membership.organizations as Organization;
              if (!org) return null;

              return (
                <Card
                  key={org.id}
                  className="cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => navigate(`/organization/${org.slug}`)}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      {org.name}
                      <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-1 rounded">
                        {membership.role}
                      </span>
                    </CardTitle>
                    <CardDescription>Join Code: {org.slug}</CardDescription>
                  </CardHeader>
                  <CardFooter className="flex justify-between items-center">
                    <div className="text-sm text-muted-foreground">
                      <Building2 className="inline h-4 w-4 mr-1" />
                      Organization
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/organization/${org.slug}`);
                      }}
                    >
                      View
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrganizationsPage;
