/**
 * Tests for secure headers and TLS configuration
 */

import { TraefikService } from "../traefikService.js";

describe("Secure Headers", () => {
  let traefikService: TraefikService;

  beforeEach(() => {
    traefikService = new TraefikService();
  });

  describe("Security Headers Middleware", () => {
    it("should apply security headers middleware to all routers", () => {
      const containerId = "test-container";
      const domain = "test.example.com";

      const labels = traefikService.generateTraefikLabels(containerId, domain);

      // Verify security headers middleware is applied to all routers
      expect(
        labels[`traefik.http.routers.vnc-${containerId}.middlewares`]
      ).toBe("security-headers@file");
      expect(
        labels[`traefik.http.routers.code-${containerId}.middlewares`]
      ).toBe("security-headers@file");
      expect(
        labels[`traefik.http.routers.web-${containerId}.middlewares`]
      ).toBe("security-headers@file");
    });
  });

  describe("HTTPS Configuration", () => {
    it("should configure all routers for HTTPS", () => {
      const containerId = "test-container";
      const domain = "test.example.com";

      const labels = traefikService.generateTraefikLabels(containerId, domain);

      // Verify all routers use websecure entrypoint
      expect(
        labels[`traefik.http.routers.vnc-${containerId}.entrypoints`]
      ).toBe("websecure");
      expect(
        labels[`traefik.http.routers.code-${containerId}.entrypoints`]
      ).toBe("websecure");
      expect(
        labels[`traefik.http.routers.web-${containerId}.entrypoints`]
      ).toBe("websecure");
    });

    it("should configure Let's Encrypt certificate resolver", () => {
      const containerId = "test-container";
      const domain = "test.example.com";

      const labels = traefikService.generateTraefikLabels(containerId, domain);

      // Verify all routers use Let's Encrypt
      expect(
        labels[`traefik.http.routers.vnc-${containerId}.tls.certresolver`]
      ).toBe("letsencrypt");
      expect(
        labels[`traefik.http.routers.code-${containerId}.tls.certresolver`]
      ).toBe("letsencrypt");
      expect(
        labels[`traefik.http.routers.web-${containerId}.tls.certresolver`]
      ).toBe("letsencrypt");
    });
  });

  describe("Service URLs", () => {
    it("should generate HTTPS URLs for all services", () => {
      const containerId = "test-container";
      const domain = "test.example.com";

      const urls = traefikService.generateServiceUrls(containerId, domain);

      expect(urls.vnc).toMatch(/^https:\/\//);
      expect(urls.codeServer).toMatch(/^https:\/\//);
      expect(urls.webServer).toMatch(/^https:\/\//);
    });

    it("should use correct subdomains for each service", () => {
      const containerId = "test-container";
      const domain = "test.example.com";

      const urls = traefikService.generateServiceUrls(containerId, domain);

      expect(urls.vnc).toBe(`https://${containerId}-vnc.${domain}`);
      expect(urls.codeServer).toBe(`https://${containerId}-code.${domain}`);
      expect(urls.webServer).toBe(`https://${containerId}-web.${domain}`);
    });
  });
});
