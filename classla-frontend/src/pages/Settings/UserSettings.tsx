import { useState, useEffect } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../lib/api";

interface UserProfile {
  id: string;
  first_name?: string;
  last_name?: string;
  email: string;
  roles: string[];
  is_admin: boolean;
  settings: Record<string, any>;
}

const UserSettings = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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
        setProfile(userProfile);
        setFirstName(userProfile.first_name || "");
        setLastName(userProfile.last_name || "");
      } catch (err: any) {
        setError(
          err.response?.data?.error?.message || "Failed to load profile"
        );
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
        first_name: firstName,
        last_name: lastName,
      });
      setProfile({ ...profile, first_name: firstName, last_name: lastName });
      setSuccess("Profile updated successfully!");
    } catch (err: any) {
      setError(
        err.response?.data?.error?.message || "Failed to update profile"
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="user-settings">
        <h2>User Settings</h2>
        <p>Loading your profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="user-settings">
        <h2>User Settings</h2>
        <div className="error-message">Failed to load user profile</div>
      </div>
    );
  }

  return (
    <div className="user-settings">
      <h2>User Settings</h2>

      <section className="profile-section">
        <h3>Profile Information</h3>
        <form onSubmit={handleSave} className="settings-form">
          <div className="form-group">
            <label htmlFor="email">Email:</label>
            <input
              type="email"
              id="email"
              value={profile.email}
              disabled
              className="readonly-input"
            />
            <small className="form-help">Email cannot be changed</small>
          </div>

          <div className="form-group">
            <label htmlFor="firstName">First Name:</label>
            <input
              type="text"
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={saving}
              placeholder="Enter your first name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="lastName">Last Name:</label>
            <input
              type="text"
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={saving}
              placeholder="Enter your last name"
            />
          </div>

          <div className="form-group">
            <label>Account Type:</label>
            <div className="account-info">
              {profile.is_admin && (
                <span className="role-badge admin">Admin</span>
              )}
              {profile.roles.map((role) => (
                <span key={role} className="role-badge">
                  {role.replace("_", " ").toUpperCase()}
                </span>
              ))}
              {!profile.is_admin && profile.roles.length === 0 && (
                <span className="role-badge">Student</span>
              )}
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          <button type="submit" disabled={saving} className="save-button">
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </form>
      </section>
    </div>
  );
};

export default UserSettings;
