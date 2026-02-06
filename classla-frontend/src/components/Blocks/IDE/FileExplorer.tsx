import React, { useState, useCallback, useMemo } from "react";
import { File, Folder, FolderOpen, Plus, Trash2, Edit2, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
}

interface FileExplorerProps {
  files: FileNode[];
  onFileSelect: (path: string) => void;
  selectedPath?: string;
  onCreateFile?: (path: string) => void;
  onCreateFolder?: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
}

// Sort file tree: folders first, then files, both alphabetically (case-insensitive)
export function sortFileTree(nodes: FileNode[]): FileNode[] {
  return [...nodes]
    .sort((a, b) => {
      // Folders before files
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      // Alphabetical within same type (case-insensitive)
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    })
    .map((node) =>
      node.type === "folder" && node.children
        ? { ...node, children: sortFileTree(node.children) }
        : node
    );
}

const FileExplorer: React.FC<FileExplorerProps> = ({
  files,
  onFileSelect,
  selectedPath,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
}) => {
  const sortedFiles = useMemo(() => sortFileTree(files), [files]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showCreateFileDialog, setShowCreateFileDialog] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleFileClick = useCallback(
    (path: string, type: "file" | "folder") => {
      if (type === "folder") {
        toggleFolder(path);
      } else {
        onFileSelect(path);
      }
    },
    [onFileSelect, toggleFolder]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, type: "file" | "folder") => {
      e.preventDefault();
      // Context menu could be implemented here
    },
    []
  );

  const renderNode = useCallback(
    (node: FileNode, depth: number = 0) => {
      const isExpanded = expandedFolders.has(node.path);
      const isSelected = selectedPath === node.path;
      const isEditing = editingPath === node.path;

      return (
        <div key={node.path}>
          <div
            className={`group flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-gray-100 rounded ${
              isSelected ? "bg-blue-100" : ""
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => handleFileClick(node.path, node.type)}
            onContextMenu={(e) => handleContextMenu(e, node.path, node.type)}
          >
            {node.type === "folder" ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolder(node.path);
                  }}
                  className="flex items-center justify-center w-4 h-4 mr-1 hover:bg-gray-200 rounded"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3 text-gray-600" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-gray-600" />
                  )}
                </button>
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4 text-blue-600" />
                ) : (
                  <Folder className="w-4 h-4 text-blue-600" />
                )}
              </>
            ) : (
              <>
                <div className="w-4 h-4 mr-1" /> {/* Spacer for alignment */}
                <File className="w-4 h-4 text-gray-600" />
              </>
            )}
            {isEditing ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => {
                  if (editValue && editValue !== node.name && onRenameFile) {
                    const parentPath = node.path.substring(0, node.path.length - node.name.length);
                    const newPath = parentPath + editValue;
                    onRenameFile(node.path, newPath);
                  }
                  setEditingPath(null);
                  setEditValue("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (editValue && editValue !== node.name && onRenameFile) {
                      const parentPath = node.path.substring(0, node.path.length - node.name.length);
                      const newPath = parentPath + editValue;
                      onRenameFile(node.path, newPath);
                    }
                    setEditingPath(null);
                    setEditValue("");
                  } else if (e.key === "Escape") {
                    setEditingPath(null);
                    setEditValue("");
                  }
                }}
                autoFocus
                className="flex-1 text-sm border border-blue-500 rounded px-1"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="text-sm flex-1 truncate">{node.name}</span>
            )}
            {!isEditing && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                {node.type === "file" && (
                  <>
                    {onRenameFile && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPath(node.path);
                          setEditValue(node.name);
                        }}
                      >
                        <Edit2 className="w-3 h-3" />
                      </Button>
                    )}
                    {onDeleteFile && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteFile(node.path);
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {node.type === "folder" && isExpanded && node.children && (
            <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
          )}
        </div>
      );
    },
    [
      expandedFolders,
      selectedPath,
      editingPath,
      editValue,
      handleFileClick,
      handleContextMenu,
      onDeleteFile,
      onRenameFile,
    ]
  );

  return (
    <div className="h-full flex flex-col border-r border-gray-200 bg-white">
      <div className="p-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-semibold">Files</span>
        <div className="flex gap-1">
          {onCreateFile && (
            <>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => {
                  setNewFilePath("");
                  setShowCreateFileDialog(true);
              }}
              title="Create file"
            >
              <Plus className="w-4 h-4" />
            </Button>
              <Dialog open={showCreateFileDialog} onOpenChange={setShowCreateFileDialog}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New File</DialogTitle>
                    <DialogDescription>
                      Enter the file path (e.g., newfile.py or folder/newfile.py)
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Label htmlFor="file-path">File Path</Label>
                    <Input
                      id="file-path"
                      value={newFilePath}
                      onChange={(e) => setNewFilePath(e.target.value)}
                      placeholder="newfile.py"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newFilePath.trim()) {
                          onCreateFile(newFilePath.trim());
                          setShowCreateFileDialog(false);
                          setNewFilePath("");
                        } else if (e.key === "Escape") {
                          setShowCreateFileDialog(false);
                          setNewFilePath("");
                        }
                      }}
                      autoFocus
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowCreateFileDialog(false);
                        setNewFilePath("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        if (newFilePath.trim()) {
                          onCreateFile(newFilePath.trim());
                          setShowCreateFileDialog(false);
                          setNewFilePath("");
                        }
                      }}
                      disabled={!newFilePath.trim()}
                    >
                      Create
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            No files found
          </div>
        ) : (
          <div>{sortedFiles.map((file) => renderNode(file))}</div>
        )}
      </div>
    </div>
  );
};

export default FileExplorer;

