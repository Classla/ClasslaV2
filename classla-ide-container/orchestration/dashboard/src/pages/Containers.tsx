import { useState, useEffect } from "react";
import ContainerTable from "../components/ContainerTable";
import { ContainersData } from "../types";

export default function Containers() {
  const [data, setData] = useState<ContainersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [limit] = useState(10);

  const fetchContainers = async () => {
    try {
      setError(null);
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: (page * limit).toString(),
      });
      if (statusFilter !== "all") {
        params.append("status", statusFilter);
      }

      const response = await fetch(`/api/containers?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch containers: ${response.statusText}`);
      }
      const result = await response.json();
      setData(result);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContainers();
  }, [page, statusFilter]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchContainers();
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh, page, statusFilter]);

  const handleRefresh = () => {
    setLoading(true);
    fetchContainers();
  };

  const handleAction = async (
    containerId: string,
    action: "stop" | "delete"
  ) => {
    if (
      !confirm(`Are you sure you want to ${action} container ${containerId}?`)
    ) {
      return;
    }

    setActionLoading(true);
    try {
      const endpoint =
        action === "stop"
          ? `/api/containers/${containerId}`
          : `/api/containers/${containerId}`;
      const method = action === "stop" ? "DELETE" : "DELETE";

      const response = await fetch(endpoint, { method });
      if (!response.ok) {
        throw new Error(
          `Failed to ${action} container: ${response.statusText}`
        );
      }

      // Refresh the list
      await fetchContainers();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to ${action} container`
      );
    } finally {
      setActionLoading(false);
    }
  };

  const filteredContainers =
    data?.containers.filter(
      (container) =>
        container.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        container.s3Bucket.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  if (loading && !data) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Container Management
        </h2>
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Container Management
        </h2>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button
            onClick={handleRefresh}
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header with controls */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          Container Management
        </h2>
        <div className="flex items-center space-x-4">
          {lastUpdate && (
            <span className="text-sm text-gray-500">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Auto-refresh</span>
          </label>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            <svg
              className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800 text-sm">{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by container ID or S3 bucket..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Status</option>
            <option value="running">Running</option>
            <option value="starting">Starting</option>
            <option value="stopping">Stopping</option>
            <option value="stopped">Stopped</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* Container Table */}
      <ContainerTable
        containers={filteredContainers}
        onAction={handleAction}
        loading={actionLoading}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing {page * limit + 1} to{" "}
            {Math.min((page + 1) * limit, data?.total || 0)} of{" "}
            {data?.total || 0} containers
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <div className="flex items-center space-x-1">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  className={`px-3 py-2 rounded ${
                    page === i
                      ? "bg-blue-600 text-white"
                      : "border border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
