import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MdEmail, MdPerson } from "react-icons/md";

const UserSettings = () => {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Initialize form fields when user data is available
  useEffect(() => {
    if (user) {
      console.log("User data:", user); // Debug log
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      await apiClient.updateUser(user.id, {
        first_name: firstName,
        last_name: lastName,
      });
      setSuccess("Profile updated successfully!");
    } catch (err: any) {
      setError(
        err.response?.data?.error?.message || "Failed to update profile"
      );
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold mb-2">User Settings</h1>
          <p className="text-muted-foreground mb-8">
            Manage your account information and preferences
          </p>
          <Alert variant="destructive">
            <AlertDescription>
              Please sign in to view your settings
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">User Settings</h1>
          <p className="text-muted-foreground">
            Manage your account information and preferences
          </p>
        </div>

        <div className="space-y-8">
          <div>
            <h2 className="text-xl font-semibold mb-2">Profile Information</h2>
            <p className="text-muted-foreground mb-6">
              Update your personal information
            </p>

            <form onSubmit={handleSave} className="space-y-6">
              {/* Email Field */}
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <MdEmail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="email"
                    id="email"
                    value={user.email || ""}
                    disabled
                    className="pl-10 bg-muted"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Email cannot be changed
                </p>
              </div>

              {/* First Name Field */}
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <div className="relative">
                  <MdPerson className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={saving}
                    placeholder="Enter your first name"
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Last Name Field */}
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <div className="relative">
                  <MdPerson className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={saving}
                    placeholder="Enter your last name"
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Account Type */}
              <div className="space-y-2">
                <Label>Account Type</Label>
                <div className="flex flex-wrap gap-2">
                  {user.isAdmin && (
                    <Badge variant="destructive" className="text-sm">
                      Admin
                    </Badge>
                  )}
                  {!user.isAdmin && (
                    <Badge variant="outline" className="text-sm">
                      Student
                    </Badge>
                  )}
                </div>
              </div>

              {/* Error and Success Messages */}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {success && (
                <Alert className="border-green-200 bg-green-50">
                  <AlertDescription className="text-green-800">
                    {success}
                  </AlertDescription>
                </Alert>
              )}

              {/* Submit Button */}
              <div className="pt-4">
                <Button
                  type="submit"
                  disabled={saving}
                  className="w-full sm:w-auto px-8 h-11 text-base font-medium"
                >
                  {saving ? (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Saving Changes...
                    </div>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserSettings;
