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
   * Check if a domain string is an IP address
   */
  private isIpAddress(domain: string): boolean {
    // IPv4 pattern
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6 pattern (simplified)
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    return ipv4Pattern.test(domain) || ipv6Pattern.test(domain);
  }

  /**
   * Generate Traefik labels for dynamic routing of IDE container services
   *
   * Creates routing rules for three services:
   * - noVNC (port 6080): Remote desktop access
   * - code-server (port 8080): VS Code web interface
   * - web server (port 3000): In-container web server
   *
   * Always uses path-based routing (e.g., domain.com/code/containerId)
   *
   * @param containerId - Unique container identifier (URL-safe)
   * @param domain - Base domain for routing (e.g., "ide.example.com" or "5.161.59.175")
   * @returns Object containing Traefik labels
   */
  generateTraefikLabels(containerId: string, domain: string): TraefikLabels {
    // Determine if we're in local development (localhost domain) or using IP address
    const isLocal = domain === "localhost" || domain.endsWith(".localhost");
    const isIp = this.isIpAddress(domain);
    const useHttp = isLocal || isIp;
    const entrypoints = useHttp ? "web" : "web,websecure";

    const labels: TraefikLabels = {
      // Enable Traefik for this service
      "traefik.enable": "true",
      // Note: traefik.docker.network is not needed - Traefik uses the network specified
      // in --providers.docker.network command line argument
    };

    // Always use path-based routing
    // Set high priority so IDE container routes are matched before management-api catch-all
    const priority = 10;
    
    // noVNC service (port 6080)
    labels[`traefik.http.routers.vnc-${containerId}.rule`] = `PathPrefix(\`/vnc/${containerId}\`) || PathPrefix(\`/vnc/${containerId}/\`)`;
    labels[`traefik.http.routers.vnc-${containerId}.entrypoints`] = entrypoints;
    labels[`traefik.http.routers.vnc-${containerId}.priority`] = String(priority);
    labels[`traefik.http.routers.vnc-${containerId}.service`] = `vnc-${containerId}`;
    labels[`traefik.http.services.vnc-${containerId}.loadbalancer.server.port`] = "6080";
    labels[`traefik.http.middlewares.vnc-${containerId}-strip.stripprefix.prefixes`] = `/vnc/${containerId}`;
    labels[`traefik.http.routers.vnc-${containerId}.middlewares`] = `vnc-${containerId}-strip`;

    // code-server service (port 8080)
    labels[`traefik.http.routers.code-${containerId}.rule`] = `PathPrefix(\`/code/${containerId}\`) || PathPrefix(\`/code/${containerId}/\`)`;
    labels[`traefik.http.routers.code-${containerId}.entrypoints`] = entrypoints;
    labels[`traefik.http.routers.code-${containerId}.priority`] = String(priority);
    labels[`traefik.http.routers.code-${containerId}.service`] = `code-${containerId}`;
    labels[`traefik.http.services.code-${containerId}.loadbalancer.server.port`] = "8080";
    labels[`traefik.http.middlewares.code-${containerId}-strip.stripprefix.prefixes`] = `/code/${containerId}`;
    labels[`traefik.http.routers.code-${containerId}.middlewares`] = `code-${containerId}-strip`;

    // web server service (port 3000)
    labels[`traefik.http.routers.web-${containerId}.rule`] = `PathPrefix(\`/web/${containerId}\`) || PathPrefix(\`/web/${containerId}/\`)`;
    labels[`traefik.http.routers.web-${containerId}.entrypoints`] = entrypoints;
    labels[`traefik.http.routers.web-${containerId}.priority`] = String(priority);
    labels[`traefik.http.routers.web-${containerId}.service`] = `web-${containerId}`;
    labels[`traefik.http.services.web-${containerId}.loadbalancer.server.port`] = "3000";
    labels[`traefik.http.middlewares.web-${containerId}-strip.stripprefix.prefixes`] = `/web/${containerId}`;
    labels[`traefik.http.routers.web-${containerId}.middlewares`] = `web-${containerId}-strip`;

    // Store domain and container ID
    labels["ide.domain"] = domain;
    labels["ide.container.id"] = containerId;

    // Add HTTPS/TLS configuration for domain names (not localhost or IP)
    if (!useHttp) {
      labels[`traefik.http.routers.vnc-${containerId}.tls.certresolver`] =
        "letsencrypt";
      labels[`traefik.http.routers.code-${containerId}.tls.certresolver`] =
        "letsencrypt";
      labels[`traefik.http.routers.web-${containerId}.tls.certresolver`] =
        "letsencrypt";
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
   * Always uses path-based routing (e.g., domain.com/code/containerId)
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
    // Determine if we're using IP address or localhost
    const isLocal = domain === "localhost" || domain.endsWith(".localhost");
    const isIp = this.isIpAddress(domain);
    
    // Use HTTP for localhost/IP addresses, HTTPS for domain names
    const protocol = (isLocal || isIp) ? "http" : "https";

    // Always use path-based URLs
    return {
      vnc: `${protocol}://${domain}/vnc/${containerId}`,
      codeServer: `${protocol}://${domain}/code/${containerId}`,
      webServer: `${protocol}://${domain}/web/${containerId}`,
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
