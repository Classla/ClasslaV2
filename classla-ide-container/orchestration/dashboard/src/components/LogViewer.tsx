import { useEffect, useRef } from "react";
import { LogEntry } from "../types";

interface LogViewerProps {
  logs: LogEntry[];
  autoScroll: boolean;
}

export default function LogViewer({ logs, autoScroll }: LogViewerProps) {
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const getLevelColor = (level: string) => {
    switch (level) {
      case "error":
        return "text-red-600";
      case "warn":
        return "text-yellow-600";
      case "info":
        return "text-blue-600";
      case "debug":
        return "text-gray-500";
      default:
        return "text-gray-700";
    }
  };

  const getLevelBg = (level: string) => {
    switch (level) {
      case "error":
        return "bg-red-50";
      case "warn":
        return "bg-yellow-50";
      case "info":
        return "bg-blue-50";
      case "debug":
        return "bg-gray-50";
      default:
        return "bg-white";
    }
  };

  if (logs.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg p-8 text-center">
        <p className="text-gray-400">No logs available</p>
      </div>
    );
  }

  return (
    <div
      ref={logContainerRef}
      className="bg-gray-900 rounded-lg p-4 h-[600px] overflow-y-auto font-mono text-sm"
    >
      {logs.map((log) => (
        <div
          key={log.id}
          className={`py-2 px-3 mb-1 rounded ${getLevelBg(
            log.level
          )} hover:bg-opacity-80`}
        >
          <div className="flex items-start space-x-3">
            <span className="text-gray-400 text-xs whitespace-nowrap">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span
              className={`text-xs font-semibold uppercase whitespace-nowrap ${getLevelColor(
                log.level
              )}`}
            >
              {log.level}
            </span>
            {log.containerId && (
              <span className="text-purple-600 text-xs whitespace-nowrap">
                [{log.containerId}]
              </span>
            )}
            {log.nodeId && (
              <span className="text-green-600 text-xs whitespace-nowrap">
                [{log.nodeId}]
              </span>
            )}
            <span className="text-gray-800 flex-1 break-all">
              {log.message}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
