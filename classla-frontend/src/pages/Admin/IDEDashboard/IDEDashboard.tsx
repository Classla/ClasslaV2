import React, { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Badge } from "../../../components/ui/badge";
import {
  RefreshCw,
  Cpu,
  MemoryStick,
  HardDrive,
  Server,
  Trash2,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import type {
  ContainerInfo,
  DashboardOverview,
  QueueStats,
} from "../../../types/adminIde";
import LoadTestPanel from "./LoadTestPanel";

// Helper function to format bytes to human readable
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// Helper function to format uptime duration
const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

// Resource card component
const ResourceCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  value: string;
  percentage: number;
  subtitle?: string;
}> = ({ title, icon, value, percentage, subtitle }) => {
  const getColorClass = (pct: number) => {
    if (pct >= 90) return "text-red-600";
    if (pct >= 70) return "text-yellow-600";
    return "text-green-600";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${getColorClass(percentage)}`}>
          {percentage.toFixed(1)}%
        </div>
        <p className="text-xs text-muted-foreground">{value}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
};

// Stats overview component
const StatsOverview: React.FC<{
  overview: DashboardOverview | null;
  queueStats: QueueStats | null;
}> = ({ overview, queueStats }) => {
  if (!overview) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Running</CardTitle>
          <Server className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            {overview.containers.running}
          </div>
          <p className="text-xs text-muted-foreground">Active containers</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Starting</CardTitle>
          <Server className="h-4 w-4 text-yellow-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-yellow-600">
            {overview.containers.starting}
          </div>
          <p className="text-xs text-muted-foreground">Initializing</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pre-warmed</CardTitle>
          <Server className="h-4 w-4 text-blue-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">
            {queueStats?.preWarmed ?? 0}
          </div>
          <p className="text-xs text-muted-foreground">
            Target: {queueStats?.targetSize ?? 0}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">With S3</CardTitle>
          <Server className="h-4 w-4 text-purple-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-purple-600">
            {queueStats?.withS3Bucket ?? 0}
          </div>
          <p className="text-xs text-muted-foreground">User containers</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Avg Uptime</CardTitle>
          <Server className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatDuration(overview.containers.averageUptime)}
          </div>
          <p className="text-xs text-muted-foreground">Running containers</p>
        </CardContent>
      </Card>
    </div>
  );
};

// Status badge component
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const variants: Record<string, string> = {
    running: "bg-green-100 text-green-800",
    starting: "bg-yellow-100 text-yellow-800",
    stopping: "bg-orange-100 text-orange-800",
    stopped: "bg-muted text-foreground",
    failed: "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-400",
  };

  return (
    <Badge className={variants[status] || "bg-muted text-foreground"}>
      {status}
    </Badge>
  );
};

const IDEDashboard: React.FC = () => {
  const { toast } = useToast();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [killDialogOpen, setKillDialogOpen] = useState(false);
  const [containerToKill, setContainerToKill] = useState<string | null>(null);
  const [killingContainer, setKillingContainer] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [overviewRes, containersRes, queueRes] = await Promise.all([
        apiClient.adminIde.getOverview(),
        apiClient.adminIde.getContainers({ status: "running" }),
        apiClient.adminIde.getQueueStats(),
      ]);

      setOverview(overviewRes.data);
      setContainers(containersRes.data.containers || containersRes.data || []);
      setQueueStats(queueRes.data);
    } catch (error: any) {
      console.error("Failed to fetch IDE dashboard data:", error);
      toast({
        title: "Failed to fetch data",
        description: error.message || "Could not connect to IDE service",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleKillContainer = async () => {
    if (!containerToKill) return;

    setKillingContainer(true);
    try {
      await apiClient.adminIde.killContainer(containerToKill);
      toast({
        title: "Container stopped",
        description: `Container ${containerToKill} has been stopped successfully.`,
      });
      // Refresh data
      fetchData();
    } catch (error: any) {
      console.error("Failed to kill container:", error);
      toast({
        title: "Failed to stop container",
        description: error.message || "Could not stop the container",
        variant: "destructive",
      });
    } finally {
      setKillingContainer(false);
      setKillDialogOpen(false);
      setContainerToKill(null);
    }
  };

  const openKillDialog = (containerId: string) => {
    setContainerToKill(containerId);
    setKillDialogOpen(true);
  };

  const getUptime = (container: ContainerInfo): string => {
    if (!container.startedAt) return "-";
    const startTime = new Date(container.startedAt).getTime();
    const now = Date.now();
    const seconds = Math.floor((now - startTime) / 1000);
    return formatDuration(seconds);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        <span className="ml-3 text-muted-foreground">Loading IDE dashboard...</span>
      </div>
    );
  }

  const ideBaseUrl = import.meta.env.VITE_IDE_BASE_URL || "https://ide.classla.org";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            IDE Container Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitor and manage IDE containers across the cluster
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing}
          className="border-purple-600 text-primary hover:bg-primary/10"
        >
          <RefreshCw
            className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Resource Cards */}
      {overview && (
        <div className="grid gap-4 md:grid-cols-3">
          <ResourceCard
            title="CPU Usage"
            icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
            value={`${overview.resources.cpu.usage.toFixed(1)}% used`}
            percentage={overview.resources.cpu.usage}
            subtitle={`${overview.resources.cpu.available.toFixed(1)}% available`}
          />
          <ResourceCard
            title="Memory Usage"
            icon={<MemoryStick className="h-4 w-4 text-muted-foreground" />}
            value={`${formatBytes(overview.resources.memory.used)} / ${formatBytes(overview.resources.memory.total)}`}
            percentage={overview.resources.memory.usagePercent}
            subtitle={`${formatBytes(overview.resources.memory.available)} available`}
          />
          <ResourceCard
            title="Disk Usage"
            icon={<HardDrive className="h-4 w-4 text-muted-foreground" />}
            value={`${formatBytes(overview.resources.disk.used)} / ${formatBytes(overview.resources.disk.total)}`}
            percentage={overview.resources.disk.usagePercent}
            subtitle={`${formatBytes(overview.resources.disk.available)} available`}
          />
        </div>
      )}

      {/* High Resource Warning */}
      {overview &&
        (overview.resources.cpu.usage > 90 ||
          overview.resources.memory.usagePercent > 90) && (
          <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <CardTitle className="text-red-800">High Resource Usage</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-red-700">
                {overview.resources.cpu.usage > 90 && "CPU usage is above 90%. "}
                {overview.resources.memory.usagePercent > 90 &&
                  "Memory usage is above 90%. "}
                Consider stopping idle containers to free up resources.
              </p>
            </CardContent>
          </Card>
        )}

      {/* Container Stats */}
      <StatsOverview overview={overview} queueStats={queueStats} />

      {/* Load Test Panel */}
      <LoadTestPanel />

      {/* Container Table */}
      <Card>
        <CardHeader>
          <CardTitle>Running Containers</CardTitle>
          <CardDescription>
            Active IDE containers with their status and resource usage
          </CardDescription>
        </CardHeader>
        <CardContent>
          {containers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No running containers found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>S3 Bucket</TableHead>
                  <TableHead>Uptime</TableHead>
                  <TableHead>URLs</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containers.map((container) => (
                  <TableRow key={container.id}>
                    <TableCell className="font-mono text-sm">
                      {container.id.substring(0, 12)}...
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={container.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {container.s3Bucket ? (
                        <span title={container.s3Bucket}>
                          {container.s3Bucket.substring(0, 20)}...
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Pre-warmed</span>
                      )}
                    </TableCell>
                    <TableCell>{getUptime(container)}</TableCell>
                    <TableCell>
                      {container.urls?.codeServer && (
                        <a
                          href={`${ideBaseUrl}${container.urls.codeServer}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center text-blue-600 hover:text-blue-800 text-sm"
                        >
                          IDE <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openKillDialog(container.id)}
                        className="text-red-600 hover:text-red-800 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Kill Confirmation Dialog */}
      <AlertDialog open={killDialogOpen} onOpenChange={setKillDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop Container?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to stop container{" "}
              <code className="bg-muted px-1 rounded">
                {containerToKill?.substring(0, 12)}...
              </code>
              ? This action cannot be undone and any unsaved work may be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={killingContainer}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleKillContainer}
              disabled={killingContainer}
              className="bg-red-600 hover:bg-red-700"
            >
              {killingContainer ? "Stopping..." : "Stop Container"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default IDEDashboard;
