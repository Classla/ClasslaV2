import { useState, useEffect } from "react";
import NodeCard from "../components/NodeCard";
import { NodesData } from "../types";

export default function Nodes() {
  const [data, setData] = useState<NodesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchNodes = async () => {
    try {
      setError(null);
      const response = await fetch("/api/dashboard/nodes");
      if (!response.ok) {
        throw new Error(`Failed to fetch nodes: ${response.statusText}`);
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
    fetchNodes();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchNodes();
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleRefresh = () => {
    setLoading(true);
    fetchNodes();
  };

  if (loading && !data) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Node Management
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
          Node Management
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

  const managerNodes = data?.nodes.filter((n) => n.role === "manager") || [];
  const workerNodes = data?.nodes.filter((n) => n.role === "worker") || [];

  return (
    <div>
      {/* Header with controls */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Node Management</h2>
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

      {/* Manager Nodes */}
      {managerNodes.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Manager Nodes ({managerNodes.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {managerNodes.map((node) => (
              <NodeCard key={node.id} node={node} />
            ))}
          </div>
        </div>
      )}

      {/* Worker Nodes */}
      {workerNodes.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Worker Nodes ({workerNodes.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {workerNodes.map((node) => (
              <NodeCard key={node.id} node={node} />
            ))}
          </div>
        </div>
      )}

      {/* Instructions for adding nodes */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">
          Adding Worker Nodes
        </h3>
        <div className="text-sm text-blue-800 space-y-2">
          <p>To add a new worker node to the swarm:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Provision a new VPS with Docker installed</li>
            <li>
              On the manager node, run:{" "}
              <code className="bg-blue-100 px-2 py-1 rounded">
                docker swarm join-token worker
              </code>
            </li>
            <li>Copy the join command and run it on the new VPS</li>
            <li>The new node will appear here automatically</li>
          </ol>
          <p className="mt-4">To remove a node:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>
              Drain the node:{" "}
              <code className="bg-blue-100 px-2 py-1 rounded">
                docker node update --availability drain &lt;node-id&gt;
              </code>
            </li>
            <li>
              On the worker node, leave the swarm:{" "}
              <code className="bg-blue-100 px-2 py-1 rounded">
                docker swarm leave
              </code>
            </li>
            <li>
              On the manager, remove the node:{" "}
              <code className="bg-blue-100 px-2 py-1 rounded">
                docker node rm &lt;node-id&gt;
              </code>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
