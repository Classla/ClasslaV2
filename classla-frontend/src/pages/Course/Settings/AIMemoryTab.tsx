import React, { useState, useEffect } from "react";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { Checkbox } from "../../../components/ui/checkbox";
import { Label } from "../../../components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../components/ui/card";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Bot, User, Trash2, Pencil, Plus, Brain, X, Check } from "lucide-react";

interface AIMemoryTabProps {
  course: any;
  setCourse?: (course: any) => void;
}

interface Memory {
  id: string;
  content: string;
  source: "ai" | "instructor";
  created_by: string;
  created_at: string;
  updated_at: string;
  users?: { first_name: string | null; last_name: string | null; email: string };
}

const AIMemoryTab: React.FC<AIMemoryTabProps> = ({ course, setCourse }) => {
  const { toast } = useToast();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [usage, setUsage] = useState({ used: 0, max: 5000 });
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const memoryEnabled = course?.settings?.ai_memory_enabled !== false;

  useEffect(() => {
    if (course?.id) {
      loadMemories();
    }
  }, [course?.id]);

  const loadMemories = async () => {
    try {
      const response = await apiClient.getCourseMemories(course.id);
      setMemories(response.data.memories || []);
      setUsage(response.data.usage || { used: 0, max: 5000 });
    } catch (error: any) {
      toast({
        title: "Error loading memories",
        description: error.message || "Failed to load AI memories",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleMemory = async () => {
    try {
      const newSettings = {
        ...course.settings,
        ai_memory_enabled: !memoryEnabled,
      };
      const response = await apiClient.updateCourse(course.id, {
        settings: newSettings,
      });
      if (setCourse) {
        setCourse(response.data);
      }
      toast({
        title: memoryEnabled ? "AI memory disabled" : "AI memory enabled",
        description: memoryEnabled
          ? "The AI will no longer save memories during chat."
          : "The AI can now save memories during chat sessions.",
      });
    } catch (error: any) {
      toast({
        title: "Error updating setting",
        description: error.message || "Failed to update memory setting",
        variant: "destructive",
      });
    }
  };

  const handleAdd = async () => {
    if (!newContent.trim()) return;

    setAdding(true);
    try {
      await apiClient.createCourseMemory(course.id, newContent.trim());
      setNewContent("");
      await loadMemories();
      toast({ title: "Memory added" });
    } catch (error: any) {
      toast({
        title: "Error adding memory",
        description: error.response?.data?.error?.message || error.message || "Failed to add memory",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  const handleStartEdit = (memory: Memory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editContent.trim()) return;

    setSavingEdit(true);
    try {
      await apiClient.updateCourseMemory(course.id, editingId, editContent.trim());
      setEditingId(null);
      setEditContent("");
      await loadMemories();
      toast({ title: "Memory updated" });
    } catch (error: any) {
      toast({
        title: "Error updating memory",
        description: error.response?.data?.error?.message || error.message || "Failed to update memory",
        variant: "destructive",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (memoryId: string) => {
    setDeletingId(memoryId);
    try {
      await apiClient.deleteCourseMemory(course.id, memoryId);
      await loadMemories();
      toast({ title: "Memory deleted" });
    } catch (error: any) {
      toast({
        title: "Error deleting memory",
        description: error.message || "Failed to delete memory",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const usagePercent = usage.max > 0 ? Math.min((usage.used / usage.max) * 100, 100) : 0;

  const getCreatorName = (memory: Memory) => {
    const user = memory.users;
    if (!user) return "Unknown";
    if (user.first_name || user.last_name) {
      return [user.first_name, user.last_name].filter(Boolean).join(" ");
    }
    return user.email || "Unknown";
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Memory
          </CardTitle>
          <CardDescription>
            Memories persist across chat sessions and are shared across all assignments in this course.
            The AI can save memories when instructors share preferences, policies, or coding standards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Toggle */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="ai-memory-enabled"
              checked={memoryEnabled}
              onCheckedChange={handleToggleMemory}
            />
            <Label htmlFor="ai-memory-enabled" className="cursor-pointer">
              Allow AI to save memories during chat
            </Label>
          </div>

          {/* Usage bar */}
          <div>
            <div className="flex justify-between text-sm text-muted-foreground mb-1">
              <span>Memory usage</span>
              <span>{usage.used.toLocaleString()} / {usage.max.toLocaleString()} characters</span>
            </div>
            <div className="w-full bg-accent rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
                  usagePercent > 90 ? "bg-red-500" : usagePercent > 70 ? "bg-yellow-500" : "bg-blue-500"
                }`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>

          {/* Add form */}
          <div className="space-y-2">
            <Label>Add a memory</Label>
            <div className="flex gap-2">
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="e.g., Always use Python type hints. Prefer unittest over pytest."
                rows={2}
                maxLength={500}
                className="flex-1"
              />
              <Button
                onClick={handleAdd}
                disabled={adding || !newContent.trim()}
                className="self-end flex items-center gap-1"
                size="sm"
              >
                <Plus className="h-4 w-4" />
                {adding ? "Adding..." : "Add"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{newContent.length}/500 characters</p>
          </div>

          {/* Memory list */}
          {loading ? (
            <div className="text-center text-muted-foreground py-4">Loading memories...</div>
          ) : memories.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 border rounded-lg bg-muted">
              <Brain className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="font-medium">No memories yet</p>
              <p className="text-sm mt-1">
                Add memories manually above, or chat with the AI — it will save important context automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map((memory) => (
                <div
                  key={memory.id}
                  className="flex items-start gap-3 p-3 border rounded-lg bg-card hover:bg-accent"
                >
                  {/* Source icon */}
                  <div
                    className={`mt-0.5 p-1 rounded ${
                      memory.source === "ai"
                        ? "bg-purple-100 text-purple-600"
                        : "bg-blue-100 dark:bg-blue-900/40 text-blue-600"
                    }`}
                    title={memory.source === "ai" ? "Saved by AI" : "Added by instructor"}
                  >
                    {memory.source === "ai" ? (
                      <Bot className="h-3.5 w-3.5" />
                    ) : (
                      <User className="h-3.5 w-3.5" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {editingId === memory.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={2}
                          maxLength={500}
                          className="text-sm"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleSaveEdit}
                            disabled={savingEdit || !editContent.trim()}
                            className="flex items-center gap-1"
                          >
                            <Check className="h-3 w-3" />
                            {savingEdit ? "Saving..." : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleCancelEdit}
                            className="flex items-center gap-1"
                          >
                            <X className="h-3 w-3" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-foreground">{memory.content}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {getCreatorName(memory)} &middot;{" "}
                          {new Date(memory.created_at).toLocaleDateString()}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  {editingId !== memory.id && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleStartEdit(memory)}
                        className="h-7 w-7 p-0"
                        title="Edit memory"
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(memory.id)}
                        disabled={deletingId === memory.id}
                        className="h-7 w-7 p-0"
                        title="Delete memory"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AIMemoryTab;
