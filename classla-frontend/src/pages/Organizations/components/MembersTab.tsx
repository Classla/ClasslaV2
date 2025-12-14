import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Plus, Users, Crown } from "lucide-react";
import { OrganizationMembership, OrganizationRole } from "../../../types";

const MembersTab: React.FC = () => {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<OrganizationMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<OrganizationRole | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<OrganizationRole>(
    OrganizationRole.MEMBER
  );

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

        // Get members
        const membersResponse = await apiClient.getOrganizationMembers(
          orgResponse.data.id
        );
        setMembers(membersResponse.data || []);
      } catch (error) {
        console.error("Failed to fetch members:", error);
        toast({
          title: "Error",
          description: "Failed to load members",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [orgSlug, toast]);

  const handleAddMember = async () => {
    if (!newMemberEmail.trim() || !organizationId) return;

    // For now, we'll need the user ID. In a real implementation, you'd search by email
    // This is a simplified version - you'd want to add a user search endpoint
    toast({
      title: "Not implemented",
      description: "Adding members by email requires user search functionality",
      variant: "destructive",
    });
    setAddMemberDialogOpen(false);
  };

  const handleUpdateMemberRole = async (
    userId: string,
    newRole: OrganizationRole
  ) => {
    if (!organizationId) return;

    try {
      await apiClient.updateOrganizationMember(organizationId, userId, {
        role: newRole,
      });

      toast({
        title: "Role updated",
        description: "Member role has been updated",
      });

      // Refresh members
      const membersResponse = await apiClient.getOrganizationMembers(
        organizationId
      );
      setMembers(membersResponse.data || []);
    } catch (error: any) {
      console.error("Failed to update member role:", error);
      toast({
        title: "Failed to update role",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!organizationId) return;
    if (!confirm("Are you sure you want to remove this member?")) return;

    try {
      await apiClient.removeOrganizationMember(organizationId, userId);

      toast({
        title: "Member removed",
        description: "Member has been removed from the organization",
      });

      // Refresh members
      const membersResponse = await apiClient.getOrganizationMembers(
        organizationId
      );
      setMembers(membersResponse.data || []);
    } catch (error: any) {
      console.error("Failed to remove member:", error);
      toast({
        title: "Failed to remove member",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading members...</div>;
  }

  const isAdmin = userRole === OrganizationRole.ADMIN;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Members</h2>
        {isAdmin && (
          <Dialog
            open={addMemberDialogOpen}
            onOpenChange={setAddMemberDialogOpen}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Member</DialogTitle>
                <DialogDescription>
                  Add a new member to this organization.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="memberEmail">User Email</Label>
                  <Input
                    id="memberEmail"
                    type="email"
                    placeholder="user@example.com"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="memberRole">Role</Label>
                  <Select
                    value={newMemberRole}
                    onValueChange={(value) =>
                      setNewMemberRole(value as OrganizationRole)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={OrganizationRole.MEMBER}>
                        Member
                      </SelectItem>
                      <SelectItem value={OrganizationRole.ADMIN}>
                        Admin
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAddMemberDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleAddMember}>Add</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="bg-white rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              {isAdmin && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 5 : 4} className="text-center py-8">
                  No members found
                </TableCell>
              </TableRow>
            ) : (
              members.map((member) => {
                const memberUser = member.users;
                if (!memberUser) return null;

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
                          {member.user_id !== user?.id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveMember(member.user_id)}
                            >
                              Remove
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
    </div>
  );
};

export default MembersTab;
