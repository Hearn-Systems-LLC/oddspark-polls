// Creator-only pre-Vote image replacement command (Story 6.3 / AC 4).
// The narrowest inbound adapter over the Media module's replaceOptionImage:
// multipart form in, one guarded D1 batch out. No public surface — the
// middleware chain owns session, same-origin/CSRF token, and creator guard
// for every /creator/* POST.

import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createMediaPersistence } from "../../../adapters/d1/index";
import { replaceOptionImage } from "../../../modules/media/index";
import { isUuidShape } from "../../../modules/polls/index";
import {
  IMAGE_UPLOAD_CAPS,
  IMAGE_UPLOAD_COPY,
  validateImageUpload,
} from "../../../modules/polls/image-upload";
import { IMAGE_DEFINITION_COPY } from "../../../modules/polls/types/image";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../../shared/domain/index";

const NO_STORE = "private, no-store";

function reject(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": NO_STORE,
    },
  });
}

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
    return reject(422, "Unreadable form submission.");
  }

  const pollId = String(formData.get("poll_id") ?? "");
  const optionId = String(formData.get("option_id") ?? "");
  const altText = String(formData.get("alt_text") ?? "").trim();
  const caption = String(formData.get("caption") ?? "").trim();
  const file = formData.get("media_file");

  if (
    !isUuidShape(pollId) ||
    !isUuidShape(optionId) ||
    !(file instanceof File)
  ) {
    return reject(422, "Invalid image replacement submission.");
  }
  if (altText.length === 0) {
    return reject(422, IMAGE_DEFINITION_COPY.altTextMissing);
  }
  if (altText.length > IMAGE_UPLOAD_CAPS.maxAltTextLength) {
    return reject(422, IMAGE_UPLOAD_COPY.altTextTooLong);
  }
  if (caption.length > IMAGE_UPLOAD_CAPS.maxCaptionLength) {
    return reject(422, IMAGE_UPLOAD_COPY.captionTooLong);
  }

  const validation = await validateImageUpload(file);
  if (!validation.ok) {
    return reject(422, validation.error);
  }

  // Stage the replacement at a scoped temp key first; the D1 batch below
  // adopts it and enqueues the superseded key in the same transaction.
  const r2Key = `tmp/${pollId}/${crypto.randomUUID()}`;
  try {
    await env.MEDIA.put(r2Key, file.stream(), {
      httpMetadata: { contentType: validation.contentType },
    });
  } catch {
    return reject(500, IMAGE_UPLOAD_COPY.uploadFailed(file.name || "The image"));
  }

  const persistence = createMediaPersistence(env.DB);
  const result = await replaceOptionImage(
    {
      replaceOptionImage: (input) => persistence.replaceOptionImage(input),
      nowMs: () => Date.now(),
    },
    {
      pollId: pollId as PollId,
      ownerUserId: principal.userId as UserId,
      optionId: optionId as PollOptionId,
      r2Key,
      contentType: validation.contentType,
      sizeBytes: validation.sizeBytes,
      altText,
      caption: caption || null,
    },
  );

  if (result.ok) {
    if (requestContext) {
      requestContext.pollId = pollId;
    }
    return new Response(null, {
      status: 303,
      headers: {
        location: `/creator/polls/${pollId}`,
        "cache-control": NO_STORE,
      },
    });
  }

  // The replacement never committed — drop the unadopted temp object now
  // rather than leaving it for the 24-hour sweeper.
  try {
    await env.MEDIA.delete(r2Key);
  } catch {
    // Best effort: the sweeper owns the fallback.
  }

  if (result.error.code === "image_replacement_locked") {
    return reject(422, result.error.message);
  }
  if (result.error.code === "image_not_found") {
    return reject(404, result.error.message);
  }
  return reject(500, result.error.message);
};
