/**
 * Minimal shim for Astro's virtual "astro:middleware" module so the real
 * src/middleware.ts chain can run under the workerd test pool.
 * Semantics match Astro: defineMiddleware is identity; sequence composes
 * each middleware around the next.
 */

type Next = () => Promise<Response> | Response;
type MiddlewareFn = (context: unknown, next: Next) => Promise<Response> | Response;

export function defineMiddleware(fn: MiddlewareFn): MiddlewareFn {
  return fn;
}

export function sequence(
  ...fns: MiddlewareFn[]
): (context: unknown, next: Next) => Promise<Response> {
  return async function chained(context: unknown, next: Next): Promise<Response> {
    let index = -1;
    const dispatch = async (i: number): Promise<Response> => {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;
      const fn = fns[i];
      if (!fn) return next();
      return fn(context, () => dispatch(i + 1));
    };
    return dispatch(0);
  };
}
