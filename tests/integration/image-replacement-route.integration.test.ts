import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthOptions } from "../../src/adapters/auth/index";
import { createPollPersistence } from "../../src/adapters/d1/index";
import { onRequest } from "../../src/middleware";
import { ALL as replaceImage } from "../../src/pages/creator/media/replace";
import type { PollPersistenceRows } from "../../src/modules/polls/index";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";

type AuthTestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
type MiddlewareContext = Parameters<typeof onRequest>[0];
const testEnv = env as AuthTestEnv;
const ORIGIN = "https://polls.example.test";
const ROUTE = `${ORIGIN}/creator/media/replace`;
const NOW = 1_784_000_000_000;
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function makeContext(request: Request): MiddlewareContext {
  return { request, params: {}, locals: {} } as unknown as MiddlewareContext;
}

async function dispatch(request: Request): Promise<Response> {
  const context = makeContext(request);
  return (await onRequest(
    context,
    (() => replaceImage(context as never)) as never,
  )) as Response;
}

async function actor() {
  const auth = betterAuth({
    ...createAuthOptions(testEnv),
    emailAndPassword: { enabled: true },
  });
  const email = `replace-route-${crypto.randomUUID()}@example.test`;
  const password = "integration-password-123";
  await auth.api.signUpEmail({
    body: { name: "Replace Route Actor", email, password },
  });
  const user = await testEnv.DB.prepare("SELECT id FROM user WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  if (!user) throw new Error("missing route actor");
  const signedIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = signedIn.headers.get("set-cookie");
  if (!cookie) throw new Error("missing route session");
  return { cookie, userId: user.id };
}

async function csrfFor(cookie: string): Promise<string> {
  const context = makeContext(
    new Request(`${ORIGIN}/creator`, { headers: { cookie } }),
  );
  await onRequest(context, (() => new Response("form")) as never);
  const token = context.locals.requestContext?.csrfToken?.value;
  if (!token) throw new Error("missing route CSRF token");
  return token;
}

async function seedImagePoll(ownerUserId: string) {
  const pollId = crypto.randomUUID();
  const optionId = crypto.randomUUID();
  const rows: PollPersistenceRows = {
    poll: {
      id: pollId as PollId,
      ownerUserId: ownerUserId as UserId,
      pollType: "image",
      question: "Choose an image",
      description: null,
      resultVisibility: "live",
      discoveryState: "unlisted",
      sessionChecksEnabled: true,
      ipChecksEnabled: false,
      voterCodesEnabled: false,
      captchaEnabled: false,
      vpnBlockingEnabled: false,
      commentsEnabled: false,
      multiSelectEnabled: false,
      minSelections: null,
      maxSelections: null,
      deadlineMs: null,
      representationVersion: 1,
      createdAtMs: NOW,
    },
    options: [
      {
        id: optionId as PollOptionId,
        pollId: pollId as PollId,
        label: "A",
        position: 0,
        createdAtMs: NOW,
      },
    ],
    reference: {
      reference: `replace-${pollId.slice(0, 8)}`,
      pollId: pollId as PollId,
      kind: "generated",
      createdAtMs: NOW,
    },
    media: [
      {
        id: crypto.randomUUID(),
        pollId: pollId as PollId,
        optionId: optionId as PollOptionId,
        r2Key: `tmp/${pollId}/media-original`,
        contentType: "image/jpeg",
        sizeBytes: 100,
        altText: "Original",
        caption: null,
        createdAtMs: NOW,
      },
    ],
  };
  await createPollPersistence(testEnv.DB).insertPoll(rows);
  return { pollId, optionId, originalKey: `tmp/${pollId}/media-original` };
}

function replacementRequest(
  cookie: string | null,
  csrfToken: string | null,
  pollId: string,
  optionId: string,
): Request {
  const form = new FormData();
  form.set("poll_id", pollId);
  form.set("option_id", optionId);
  form.set("alt_text", "Replacement image");
  form.set("caption", "Replacement caption");
  form.set(
    "media_file",
    new File([PNG_BYTES], "replacement.png", { type: "image/png" }),
  );
  if (csrfToken !== null) {
    form.set("csrf_token", csrfToken);
  }
  const headers: Record<string, string> = {
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
  };
  if (cookie !== null) {
    headers.cookie = cookie;
  }
  return new Request(ROUTE, { method: "POST", headers, body: form });
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM cleanup_outbox").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM media_object").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
});

describe("creator image replacement route", () => {
  it("replaces the option image and enqueues the superseded key", async () => {
    const { cookie, userId } = await actor();
    const { pollId, optionId, originalKey } = await seedImagePoll(userId);
    const csrfToken = await csrfFor(cookie);

    const response = await dispatch(
      replacementRequest(cookie, csrfToken, pollId, optionId),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/creator/polls/${pollId}`);

    const media = await testEnv.DB.prepare(
      "SELECT r2_key, content_type, alt_text, caption FROM media_object WHERE poll_id = ?1 AND option_id = ?2",
    )
      .bind(pollId, optionId)
      .first<{
        r2_key: string;
        content_type: string;
        alt_text: string;
        caption: string | null;
      }>();
    expect(media?.content_type).toBe("image/png");
    expect(media?.alt_text).toBe("Replacement image");
    expect(media?.caption).toBe("Replacement caption");
    expect(media?.r2_key).toMatch(new RegExp(`^tmp/${pollId}/`));
    expect(media?.r2_key).not.toBe(originalKey);
    // The adopted replacement object really landed in R2.
    expect(await testEnv.MEDIA.head(media!.r2_key)).not.toBeNull();

    const outbox = await testEnv.DB.prepare(
      "SELECT r2_key FROM cleanup_outbox",
    ).all<{ r2_key: string }>();
    expect(outbox.results).toEqual([{ r2_key: originalKey }]);
  });

  it("rejects replacement once a vote exists and drops the staged upload", async () => {
    const { cookie, userId } = await actor();
    const { pollId, optionId, originalKey } = await seedImagePoll(userId);
    await testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
      .bind(crypto.randomUUID(), pollId, crypto.randomUUID(), "hash", NOW)
      .run();
    const csrfToken = await csrfFor(cookie);

    const response = await dispatch(
      replacementRequest(cookie, csrfToken, pollId, optionId),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Locked");

    const media = await testEnv.DB.prepare(
      "SELECT r2_key FROM media_object WHERE poll_id = ?1 AND option_id = ?2",
    )
      .bind(pollId, optionId)
      .first<{ r2_key: string }>();
    expect(media?.r2_key).toBe(originalKey);
    expect(
      (await testEnv.DB.prepare("SELECT id FROM cleanup_outbox").all()).results,
    ).toEqual([]);
    // The staged but never-adopted temp object was removed, not orphaned.
    const leftovers = await testEnv.MEDIA.list({ prefix: `tmp/${pollId}/` });
    expect(leftovers.objects).toEqual([]);
  });

  it("redirects unauthenticated requests to sign-in", async () => {
    const { userId } = await actor();
    const { pollId, optionId } = await seedImagePoll(userId);

    const response = await dispatch(
      replacementRequest(null, null, pollId, optionId),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  it("rejects authenticated requests without the session CSRF token", async () => {
    const { cookie, userId } = await actor();
    const { pollId, optionId, originalKey } = await seedImagePoll(userId);

    const response = await dispatch(
      replacementRequest(cookie, null, pollId, optionId),
    );

    expect(response.status).toBe(403);
    const media = await testEnv.DB.prepare(
      "SELECT r2_key FROM media_object WHERE poll_id = ?1 AND option_id = ?2",
    )
      .bind(pollId, optionId)
      .first<{ r2_key: string }>();
    expect(media?.r2_key).toBe(originalKey);
    expect(
      (await testEnv.DB.prepare("SELECT id FROM cleanup_outbox").all()).results,
    ).toEqual([]);
  });
});
