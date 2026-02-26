import React, { useState, useMemo, useCallback } from "react";
import { ChevronRight, ChevronDown, Folder, FileText, Filter } from "lucide-react";
import { Checkbox } from "../../../../components/ui/checkbox";
import { Popover } from "../../../../components/ui/popover";
import { Assignment } from "../../../../types";

interface TreeNode {
  id: string;
  name: string;
  type: "folder" | "assignment";
  path: string[];
  assignmentId?: string;
  children: TreeNode[];
}

interface AssignmentFilterTreeProps {
  assignments: Assignment[];
  selectedAssignmentIds: Set<string> | null; // null = all selected
  onSelectionChange: (ids: Set<string> | null) => void;
}

function buildTree(assignments: Assignment[]): TreeNode[] {
  const folderMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Ensure folder nodes exist for each level of every path
  const getOrCreateFolder = (path: string[]): TreeNode => {
    const key = path.join("/");
    if (folderMap.has(key)) return folderMap.get(key)!;

    const node: TreeNode = {
      id: `folder-${key}`,
      name: path[path.length - 1],
      type: "folder",
      path,
      children: [],
    };
    folderMap.set(key, node);

    if (path.length === 1) {
      roots.push(node);
    } else {
      const parent = getOrCreateFolder(path.slice(0, -1));
      parent.children.push(node);
    }

    return node;
  };

  // Place each assignment into the tree
  for (const assignment of assignments) {
    const assignmentNode: TreeNode = {
      id: `assignment-${assignment.id}`,
      name: assignment.name,
      type: "assignment",
      path: assignment.module_path,
      assignmentId: assignment.id,
      children: [],
    };

    if (assignment.module_path.length === 0) {
      // Root-level assignment
      roots.push(assignmentNode);
    } else {
      const parent = getOrCreateFolder(assignment.module_path);
      parent.children.push(assignmentNode);
    }
  }

  // Sort children: folders first, then assignments, both by insertion order
  const sortChildren = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortChildren(node.children);
      }
    }
  };
  sortChildren(roots);

  return roots;
}

// Collect all assignment IDs under a node
function collectAssignmentIds(node: TreeNode): string[] {
  if (node.type === "assignment" && node.assignmentId) {
    return [node.assignmentId];
  }
  return node.children.flatMap(collectAssignmentIds);
}

function collectAllAssignmentIds(nodes: TreeNode[]): string[] {
  return nodes.flatMap(collectAssignmentIds);
}

const TreeNodeRow: React.FC<{
  node: TreeNode;
  depth: number;
  selectedIds: Set<string>;
  allIds: Set<string>;
  onToggleNode: (node: TreeNode) => void;
  expandedFolders: Set<string>;
  onToggleExpand: (folderId: string) => void;
}> = ({ node, depth, selectedIds, allIds, onToggleNode, expandedFolders, onToggleExpand }) => {
  const isFolder = node.type === "folder";
  const isExpanded = expandedFolders.has(node.id);

  // Determine checked state
  const childAssignmentIds = useMemo(() => collectAssignmentIds(node), [node]);
  const selectedCount = childAssignmentIds.filter((id) => selectedIds.has(id)).length;
  const isChecked = selectedCount === childAssignmentIds.length && childAssignmentIds.length > 0;
  const isIndeterminate = selectedCount > 0 && selectedCount < childAssignmentIds.length;

  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-accent cursor-pointer select-none"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => {
          if (isFolder) onToggleExpand(node.id);
        }}
      >
        {isFolder ? (
          <button
            className="p-0 w-4 h-4 flex items-center justify-center text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <Checkbox
          checked={isIndeterminate ? "indeterminate" : isChecked}
          onCheckedChange={() => onToggleNode(node)}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5"
        />
        {isFolder ? (
          <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm text-foreground truncate">{node.name}</span>
      </div>
      {isFolder && isExpanded &&
        node.children.map((child) => (
          <TreeNodeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedIds={selectedIds}
            allIds={allIds}
            onToggleNode={onToggleNode}
            expandedFolders={expandedFolders}
            onToggleExpand={onToggleExpand}
          />
        ))}
    </>
  );
};

const AssignmentFilterTree: React.FC<AssignmentFilterTreeProps> = ({
  assignments,
  selectedAssignmentIds,
  onSelectionChange,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(assignments), [assignments]);
  const allIds = useMemo(
    () => new Set(assignments.map((a) => a.id)),
    [assignments]
  );

  // If null (all selected), use full set
  const selectedIds = useMemo(
    () => selectedAssignmentIds ?? allIds,
    [selectedAssignmentIds, allIds]
  );

  const isAllSelected = selectedAssignmentIds === null || selectedIds.size === allIds.size;

  const handleToggleExpand = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleToggleNode = useCallback(
    (node: TreeNode) => {
      const idsToToggle = collectAssignmentIds(node);
      const next = new Set(selectedIds);
      const allSelected = idsToToggle.every((id) => next.has(id));

      if (allSelected) {
        // Deselect all
        for (const id of idsToToggle) next.delete(id);
      } else {
        // Select all
        for (const id of idsToToggle) next.add(id);
      }

      // If everything is selected, go back to null (all)
      if (next.size === allIds.size) {
        onSelectionChange(null);
      } else {
        onSelectionChange(next);
      }
    },
    [selectedIds, allIds, onSelectionChange]
  );

  const handleSelectAll = useCallback(() => {
    if (isAllSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(null);
    }
  }, [isAllSelected, onSelectionChange]);

  const filterCount =
    selectedAssignmentIds === null
      ? null
      : selectedAssignmentIds.size === allIds.size
      ? null
      : selectedAssignmentIds.size;

  const triggerButton = (
    <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-card border border-border rounded-lg hover:bg-accent transition-colors text-foreground">
      <Filter className="w-4 h-4" />
      <span>Assignments</span>
      {filterCount !== null && (
        <span className="bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-bold px-1.5 py-0.5 rounded-full">
          {filterCount}
        </span>
      )}
    </button>
  );

  const content = (
    <div className="p-3 max-h-[400px] flex flex-col">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Filter assignments</span>
        <button
          className="text-xs text-primary hover:underline"
          onClick={handleSelectAll}
        >
          {isAllSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className="overflow-y-auto flex-1 -mx-1">
        {tree.map((node) => (
          <TreeNodeRow
            key={node.id}
            node={node}
            depth={0}
            selectedIds={selectedIds}
            allIds={allIds}
            onToggleNode={handleToggleNode}
            expandedFolders={expandedFolders}
            onToggleExpand={handleToggleExpand}
          />
        ))}
      </div>
    </div>
  );

  return (
    <Popover
      trigger={triggerButton}
      content={content}
      align="right"
      minWidth="300px"
    />
  );
};

export default AssignmentFilterTree;
