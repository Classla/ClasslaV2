/**
 * MonacoOTBinding - Binds Monaco Editor to OTDocumentClient
 *
 * Handles:
 * - Local Monaco edits → OT operations
 * - Remote OT operations → Monaco edits
 * - Local cursor/selection tracking → onCursorChange callback
 * - Remote cursor rendering via Monaco decorations
 */

import type * as monaco from "monaco-editor";
import * as Sentry from "@sentry/react";
import { TextOperation, OTDocumentClient } from "./otClient";

// Inject remote cursor CSS once
let cursorStylesInjected = false;
function injectCursorStyles(): void {
  if (cursorStylesInjected) return;
  cursorStylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .ot-remote-cursor {
      border-left: 2px solid var(--cursor-color, #FF6B6B);
      margin-left: -1px;
    }
    .ot-remote-selection {
      background-color: var(--cursor-color, #FF6B6B);
      opacity: 0.2;
    }
    .ot-remote-cursor-label {
      position: relative;
    }
    .ot-remote-cursor-label::after {
      content: attr(data-username);
      position: absolute;
      top: -18px;
      left: 0;
      font-size: 11px;
      line-height: 14px;
      padding: 1px 4px;
      border-radius: 2px;
      white-space: nowrap;
      pointer-events: none;
      background-color: var(--cursor-color, #FF6B6B);
      color: white;
      z-index: 10;
    }
  `;
  document.head.appendChild(style);
}

// Generate a unique CSS class name for a specific color
const colorClassCache = new Map<string, string>();
let colorClassCounter = 0;

function getColorClass(color: string): string {
  let cls = colorClassCache.get(color);
  if (cls) return cls;
  cls = `ot-cursor-color-${colorClassCounter++}`;
  const style = document.createElement("style");
  style.textContent = `
    .${cls} { --cursor-color: ${color}; }
  `;
  document.head.appendChild(style);
  colorClassCache.set(color, cls);
  return cls;
}

export interface CursorData {
  cursor: { lineNumber: number; column: number } | null;
  selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null;
}

interface RemoteCursorState {
  name: string;
  color: string;
  cursor: { lineNumber: number; column: number } | null;
  selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null;
  decorationIds: string[];
  lastUpdate: number;
}

export class MonacoOTBinding {
  private model: monaco.editor.ITextModel;
  private editor: monaco.editor.IStandaloneCodeEditor;
  private document: OTDocumentClient;
  private isApplyingRemote: boolean = false;
  private disposables: monaco.IDisposable[] = [];
  private remoteCursors: Map<string, RemoteCursorState> = new Map();
  private cursorFadeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  readonly bindingId: string;

  onCursorChange: ((data: CursorData) => void) | null = null;

  constructor(
    model: monaco.editor.ITextModel,
    editor: monaco.editor.IStandaloneCodeEditor,
    document: OTDocumentClient
  ) {
    this.model = model;
    this.editor = editor;
    this.document = document;
    this.bindingId = `binding_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    injectCursorStyles();

    // Monaco -> OT: convert Monaco content changes to TextOperation
    const changeDisposable = model.onDidChangeContent((e) => {
      if (this.isApplyingRemote) return;

      const fullText = model.getValue();
      const baseLength = this.document.content.length;

      // Build operation from Monaco changes
      // Changes are sorted by offset; process them by building a single operation
      const changes = [...e.changes].sort((a, b) => a.rangeOffset - b.rangeOffset);
      let op = new TextOperation();
      let cursor = 0;

      for (const change of changes) {
        // Retain characters before this change
        if (change.rangeOffset > cursor) {
          op.retain(change.rangeOffset - cursor);
        }
        // Delete replaced text
        if (change.rangeLength > 0) {
          op.delete(change.rangeLength);
        }
        // Insert new text
        if (change.text) {
          op.insert(change.text);
        }
        cursor = change.rangeOffset + change.rangeLength;
      }

      // Retain remaining characters
      if (cursor < baseLength) {
        op.retain(baseLength - cursor);
      }

      // Safety net: if the computed baseLength doesn't match the OT document,
      // the OT client and Monaco have diverged (e.g. due to EOL normalization).
      // Force-sync doc.content to Monaco immediately, then rebuild as a full
      // replacement so applyLocal() operates on a consistent base.
      if (op.baseLength !== this.document.content.length) {
        const divergenceMsg = `[OT] Content divergence detected: op.baseLength=${op.baseLength}, doc.content.length=${this.document.content.length}. Force-syncing and rebuilding as full replacement.`;
        console.error(divergenceMsg);
        Sentry.captureMessage(divergenceMsg, {
          level: "error",
          extra: {
            opBaseLength: op.baseLength,
            docContentLength: this.document.content.length,
            documentId: this.document.documentId,
          },
        });
        // Directly correct doc.content so no further ops see the stale value
        const staleLength = this.document.content.length;
        this.document.content = fullText;
        op = new TextOperation();
        if (staleLength > 0) op.delete(staleLength);
        if (fullText.length > 0) op.insert(fullText);
      }

      if (!op.isNoop()) {
        this.document.applyLocal(op);
        this.document.notifyLocalOperation(this.bindingId, op);
      }
    });
    this.disposables.push(changeDisposable);

    // Track cursor position changes
    const cursorDisposable = editor.onDidChangeCursorPosition(() => {
      if (this.isApplyingRemote) return;
      this.emitCursorChange();
    });
    this.disposables.push(cursorDisposable);

    // Track selection changes
    const selectionDisposable = editor.onDidChangeCursorSelection(() => {
      if (this.isApplyingRemote) return;
      this.emitCursorChange();
    });
    this.disposables.push(selectionDisposable);

    // OT -> Monaco: convert TextOperation to Monaco batch edits
    // All edit positions must reference the ORIGINAL (pre-edit) model content,
    // since pushEditOperations applies all edits as a batch.
    // Only retain and delete consume base characters (advance the index).
    // Inserts do NOT advance the index — they add text at the current base position.
    this.document.addContentChangedListener(this.bindingId, (content: string, operation: TextOperation) => {
      this.isApplyingRemote = true;
      try {
        const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
        let index = 0; // Position in the base (original) document

        for (const op of operation.ops) {
          if (typeof op === "number" && op > 0) {
            // Retain: skip forward in base document
            index += op;
          } else if (typeof op === "string") {
            // Insert: add text at current base position
            const pos = model.getPositionAt(index);
            edits.push({
              range: {
                startLineNumber: pos.lineNumber,
                startColumn: pos.column,
                endLineNumber: pos.lineNumber,
                endColumn: pos.column,
              } as monaco.IRange,
              text: op,
            });
            // Do NOT advance index — inserts don't consume base characters
          } else if (typeof op === "number" && op < 0) {
            // Delete: remove characters from base document
            const deleteLen = -op;
            const startPos = model.getPositionAt(index);
            const endPos = model.getPositionAt(index + deleteLen);
            edits.push({
              range: {
                startLineNumber: startPos.lineNumber,
                startColumn: startPos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column,
              } as monaco.IRange,
              text: "",
            });
            index += deleteLen; // Deletes consume base characters
          }
        }

        if (edits.length > 0) {
          model.pushEditOperations([], edits, () => null);
        }

        // Verify Monaco's model matches the OT content after applying remote op.
        // If Monaco normalized \r\n from the remote op, force-sync to prevent drift.
        if (model.getValue() !== content) {
          console.warn("[OT] Post-apply divergence: forcing Monaco sync with OT content.");
          model.pushEditOperations(
            [],
            [{ range: model.getFullModelRange(), text: content }],
            () => null
          );
        }
      } finally {
        this.isApplyingRemote = false;
      }
    });
  }

  private emitCursorChange(): void {
    if (!this.onCursorChange) return;

    const position = this.editor.getPosition();
    const selection = this.editor.getSelection();

    const cursorData: CursorData = {
      cursor: position ? { lineNumber: position.lineNumber, column: position.column } : null,
      selection: null,
    };

    // Only include selection if it's non-empty (not just a cursor position)
    if (selection && !selection.isEmpty()) {
      cursorData.selection = {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn,
      };
    }

    this.onCursorChange(cursorData);
  }

  /**
   * Update a remote user's cursor position and render it
   */
  updateRemoteCursor(
    clientId: string,
    name: string,
    color: string,
    cursor: { lineNumber: number; column: number } | null,
    selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null
  ): void {
    // Clear existing fade timer
    const existingTimer = this.cursorFadeTimers.get(clientId);
    if (existingTimer) clearTimeout(existingTimer);

    const state: RemoteCursorState = {
      name,
      color,
      cursor,
      selection,
      decorationIds: this.remoteCursors.get(clientId)?.decorationIds || [],
      lastUpdate: Date.now(),
    };
    this.remoteCursors.set(clientId, state);

    // Render decorations
    this.renderRemoteCursor(clientId, state);

    // Set fade timer - remove cursor after 10s of inactivity
    const timer = setTimeout(() => {
      this.removeRemoteCursor(clientId);
    }, 10000);
    this.cursorFadeTimers.set(clientId, timer);
  }

  /**
   * Remove a remote cursor
   */
  removeRemoteCursor(clientId: string): void {
    const state = this.remoteCursors.get(clientId);
    if (state) {
      // Clear decorations
      this.editor.deltaDecorations(state.decorationIds, []);
      this.remoteCursors.delete(clientId);
    }
    const timer = this.cursorFadeTimers.get(clientId);
    if (timer) {
      clearTimeout(timer);
      this.cursorFadeTimers.delete(clientId);
    }
  }

  private renderRemoteCursor(clientId: string, state: RemoteCursorState): void {
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    const colorClass = getColorClass(state.color);

    // Cursor line decoration
    if (state.cursor) {
      decorations.push({
        range: {
          startLineNumber: state.cursor.lineNumber,
          startColumn: state.cursor.column,
          endLineNumber: state.cursor.lineNumber,
          endColumn: state.cursor.column,
        } as monaco.IRange,
        options: {
          className: `ot-remote-cursor ${colorClass}`,
          stickiness: 1, // NeverGrowsWhenTypingAtEdges
        },
      });

      // Username label decoration (on the same position as cursor)
      decorations.push({
        range: {
          startLineNumber: state.cursor.lineNumber,
          startColumn: state.cursor.column,
          endLineNumber: state.cursor.lineNumber,
          endColumn: state.cursor.column,
        } as monaco.IRange,
        options: {
          before: {
            content: " ",
            inlineClassName: `ot-remote-cursor-label ${colorClass}`,
            inlineClassNameAffectsLetterSpacing: false,
            cursorStops: 2, // None
          } as any,
        },
      });
    }

    // Selection highlight decoration
    if (state.selection) {
      decorations.push({
        range: {
          startLineNumber: state.selection.startLineNumber,
          startColumn: state.selection.startColumn,
          endLineNumber: state.selection.endLineNumber,
          endColumn: state.selection.endColumn,
        } as monaco.IRange,
        options: {
          className: `ot-remote-selection ${colorClass}`,
          stickiness: 1,
        },
      });
    }

    // Update decorations
    const oldIds = state.decorationIds;
    const newIds = this.editor.deltaDecorations(oldIds, decorations);
    state.decorationIds = newIds;

    // Inject username as CSS content via a per-client style rule
    this.injectUsernameStyle(clientId, state.name, state.color);
  }

  // Track injected username styles to avoid re-injecting
  private usernameStyleElements: Map<string, HTMLStyleElement> = new Map();

  private injectUsernameStyle(clientId: string, name: string, color: string): void {
    // Remove old style if exists
    const oldStyle = this.usernameStyleElements.get(clientId);
    if (oldStyle) oldStyle.remove();

    // We use the description to find the decoration and inject the username
    // But since Monaco doesn't support data attributes on before pseudo-elements directly,
    // we use a unique class per client for the label
    const labelClass = `ot-cursor-label-${clientId.replace(/[^a-zA-Z0-9]/g, "")}`;
    const colorClass = getColorClass(color);

    const style = document.createElement("style");
    style.textContent = `
      .${labelClass}::after {
        content: "${name.replace(/"/g, '\\"')}";
        position: absolute;
        top: -18px;
        left: 0;
        font-size: 11px;
        line-height: 14px;
        padding: 1px 4px;
        border-radius: 2px;
        white-space: nowrap;
        pointer-events: none;
        background-color: ${color};
        color: white;
        z-index: 10;
      }
    `;
    document.head.appendChild(style);
    this.usernameStyleElements.set(clientId, style);

    // Re-render the cursor label decoration with the client-specific class
    const state = this.remoteCursors.get(clientId);
    if (state && state.cursor) {
      // The decorations are already set, but we need to update the label decoration
      // to use the client-specific class. We do this by re-running deltaDecorations.
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];
      const cColorClass = getColorClass(state.color);

      // Cursor line
      decorations.push({
        range: {
          startLineNumber: state.cursor.lineNumber,
          startColumn: state.cursor.column,
          endLineNumber: state.cursor.lineNumber,
          endColumn: state.cursor.column,
        } as monaco.IRange,
        options: {
          className: `ot-remote-cursor ${cColorClass}`,
          stickiness: 1,
        },
      });

      // Username label with client-specific class
      decorations.push({
        range: {
          startLineNumber: state.cursor.lineNumber,
          startColumn: state.cursor.column,
          endLineNumber: state.cursor.lineNumber,
          endColumn: state.cursor.column,
        } as monaco.IRange,
        options: {
          before: {
            content: " ",
            inlineClassName: `ot-remote-cursor-label ${cColorClass} ${labelClass}`,
            inlineClassNameAffectsLetterSpacing: false,
            cursorStops: 2,
          } as any,
        },
      });

      // Selection
      if (state.selection) {
        decorations.push({
          range: {
            startLineNumber: state.selection.startLineNumber,
            startColumn: state.selection.startColumn,
            endLineNumber: state.selection.endLineNumber,
            endColumn: state.selection.endColumn,
          } as monaco.IRange,
          options: {
            className: `ot-remote-selection ${cColorClass}`,
            stickiness: 1,
          },
        });
      }

      const newIds = this.editor.deltaDecorations(state.decorationIds, decorations);
      state.decorationIds = newIds;
    }
  }

  destroy(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.document.removeContentChangedListener(this.bindingId);
    this.document.removeSaveStatusListener(this.bindingId);
    this.document.removeResyncListener(this.bindingId);
    this.onCursorChange = null;

    // Clean up all remote cursors
    for (const [clientId, state] of this.remoteCursors) {
      this.editor.deltaDecorations(state.decorationIds, []);
    }
    this.remoteCursors.clear();

    // Clean up fade timers
    for (const timer of this.cursorFadeTimers.values()) {
      clearTimeout(timer);
    }
    this.cursorFadeTimers.clear();

    // Clean up username style elements
    for (const style of this.usernameStyleElements.values()) {
      style.remove();
    }
    this.usernameStyleElements.clear();
  }
}
