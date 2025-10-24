/**
 * TraefikService - Handles Traefik label generation for dynamic routing
 *
 * This service generates Docker labels that Traefik uses to automatically
 * configure routing rules for IDE container services.
 */

export interface TraefikLabels {
  [key: string]: string;
}

export class TraefikService {
  /**
   * Generate Traefik labels for dynamic routing of IDE container services
   *
   * Creates routing rules for three services:
   * - noVNC (port 6080): Remote desktop access
   * - code-server (port 8080): VS Code web interface
   * - web server (port 3000): In-container web server
   *
   * All services are configured with:
   * - HTTPS via Let's Encrypt
   * - Unique subdomains based on container ID
   * - Automatic SSL/TLS certificate generation
   *
   * @param containerId - Unique container identifier (URL-safe)
   * @param domain - Base domain for routing (e.g., "ide.example.com")
   * @returns Object containing Traefik labels
   */
  generateTraefikLabels(containerId: string, domain: string): TraefikLabels {
    // Determine if we're in local development (localhost domain)
    const isLocal = domain === "localhost" || domain.endsWith(".localhost");
    const entrypoints = isLocal ? "web" : "web,websecure";

    const labels: TraefikLabels = {
      // Enable Traefik for this service
      "traefik.enable": "true",

      // Specify the Docker network to use
      "traefik.docker.network": "ide-network",

      // noVNC service (port 6080) - Remote desktop access
      [`traefik.http.routers.vnc-${containerId}.rule`]: `Host(\`${containerId}-vnc.${domain}\`)`,
      [`traefik.http.routers.vnc-${containerId}.entrypoints`]: entrypoints,
      [`traefik.http.routers.vnc-${containerId}.service`]: `vnc-${containerId}`,
      [`traefik.http.services.vnc-${containerId}.loadbalancer.server.port`]:
        "6080",

      // code-server service (port 8080) - VS Code web interface
      [`traefik.http.routers.code-${containerId}.rule`]: `Host(\`${containerId}-code.${domain}\`)`,
      [`traefik.http.routers.code-${containerId}.entrypoints`]: entrypoints,
      [`traefik.http.routers.code-${containerId}.service`]: `code-${containerId}`,
      [`traefik.http.services.code-${containerId}.loadbalancer.server.port`]:
        "8080",

      // web server service (port 3000) - In-container web server
      [`traefik.http.routers.web-${containerId}.rule`]: `Host(\`${containerId}-web.${domain}\`)`,
      [`traefik.http.routers.web-${containerId}.entrypoints`]: entrypoints,
      [`traefik.http.routers.web-${containerId}.service`]: `web-${containerId}`,
      [`traefik.http.services.web-${containerId}.loadbalancer.server.port`]:
        "3000",

      // Store domain for later retrieval
      "ide.domain": domain,

      // Store container ID for identification
      "ide.container.id": containerId,
    };

    // Add HTTPS/TLS configuration only for production (non-localhost)
    if (!isLocal) {
      labels[`traefik.http.routers.vnc-${containerId}.tls.certresolver`] =
        "letsencrypt";
      labels[`traefik.http.routers.code-${containerId}.tls.certresolver`] =
        "letsencrypt";
      labels[`traefik.http.routers.web-${containerId}.tls.certresolver`] =
        "letsencrypt";

      // Add security headers middleware only if it exists
      labels[`traefik.http.routers.vnc-${containerId}.middlewares`] =
        "security-headers@file";
      labels[`traefik.http.routers.code-${containerId}.middlewares`] =
        "security-headers@file";
      labels[`traefik.http.routers.web-${containerId}.middlewares`] =
        "security-headers@file";
    }

    return labels;
  }

  /**
   * Extract domain from Traefik labels
   *
   * @param labels - Docker service labels
   * @returns Domain name or "localhost" as fallback
   */
  extractDomainFromLabels(labels: Record<string, string>): string {
    return labels["ide.domain"] || "localhost";
  }

  /**
   * Extract container ID from Traefik labels
   *
   * @param labels - Docker service labels
   * @returns Container ID or empty string if not found
   */
  extractContainerIdFromLabels(labels: Record<string, string>): string {
    return labels["ide.container.id"] || "";
  }

  /**
   * Generate URLs for all container services
   *
   * @param containerId - Unique container identifier
   * @param domain - Base domain for routing
   * @returns Object containing URLs for all services
   */
  generateServiceUrls(
    containerId: string,
    domain: string
  ): {
    vnc: string;
    codeServer: string;
    webServer: string;
  } {
    // Use HTTP for localhost domains, HTTPS for production
    const isLocal = domain === "localhost" || domain.endsWith(".localhost");
    const protocol = isLocal ? "http" : "https";

    return {
      vnc: `${protocol}://${containerId}-vnc.${domain}`,
      codeServer: `${protocol}://${containerId}-code.${domain}`,
      webServer: `${protocol}://${containerId}-web.${domain}`,
    };
  }

  /**
   * Validate that a container ID is suitable for use in URLs and DNS
   *
   * Container IDs must be:
   * - Lowercase alphanumeric
   * - May contain hyphens (but not at start/end)
   * - Between 4 and 32 characters
   *
   * @param containerId - Container ID to validate
   * @returns true if valid, false otherwise
   */
  validateContainerId(containerId: string): boolean {
    // DNS-compatible: lowercase alphanumeric and hyphens, not starting/ending with hyphen
    const dnsPattern = /^[a-z0-9]([a-z0-9-]{2,30}[a-z0-9])?$/;
    return dnsPattern.test(containerId);
  }
}
