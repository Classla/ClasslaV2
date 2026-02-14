import React, { useState, useCallback, useMemo } from "react";
import { File, FileText, Folder, FolderOpen, Plus, Trash2, Edit2, ChevronRight, ChevronDown } from "lucide-react";
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

// File type icon based on extension
export function getFileIcon(fileName: string): React.ReactNode {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "py":
      return (
        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 256 255" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient x1="12.959%" y1="12.039%" x2="79.639%" y2="78.201%" id="pyA">
              <stop stopColor="#387EB8" offset="0%"/>
              <stop stopColor="#366994" offset="100%"/>
            </linearGradient>
            <linearGradient x1="19.128%" y1="20.579%" x2="90.742%" y2="88.429%" id="pyB">
              <stop stopColor="#FFE052" offset="0%"/>
              <stop stopColor="#FFC331" offset="100%"/>
            </linearGradient>
          </defs>
          <path d="M126.916.072c-64.832 0-60.784 28.115-60.784 28.115l.072 29.128h61.868v8.745H41.631S.145 61.355.145 126.77c0 65.417 36.21 63.097 36.21 63.097h21.61v-30.356s-1.165-36.21 35.632-36.21h61.362s34.475.557 34.475-33.319V33.97S194.67.072 126.916.072zM92.802 19.66a11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13 11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.13z" fill="url(#pyA)"/>
          <path d="M128.757 254.126c64.832 0 60.784-28.115 60.784-28.115l-.072-29.127H127.6v-8.745h86.441s41.486 4.705 41.486-60.712c0-65.416-36.21-63.096-36.21-63.096h-21.61v30.355s1.165 36.21-35.632 36.21h-61.362s-34.475-.557-34.475 33.32v56.013s-5.235 33.897 62.518 33.897zm34.114-19.586a11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.131 11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13z" fill="url(#pyB)"/>
        </svg>
      );
    case "java":
      return (
        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 256 346" xmlns="http://www.w3.org/2000/svg">
          <path d="M82.554 267.473s-13.198 7.675 9.393 10.272c27.369 3.122 41.356 2.675 71.517-3.034 0 0 7.93 4.972 19.003 9.279-67.611 28.977-153.019-1.679-99.913-16.517M74.292 229.659s-14.803 10.958 7.805 13.296c29.236 3.016 52.324 3.263 92.276-4.43 0 0 5.526 5.602 14.215 8.666-81.747 23.904-172.798 1.885-114.296-17.532" fill="#5382A1"/>
          <path d="M143.942 165.515c16.66 19.18-4.377 36.44-4.377 36.44s42.301-21.837 22.874-49.183c-18.144-25.5-32.059-38.172 43.268-81.858 0 0-118.238 29.53-61.765 94.6" fill="#E76F00"/>
          <path d="M233.364 295.442s9.767 8.047-10.757 14.273c-39.026 11.823-162.432 15.393-196.714.471-12.323-5.36 10.787-12.8 18.056-14.362 7.581-1.644 11.914-1.337 11.914-1.337-13.705-9.655-88.583 18.957-38.034 27.15 137.853 22.356 251.292-10.066 215.535-26.195M88.9 190.48s-62.771 14.91-22.228 20.323c17.118 2.292 51.243 1.774 83.03-.89 25.978-2.19 52.063-6.85 52.063-6.85s-9.16 3.923-15.787 8.448c-63.744 16.765-186.886 8.966-151.435-8.183 29.981-14.492 54.358-12.848 54.358-12.848M201.506 253.422c64.8-33.672 34.839-66.03 13.927-61.67-5.126 1.066-7.411 1.99-7.411 1.99s1.903-2.98 5.537-4.27c41.37-14.545 73.187 42.897-13.355 65.647 0 .001 1.003-.895 1.302-1.697" fill="#5382A1"/>
          <path d="M162.439.371s35.887 35.9-34.037 91.101c-56.071 44.282-12.786 69.53-.023 98.377-32.73-29.53-56.75-55.526-40.635-79.72C111.395 74.612 176.918 57.393 162.439.37" fill="#E76F00"/>
          <path d="M95.268 344.665c62.199 3.982 157.712-2.209 159.974-31.64 0 0-4.348 11.158-51.404 20.018-53.088 9.99-118.564 8.824-157.399 2.421.001 0 7.95 6.58 48.83 9.201" fill="#5382A1"/>
        </svg>
      );
    case "txt":
      return <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />;
    default:
      return <File className="w-4 h-4 text-gray-500 flex-shrink-0" />;
  }
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
                {getFileIcon(node.name)}
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

