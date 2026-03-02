import React, { useState, useEffect, useCallback, useRef, memo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { ImageBlockData } from "../../extensions/ImageBlock";
import { apiClient } from "../../../lib/api";
import { getAssignmentIdFromUrl } from "../../extensions/blockUtils";
import axios from "axios";
import {
  ImageIcon,
  Trash2,
  Upload,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";

interface ImageBlockEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const ImageBlockEditor: React.FC<ImageBlockEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const imageData = node.attrs.imageData as ImageBlockData;
    const [imageUrl, setImageUrl] = useState<string>("");
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string>("");
    const [isDragOver, setIsDragOver] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const resizeStartRef = useRef<{ x: number; width: number } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const updateImageData = useCallback(
      (updates: Partial<ImageBlockData>) => {
        updateAttributes({ imageData: { ...imageData, ...updates } });
      },
      [imageData, updateAttributes]
    );

    // Fetch presigned GET URL when s3Key changes
    useEffect(() => {
      if (!imageData.s3Key || (!imageData.assignmentId && !imageData.courseId)) {
        setImageUrl("");
        return;
      }

      let cancelled = false;
      const fetchUrl = async () => {
        try {
          const context = imageData.courseId
            ? { courseId: imageData.courseId }
            : { assignmentId: imageData.assignmentId };
          const response = await apiClient.getImageUrl(imageData.s3Key, context);
          if (!cancelled) {
            setImageUrl(response.data.url);
          }
        } catch (err) {
          console.error("[ImageBlock] Failed to fetch image URL:", err);
          if (!cancelled) setImageUrl("");
        }
      };
      fetchUrl();
      return () => {
        cancelled = true;
      };
    }, [imageData.s3Key, imageData.assignmentId, imageData.courseId]);

    const handleFileUpload = useCallback(
      async (file: File) => {
        // Validate type
        if (!ALLOWED_TYPES.includes(file.type)) {
          setUploadError("Only PNG, JPEG, GIF, and WebP images are allowed.");
          return;
        }
        // Validate size
        if (file.size > MAX_SIZE) {
          setUploadError("Image must be under 10 MB.");
          return;
        }

        // Determine context: courseId from block data (course summary) or assignmentId from URL
        const assignmentId = getAssignmentIdFromUrl();
        const courseId = imageData.courseId;
        if (!assignmentId && !courseId) {
          setUploadError("Could not determine context from URL.");
          return;
        }

        setUploadError("");
        setIsUploading(true);

        try {
          // 1. Get presigned upload URL
          const { data } = await apiClient.getImageUploadUrl({
            ...(courseId ? { courseId } : { assignmentId: assignmentId! }),
            filename: file.name,
            contentType: file.type,
          });

          // 2. Upload directly to S3
          await axios.put(data.uploadUrl, file, {
            headers: { "Content-Type": file.type },
          });

          // 3. Update block data
          updateImageData({
            s3Key: data.s3Key,
            ...(courseId ? { courseId } : { assignmentId: assignmentId! }),
            originalFilename: file.name,
            mimeType: file.type,
          });
        } catch (err: any) {
          console.error("[ImageBlock] Upload failed:", err);
          setUploadError(err.message || "Upload failed. Please try again.");
        } finally {
          setIsUploading(false);
        }
      },
      [updateImageData]
    );

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFileUpload(file);
      },
      [handleFileUpload]
    );

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    }, []);

    const handleFileInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFileUpload(file);
        // Reset so same file can be re-selected
        e.target.value = "";
      },
      [handleFileUpload]
    );

    // Resize handlers
    const handleResizeStart = useCallback(
      (e: React.MouseEvent, side: "left" | "right") => {
        e.preventDefault();
        e.stopPropagation();
        const imgEl = containerRef.current?.querySelector("img");
        if (!imgEl) return;
        const currentWidth = imgEl.getBoundingClientRect().width;
        resizeStartRef.current = { x: e.clientX, width: currentWidth };
        setIsResizing(true);

        const handleMouseMove = (moveEvent: MouseEvent) => {
          if (!resizeStartRef.current) return;
          const diff = moveEvent.clientX - resizeStartRef.current.x;
          const multiplier = side === "right" ? 1 : -1;
          let newWidth = resizeStartRef.current.width + diff * multiplier;
          // Clamp
          const maxWidth =
            containerRef.current?.parentElement?.getBoundingClientRect().width ||
            800;
          newWidth = Math.max(100, Math.min(newWidth, maxWidth));
          updateImageData({ width: Math.round(newWidth) });
        };

        const handleMouseUp = () => {
          setIsResizing(false);
          resizeStartRef.current = null;
          window.removeEventListener("mousemove", handleMouseMove);
          window.removeEventListener("mouseup", handleMouseUp);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
      },
      [updateImageData]
    );

    const handleInputEvent = useCallback((e: React.SyntheticEvent) => {
      e.stopPropagation();
    }, []);

    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
      },
      []
    );

    const alignmentClass =
      imageData.alignment === "left"
        ? "justify-start"
        : imageData.alignment === "right"
        ? "justify-end"
        : "justify-center";

    const hasImage = !!imageData.s3Key;

    return (
      <NodeViewWrapper
        className="image-editor-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
        onMouseDown={(e: React.MouseEvent) => {
          const target = e.target as HTMLElement;
          if (
            target.tagName !== "INPUT" &&
            target.tagName !== "TEXTAREA" &&
            !target.closest("input") &&
            !target.closest("textarea")
          ) {
            e.stopPropagation();
          }
        }}
        onClick={(e: React.MouseEvent) => {
          const target = e.target as HTMLElement;
          if (
            target.tagName !== "INPUT" &&
            target.tagName !== "TEXTAREA" &&
            !target.closest("input") &&
            !target.closest("textarea")
          ) {
            e.stopPropagation();
          }
        }}
        onPaste={(e: React.ClipboardEvent) => {
          const target = e.target as HTMLElement;
          if (
            target.tagName !== "INPUT" &&
            target.tagName !== "TEXTAREA" &&
            !target.closest("input") &&
            !target.closest("textarea")
          ) {
            e.stopPropagation();
          }
        }}
      >
        <div className="image-editor border border-border rounded-lg p-3 bg-card shadow-sm select-none">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
                <ImageIcon className="w-5 h-5" />
              </div>
              <div className="select-none">
                <div className="text-sm font-medium text-foreground">Image</div>
                {imageData.originalFilename && (
                  <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {imageData.originalFilename}
                  </div>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={deleteNode}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          {/* Upload area or image preview */}
          {!hasImage ? (
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragOver
                  ? "border-emerald-400 bg-emerald-50"
                  : "border-border hover:border-border hover:bg-muted"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                  <span className="text-sm text-muted-foreground">Uploading...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Drop an image here or click to browse
                  </span>
                  <span className="text-xs text-muted-foreground">
                    PNG, JPEG, GIF, WebP up to 10 MB
                  </span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={handleFileInputChange}
              />
            </div>
          ) : (
            <div ref={containerRef}>
              {/* Image with resize handles */}
              <div className={`flex ${alignmentClass}`}>
                <div className="relative group inline-block">
                  {/* Left resize handle */}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-10 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-emerald-500/30 rounded-l"
                    onMouseDown={(e) => handleResizeStart(e, "left")}
                  />
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={imageData.alt || ""}
                      style={{
                        width: imageData.width > 0 ? `${imageData.width}px` : "auto",
                        maxWidth: "100%",
                      }}
                      className={`rounded ${isResizing ? "pointer-events-none" : ""}`}
                      draggable={false}
                    />
                  ) : (
                    <div className="flex items-center justify-center bg-muted rounded p-8">
                      <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
                    </div>
                  )}
                  {/* Right resize handle */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-10 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-emerald-500/30 rounded-r"
                    onMouseDown={(e) => handleResizeStart(e, "right")}
                  />
                </div>
              </div>

              {/* Controls below image */}
              <div className="mt-3 space-y-2">
                {/* Alignment */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground mr-2">Align:</span>
                  {(["left", "center", "right"] as const).map((align) => (
                    <button
                      key={align}
                      onClick={() => updateImageData({ alignment: align })}
                      className={`p-1.5 rounded transition-colors ${
                        imageData.alignment === align
                          ? "bg-emerald-100 text-emerald-700"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                      title={`Align ${align}`}
                    >
                      {align === "left" && <AlignLeft className="w-4 h-4" />}
                      {align === "center" && <AlignCenter className="w-4 h-4" />}
                      {align === "right" && <AlignRight className="w-4 h-4" />}
                    </button>
                  ))}
                  {imageData.width > 0 && (
                    <button
                      onClick={() => updateImageData({ width: 0 })}
                      className="ml-2 text-xs text-muted-foreground hover:text-foreground underline"
                    >
                      Reset size
                    </button>
                  )}
                </div>

                {/* Alt text */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    Alt text (accessibility)
                  </Label>
                  <Input
                    value={imageData.alt || ""}
                    onChange={(e) => updateImageData({ alt: e.target.value })}
                    onMouseDown={handleInputEvent}
                    onClick={handleInputEvent}
                    onFocus={handleInputEvent}
                    onBlur={handleInputEvent}
                    onKeyDown={handleInputEvent}
                    onKeyUp={handleInputEvent}
                    onKeyPress={handleInputEvent}
                    onInput={handleInputEvent}
                    onMouseUp={handleInputEvent}
                    onMouseMove={handleInputEvent}
                    onPaste={handlePaste}
                    placeholder="Describe the image..."
                    className="w-full text-sm"
                  />
                </div>

                {/* Caption */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    Caption (optional)
                  </Label>
                  <Input
                    value={imageData.caption || ""}
                    onChange={(e) => updateImageData({ caption: e.target.value })}
                    onMouseDown={handleInputEvent}
                    onClick={handleInputEvent}
                    onFocus={handleInputEvent}
                    onBlur={handleInputEvent}
                    onKeyDown={handleInputEvent}
                    onKeyUp={handleInputEvent}
                    onKeyPress={handleInputEvent}
                    onInput={handleInputEvent}
                    onMouseUp={handleInputEvent}
                    onMouseMove={handleInputEvent}
                    onPaste={handlePaste}
                    placeholder="Add a caption..."
                    className="w-full text-sm"
                  />
                </div>

                {/* Replace image button */}
                <div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Replace image
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    onChange={handleFileInputChange}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Upload error */}
          {uploadError && (
            <div className="mt-2 flex items-center gap-2 text-sm text-red-600">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {uploadError}
            </div>
          )}
        </div>
      </NodeViewWrapper>
    );
  }
);

export default ImageBlockEditor;
