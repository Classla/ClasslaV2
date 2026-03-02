import React, { memo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { AlertData } from "../../extensions/AlertBlock";
import { Info, AlertTriangle, OctagonAlert } from "lucide-react";

interface AlertViewerProps {
  node: any;
}

const variantConfig = {
  info: {
    border: "border-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    iconColor: "text-blue-600 dark:text-blue-400",
    icon: Info,
  },
  warning: {
    border: "border-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    iconColor: "text-amber-600 dark:text-amber-400",
    icon: AlertTriangle,
  },
  alert: {
    border: "border-red-500",
    bg: "bg-red-50 dark:bg-red-950/30",
    iconColor: "text-red-600 dark:text-red-400",
    icon: OctagonAlert,
  },
} as const;

const AlertViewer: React.FC<AlertViewerProps> = memo(({ node }) => {
  const alertData = node.attrs.alertData as AlertData;
  const variant = variantConfig[alertData.alertType] || variantConfig.info;
  const IconComponent = variant.icon;

  return (
    <NodeViewWrapper
      className="alert-viewer-wrapper"
      as="div"
      draggable={false}
      contentEditable={false}
    >
      <div
        className={`border-l-4 ${variant.border} ${variant.bg} rounded-r-lg p-4 my-2`}
      >
        <div className="flex items-start gap-3">
          <IconComponent
            className={`w-5 h-5 mt-0.5 flex-shrink-0 ${variant.iconColor}`}
          />
          <div className="flex-1 min-w-0">
            {alertData.title && (
              <div className={`font-semibold mb-1 ${variant.iconColor}`}>
                {alertData.title}
              </div>
            )}
            {alertData.content && (
              <div className="text-sm text-foreground whitespace-pre-wrap">
                {alertData.content}
              </div>
            )}
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
});

export default AlertViewer;
