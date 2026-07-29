/**
 * Minimal Worker entrypoint for the workerd test pool.
 * Application code is imported directly in tests; this satisfies the pool main.
 */
export default {
  async fetch(): Promise<Response> {
    return new Response("oddspark-polls integration pool", { status: 200 });
  },
};
