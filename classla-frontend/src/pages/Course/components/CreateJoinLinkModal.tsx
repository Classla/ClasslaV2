import React, { useState, useEffect } from "react";
import {
  X,
  Calendar,
  Clock,
  Link as LinkIcon,
  Copy,
  Check,
  Trash2,
  Plus,
  ExternalLink,
} from "lucide-react";
import { Card } from "../../../components/ui/card";
import { joinLinksService } from "../../../services/joinLinks";
import { sectionsService } from "../../../services/sections";
import { JoinLink, Section } from "../../../types";

interface CreateJoinLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseSlug: string;
  onLinkCreated?: (link: JoinLink) => void;
}

const CreateJoinLinkModal: React.FC<CreateJoinLinkModalProps> = ({
  isOpen,
  onClose,
  courseSlug,
  onLinkCreated,
}) => {
  const [expiryDate, setExpiryDate] = useState("");
  const [expiryTime, setExpiryTime] = useState("23:59");
  const [sectionSlug, setSectionSlug] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [existingLinks, setExistingLinks] = useState<JoinLink[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  // Set default expiry to 7 days from now
  useEffect(() => {
    if (isOpen && !expiryDate) {
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + 7);
      setExpiryDate(defaultDate.toISOString().split("T")[0]);
    }
  }, [isOpen, expiryDate]);

  // Load existing links and sections when modal opens
  useEffect(() => {
    if (isOpen) {
      loadExistingLinks();
      loadSections();
    }
  }, [isOpen, courseSlug]);

  const loadExistingLinks = async () => {
    try {
      const links = await joinLinksService.getJoinLinks(courseSlug);
      setExistingLinks(links);
    } catch (err) {
      console.error("Failed to load existing links:", err);
    }
  };

  const loadSections = async () => {
    try {
      const courseSections = await sectionsService.getCourseSections(
        courseSlug
      );
      setSections(Array.isArray(courseSections) ? courseSections : []);
    } catch (err) {
      console.error("Failed to load sections:", err);
      setSections([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const expiryDateTime = new Date(`${expiryDate}T${expiryTime}`);

      if (expiryDateTime <= new Date()) {
        setError("Expiry date must be in the future");
        setIsLoading(false);
        return;
      }

      const link = await joinLinksService.createJoinLink({
        course_slug: courseSlug,
        section_slug: sectionSlug || undefined,
        expiry_date: expiryDateTime.toISOString(),
      });

      // Refresh the existing links list
      await loadExistingLinks();
      setShowCreateForm(false);
      setExpiryDate("");
      setExpiryTime("23:59");
      setSectionSlug("");
      onLinkCreated?.(link);
    } catch (err: any) {
      setError(err.message || "Failed to create join link");
    } finally {
      setIsLoading(false);
    }
  };

  const generateJoinUrl = (linkId: string) => {
    return `${window.location.origin}/join/${linkId}`;
  };

  const handleCopyLink = async (linkId: string) => {
    const url = generateJoinUrl(linkId);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLinkId(linkId);
      setTimeout(() => setCopiedLinkId(null), 2000);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    try {
      await joinLinksService.deleteJoinLink(linkId);
      await loadExistingLinks();
    } catch (err) {
      console.error("Failed to delete link:", err);
    }
  };

  const handleClose = () => {
    setShowCreateForm(false);
    setExpiryDate("");
    setExpiryTime("23:59");
    setSectionSlug("");
    setError("");
    setCopiedLinkId(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card className="bg-card rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-foreground">Join Links</h2>
            <button
              onClick={handleClose}
              className="text-muted-foreground hover:text-muted-foreground transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Existing Links Section */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                Active Links
              </h3>
              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Link</span>
              </button>
            </div>

            {existingLinks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <LinkIcon className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p>No active join links</p>
                <p className="text-sm">Create your first link to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {existingLinks.map((link) => (
                  <div
                    key={link.id}
                    className="border border-border rounded-lg p-4"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <LinkIcon className="w-4 h-4 text-primary" />
                          <span className="font-medium text-foreground">
                            {link.section_slug
                              ? `Section: ${link.section_slug}`
                              : "Course-wide"}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Expires: {new Date(link.expiry_date).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleCopyLink(link.id)}
                          className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition-colors"
                          title="Copy link"
                        >
                          {copiedLinkId === link.id ? (
                            <Check className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() =>
                            window.open(generateJoinUrl(link.id), "_blank")
                          }
                          className="p-2 text-muted-foreground hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                          title="Open link"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteLink(link.id)}
                          className="p-2 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          title="Delete link"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="bg-muted rounded p-2">
                      <input
                        type="text"
                        value={generateJoinUrl(link.id)}
                        readOnly
                        className="w-full text-sm text-muted-foreground bg-transparent border-none outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create New Link Form */}
          {showCreateForm && (
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Create New Link
              </h3>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-red-800 text-sm">{error}</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Section (Optional)
                  </label>
                  <select
                    value={sectionSlug}
                    onChange={(e) => setSectionSlug(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                  >
                    <option value="">Course-wide (all sections)</option>
                    {Array.isArray(sections) && sections.map((section) => (
                      <option key={section.id} value={section.slug}>
                        {section.name} ({section.slug})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    If a section is selected, students will join that specific
                    section
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      <Calendar className="w-4 h-4 inline mr-1" />
                      Expiry Date
                    </label>
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      required
                      min={new Date().toISOString().split("T")[0]}
                      className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      <Clock className="w-4 h-4 inline mr-1" />
                      Expiry Time
                    </label>
                    <input
                      type="time"
                      value={expiryTime}
                      onChange={(e) => setExpiryTime(e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                    />
                  </div>
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="flex-1 py-2 border border-border text-foreground rounded-lg hover:bg-accent transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="flex-1 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? "Creating..." : "Create Link"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default CreateJoinLinkModal;
