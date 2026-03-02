import React, { memo, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { AlertData } from "../../extensions/AlertBlock";
import { Info, AlertTriangle, OctagonAlert, Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";

interface AlertEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const variantConfig = {
  info: {
    border: "border-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    iconColor: "text-blue-600 dark:text-blue-400",
    icon: Info,
    label: "Info",
  },
  warning: {
    border: "border-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    iconColor: "text-amber-600 dark:text-amber-400",
    icon: AlertTriangle,
    label: "Warning",
  },
  alert: {
    border: "border-red-500",
    bg: "bg-red-50 dark:bg-red-950/30",
    iconColor: "text-red-600 dark:text-red-400",
    icon: OctagonAlert,
    label: "Alert",
  },
} as const;

const AlertEditor: React.FC<AlertEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const alertData = node.attrs.alertData as AlertData;
    const variant = variantConfig[alertData.alertType] || variantConfig.info;
    const IconComponent = variant.icon;

    const updateAlertData = useCallback(
      (updates: Partial<AlertData>) => {
        updateAttributes({ alertData: { ...alertData, ...updates } });
      },
      [alertData, updateAttributes]
    );

    const handleInputEvent = useCallback((e: React.SyntheticEvent) => {
      e.stopPropagation();
    }, []);

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
      e.stopPropagation();
    }, []);

    return (
      <NodeViewWrapper
        className="alert-editor-wrapper"
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
        <div
          className={`border-l-4 ${variant.border} ${variant.bg} rounded-r-lg p-4 my-2`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <IconComponent className={`w-5 h-5 ${variant.iconColor}`} />
              <Select
                value={alertData.alertType}
                onValueChange={(value: AlertData["alertType"]) =>
                  updateAlertData({ alertType: value })
                }
              >
                <SelectTrigger className="w-[120px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="alert">Alert</SelectItem>
                </SelectContent>
              </Select>
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
          <Input
            value={alertData.title}
            onChange={(e) => updateAlertData({ title: e.target.value })}
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
            placeholder="Title (optional)"
            className="mb-2 font-semibold bg-transparent border-none shadow-none focus-visible:ring-0 px-0 text-foreground placeholder:text-muted-foreground"
          />
          <textarea
            value={alertData.content}
            onChange={(e) => updateAlertData({ content: e.target.value })}
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
            placeholder="Callout content..."
            rows={2}
            className="w-full bg-transparent border-none shadow-none resize-none focus:outline-none text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </NodeViewWrapper>
    );
  }
);

export default AlertEditor;
