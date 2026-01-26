import * as Y from "yjs";
import * as monaco from "monaco-editor";

/**
 * Y.js Cursor tracking using Y.Map instead of Awareness
 * Tracks cursor positions of all users in the document
 */
export class YjsAwareness {
  private cursors: Y.Map<any> | null = null;
  private doc: Y.Doc | null = null;
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private userId: string;
  private userColor: string;
  private remoteCursors: Map<string, monaco.editor.IContentWidget> = new Map();
  private remoteSelections: Map<string, string[]> = new Map(); // userId -> decoration IDs
  private disposables: monaco.IDisposable[] = [];
  private updateTimeout: NodeJS.Timeout | null = null;
  private destroyed: boolean = false;
  private cursorPositions: Map<string, { lineNumber: number; column: number }> = new Map(); // Store current cursor positions

  constructor(doc: Y.Doc, editor: monaco.editor.IStandaloneCodeEditor, userId?: string) {
    this.doc = doc;
    this.editor = editor;
    this.userId = userId || `user-${Math.random().toString(36).substr(2, 9)}`;
    
    // Generate a color for this user
    this.userColor = this.generateColor(this.userId);
    
    // Use Y.Map to store cursor positions (keyed by user ID)
    // This map is part of the Y.js document and will sync automatically
    this.cursors = doc.getMap("cursors");
    
    // Initialize our cursor entry
    this.cursors.set(this.userId, {
      cursor: null,
      selection: null,
      user: {
        name: this.userId,
        color: this.userColor,
      },
    });
    
    // Listen for cursor changes in Monaco
    this.setupCursorTracking();
    
    // Listen for remote cursor changes
    this.setupRemoteCursors();
  }

  private generateColor(seed: string): string {
    // Generate a consistent color based on user ID
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 50%)`;
  }

  private setupCursorTracking(): void {
    if (!this.editor || !this.cursors) return;

    // Track cursor position with debouncing
    const updateCursor = () => {
      if (!this.editor || !this.cursors || this.destroyed) return;
      
      const position = this.editor.getPosition();
      const selection = this.editor.getSelection();
      
      if (position && this.cursors) {
        const cursorData: any = {
          cursor: {
            lineNumber: position.lineNumber,
            column: position.column,
          },
          user: {
            name: this.userId,
            color: this.userColor,
          },
        };
        
        if (selection && !selection.isEmpty()) {
          cursorData.selection = {
            startLineNumber: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLineNumber: selection.endLineNumber,
            endColumn: selection.endColumn,
          };
        } else {
          // Clear selection if empty
          cursorData.selection = null;
        }
        
        // Update in Y.js map - this will sync to other clients
        // Use a transaction but without origin to ensure it gets sent
        if (this.doc && this.cursors) {
          this.doc.transact(() => {
            this.cursors!.set(this.userId, cursorData);
          }); // No origin parameter - will be sent to server
        }
        
        console.debug(`[YjsAwareness] Updated cursor for ${this.userId}:`, cursorData);
      }
    };

    // Debounce cursor updates to avoid too many Y.js updates
    // Use shorter debounce for better responsiveness
    const debouncedUpdate = () => {
      if (this.updateTimeout) {
        clearTimeout(this.updateTimeout);
      }
      this.updateTimeout = setTimeout(updateCursor, 100);
    };

    // Update on cursor change
    const cursorDisposable = this.editor.onDidChangeCursorPosition(() => {
      debouncedUpdate();
    });

    // Update on selection change
    const selectionDisposable = this.editor.onDidChangeCursorSelection(() => {
      debouncedUpdate();
    });

    // Initial update
    updateCursor();

    this.disposables.push(cursorDisposable, selectionDisposable);
  }

  private setupRemoteCursors(): void {
    if (!this.cursors || !this.editor) {
      console.warn('[YjsAwareness] Cannot setup remote cursors - cursors or editor is null');
      return;
    }

    // Observe changes to the cursors map
    const observer = (event: Y.YMapEvent<any>) => {
      if (!this.cursors || !this.editor || this.destroyed) return;
      
      console.debug('[YjsAwareness] Cursor map changed:', {
        keysChanged: event.keysChanged,
        currentKeys: Array.from(this.cursors.keys()),
        userId: this.userId
      });
      
      event.keysChanged.forEach((key) => {
        if (key === this.userId) {
          // Ignore our own cursor - we don't show it
          return;
        }

        const cursorData = this.cursors?.get(key);
        
        if (cursorData && cursorData.cursor) {
          console.debug(`[YjsAwareness] Updating remote cursor for ${key}:`, cursorData);
          this.updateRemoteCursor(key, cursorData);
        } else {
          // Cursor was removed or has no cursor data
          console.debug(`[YjsAwareness] Removing cursor for ${key}`);
          this.removeRemoteCursor(key);
          this.removeRemoteSelection(key);
        }
      });
    };

    this.cursors.observe(observer);
    
    // Store observer for cleanup
    (this as any)._cursorObserver = observer;

    // Initial render of existing cursors (only for other users)
    if (this.cursors) {
      console.debug('[YjsAwareness] Initial cursor render, current keys:', Array.from(this.cursors.keys()));
      this.cursors.forEach((cursorData, userId) => {
        if (userId !== this.userId && cursorData && cursorData.cursor) {
          console.debug(`[YjsAwareness] Initial render cursor for ${userId}:`, cursorData);
          this.updateRemoteCursor(userId, cursorData);
        }
      });
    }
  }

  private updateRemoteCursor(userId: string, state: any): void {
    if (!this.editor || userId === this.userId) {
      // Don't show our own cursor
      return;
    }

    const cursor = state.cursor;
    if (!cursor || !cursor.lineNumber || !cursor.column) {
      // Remove cursor if no cursor data
      this.removeRemoteCursor(userId);
      this.removeRemoteSelection(userId);
      this.cursorPositions.delete(userId);
      return;
    }

    const color = state.user?.color || "#000000";
    const selection = state.selection;

    // Store the current cursor position so getPosition() can read it dynamically
    this.cursorPositions.set(userId, {
      lineNumber: cursor.lineNumber,
      column: cursor.column,
    });

    // Check if widget already exists - if so, just update its position
    const existingWidget = this.remoteCursors.get(userId);
    if (existingWidget) {
      // Widget exists - just trigger a layout update by calling layoutContentWidget
      try {
        this.editor.layoutContentWidget(existingWidget);
      } catch (error) {
        console.warn(`[YjsAwareness] Failed to layout cursor widget for ${userId}:`, error);
      }
    } else {
      // Create new cursor widget
      const widget: monaco.editor.IContentWidget = {
        getId: () => `yjs-cursor-${userId}`,
        getDomNode: () => {
          const node = document.createElement("div");
          node.className = "yjs-remote-cursor";
          node.style.borderLeft = `2px solid ${color}`;
          node.style.marginLeft = "-1px";
          node.style.height = "1.2em";
          node.style.position = "absolute";
          node.style.pointerEvents = "none";
          node.style.zIndex = "10";
          node.style.width = "2px";
          
          return node;
        },
        getPosition: () => {
          try {
            // Read position dynamically from stored state
            const pos = this.cursorPositions.get(userId);
            if (!pos) {
              return null;
            }
            return {
              position: {
                lineNumber: pos.lineNumber,
                column: pos.column,
              },
              preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
            };
          } catch (error) {
            console.error(`[YjsAwareness] Error getting cursor position for ${userId}:`, error);
            return null;
          }
        },
      };

      try {
        this.editor.addContentWidget(widget);
        this.remoteCursors.set(userId, widget);
      } catch (error) {
        console.error(`[YjsAwareness] Failed to add cursor widget for ${userId}:`, error);
      }
    }

    // Add selection highlighting if there's a selection, otherwise remove it
    if (selection && 
        selection.startLineNumber && selection.startColumn && 
        selection.endLineNumber && selection.endColumn &&
        !(selection.startLineNumber === selection.endLineNumber && selection.startColumn === selection.endColumn)) {
      // Only show selection if it's not empty (start != end)
      this.addRemoteSelection(userId, selection, color);
    } else {
      // Clear selection if empty or missing
      this.removeRemoteSelection(userId);
    }
  }

  private addRemoteSelection(userId: string, selection: any, color: string): void {
    if (!this.editor || this.destroyed) return;

    const model = this.editor.getModel();
    if (!model) return;

    try {
      // Remove old selection first
      this.removeRemoteSelection(userId);

      // Validate selection range
      const startLine = Math.max(1, Math.min(selection.startLineNumber, model.getLineCount()));
      const endLine = Math.max(1, Math.min(selection.endLineNumber, model.getLineCount()));
      const startCol = Math.max(1, Math.min(selection.startColumn, model.getLineLength(startLine) + 1));
      const endCol = Math.max(1, Math.min(selection.endColumn, model.getLineLength(endLine) + 1));

      const decoration: monaco.editor.IModelDeltaDecoration = {
        range: new monaco.Range(
          startLine,
          startCol,
          endLine,
          endCol
        ),
        options: {
          className: `yjs-remote-selection-${userId}`,
          inlineClassName: `yjs-remote-selection-inline-${userId}`,
          hoverMessage: { value: `Selection by ${userId}` },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      };

      // Create a unique style for this user's selection with better visibility
      const styleId = `yjs-selection-style-${userId}`;
      let styleTag = document.getElementById(styleId) as HTMLStyleElement;
      if (!styleTag) {
        styleTag = document.createElement("style");
        styleTag.id = styleId;
        document.head.appendChild(styleTag);
      }
      // Use rgba for better opacity control
      const rgbaColor = this.hexToRgba(color, 0.3);
      styleTag.textContent = `
        .yjs-remote-selection-${userId} {
          background-color: ${rgbaColor} !important;
        }
        .yjs-remote-selection-inline-${userId} {
          background-color: ${rgbaColor} !important;
        }
      `;

      const decorationIds = model.deltaDecorations([], [decoration]);
      this.remoteSelections.set(userId, decorationIds);
      
      console.debug(`[YjsAwareness] Added selection for ${userId}:`, decoration.range);
    } catch (error) {
      console.warn(`[YjsAwareness] Failed to add selection for ${userId}:`, error);
    }
  }

  private hexToRgba(hex: string, alpha: number): string {
    // Handle hsl colors
    if (hex.startsWith('hsl')) {
      return hex.replace(')', `, ${alpha})`).replace('hsl', 'hsla');
    }
    
    // Handle hex colors
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private removeRemoteSelection(userId: string): void {
    const decorationIds = this.remoteSelections.get(userId);
    if (decorationIds && this.editor) {
      const model = this.editor.getModel();
      if (model) {
        model.deltaDecorations(decorationIds, []);
      }
      this.remoteSelections.delete(userId);
    }
  }

  private removeRemoteCursor(userId: string): void {
    const widget = this.remoteCursors.get(userId);
    if (widget && this.editor) {
      this.editor.removeContentWidget(widget);
      this.remoteCursors.delete(userId);
    }
    this.cursorPositions.delete(userId);
  }

  /**
   * Clean up cursor tracking
   */
  destroy(): void {
    // Remove all remote cursors
    this.remoteCursors.forEach((widget, userId) => {
      this.removeRemoteCursor(userId);
    });
    this.remoteCursors.clear();

    // Remove all remote selections
    this.remoteSelections.forEach((decorationIds, userId) => {
      this.removeRemoteSelection(userId);
    });
    this.remoteSelections.clear();

    // Clear update timeout
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }

    // Dispose all listeners
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables = [];

    // Remove our cursor from the map
    if (this.cursors) {
      this.cursors.unobserve((this as any)._cursorObserver);
      this.cursors.delete(this.userId);
    }

    this.cursors = null;
    this.doc = null;
    this.editor = null;
    this.destroyed = true;
  }
}

