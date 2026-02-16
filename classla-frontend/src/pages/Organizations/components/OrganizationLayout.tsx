import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../../components/ui/button";
import { FileText, Users, Settings, Building2, Copy } from "lucide-react";
import { Organization, OrganizationRole } from "../../../types";

interface OrganizationLayoutProps {
  children: React.ReactNode;
}

const OrganizationLayout: React.FC<OrganizationLayoutProps> = ({ children }) => {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [userRole, setUserRole] = useState<OrganizationRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Get current page from URL
  const currentPage = location.pathname.split("/").pop() || "templates";

  useEffect(() => {
    const fetchOrganizationData = async () => {
      if (!orgSlug || !user?.id) {
        setLoading(false);
        return;
      }

      try {
        // Fetch organization data
        const orgResponse = await apiClient.getOrganizationBySlug(orgSlug);
        const orgData = orgResponse.data;
        setOrganization(orgData);

        // Fetch user's organizations to get role
        const userOrgsResponse = await apiClient.getOrganizations();
        const userOrgs = userOrgsResponse.data || [];
        const membership = userOrgs.find(
          (m: any) => m.organizations?.id === orgData.id
        );
        if (membership) {
          setUserRole(membership.role);
        }
      } catch (error: any) {
        console.error("Failed to fetch organization data:", error);
        toast({
          title: "Error loading organization",
          description: error.message || "Failed to load organization data",
          variant: "destructive",
        });
        navigate("/organizations");
      } finally {
        setLoading(false);
      }
    };

    fetchOrganizationData();
  }, [orgSlug, user?.id, navigate, toast]);

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

  const isAdmin = userRole === OrganizationRole.ADMIN;

  const navigationTabs = [
    { id: "templates", label: "Templates", icon: FileText, path: "templates" },
    { id: "members", label: "Members", icon: Users, path: "members" },
    ...(isAdmin
      ? [{ id: "settings", label: "Settings", icon: Settings, path: "settings" }]
      : []),
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        <span className="ml-3 text-muted-foreground">Loading organization...</span>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Organization not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Building2 className="h-8 w-8 text-purple-600" />
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  {organization.name}
                </h1>
                <div className="flex items-center space-x-2 mt-1">
                  <span className="text-sm text-muted-foreground">
                    Join Code: {organization.slug}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyJoinCode}
                    className="h-6 px-2"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  {copied && (
                    <span className="text-xs text-green-600">Copied!</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded">
                {userRole === OrganizationRole.ADMIN ? "Admin" : "Member"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {navigationTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentPage === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => navigate(`/organization/${orgSlug}/${tab.path}`)}
                  className={`
                    flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm
                    ${
                      isActive
                        ? "border-purple-600 text-purple-600"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                    }
                  `}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </div>
    </div>
  );
};

export default OrganizationLayout;
