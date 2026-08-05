import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createCommentModerationPersistence } from "../../../adapters/d1/index";
import { parseCommentModerationForm } from "../../../lib/comment-moderation-form";
import {
  COMMENT_COPY,
  deleteCommentAsAdministrator,
  deleteCommentAsOwner,
  type CommentModerationActor,
} from "../../../modules/comments/index";
import type { UserId } from "../../../shared/domain/index";

const NO_STORE = "private, no-store";

export const ALL: APIRoute = async ({ request, locals }) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed.", {
      status: 405,
      headers: { allow: "POST", "cache-control": NO_STORE },
    });
  }

  const requestContext = locals.requestContext;
  const principal = requestContext?.principal ?? locals.principal ?? null;
  if (!principal) {
    return new Response(null, {
      status: 303,
      headers: {
        location: "/sign-in?return=%2Fcreator",
        "cache-control": NO_STORE,
      },
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response("Unreadable form submission.", {
      status: 422,
      headers: { "cache-control": NO_STORE },
    });
  }
  const parsed = parseCommentModerationForm(formData);
  if (!parsed.ok) {
    return new Response("Invalid Comment moderation submission.", {
      status: 422,
      headers: { "cache-control": NO_STORE },
    });
  }

  const persistence = createCommentModerationPersistence(env.DB);
  const deps = {
    deleteComment:
      parsed.value.mode === "owner"
        ? persistence.deleteForOwner
        : persistence.deleteForAdministrator,
    nowMs: () => Date.now(),
  };
  const result =
    parsed.value.mode === "owner"
      ? await deleteCommentAsOwner(
          deps,
          principal.userId as UserId,
          parsed.value.commentId,
        )
      : await deleteCommentAsAdministrator(
          deps,
          {
            userId: principal.userId as UserId,
            role: principal.role,
          } satisfies CommentModerationActor,
          parsed.value.commentId,
        );

  if (result.ok) {
    if (requestContext) {
      requestContext.pollId = result.value.pollId;
    }
    const encodedReference = encodeURIComponent(
      result.value.canonicalReference,
    );
    const location =
      parsed.value.mode === "administrator"
        ? `/creator/moderation?target=${encodedReference}`
        : `/${encodedReference}/results`;
    return new Response(null, {
      status: 303,
      headers: { location, "cache-control": NO_STORE },
    });
  }

  if (result.error.code === "authorization_denied") {
    if (requestContext) {
      requestContext.authorizationDenied = true;
    }
    return new Response(COMMENT_COPY.accessRequired, {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": NO_STORE,
      },
    });
  }
  if (result.error.code === "comment_not_found") {
    return new Response(COMMENT_COPY.notFound, {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": NO_STORE,
      },
    });
  }
  return new Response(COMMENT_COPY.failed, {
    status: 500,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": NO_STORE,
    },
  });
};
