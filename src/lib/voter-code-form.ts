// Strict form parser for Voter Code generation (Story 8.1).
// Accepts only csrf_token, intent=generate, count, and one canonical
// lowercase UUID batch_id. Rejects duplicate keys, File values, unknown
// keys, malformed/non-integer counts, and non-canonical batch IDs.

const ALLOWED_KEYS = new Set(["csrf_token", "intent", "count", "batch_id"]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ParsedVoterCodeForm = {
  csrfToken: string;
  intent: "generate";
  count: number;
  batchId: string;
};

export type VoterCodeFormError = {
  code: string;
  message: string;
};

function isCanonicalUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function parseVoterCodeForm(formData: FormData): ParsedVoterCodeForm | VoterCodeFormError {
  const seen = new Set<string>();
  for (const [key, value] of formData.entries()) {
    if (!ALLOWED_KEYS.has(key)) {
      return { code: "invalid_form", message: "Unknown form field." };
    }
    if (typeof value !== "string") {
      return { code: "invalid_form", message: "File values are not accepted." };
    }
    if (seen.has(key)) {
      return { code: "invalid_form", message: "Duplicate form field." };
    }
    seen.add(key);
  }

  const intent = formData.get("intent");
  if (intent !== "generate") {
    return { code: "invalid_form", message: "Invalid intent." };
  }

  const csrfToken = formData.get("csrf_token");
  if (typeof csrfToken !== "string" || csrfToken.length === 0) {
    return { code: "invalid_form", message: "Missing CSRF token." };
  }

  const rawCount = formData.get("count");
  if (typeof rawCount !== "string" || rawCount.trim().length === 0) {
    return { code: "voter_code_count_invalid", message: "Enter a whole number from 1 to 100." };
  }
  const count = Number(rawCount);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    return { code: "voter_code_count_invalid", message: "Enter a whole number from 1 to 100." };
  }

  const batchId = formData.get("batch_id");
  if (typeof batchId !== "string" || !isCanonicalUuid(batchId)) {
    return { code: "invalid_form", message: "Invalid batch identifier." };
  }

  return { csrfToken, intent: "generate", count, batchId };
}
