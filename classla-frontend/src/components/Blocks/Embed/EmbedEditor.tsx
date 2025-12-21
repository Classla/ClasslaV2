import React, { useState, useEffect, memo, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { EmbedData, validateEmbedData } from "../../extensions/EmbedBlock";
import { AlertTriangle, Film, Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Checkbox } from "../../ui/checkbox";

interface EmbedEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const EmbedEditor: React.FC<EmbedEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const embedData = node.attrs.embedData as EmbedData;
    const [validationErrors, setValidationErrors] = useState<string[]>([]);

    const updateEmbedData = useCallback(
      (updates: Partial<EmbedData>) => {
        const newData = { ...embedData, ...updates };
        const validation = validateEmbedData(newData);
        setValidationErrors(validation.errors);
        updateAttributes({ embedData: newData });
      },
      [embedData, updateAttributes]
    );

    useEffect(() => {
      const validation = validateEmbedData(embedData);
      setValidationErrors(validation.errors);
    }, [embedData]);

    const handleInputEvent = useCallback((e: React.SyntheticEvent) => {
      e.stopPropagation();
    }, []);

    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
      },
      []
    );

    // Auto-detect embed type from URL
    const detectEmbedType = useCallback((url: string): EmbedData["embedType"] => {
      if (!url) return "iframe";
      
      const lowerUrl = url.toLowerCase();
      if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be")) {
        return "youtube";
      }
      if (lowerUrl.includes("vimeo.com")) {
        return "vimeo";
      }
      return "iframe";
    }, []);

    const handleUrlChange = useCallback((url: string) => {
      const detectedType = detectEmbedType(url);
      updateEmbedData({ url, embedType: detectedType });
    }, [detectEmbedType, updateEmbedData]);

    const getEmbedUrl = () => {
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
    };

    return (
      <NodeViewWrapper
        className="embed-editor-wrapper"
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
        <div className="embed-editor border border-gray-200 rounded-lg p-3 bg-white shadow-sm select-none">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  validationErrors.length > 0
                    ? "bg-red-100 text-red-600"
                    : "bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-sm"
                }`}
              >
                {validationErrors.length > 0 ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <Film className="w-5 h-5" />
                )}
              </div>
              <div className="select-none">
                <div className="text-sm font-medium text-gray-900">Embed</div>
                {validationErrors.length > 0 && (
                  <div className="text-xs text-red-600 mt-0.5">
                    {validationErrors.length} error
                    {validationErrors.length !== 1 ? "s" : ""}
                  </div>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={deleteNode}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          <div className="mb-3">
            <Label className="text-sm font-medium text-gray-700 mb-1 block">
              URL or Embed Code
            </Label>
            <Input
              value={embedData.url}
              onChange={(e) => handleUrlChange(e.target.value)}
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
              placeholder="https://youtube.com/... or https://vimeo.com/... or any URL"
              className="w-full"
            />
            {embedData.url && (
              <p className="text-xs text-gray-500 mt-1">
                Detected: {embedData.embedType === "youtube" ? "YouTube" : embedData.embedType === "vimeo" ? "Vimeo" : "Generic iframe"}
              </p>
            )}
          </div>

          {embedData.embedType === "youtube" || embedData.embedType === "vimeo" ? (
            <div className="mb-3">
              <Label className="text-sm font-medium text-gray-700 mb-1 block">
                Start Time (MM:SS, optional)
              </Label>
              <Input
                value={embedData.startTime || ""}
                onChange={(e) => updateEmbedData({ startTime: e.target.value })}
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
                placeholder="00:30"
                className="w-full"
              />
            </div>
          ) : null}

          <div className="mb-3">
            <Label className="text-sm font-medium text-gray-700 mb-1 block">
              Title (optional)
            </Label>
            <Input
              value={embedData.title || ""}
              onChange={(e) => updateEmbedData({ title: e.target.value })}
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
              placeholder="Embed title..."
              className="w-full"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="allowFullscreen"
              checked={embedData.allowFullscreen}
              onCheckedChange={(checked) =>
                updateEmbedData({ allowFullscreen: !!checked })
              }
            />
            <Label htmlFor="allowFullscreen" className="text-sm">
              Allow fullscreen
            </Label>
          </div>

          {embedData.url && (
            <div className="mt-4 p-2 bg-gray-50 rounded border">
              <div className="text-xs text-gray-600 mb-2">Preview:</div>
              <div className="aspect-video bg-gray-200 rounded flex items-center justify-center">
                <span className="text-xs text-gray-500">Preview will appear here</span>
              </div>
            </div>
          )}
        </div>
      </NodeViewWrapper>
    );
  }
);

export default EmbedEditor;

