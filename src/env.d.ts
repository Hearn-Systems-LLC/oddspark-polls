/// <reference types="astro/client" />

import type { RequestContext } from "./lib/request-context";
import type { CreatorPrincipal } from "./modules/identity/index";

type Runtime = import("@astrojs/cloudflare").Runtime;

declare global {
  interface AuthBindings {
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    VOTE_DIGEST_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
  }

  namespace App {
    interface Locals extends Runtime {
      requestContext?: RequestContext;
      principal?: CreatorPrincipal | null;
    }
  }

  namespace Cloudflare {
    interface Env extends AuthBindings {}
    interface StagingEnv extends AuthBindings {}
    interface ProductionEnv extends AuthBindings {}
  }

  interface Env extends AuthBindings {
    DB: D1Database;
    MEDIA: R2Bucket;
    ASSETS: Fetcher;
    /** Optional only for test/local runtimes that cannot emulate this binding. */
    VOTE_RATE_LIMITER?: RateLimit;
    /** Cloudflare Images binding (adapter default); not R2. */
    IMAGES?: ImagesBinding;
    SESSION?: KVNamespace;
  }
}

export {};
