import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Copy } from "lucide-react";
import { Organization } from "../../../types";

const SettingsTab: React.FC = () => {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { toast } = useToast();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchOrganization = async () => {
      if (!orgSlug) return;

      try {
        const response = await apiClient.getOrganizationBySlug(orgSlug);
        setOrganization(response.data);
        setOrgName(response.data.name);
      } catch (error) {
        console.error("Failed to fetch organization:", error);
        toast({
          title: "Error",
          description: "Failed to load organization",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchOrganization();
  }, [orgSlug, toast]);

  const handleSave = async () => {
    if (!organization || !orgName.trim()) return;

    setSaving(true);
    try {
      const response = await apiClient.updateOrganization(organization.id, {
        name: orgName.trim(),
      });

      setOrganization(response.data);
      toast({
        title: "Settings saved",
        description: "Organization settings have been updated",
      });
    } catch (error: any) {
      console.error("Failed to update organization:", error);
      toast({
        title: "Failed to save",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyJoinCode = async () => {
    if (!organization?.slug) return;

    try {
      await navigator.clipboard.writeText(organization.slug);
      setCopied(true);
      toast({
        title: "Join code copied!",
        description: `${organization.slug} has been copied to your clipboard`,
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Could not copy join code to clipboard",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading settings...</div>;
  }

  if (!organization) {
    return <div className="text-center py-8">Organization not found</div>;
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">Organization Settings</h2>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Update organization information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orgName">Organization Name</Label>
            <Input
              id="orgName"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Join Code</CardTitle>
          <CardDescription>
            Share this code with others to let them join your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2">
            <Input value={organization.slug} readOnly className="font-mono" />
            <Button variant="outline" onClick={handleCopyJoinCode}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {copied && (
            <p className="text-sm text-green-600 mt-2">Copied to clipboard!</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsTab;
