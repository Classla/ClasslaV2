import { useState, useEffect, useRef } from "react";
import LogViewer from "../components/LogViewer";
import { LogEntry } from "../types";

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [containerFilter, setContainerFilter] = useState<string>("");
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Connect to SSE endpoint
    const connectSSE = () => {
      try {
        const eventSource = new EventSource("/api/dashboard/logs");
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          setConnected(true);
          setError(null);
        };

        eventSource.onmessage = (event) => {
          try {
            const logEntry: LogEntry = JSON.parse(event.data);
            setLogs((prev) => [...prev, logEntry].slice(-1000)); // Keep last 1000 logs
          } catch (err) {
            console.error("Failed to parse log entry:", err);
          }
        };

        eventSource.onerror = () => {
          setConnected(false);
          setError("Connection to log stream lost. Reconnecting...");
          eventSource.close();
          // Attempt to reconnect after 5 seconds
          setTimeout(connectSSE, 5000);
        };
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to connect to log stream"
        );
      }
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleClearLogs = () => {
    if (confirm("Are you sure you want to clear all logs?")) {
      setLogs([]);
    }
  };

  const filteredLogs = logs.filter((log) => {
    // Level filter
    if (levelFilter !== "all" && log.level !== levelFilter) {
      return false;
    }

    // Container filter
    if (containerFilter && log.containerId !== containerFilter) {
      return false;
    }

    // Search query
    if (
      searchQuery &&
      !log.message.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }

    return true;
  });

  const uniqueContainers = Array.from(
    new Set(logs.map((log) => log.containerId).filter(Boolean))
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">System Logs</h2>
          <div className="flex items-center mt-2 space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${
                connected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-sm text-gray-600">
              {connected ? "Connected" : "Disconnected"}
            </span>
            <span className="text-sm text-gray-400">•</span>
            <span className="text-sm text-gray-600">
              {filteredLogs.length} logs
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Auto-scroll</span>
          </label>
          <button
            onClick={handleClearLogs}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center space-x-2"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>Clear</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800 text-sm">{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Search
          </label>
          <input
            type="text"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Log Level
          </label>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Levels</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Container
          </label>
          <select
            value={containerFilter}
            onChange={(e) => setContainerFilter(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">All Containers</option>
            {uniqueContainers.map((containerId) => (
              <option key={containerId} value={containerId}>
                {containerId}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Log Viewer */}
      <LogViewer logs={filteredLogs} autoScroll={autoScroll} />

      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Total Logs</p>
          <p className="text-2xl font-semibold text-gray-900">{logs.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Errors</p>
          <p className="text-2xl font-semibold text-red-600">
            {logs.filter((l) => l.level === "error").length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Warnings</p>
          <p className="text-2xl font-semibold text-yellow-600">
            {logs.filter((l) => l.level === "warn").length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Info</p>
          <p className="text-2xl font-semibold text-blue-600">
            {logs.filter((l) => l.level === "info").length}
          </p>
        </div>
      </div>
    </div>
  );
}
