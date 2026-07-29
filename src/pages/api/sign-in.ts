import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { createAuth } from "../../adapters/auth/index";
import { createSignInDestinations } from "../../modules/identity/index";

const signInRequestSchema = z.object({
  provider: z.enum(["google", "github"]),
  // Length is capped inside validateReturnAddress (raw + normalized forms)
  // so every invalid value takes the same /creator fallback path.
  return: z.string().optional(),
});

function errorResponse(code: string, status: number): Response {
  return Response.json(
    { code },
    {
      status,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

export const POST: APIRoute = async ({ request }) => {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("invalid_sign_in_request", 422);
  }

  const parsed = signInRequestSchema.safeParse({
    provider: formData.get("provider"),
    return: formData.get("return") ?? undefined,
  });
  if (!parsed.success) {
    return errorResponse("invalid_sign_in_request", 422);
  }

  const destinations = createSignInDestinations(parsed.data.return);
  let authResult;
  try {
    authResult = await createAuth(env).api.signInSocial({
      body: {
        provider: parsed.data.provider,
        callbackURL: destinations.callbackURL,
        errorCallbackURL: destinations.errorCallbackURL,
        disableRedirect: true,
      },
      headers: request.headers,
      returnHeaders: true,
    });
  } catch {
    return errorResponse("sign_in_unavailable", 502);
  }
  const location = authResult.response.url;
  if (!location) {
    return errorResponse("sign_in_unavailable", 502);
  }

  const headers = new Headers({
    "cache-control": "no-store",
    location,
  });
  for (const cookie of authResult.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }

  return new Response(null, {
    status: 303,
    headers,
  });
};
