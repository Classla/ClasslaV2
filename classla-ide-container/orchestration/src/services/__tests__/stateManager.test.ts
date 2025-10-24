import { StateManager, ContainerMetadata } from "../stateManager";
import fs from "fs";
import path from "path";

describe("StateManager", () => {
  let stateManager: StateManager;
  const testDbPath = path.join(__dirname, "test-containers.db");

  beforeEach(() => {
    // Clean up test database if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    stateManager = new StateManager(testDbPath);
  });

  afterEach(() => {
    stateManager.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe("saveContainer and getContainer", () => {
    it("should save and retrieve a container", () => {
      const container: ContainerMetadata = {
        id: "test-123",
        serviceName: "ide-test-123",
        s3Bucket: "test-bucket",
        s3Region: "us-east-1",
        status: "starting",
        createdAt: new Date(),
        urls: {
          vnc: "https://test-123-vnc.example.com",
          codeServer: "https://test-123-code.example.com",
          webServer: "https://test-123-web.example.com",
        },
        resourceLimits: {
          cpuLimit: "2",
          memoryLimit: "4g",
        },
      };

      stateManager.saveContainer(container);
      const retrieved = stateManager.getContainer("test-123");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe("test-123");
      expect(retrieved?.serviceName).toBe("ide-test-123");
      expect(retrieved?.s3Bucket).toBe("test-bucket");
      expect(retrieved?.status).toBe("starting");
    });

    it("should return null for non-existent container", () => {
      const retrieved = stateManager.getContainer("non-existent");
      expect(retrieved).toBeNull();
    });
  });

  describe("updateContainerStatus", () => {
    it("should update container status", () => {
      const container: ContainerMetadata = {
        id: "test-456",
        serviceName: "ide-test-456",
        s3Bucket: "test-bucket",
        s3Region: "us-east-1",
        status: "starting",
        createdAt: new Date(),
        urls: {
          vnc: "https://test-456-vnc.example.com",
          codeServer: "https://test-456-code.example.com",
          webServer: "https://test-456-web.example.com",
        },
        resourceLimits: {
          cpuLimit: "2",
          memoryLimit: "4g",
        },
      };

      stateManager.saveContainer(container);
      stateManager.updateContainerStatus("test-456", "running");

      const retrieved = stateManager.getContainer("test-456");
      expect(retrieved?.status).toBe("running");
    });
  });

  describe("updateContainerLifecycle", () => {
    it("should update lifecycle timestamps and shutdown reason", () => {
      const container: ContainerMetadata = {
        id: "test-789",
        serviceName: "ide-test-789",
        s3Bucket: "test-bucket",
        s3Region: "us-east-1",
        status: "starting",
        createdAt: new Date(),
        urls: {
          vnc: "https://test-789-vnc.example.com",
          codeServer: "https://test-789-code.example.com",
          webServer: "https://test-789-web.example.com",
        },
        resourceLimits: {
          cpuLimit: "2",
          memoryLimit: "4g",
        },
      };

      stateManager.saveContainer(container);

      const startedAt = new Date();
      const lastActivity = new Date();

      stateManager.updateContainerLifecycle("test-789", {
        status: "running",
        startedAt,
        lastActivity,
      });

      let retrieved = stateManager.getContainer("test-789");
      expect(retrieved?.status).toBe("running");
      expect(retrieved?.startedAt).toEqual(startedAt);
      expect(retrieved?.lastActivity).toEqual(lastActivity);

      const stoppedAt = new Date();
      stateManager.updateContainerLifecycle("test-789", {
        status: "stopped",
        stoppedAt,
        shutdownReason: "inactivity",
      });

      retrieved = stateManager.getContainer("test-789");
      expect(retrieved?.status).toBe("stopped");
      expect(retrieved?.stoppedAt).toEqual(stoppedAt);
      expect(retrieved?.shutdownReason).toBe("inactivity");
    });
  });

  describe("listContainers", () => {
    beforeEach(() => {
      // Create multiple containers with different statuses
      const containers: ContainerMetadata[] = [
        {
          id: "running-1",
          serviceName: "ide-running-1",
          s3Bucket: "test-bucket",
          s3Region: "us-east-1",
          status: "running",
          createdAt: new Date(Date.now() - 3000),
          urls: {
            vnc: "https://running-1-vnc.example.com",
            codeServer: "https://running-1-code.example.com",
            webServer: "https://running-1-web.example.com",
          },
          resourceLimits: { cpuLimit: "2", memoryLimit: "4g" },
        },
        {
          id: "running-2",
          serviceName: "ide-running-2",
          s3Bucket: "test-bucket",
          s3Region: "us-east-1",
          status: "running",
          createdAt: new Date(Date.now() - 2000),
          urls: {
            vnc: "https://running-2-vnc.example.com",
            codeServer: "https://running-2-code.example.com",
            webServer: "https://running-2-web.example.com",
          },
          resourceLimits: { cpuLimit: "2", memoryLimit: "4g" },
        },
        {
          id: "stopped-1",
          serviceName: "ide-stopped-1",
          s3Bucket: "test-bucket",
          s3Region: "us-east-1",
          status: "stopped",
          createdAt: new Date(Date.now() - 1000),
          urls: {
            vnc: "https://stopped-1-vnc.example.com",
            codeServer: "https://stopped-1-code.example.com",
            webServer: "https://stopped-1-web.example.com",
          },
          resourceLimits: { cpuLimit: "2", memoryLimit: "4g" },
        },
      ];

      containers.forEach((c) => stateManager.saveContainer(c));
    });

    it("should list all containers", () => {
      const containers = stateManager.listContainers();
      expect(containers).toHaveLength(3);
    });

    it("should filter containers by status", () => {
      const runningContainers = stateManager.listContainers({
        status: "running",
      });
      expect(runningContainers).toHaveLength(2);
      expect(runningContainers.every((c) => c.status === "running")).toBe(true);

      const stoppedContainers = stateManager.listContainers({
        status: "stopped",
      });
      expect(stoppedContainers).toHaveLength(1);
      expect(stoppedContainers[0].status).toBe("stopped");
    });

    it("should support pagination with limit and offset", () => {
      const page1 = stateManager.listContainers({ limit: 2 });
      expect(page1).toHaveLength(2);

      const page2 = stateManager.listContainers({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });

    it("should order by created_at DESC", () => {
      const containers = stateManager.listContainers();
      // Most recent first
      expect(containers[0].id).toBe("stopped-1");
      expect(containers[1].id).toBe("running-2");
      expect(containers[2].id).toBe("running-1");
    });
  });

  describe("getContainerCount", () => {
    beforeEach(() => {
      const containers: ContainerMetadata[] = [
        {
          id: "count-1",
          serviceName: "ide-count-1",
          s3Bucket: "test-bucket",
          s3Region: "us-east-1",
          status: "running",
          createdAt: new Date(),
          urls: {
            vnc: "https://count-1-vnc.example.com",
            codeServer: "https://count-1-code.example.com",
            webServer: "https://count-1-web.example.com",
          },
          resourceLimits: { cpuLimit: "2", memoryLimit: "4g" },
        },
        {
          id: "count-2",
          serviceName: "ide-count-2",
          s3Bucket: "test-bucket",
          s3Region: "us-east-1",
          status: "running",
          createdAt: new Date(),
          urls: {
            vnc: "https://count-2-vnc.example.com",
            codeServer: "https://count-2-code.example.com",
            webServer: "https://count-2-web.example.com",
          },
          resourceLimits: { cpuLimit: "2", memoryLimit: "4g" },
        },
        {
          id: "count-3",
          serviceName: "ide-count-3",
          s3Bucket: "test-bucket",
          s3Region: "us-east-1",
          status: "stopped",
          createdAt: new Date(),
          urls: {
            vnc: "https://count-3-vnc.example.com",
            codeServer: "https://count-3-code.example.com",
            webServer: "https://count-3-web.example.com",
          },
          resourceLimits: { cpuLimit: "2", memoryLimit: "4g" },
        },
      ];

      containers.forEach((c) => stateManager.saveContainer(c));
    });

    it("should count all containers", () => {
      const count = stateManager.getContainerCount();
      expect(count).toBe(3);
    });

    it("should count containers by status", () => {
      const runningCount = stateManager.getContainerCount("running");
      expect(runningCount).toBe(2);

      const stoppedCount = stateManager.getContainerCount("stopped");
      expect(stoppedCount).toBe(1);
    });
  });

  describe("archiveOldContainers", () => {
    it("should archive containers stopped for more than 24 hours", () => {
      const now = Date.now();
      const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;
      const twentyThreeHoursAgo = now - 23 * 60 * 60 * 1000;

      // Create old stopped container
      const oldContainer: ContainerMetadata = {
        id: "old-stopped",
        serviceName: "ide-old-stopped",
        s3Bucket: "test-bucket",
        s3Region: "us-east-1",
        status: "stopped",
        createdAt: new Date(twentyFiveHoursAgo),
        stoppedAt: new Date(twentyFiveHoursAgo),
        urls: {
          vnc: "https://old-stopped-vnc.example.com",
          codeServer: "https://old-stopped-code.example.com",
          webServer: "https://old-stopped-web.example.com",
        },
        resourceLimits: { cpuLimit: "2", memoryLimit: "4g" },
      };

      // Create recent stopped container
      const recentContainer: ContainerMetadata = {
        id: "recent-stopped",
        serviceName: "ide-recent-stopped",
        s3Bucket: "test-bucket",
        s3Region: "us-east-1",
        status: "stopped",
        createdAt: new Date(twentyThreeHoursAgo),
        stoppedAt: new Date(twentyThreeHoursAgo),
        urls: {
          vnc: "https://recent-stopped-vnc.example.com",
          codeServer: "https://recent-stopped-code.example.com",
          webServer: "https://recent-stopped-web.example.com",
        },
        resourceLimits: { cpuLimit: "2", memoryLimit: "4g" },
      };

      stateManager.saveContainer(oldContainer);
      stateManager.saveContainer(recentContainer);

      const archivedCount = stateManager.archiveOldContainers();
      expect(archivedCount).toBe(1);

      // Old container should be archived (not in main table)
      const oldRetrieved = stateManager.getContainer("old-stopped");
      expect(oldRetrieved).toBeNull();

      // Recent container should still be in main table
      const recentRetrieved = stateManager.getContainer("recent-stopped");
      expect(recentRetrieved).not.toBeNull();
    });

    it("should not archive running containers", () => {
      const now = Date.now();
      const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;

      const runningContainer: ContainerMetadata = {
        id: "old-running",
        serviceName: "ide-old-running",
        s3Bucket: "test-bucket",
        s3Region: "us-east-1",
        status: "running",
        createdAt: new Date(twentyFiveHoursAgo),
        urls: {
          vnc: "https://old-running-vnc.example.com",
          codeServer: "https://old-running-code.example.com",
          webServer: "https://old-running-web.example.com",
        },
        resourceLimits: { cpuLimit: "2", memoryLimit: "4g" },
      };

      stateManager.saveContainer(runningContainer);

      const archivedCount = stateManager.archiveOldContainers();
      expect(archivedCount).toBe(0);

      const retrieved = stateManager.getContainer("old-running");
      expect(retrieved).not.toBeNull();
    });
  });
});
