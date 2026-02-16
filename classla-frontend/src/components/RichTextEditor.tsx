import React, { useCallback, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import { Bold, Italic, List, ListOrdered, Quote, Code } from "lucide-react";

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  autoFocus?: boolean;
  minHeight?: string;
  maxHeight?: string;
  showToolbar?: boolean;
  customExtensions?: any[]; // Additional TipTap extensions to include
  onEditorReady?: (editor: any) => void; // Callback when editor is ready
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  content,
  onChange,
  placeholder = "Start typing...",
  className = "",
  onKeyDown,
  autoFocus = false,
  minHeight = "28px",
  maxHeight = "300px",
  showToolbar = true,
  customExtensions = [],
  onEditorReady,
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable some features that might be too complex for MCQ text
        heading: {
          levels: [1, 2, 3],
        },
        bulletList: {
          HTMLAttributes: {
            class: "list-disc list-inside",
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: "list-decimal list-inside",
          },
        },
        blockquote: {
          HTMLAttributes: {
            class: "border-l-4 border-border pl-4 italic",
          },
        },
        code: {
          HTMLAttributes: {
            class: "bg-muted px-1 py-0.5 rounded text-sm font-mono",
          },
        },
        codeBlock: {
          HTMLAttributes: {
            class: "bg-muted p-3 rounded font-mono text-sm",
          },
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      Typography,
      ...customExtensions,
    ],
    content,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
    },
    editorProps: {
      attributes: {
        class: `rich-text-content text-foreground focus:outline-none ${className}`,
        style: `min-height: ${minHeight}; max-height: ${maxHeight}; overflow-y: auto; resize: none; padding: 8px !important; margin: 0 !important;`,
      },
      handleKeyDown: (view, event) => {
        if (onKeyDown) {
          const reactEvent = event as unknown as React.KeyboardEvent;
          onKeyDown(reactEvent);
        }
        return false;
      },
    },
    immediatelyRender: false,
  });

  // Update editor content when prop changes
  useEffect(() => {
    if (editor && editor.getHTML() !== content) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  // Handle auto focus
  useEffect(() => {
    if (editor && autoFocus) {
      editor.commands.focus();
    }
  }, [editor, autoFocus]);

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Auto-expand height based on content
  useEffect(() => {
    if (!editor) return;

    const updateHeight = () => {
      const editorElement = editor.view.dom as HTMLElement;
      if (!editorElement) return;

      // Reset height to auto to get the natural height
      editorElement.style.height = "auto";

      // Get the scroll height (natural content height)
      const scrollHeight = editorElement.scrollHeight;
      const minHeightPx = parseInt(minHeight);
      const maxHeightPx = parseInt(maxHeight);

      // Set height to content height, respecting min/max bounds
      const newHeight = Math.max(
        minHeightPx,
        Math.min(scrollHeight, maxHeightPx)
      );
      editorElement.style.height = `${newHeight}px`;

      // Show scrollbar only if content exceeds max height
      editorElement.style.overflowY =
        scrollHeight > maxHeightPx ? "auto" : "hidden";
    };

    // Update height on content changes
    const handleUpdate = () => {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(updateHeight);
    };

    // Listen to editor updates
    editor.on("update", handleUpdate);
    editor.on("focus", handleUpdate);
    editor.on("blur", handleUpdate);

    // Initial height adjustment
    handleUpdate();

    return () => {
      editor.off("update", handleUpdate);
      editor.off("focus", handleUpdate);
      editor.off("blur", handleUpdate);
    };
  }, [editor, minHeight, maxHeight]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Stop propagation to prevent ProseMirror interference
    e.stopPropagation();
  }, []);

  const handleEvent = useCallback((e: React.SyntheticEvent) => {
    // Stop propagation for all events to prevent parent editor interference
    e.stopPropagation();
  }, []);

  const ToolbarButton = ({
    onClick,
    isActive,
    children,
    title,
  }: {
    onClick: () => void;
    isActive?: boolean;
    children: React.ReactNode;
    title: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`p-1.5 rounded text-sm transition-colors ${
        isActive
          ? "bg-primary/20 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
      title={title}
    >
      {children}
    </button>
  );

  if (!editor) {
    return (
      <div
        className={`p-2 border border-border rounded-md bg-muted animate-pulse ${className}`}
        style={{ minHeight: minHeight }}
      >
        <div className="h-4 bg-accent rounded w-1/3"></div>
      </div>
    );
  }

  return (
    <div
      className={`rich-text-editor border border-border rounded-md focus-within:border-primary focus-within:ring-1 focus-within:ring-ring transition-colors ${className}`}
      onMouseDown={handleMouseDown}
      onMouseUp={handleEvent}
      onMouseMove={handleEvent}
      onClick={handleEvent}
      onFocus={handleEvent}
      onBlur={handleEvent}
      style={
        {
          // Override any default ProseMirror styles
          "--prosemirror-padding": "0px",
        } as React.CSSProperties
      }
    >
      {showToolbar && editor && (
        <div className="border-b border-border px-2 py-1 flex items-center gap-1 bg-muted rounded-t-md">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive("bold")}
            title="Bold (Ctrl+B)"
          >
            <Bold className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive("italic")}
            title="Italic (Ctrl+I)"
          >
            <Italic className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            isActive={editor.isActive("code")}
            title="Inline Code"
          >
            <Code className="w-4 h-4" />
          </ToolbarButton>

          <div className="w-px h-6 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive("bulletList")}
            title="Bullet List"
          >
            <List className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive("orderedList")}
            title="Numbered List"
          >
            <ListOrdered className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={editor.isActive("blockquote")}
            title="Quote"
          >
            <Quote className="w-4 h-4" />
          </ToolbarButton>
        </div>
      )}

      <div className={`${showToolbar ? "px-1 py-0" : "px-1 py-0"}`}>
        <style>{`
          .rich-text-content {
            line-height: 1.3;
          }
          .rich-text-content :global(.ProseMirror) {
            padding: 0 !important;
            margin: 0 !important;
            outline: none !important;
            border: none !important;
          }
          .rich-text-content :global(.ProseMirror-focused) {
            outline: none !important;
            border: none !important;
          }
          .rich-text-content :global(.ProseMirror > *:first-child) {
            margin-top: 0 !important;
          }
          .rich-text-content :global(.ProseMirror > *:last-child) {
            margin-bottom: 0 !important;
          }
          /* Additional ProseMirror overrides */
          :global(.rich-text-editor .ProseMirror) {
            padding: 0 !important;
            margin: 0 !important;
          }
          :global(.rich-text-editor .ProseMirror-focused) {
            outline: none !important;
          }
          .rich-text-content p {
            margin: 0;
            padding: 0;
          }
          .rich-text-content p + p {
            margin-top: 0.25rem;
          }
          .rich-text-content ul,
          .rich-text-content ol {
            margin: 0.125rem 0;
            padding-left: 1rem;
          }
          .rich-text-content li {
            margin: 0;
            padding: 0;
            line-height: 1.3;
          }
          .rich-text-content blockquote {
            margin: 0.125rem 0;
            padding-left: 0.5rem;
            border-left: 2px solid #d1d5db;
            font-style: italic;
          }
          .rich-text-content code {
            background-color: #f3f4f6;
            padding: 0.0625rem 0.125rem;
            border-radius: 0.125rem;
            font-size: 0.875rem;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas,
              "Liberation Mono", Menlo, monospace;
          }
          .rich-text-content pre {
            background-color: #f3f4f6;
            padding: 0.25rem;
            border-radius: 0.125rem;
            margin: 0.125rem 0;
            overflow-x: auto;
          }
          .rich-text-content pre code {
            background: none;
            padding: 0;
          }
          .rich-text-content strong {
            font-weight: 600;
          }
          .rich-text-content em {
            font-style: italic;
          }
        `}</style>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

export default RichTextEditor;
