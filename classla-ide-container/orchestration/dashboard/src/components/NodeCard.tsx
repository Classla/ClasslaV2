import { NodeInfo } from "../types";
import { formatBytes, formatPercent } from "../utils/format";

interface NodeCardProps {
  node: NodeInfo;
}

export default function NodeCard({ node }: NodeCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "ready":
        return "bg-green-100 text-green-800";
      case "down":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getRoleColor = (role: string) => {
    return role === "manager"
      ? "bg-blue-100 text-blue-800"
      : "bg-purple-100 text-purple-800";
  };

  const getMemoryColor = (percent: number) => {
    if (percent > 90) return "bg-red-500";
    if (percent > 70) return "bg-yellow-500";
    return "bg-green-500";
  };

  const getCpuColor = (percent: number) => {
    if (percent > 90) return "bg-red-500";
    if (percent > 70) return "bg-yellow-500";
    return "bg-blue-500";
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {node.hostname}
          </h3>
          <p className="text-sm text-gray-500">{node.address}</p>
        </div>
        <div className="flex flex-col items-end space-y-2">
          <span
            className={`px-2 py-1 text-xs font-medium rounded ${getRoleColor(
              node.role
            )}`}
          >
            {node.role.toUpperCase()}
          </span>
          <span
            className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(
              node.status
            )}`}
          >
            {node.status.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Metrics */}
      <div className="space-y-4">
        {/* CPU */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">CPU</span>
            <span className="font-medium text-gray-900">
              {formatPercent(node.resources.cpu.usage)}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${getCpuColor(
                node.resources.cpu.usage
              )}`}
              style={{ width: `${Math.min(node.resources.cpu.usage, 100)}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Memory</span>
            <span className="font-medium text-gray-900">
              {formatBytes(node.resources.memory.usage)} /{" "}
              {formatBytes(node.resources.memory.total)}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${getMemoryColor(
                node.resources.memory.usagePercent
              )}`}
              style={{
                width: `${Math.min(node.resources.memory.usagePercent, 100)}%`,
              }}
            />
          </div>
        </div>

        {/* Disk */}
        {node.resources.disk && (
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Disk</span>
              <span className="font-medium text-gray-900">
                {formatBytes(node.resources.disk.usage)} /{" "}
                {formatBytes(node.resources.disk.total)}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${getMemoryColor(
                  node.resources.disk.usagePercent
                )}`}
                style={{
                  width: `${Math.min(node.resources.disk.usagePercent, 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Container Count */}
        <div className="flex justify-between text-sm pt-2 border-t">
          <span className="text-gray-600">Containers</span>
          <span className="font-medium text-gray-900">
            {node.containerCount}
          </span>
        </div>
      </div>
    </div>
  );
}
