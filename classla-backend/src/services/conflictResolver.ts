// @ts-ignore - diff-match-patch doesn't have type declarations
import DiffMatchPatch from "diff-match-patch";

const dmp = new DiffMatchPatch();

export interface ConflictResolutionResult {
  merged: boolean;
  content: string;
  hasConflict: boolean;
  conflictMessage?: string;
}

/**
 * Attempt to merge two versions of a file using diff-match-patch
 */
export function mergeFileContent(
  baseContent: string,
  localContent: string,
  remoteContent: string
): ConflictResolutionResult {
  try {
    // If contents are identical, no merge needed
    if (localContent === remoteContent) {
      return {
        merged: true,
        content: localContent,
        hasConflict: false,
      };
    }

    // If one is empty, use the non-empty one
    if (!localContent && remoteContent) {
      return {
        merged: true,
        content: remoteContent,
        hasConflict: false,
      };
    }
    if (localContent && !remoteContent) {
      return {
        merged: true,
        content: localContent,
        hasConflict: false,
      };
    }

    // Compute diffs
    const diff1 = dmp.diff_main(baseContent, localContent);
    dmp.diff_cleanupSemantic(diff1);

    const diff2 = dmp.diff_main(baseContent, remoteContent);
    dmp.diff_cleanupSemantic(diff2);

    // Merge the diffs
    const patches1 = dmp.patch_make(baseContent, diff1);
    const patches2 = dmp.patch_make(baseContent, diff2);

    // Try to apply both patches
    let merged = baseContent;
    const [merged1, results1] = dmp.patch_apply(patches1, merged);
    const [merged2, results2] = dmp.patch_apply(patches2, merged1);

    // Check if all patches applied successfully
    const allPatchesApplied =
      results1.every((r: boolean) => r === true) && results2.every((r: boolean) => r === true);

    if (allPatchesApplied) {
      // Check if the merged result makes sense (no obvious conflicts)
      // If both diffs modified the same region, we might have conflicts
      const hasOverlappingChanges = checkOverlappingChanges(diff1, diff2);

      if (hasOverlappingChanges) {
        // Use last-write-wins for overlapping changes
        return {
          merged: true,
          content: remoteContent, // Prefer remote (S3) as source of truth
          hasConflict: true,
          conflictMessage: "Overlapping changes detected, using remote version",
        };
      }

      return {
        merged: true,
        content: merged2,
        hasConflict: false,
      };
    } else {
      // Patches couldn't be applied cleanly, use last-write-wins
      return {
        merged: true,
        content: remoteContent,
        hasConflict: true,
        conflictMessage: "Automatic merge failed, using remote version",
      };
    }
  } catch (error) {
    // If merge fails, use last-write-wins (prefer remote)
    return {
      merged: true,
      content: remoteContent,
      hasConflict: true,
      conflictMessage: `Merge error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Check if two diffs have overlapping changes
 */
function checkOverlappingChanges(
  diff1: DiffMatchPatch.Diff[],
  diff2: DiffMatchPatch.Diff[]
): boolean {
  // Simple heuristic: if both diffs have changes in similar positions, they overlap
  // This is a simplified check - a full implementation would track exact positions
  const changes1 = diff1.filter((d) => d[0] !== 0).length;
  const changes2 = diff2.filter((d) => d[0] !== 0).length;

  // If both have many changes, likely overlap
  if (changes1 > 0 && changes2 > 0) {
    return true;
  }

  return false;
}

/**
 * Resolve conflict using last-write-wins strategy
 */
export function resolveConflictLastWriteWins(
  localContent: string,
  remoteContent: string,
  localTimestamp: number,
  remoteTimestamp: number
): ConflictResolutionResult {
  // Use the most recent version
  const winner = remoteTimestamp >= localTimestamp ? remoteContent : localContent;

  return {
    merged: true,
    content: winner,
    hasConflict: true,
    conflictMessage: `Conflict resolved using last-write-wins (${remoteTimestamp >= localTimestamp ? "remote" : "local"} version)`,
  };
}

