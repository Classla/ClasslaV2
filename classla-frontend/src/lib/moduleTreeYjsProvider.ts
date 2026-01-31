import * as Y from "yjs";
import { Socket, io } from "socket.io-client";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

export interface Assignment {
  id: string;
  name: string;
  module_path: string[];
  order_index: number;
  publish_times: Record<string, string>;
  due_dates_map: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: string;
  name: string;
  path: string[];
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ModuleTreeData {
  assignments: Map<string, Assignment>;
  folders: Map<string, Folder>;
  lastUpdate: number;
}

export type ModuleTreeChangeListener = (data: ModuleTreeData) => void;

/**
 * YJS Provider for Module Tree
 * Handles real-time synchronization of assignments and folders
 */
export class ModuleTreeYjsProvider {
  private socket: Socket | null = null;
  private doc: Y.Doc | null = null;
  private courseId: string | null = null;
  private templateId: string | null = null;
  private changeListeners: Set<ModuleTreeChangeListener> = new Set();
  private isSubscribed = false;

  constructor() {
    // Initialize socket connection
    this.initializeSocket();
  }

  /**
   * Initialize Socket.IO connection
   */
  private initializeSocket(): void {
    this.socket = io(`${BACKEND_URL}/yjs`, {
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on("connect", () => {
      console.log("[ModuleTreeYjs] Connected to server");
      // Resubscribe if we were subscribed before
      if (this.isSubscribed && (this.courseId || this.templateId)) {
        this.resubscribe();
      }
    });

    this.socket.on("disconnect", (reason) => {
      console.log("[ModuleTreeYjs] Disconnected from server:", reason);
    });

    this.socket.on("module-tree-state", (data: { docId: string; courseId?: string; templateId?: string; state: string }) => {
      console.log("[ModuleTreeYjs] Received initial module tree state", {
        docId: data.docId,
        courseId: data.courseId,
        templateId: data.templateId,
      });

      if (!this.doc) {
        this.doc = new Y.Doc();
      }

      // Apply initial state
      const stateUpdate = Uint8Array.from(atob(data.state), (c) => c.charCodeAt(0));
      Y.applyUpdate(this.doc, stateUpdate, "server");

      // Notify listeners
      this.notifyListeners();
    });

    this.socket.on("module-tree-update", (data: { docId: string; courseId?: string; templateId?: string; update: string }) => {
      console.log("[ModuleTreeYjs] Received module tree update", {
        docId: data.docId,
        courseId: data.courseId,
        templateId: data.templateId,
      });

      if (!this.doc) {
        console.warn("[ModuleTreeYjs] Received update before document initialized");
        return;
      }

      // Apply update
      const update = Uint8Array.from(atob(data.update), (c) => c.charCodeAt(0));
      Y.applyUpdate(this.doc, update, "server");

      // Notify listeners
      this.notifyListeners();
    });

    this.socket.on("error", (error: { message: string }) => {
      console.error("[ModuleTreeYjs] Server error:", error);
    });
  }

  /**
   * Subscribe to module tree for a course or template
   */
  public subscribe(courseId?: string, templateId?: string): void {
    if (!this.socket) {
      console.error("[ModuleTreeYjs] Socket not initialized");
      return;
    }

    if (!courseId && !templateId) {
      console.error("[ModuleTreeYjs] Must provide either courseId or templateId");
      return;
    }

    this.courseId = courseId || null;
    this.templateId = templateId || null;
    this.isSubscribed = true;

    console.log("[ModuleTreeYjs] Subscribing to module tree", { courseId, templateId });

    this.socket.emit("subscribe-module-tree", { courseId, templateId });
  }

  /**
   * Resubscribe after reconnection
   */
  private resubscribe(): void {
    if (!this.courseId && !this.templateId) return;

    console.log("[ModuleTreeYjs] Resubscribing to module tree", {
      courseId: this.courseId,
      templateId: this.templateId,
    });

    this.socket?.emit("subscribe-module-tree", {
      courseId: this.courseId,
      templateId: this.templateId,
    });
  }

  /**
   * Unsubscribe from module tree
   */
  public unsubscribe(): void {
    if (!this.socket || !this.isSubscribed) return;

    console.log("[ModuleTreeYjs] Unsubscribing from module tree");

    this.socket.emit("unsubscribe-module-tree", {
      courseId: this.courseId,
      templateId: this.templateId,
    });

    this.isSubscribed = false;
    this.courseId = null;
    this.templateId = null;
    this.doc = null;
  }

  /**
   * Get current module tree data
   */
  public getModuleTreeData(): ModuleTreeData | null {
    if (!this.doc) return null;

    const assignmentsMap = this.doc.getMap("assignments");
    const foldersMap = this.doc.getMap("folders");
    const metadataMap = this.doc.getMap("metadata");

    const assignments = new Map<string, Assignment>();
    const folders = new Map<string, Folder>();

    // Convert Y.Map to regular Map for assignments
    assignmentsMap.forEach((value, key) => {
      if (value instanceof Y.Map) {
        const assignment: Assignment = {
          id: value.get("id") as string,
          name: value.get("name") as string,
          module_path: value.get("module_path") as string[],
          order_index: value.get("order_index") as number,
          publish_times: value.get("publish_times") as Record<string, string>,
          due_dates_map: value.get("due_dates_map") as Record<string, string>,
          created_at: value.get("created_at") as string,
          updated_at: value.get("updated_at") as string,
        };
        assignments.set(key, assignment);
      }
    });

    // Convert Y.Map to regular Map for folders
    foldersMap.forEach((value, key) => {
      if (value instanceof Y.Map) {
        const folder: Folder = {
          id: value.get("id") as string,
          name: value.get("name") as string,
          path: value.get("path") as string[],
          order_index: value.get("order_index") as number,
          created_at: value.get("created_at") as string,
          updated_at: value.get("updated_at") as string,
        };
        folders.set(key, folder);
      }
    });

    return {
      assignments,
      folders,
      lastUpdate: (metadataMap.get("lastUpdate") as number) || Date.now(),
    };
  }

  /**
   * Add change listener
   */
  public onChange(listener: ModuleTreeChangeListener): () => void {
    this.changeListeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of changes
   */
  private notifyListeners(): void {
    const data = this.getModuleTreeData();
    if (!data) return;

    this.changeListeners.forEach((listener) => {
      try {
        listener(data);
      } catch (error) {
        console.error("[ModuleTreeYjs] Error in change listener:", error);
      }
    });
  }

  /**
   * Disconnect and cleanup
   */
  public disconnect(): void {
    this.unsubscribe();
    this.changeListeners.clear();

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

// Singleton instance
let moduleTreeProviderInstance: ModuleTreeYjsProvider | null = null;

/**
 * Get the module tree YJS provider instance
 */
export function getModuleTreeYjsProvider(): ModuleTreeYjsProvider {
  if (!moduleTreeProviderInstance) {
    moduleTreeProviderInstance = new ModuleTreeYjsProvider();
  }
  return moduleTreeProviderInstance;
}
