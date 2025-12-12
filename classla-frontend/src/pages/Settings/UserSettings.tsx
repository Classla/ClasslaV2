import { useState, useEffect } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../lib/api";
import { useToast } from "../../hooks/use-toast";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { User, Mail, Loader2 } from "lucide-react";

interface UserProfile {
  id: string;
  first_name?: string;
  last_name?: string;
  email: string;
  settings: Record<string, any>;
}

const UserSettings = () => {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user) return;

      try {
        setLoading(true);
        const response = await apiClient.getUser(user.id);
        const userProfile = response.data;
        const profileData: UserProfile = {
          ...userProfile,
          settings: userProfile.settings || {},
        };
        setProfile(profileData);
        // Set firstName and lastName, handling null/undefined values
        // Use nullish coalescing to properly handle null values
        const firstNameValue = userProfile.first_name ?? user?.firstName ?? "";
        const lastNameValue = userProfile.last_name ?? user?.lastName ?? "";
        setFirstName(firstNameValue);
        setLastName(lastNameValue);
      } catch (err: any) {
        setError(
          err.response?.data?.error?.message || "Failed to load profile"
        );
        // Fallback to auth context user data if API fails
        if (user) {
          setFirstName(user.firstName ?? "");
          setLastName(user.lastName ?? "");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      await apiClient.updateUser(user.id, {
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
      });
      
      // Update local profile state
      setProfile({ ...profile, first_name: firstName.trim(), last_name: lastName.trim() });
      
      // Refresh user context to update the global user state
      await refreshUser();
      
      setSuccess("Profile updated successfully!");
      toast({
        title: "Profile updated",
        description: "Your name has been updated successfully.",
      });
    } catch (err: any) {
      const errorMessage = err.response?.data?.error?.message || "Failed to update profile";
      setError(errorMessage);
      toast({
        title: "Failed to update profile",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 p-4">
        <div className="max-w-2xl mx-auto pt-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
            <span className="ml-3 text-gray-600">Loading your profile...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 p-4">
        <div className="max-w-2xl mx-auto pt-8">
          <Card className="shadow-xl border-0">
            <CardHeader>
              <CardTitle className="text-2xl font-semibold">User Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <Alert variant="destructive">
                <AlertDescription>Failed to load user profile</AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 p-4">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">User Settings</h1>
          <p className="text-gray-600 mt-1">Manage your profile information</p>
        </div>

        <Card className="shadow-xl border-0">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <User className="h-5 w-5 text-purple-600" />
              <CardTitle className="text-2xl font-semibold">Profile Information</CardTitle>
            </div>
            <CardDescription>
              Update your personal information. Your email cannot be changed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-6">
              {/* Email Field */}
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center space-x-2">
                  <Mail className="h-4 w-4 text-gray-500" />
                  <span>Email</span>
                </Label>
                <Input
                  type="email"
                  id="email"
                  value={profile.email}
                  disabled
                  className="bg-gray-50 cursor-not-allowed"
                />
                <p className="text-sm text-gray-500">Email cannot be changed</p>
              </div>

              {/* First Name Field */}
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  type="text"
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={saving}
                  placeholder="Enter your first name"
                  className="w-full"
                />
              </div>

              {/* Last Name Field */}
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  type="text"
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={saving}
                  placeholder="Enter your last name"
                  className="w-full"
                />
              </div>

              {/* Error Message */}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Success Message */}
              {success && (
                <Alert className="border-green-200 bg-green-50">
                  <AlertDescription className="text-green-800">
                    {success}
                  </AlertDescription>
                </Alert>
              )}

              {/* Submit Button */}
              <div className="flex justify-end space-x-3 pt-4">
                <Button
                  type="submit"
                  disabled={saving}
                  className="bg-purple-600 hover:bg-purple-700 text-white min-w-[120px]"
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default UserSettings;
