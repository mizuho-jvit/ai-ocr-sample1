import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * 🟡 Intent: Worker と SPA でランタイムが異なるため、Vitest のプロジェクトを分ける。
 * `cloudflareTest()` を全体へ適用すると SPA のテストも workerd 上で動き、DOM が無いため
 * 描画テストが書けない。逆に SPA 側へ workerd プールを適用しない限り、Worker テストが
 * 使う D1・R2 バインディングは得られない。include はディレクトリで完全に分離する。
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./drizzle");

  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              miniflare: {
                bindings: { TEST_MIGRATIONS: migrations },
              },
              wrangler: {
                configPath: "./wrangler.toml",
              },
            }),
          ],
          test: {
            include: ["test/worker/**/*.test.ts"],
            name: "worker",
          },
        },
        {
          plugins: [react()],
          test: {
            environment: "happy-dom",
            include: ["test/react-app/**/*.test.{ts,tsx}"],
            name: "react-app",
            setupFiles: ["./test/react-app/test-setup.ts"],
          },
        },
      ],
    },
  };
});
