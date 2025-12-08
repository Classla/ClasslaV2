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
   * For domain names: Uses subdomain-based routing (e.g., container-vnc.domain.com)
   * For IP addresses: Uses path-based routing (e.g., IP/vnc/container)
   *
   * @param containerId - Unique container identifier (URL-safe)
   * @param domain - Base domain for routing (e.g., "ide.example.com" or "5.161.59.175")
   * @returns Object containing Traefik labels
   */
  generateTraefikLabels(containerId: string, domain: string): TraefikLabels {
    // Determine if we're in local development (localhost domain) or using IP address
    const isLocal = domain === "localhost" || domain.endsWith(".localhost");
    const isIp = this.isIpAddress(domain);
    const usePathBased = isLocal || isIp;
    const entrypoints = usePathBased ? "web" : "web,websecure";

    const labels: TraefikLabels = {
      // Enable Traefik for this service
      "traefik.enable": "true",

      // Specify the Docker network to use
      "traefik.docker.network": "ide-network",
    };

    // Use path-based routing for IP addresses or localhost, subdomain routing for domain names
    if (usePathBased) {
      // Path-based routing for IP addresses and localhost
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
    } else {
      // Subdomain-based routing for domain names
      // noVNC service (port 6080)
      labels[`traefik.http.routers.vnc-${containerId}.rule`] = `Host(\`${containerId}-vnc.${domain}\`)`;
      labels[`traefik.http.routers.vnc-${containerId}.entrypoints`] = entrypoints;
      labels[`traefik.http.routers.vnc-${containerId}.service`] = `vnc-${containerId}`;
      labels[`traefik.http.services.vnc-${containerId}.loadbalancer.server.port`] = "6080";

      // code-server service (port 8080)
      labels[`traefik.http.routers.code-${containerId}.rule`] = `Host(\`${containerId}-code.${domain}\`)`;
      labels[`traefik.http.routers.code-${containerId}.entrypoints`] = entrypoints;
      labels[`traefik.http.routers.code-${containerId}.service`] = `code-${containerId}`;
      labels[`traefik.http.services.code-${containerId}.loadbalancer.server.port`] = "8080";

      // web server service (port 3000)
      labels[`traefik.http.routers.web-${containerId}.rule`] = `Host(\`${containerId}-web.${domain}\`)`;
      labels[`traefik.http.routers.web-${containerId}.entrypoints`] = entrypoints;
      labels[`traefik.http.routers.web-${containerId}.service`] = `web-${containerId}`;
      labels[`traefik.http.services.web-${containerId}.loadbalancer.server.port`] = "3000";
    }

    // Store domain and container ID
    labels["ide.domain"] = domain;
    labels["ide.container.id"] = containerId;

    // Add HTTPS/TLS configuration only for production domain names (not localhost or IP)
    if (!usePathBased) {
      labels[`traefik.http.routers.vnc-${containerId}.tls.certresolver`] =
        "letsencrypt";
      labels[`traefik.http.routers.code-${containerId}.tls.certresolver`] =
        "letsencrypt";
      labels[`traefik.http.routers.web-${containerId}.tls.certresolver`] =
        "letsencrypt";

      // Add security headers middleware only if it exists
      const existingMiddlewares = labels[`traefik.http.routers.vnc-${containerId}.middlewares`] || "";
      labels[`traefik.http.routers.vnc-${containerId}.middlewares`] =
        existingMiddlewares ? `${existingMiddlewares},security-headers@file` : "security-headers@file";
      const codeMiddlewares = labels[`traefik.http.routers.code-${containerId}.middlewares`] || "";
      labels[`traefik.http.routers.code-${containerId}.middlewares`] =
        codeMiddlewares ? `${codeMiddlewares},security-headers@file` : "security-headers@file";
      const webMiddlewares = labels[`traefik.http.routers.web-${containerId}.middlewares`] || "";
      labels[`traefik.http.routers.web-${containerId}.middlewares`] =
        webMiddlewares ? `${webMiddlewares},security-headers@file` : "security-headers@file";
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
    // Determine if we're using IP address or localhost (use path-based routing)
    const isLocal = domain === "localhost" || domain.endsWith(".localhost");
    const isIp = this.isIpAddress(domain);
    const usePathBased = isLocal || isIp;
    
    // Use HTTP for localhost/IP addresses, HTTPS for domain names
    const protocol = usePathBased ? "http" : "https";

    if (usePathBased) {
      // Path-based URLs for IP addresses and localhost
      return {
        vnc: `${protocol}://${domain}/vnc/${containerId}`,
        codeServer: `${protocol}://${domain}/code/${containerId}`,
        webServer: `${protocol}://${domain}/web/${containerId}`,
      };
    } else {
      // Subdomain-based URLs for domain names
      return {
        vnc: `${protocol}://${containerId}-vnc.${domain}`,
        codeServer: `${protocol}://${containerId}-code.${domain}`,
        webServer: `${protocol}://${containerId}-web.${domain}`,
      };
    }
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
