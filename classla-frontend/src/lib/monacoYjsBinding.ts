import * as Y from "yjs";
import * as monaco from "monaco-editor";

// Shared constant to identify binding-originated updates
const BINDING_ORIGIN = "monaco-binding";

/**
 * Monaco Editor binding for Y.js
 * Syncs Monaco editor content with Y.js Y.Text
 * Uses a reliable approach to prevent sync loops and duplication
 */
export class MonacoBinding {
  private ytext: Y.Text;
  private model: monaco.editor.ITextModel;
  private editor: monaco.editor.IStandaloneCodeEditor;
  private doc: Y.Doc;
  private destroyed: boolean = false;
  private isApplyingYjsUpdate: boolean = false;
  private lastMonacoContent: string = "";
  private lastYjsContent: string = "";
  private ytextObserver: (event: Y.YTextEvent, transaction: Y.Transaction) => void;
  private modelContentChangeListener!: monaco.IDisposable;
  private modelDisposeListener: monaco.IDisposable;
  private syncTimeout: NodeJS.Timeout | null = null;
  private updateCount: number = 0;
  private lastUpdateTime: number = 0;
  private readonly MAX_UPDATES_PER_SECOND = 10;

  constructor(
    ytext: Y.Text,
    model: monaco.editor.ITextModel,
    editors: Set<monaco.editor.IStandaloneCodeEditor>,
    doc: Y.Doc
  ) {
    this.ytext = ytext;
    this.model = model;
    this.doc = doc;
    // Get the first editor from the set
    this.editor = Array.from(editors)[0];

    // Initial sync: set Monaco content from Y.js
    const yjsContent = this.ytext.toString();
    this.lastYjsContent = yjsContent;
    this.lastMonacoContent = this.model.getValue();
    if (yjsContent !== this.lastMonacoContent) {
      this.isApplyingYjsUpdate = true;
      this.model.setValue(yjsContent);
      this.lastMonacoContent = yjsContent;
      this.isApplyingYjsUpdate = false;
    }

    // Sync Y.js to Monaco
    this.ytextObserver = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      // CRITICAL: Check transaction origin to prevent echo loops
      // Don't apply updates that came from this binding (they're already in Monaco)
      if (this.destroyed || transaction.origin === BINDING_ORIGIN || this.isApplyingYjsUpdate) {
        return;
      }

      // Rate limiting to prevent infinite loops
      const now = Date.now();
      if (now - this.lastUpdateTime < 1000) {
        this.updateCount++;
        if (this.updateCount > this.MAX_UPDATES_PER_SECOND) {
          console.warn('[MonacoBinding] Rate limit exceeded, skipping update');
          return;
        }
      } else {
        this.updateCount = 0;
        this.lastUpdateTime = now;
      }

      // Debounce updates to prevent rapid-fire changes
      if (this.syncTimeout) {
        clearTimeout(this.syncTimeout);
      }

      this.syncTimeout = setTimeout(() => {
        if (this.destroyed || this.isApplyingYjsUpdate) {
          return;
        }

        this.isApplyingYjsUpdate = true;

        try {
          const yjsContent = this.ytext.toString();
          const monacoContent = this.model.getValue();

          // Only update if content actually differs
          if (yjsContent !== monacoContent) {
            // CRITICAL: Update lastYjsContent BEFORE applying to prevent loops
            this.lastYjsContent = yjsContent;

            // Save cursor position before applying edits
            const position = this.editor.getPosition();

            // Use pushEditOperations with undo stop to prevent triggering change listener
            const lineCount = this.model.getLineCount();
            const lastLineLength = lineCount > 0 ? this.model.getLineLength(lineCount) : 0;
            
            this.model.pushEditOperations(
              [],
              [
                {
                  range: {
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: lineCount || 1,
                    endColumn: lastLineLength + 1,
                  },
                  text: yjsContent,
                },
              ],
              () => null // No undo stop
            );

            // CRITICAL: Update lastMonacoContent to match what we just set
            // This prevents the change listener from syncing back the old content
            this.lastMonacoContent = yjsContent;

            // Restore cursor position if possible
            if (position) {
              try {
                const newLineCount = this.model.getLineCount();
                const clampedLine = Math.min(Math.max(1, position.lineNumber), newLineCount);
                const lineLength = this.model.getLineLength(clampedLine);
                const clampedColumn = Math.min(Math.max(1, position.column), lineLength + 1);
                
                this.editor.setPosition({
                  lineNumber: clampedLine,
                  column: clampedColumn,
                });
              } catch (e) {
                // Ignore position restore errors
              }
            }
          }
        } catch (error) {
          console.error('[MonacoBinding] Error applying Y.js update:', error);
        } finally {
          this.isApplyingYjsUpdate = false;
        }
      }, 50); // Increased debounce for stability
    };

    // Set up Monaco to Y.js sync
    this.setupMonacoToYjsSync();

    // Handle model disposal
    this.modelDisposeListener = this.model.onWillDispose(() => {
      this.destroy();
    });

    // Observe Y.js changes
    this.ytext.observe(this.ytextObserver);
  }

  private setupMonacoToYjsSync(): void {
    // Sync Monaco to Y.js
    this.modelContentChangeListener = this.model.onDidChangeContent((e) => {
      // CRITICAL: Prevent sync during Y.js updates
      if (this.destroyed || this.isApplyingYjsUpdate) {
        return;
      }

      // Get current content
      const currentContent = this.model.getValue();
      
      // Check if content actually changed
      if (currentContent === this.lastMonacoContent) {
        return; // No actual change
      }

      // Use full content sync for reliability - incremental updates are too error-prone
      // This is especially important for operations like "select all + delete"
      // Use BINDING_ORIGIN to mark binding updates (they should be sent to server)
      this.doc.transact(() => {
        try {
          const yjsContent = this.ytext.toString();
          
          // Only sync if content differs
          if (currentContent !== yjsContent) {
            // Full content replacement - more reliable than incremental
            this.ytext.delete(0, this.ytext.length);
            if (currentContent.length > 0) {
              this.ytext.insert(0, currentContent);
            }
            
            // Update last known content
            this.lastMonacoContent = currentContent;
          }
        } catch (error) {
          console.error('[MonacoBinding] Error syncing Monaco to Y.js:', error);
          // Try again with a small delay if sync fails
          setTimeout(() => {
            if (!this.destroyed && !this.isApplyingYjsUpdate) {
              try {
                const content = this.model.getValue();
                const yjsContent = this.ytext.toString();
                if (content !== yjsContent) {
                  this.ytext.delete(0, this.ytext.length);
                  if (content.length > 0) {
                    this.ytext.insert(0, content);
                  }
                  this.lastMonacoContent = content;
                }
              } catch (retryError) {
                console.error('[MonacoBinding] Retry sync also failed:', retryError);
              }
            }
          }, 50);
        }
      }, BINDING_ORIGIN); // Mark as binding update (will be sent to server, but won't echo back)
    });
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }

    this.ytext.unobserve(this.ytextObserver);
    if (this.modelContentChangeListener) {
      this.modelContentChangeListener.dispose();
    }
    this.modelDisposeListener.dispose();
  }
}

