import React, { memo, useMemo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { EmbedData } from "../../extensions/EmbedBlock";

interface EmbedViewerProps {
  node: any;
  editor: any;
}

const EmbedViewer: React.FC<EmbedViewerProps> = memo(({ node }) => {
  const embedData = node.attrs.embedData as EmbedData;

  const embedUrl = useMemo(() => {
    if (embedData.embedType === "youtube" && embedData.url) {
      const videoId = embedData.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/)?.[1];
      if (videoId) {
        let url = `https://www.youtube.com/embed/${videoId}`;
        if (embedData.startTime) {
          const [minutes, seconds] = embedData.startTime.split(":").map(Number);
          const totalSeconds = (minutes || 0) * 60 + (seconds || 0);
          url += `?start=${totalSeconds}`;
        }
        return url;
      }
    }
    if (embedData.embedType === "vimeo" && embedData.url) {
      const videoId = embedData.url.match(/vimeo\.com\/(\d+)/)?.[1];
      if (videoId) {
        let url = `https://player.vimeo.com/video/${videoId}`;
        if (embedData.startTime) {
          const [minutes, seconds] = embedData.startTime.split(":").map(Number);
          const totalSeconds = (minutes || 0) * 60 + (seconds || 0);
          url += `#t=${totalSeconds}`;
        }
        return url;
      }
    }
    return embedData.url;
  }, [embedData]);

  return (
    <NodeViewWrapper
      className="embed-viewer-wrapper"
      as="div"
      draggable={false}
      contentEditable={false}
    >
      <div className="embed-viewer border border-border rounded-lg p-4 bg-card">
        {embedData.title && (
          <h3 className="text-sm font-medium text-foreground mb-2">
            {embedData.title}
          </h3>
        )}
        {embedData.embedType === "iframe" && embedData.embedCode ? (
          <div
            dangerouslySetInnerHTML={{ __html: embedData.embedCode }}
            className="w-full"
          />
        ) : embedUrl ? (
          <div className="aspect-video w-full">
            <iframe
              src={embedUrl}
              className="w-full h-full rounded"
              allowFullScreen={embedData.allowFullscreen}
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            />
          </div>
        ) : (
          <div className="p-4 text-center text-muted-foreground">
            No embed URL provided
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
});

export default EmbedViewer;

