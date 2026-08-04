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

  /**
   * Turnstile binding contract (Story 2.3).
   * - TURNSTILE_SITE_KEY is public configuration (may appear in vote-page HTML).
   * - TURNSTILE_SECRET_KEY is a server-only Worker secret — never client markup,
   *   bundled scripts, errors, or generated data attributes.
   */
  interface TurnstileBindings {
    TURNSTILE_SITE_KEY: string;
    TURNSTILE_SECRET_KEY: string;
  }

  interface DemoPollBindings {
    /** Public, server-owned canonical Custom Link for the landing Demo. */
    DEMO_POLL_REFERENCE: string;
  }

  namespace App {
    interface Locals extends Runtime {
      requestContext?: RequestContext;
      principal?: CreatorPrincipal | null;
    }
  }

  namespace Cloudflare {
    interface Env extends AuthBindings, TurnstileBindings, DemoPollBindings {}
    interface StagingEnv extends AuthBindings, TurnstileBindings, DemoPollBindings {}
    interface ProductionEnv extends AuthBindings, TurnstileBindings, DemoPollBindings {}
  }

  interface Env extends AuthBindings, TurnstileBindings, DemoPollBindings {
    DB: D1Database;
    MEDIA: R2Bucket;
    ASSETS: Fetcher;
    /** Cloudflare Images binding (adapter default); not R2. */
    IMAGES?: ImagesBinding;
    // SESSION and VOTE_RATE_LIMITER are declared required by
    // worker-configuration.d.ts (`wrangler types`); redeclaring them optional
    // here would be a TS2430 conflict in the merged global Env. Test/local
    // runtimes that cannot emulate them keep the optionality at the
    // consumption sites instead.
  }
}

export {};
