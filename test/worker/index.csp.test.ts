import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "../../src/worker/index";

describe("buildContentSecurityPolicy", () => {
  it("keeps script-src strict for the production build (isDevOnly=false)", () => {
    const csp = buildContentSecurityPolicy(false);

    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("relaxes only script-src for the Vite dev server (isDevOnly=true)", () => {
    const csp = buildContentSecurityPolicy(true);

    // @vitejs/plugin-react のFast Refreshプリアンブルを許可するための緩和。
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("always restricts img-src to self, data:, and the R2 signed-URL host", () => {
    for (const isDevOnly of [true, false]) {
      const csp = buildContentSecurityPolicy(isDevOnly);
      expect(csp).toContain(
        "img-src 'self' data: https://*.r2.cloudflarestorage.com",
      );
    }
  });

  it("always sets object-src 'none' and base-uri 'self'", () => {
    for (const isDevOnly of [true, false]) {
      const csp = buildContentSecurityPolicy(isDevOnly);
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
    }
  });
});
