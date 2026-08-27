import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";

export interface WorkerEnv {
  ASSETS: Fetcher;
  BASIC_AUTH_PASSWORD: string;
  BASIC_AUTH_USERNAME: string;
}

type HonoEnvironment = {
  Bindings: WorkerEnv;
};

function requireBasicAuthConfiguration(env: WorkerEnv): void {
  if (!env.BASIC_AUTH_USERNAME || !env.BASIC_AUTH_PASSWORD) {
    throw new Error("Required Basic authentication configuration is missing.");
  }
}

export function createApp(env: WorkerEnv): Hono<HonoEnvironment> {
  requireBasicAuthConfiguration(env);

  const app = new Hono<HonoEnvironment>();

  app.use(
    "*",
    basicAuth({
      password: env.BASIC_AUTH_PASSWORD,
      username: env.BASIC_AUTH_USERNAME,
    }),
  );

  app.notFound((context) => context.env.ASSETS.fetch(context.req.raw));

  return app;
}

export default {
  fetch(request, env, executionContext) {
    return createApp(env).fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<WorkerEnv>;
