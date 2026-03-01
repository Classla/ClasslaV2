import React, { useState, useEffect, useCallback, useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { apiClient } from "../../../lib/api";
import { Loader2 } from "lucide-react";

interface InlineImageNodeProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  selected: boolean;
}

const InlineImageNode: React.FC<InlineImageNodeProps> = ({
  node,
  updateAttributes,
  selected,
}) => {
  const { s3Key, assignmentId, width, alt } = node.attrs;
  const [imageUrl, setImageUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);

  const updateAttrsRef = useRef(updateAttributes);
  updateAttrsRef.current = updateAttributes;

  const fetchUrl = useCallback(async () => {
    if (!s3Key || !assignmentId) {
      setLoading(false);
      return;
    }
    try {
      setError(false);
      const response = await apiClient.getImageUrl(s3Key, { assignmentId });
      setImageUrl(response.data.url);
    } catch (err) {
      console.error("[InlineImage] Failed to fetch image URL:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [s3Key, assignmentId]);

  useEffect(() => {
    fetchUrl();
  }, [fetchUrl]);

  const handleImgError = useCallback(() => {
    setImageUrl("");
    setLoading(true);
    fetchUrl();
  }, [fetchUrl]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;

    const startX = e.clientX;
    const startWidth = img.getBoundingClientRect().width;

    // Create a full-screen transparent overlay to capture all mouse events.
    // This prevents ProseMirror from intercepting mousemove during drag.
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;cursor:col-resize;";
    document.body.appendChild(overlay);
    document.body.style.userSelect = "none";

    container.classList.add("resizing");

    const onMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const diff = moveEvent.clientX - startX;
      const newWidth = Math.max(30, Math.min(startWidth + diff, 800));
      img.style.width = `${Math.round(newWidth)}px`;
    };

    const onMouseUp = () => {
      overlay.remove();
      document.body.style.userSelect = "";
      container.classList.remove("resizing");
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);

      const finalWidth = Math.round(img.getBoundingClientRect().width);
      updateAttrsRef.current({ width: finalWidth });
    };

    // Use capture phase on document so nothing can intercept
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
  }, []);

  if (loading) {
    return (
      <NodeViewWrapper as="span" className="inline-image-wrapper">
        <span className="inline-image-node inline-flex items-center justify-center bg-muted rounded px-2 py-1">
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
        </span>
      </NodeViewWrapper>
    );
  }

  if (error || !imageUrl) {
    return (
      <NodeViewWrapper as="span" className="inline-image-wrapper">
        <span className="inline-image-node inline-flex items-center gap-1 bg-muted text-muted-foreground rounded px-2 py-1 text-xs">
          Image failed to load
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="inline-image-wrapper">
      <span
        ref={containerRef}
        className={`inline-image-node${selected ? " selected" : ""}`}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt={alt || ""}
          onError={handleImgError}
          draggable={false}
          style={{
            width: width > 0 ? `${width}px` : "auto",
            maxWidth: "100%",
          }}
        />
        <span className="resize-bar" onMouseDown={handleResizeStart} />
      </span>
    </NodeViewWrapper>
  );
};

export default InlineImageNode;
