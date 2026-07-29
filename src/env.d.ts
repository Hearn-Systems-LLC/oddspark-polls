/// <reference types="astro/client" />

import type { RequestContext } from "./lib/request-context";

type Runtime = import("@astrojs/cloudflare").Runtime;

declare global {
  namespace App {
    interface Locals extends Runtime {
      requestContext?: RequestContext;
    }
  }

  interface Env {
    DB: D1Database;
    MEDIA: R2Bucket;
    ASSETS: Fetcher;
    /** Cloudflare Images binding (adapter default); not R2. */
    IMAGES?: ImagesBinding;
    SESSION?: KVNamespace;
  }
}

export {};
