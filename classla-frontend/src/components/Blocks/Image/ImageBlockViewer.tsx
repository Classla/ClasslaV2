import React, { useState, useEffect, useCallback, memo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { ImageBlockData } from "../../extensions/ImageBlock";
import { apiClient } from "../../../lib/api";
import { ImageIcon, Loader2 } from "lucide-react";

interface ImageBlockViewerProps {
  node: any;
  editor: any;
}

const ImageBlockViewer: React.FC<ImageBlockViewerProps> = memo(({ node }) => {
  const imageData = node.attrs.imageData as ImageBlockData;
  const [imageUrl, setImageUrl] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const fetchUrl = useCallback(async () => {
    if (!imageData.s3Key || (!imageData.assignmentId && !imageData.courseId)) {
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      setHasError(false);
      const context = imageData.courseId
        ? { courseId: imageData.courseId }
        : { assignmentId: imageData.assignmentId };
      const response = await apiClient.getImageUrl(imageData.s3Key, context);
      setImageUrl(response.data.url);
    } catch (err) {
      console.error("[ImageBlockViewer] Failed to fetch image URL:", err);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [imageData.s3Key, imageData.assignmentId, imageData.courseId]);

  useEffect(() => {
    fetchUrl();
  }, [fetchUrl]);

  // Re-fetch if the presigned URL expires (on img error)
  const handleImageError = useCallback(() => {
    if (imageUrl) {
      // Only retry once
      setHasError(true);
      fetchUrl();
    }
  }, [imageUrl, fetchUrl]);

  const alignmentClass =
    imageData.alignment === "left"
      ? "justify-start"
      : imageData.alignment === "right"
      ? "justify-end"
      : "justify-center";

  if (!imageData.s3Key) {
    return (
      <NodeViewWrapper
        className="image-viewer-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div className="flex items-center justify-center p-8 text-muted-foreground">
          <ImageIcon className="w-8 h-8" />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      className="image-viewer-wrapper"
      as="div"
      draggable={false}
      contentEditable={false}
    >
      <div className="image-viewer my-4">
        <div className={`flex ${alignmentClass}`}>
          {isLoading ? (
            <div className="flex items-center justify-center bg-muted rounded p-12">
              <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
            </div>
          ) : hasError && !imageUrl ? (
            <div className="flex items-center justify-center bg-muted rounded p-8 text-muted-foreground text-sm">
              Failed to load image
            </div>
          ) : (
            <img
              src={imageUrl}
              alt={imageData.alt || ""}
              style={{
                width: imageData.width > 0 ? `${imageData.width}px` : "auto",
                maxWidth: "100%",
              }}
              className="rounded"
              loading="lazy"
              onError={handleImageError}
              draggable={false}
            />
          )}
        </div>
        {imageData.caption && (
          <div className={`flex ${alignmentClass} mt-1`}>
            <p className="text-sm text-muted-foreground italic">{imageData.caption}</p>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
});

export default ImageBlockViewer;
