import { useState, useEffect } from "react";
import MetricsCard from "../components/MetricsCard";
import { OverviewData } from "../types";
import { formatBytes, formatPercent, formatCores } from "../utils/format";

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchOverview = async () => {
    try {
      setError(null);
      const response = await fetch("/api/dashboard/overview");
      if (!response.ok) {
        throw new Error(`Failed to fetch overview: ${response.statusText}`);
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
    fetchOverview();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchOverview();
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleRefresh = () => {
    setLoading(true);
    fetchOverview();
  };

  if (loading && !data) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Overview</h2>
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
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Overview</h2>
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

  const resources = data?.resources;

  return (
    <div>
      {/* Header with controls */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
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

      {/* Metrics Grid */}
      {resources && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Containers */}
          <MetricsCard
            title="Total Containers"
            value={resources.containers.total}
            subtitle={`${resources.containers.running} running, ${resources.containers.stopped} stopped`}
            color="blue"
            icon={
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
              </svg>
            }
          />

          {/* CPU Usage */}
          <MetricsCard
            title="CPU Usage"
            value={formatPercent(resources.cpu.usage)}
            subtitle={`${formatCores(resources.cpu.available)} available`}
            color={
              resources.cpu.usage > 90
                ? "red"
                : resources.cpu.usage > 70
                ? "yellow"
                : "green"
            }
            icon={
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13 7H7v6h6V7z" />
                <path
                  fillRule="evenodd"
                  d="M7 2a1 1 0 012 0v1h2V2a1 1 0 112 0v1h2a2 2 0 012 2v2h1a1 1 0 110 2h-1v2h1a1 1 0 110 2h-1v2a2 2 0 01-2 2h-2v1a1 1 0 11-2 0v-1H9v1a1 1 0 11-2 0v-1H5a2 2 0 01-2-2v-2H2a1 1 0 110-2h1V9H2a1 1 0 010-2h1V5a2 2 0 012-2h2V2zM5 5h10v10H5V5z"
                  clipRule="evenodd"
                />
              </svg>
            }
          />

          {/* Memory Usage */}
          <MetricsCard
            title="Memory Usage"
            value={formatPercent(resources.memory.usagePercent)}
            subtitle={`${formatBytes(resources.memory.used)} / ${formatBytes(
              resources.memory.total
            )}`}
            color={
              resources.memory.usagePercent > 90
                ? "red"
                : resources.memory.usagePercent > 70
                ? "yellow"
                : "green"
            }
            icon={
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
                <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
                <path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z" />
              </svg>
            }
          />

          {/* Disk Usage */}
          {resources.disk && (
            <MetricsCard
              title="Disk Usage"
              value={formatPercent(resources.disk.usagePercent)}
              subtitle={`${formatBytes(resources.disk.used)} / ${formatBytes(
                resources.disk.total
              )}`}
              color={
                resources.disk.usagePercent > 90
                  ? "red"
                  : resources.disk.usagePercent > 70
                  ? "yellow"
                  : "green"
              }
              icon={
                <svg
                  className="w-6 h-6"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z"
                    clipRule="evenodd"
                  />
                </svg>
              }
            />
          )}
        </div>
      )}

      {/* Additional Info */}
      <div className="mt-8 bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Cluster Status
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Running Containers:</span>
            <span className="font-medium text-gray-900">
              {resources?.containers.running || 0}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Stopped Containers:</span>
            <span className="font-medium text-gray-900">
              {resources?.containers.stopped || 0}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Available Memory:</span>
            <span className="font-medium text-gray-900">
              {resources?.memory.available
                ? formatBytes(resources.memory.available)
                : "N/A"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Available CPU:</span>
            <span className="font-medium text-gray-900">
              {resources?.cpu.available
                ? formatCores(resources.cpu.available)
                : "N/A"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
