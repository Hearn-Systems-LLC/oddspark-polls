import { RENDER_OPTION_CEILING } from "../modules/polls/caps";
import type { SecurityToggle } from "../shared/domain/index";
import { SECURITY_TOGGLES } from "../shared/domain/index";

export type LifecycleIntent =
  | "add-option"
  | "update-definition"
  | "update-description"
  | "update-security"
  | "update-listing"
  | "close"
  | "reset-demo"
  | "delete";

export type ParsedLifecycleForm = {
  intent: LifecycleIntent;
  question: string;
  description: string;
  options: string[];
  multiSelect: string;
  minSelections: string;
  maxSelections: string;
  commentsEnabled: string;
  pollType: string | null;
  sessionChecks: string;
  ipChecks: string;
  voterCodes: string;
  captcha: string;
  vpnBlocking: string;
  listing: string;
};

const INTENTS = new Set<LifecycleIntent>([
  "add-option",
  "update-definition",
  "update-description",
  "update-security",
  "update-listing",
  "close",
  "reset-demo",
  "delete",
]);

const DEFINITION_KEYS = [
  "question",
  "option",
  "multiSelect",
  "minSelections",
  "maxSelections",
  "commentsEnabled",
  "pollType",
] as const;

const SECURITY_KEYS = [...SECURITY_TOGGLES] as SecurityToggle[];

const COMMON_KEYS = new Set(["csrf_token", "intent"]);
const DEFINITION_FORM_KEYS = new Set([
  ...COMMON_KEYS,
  ...DEFINITION_KEYS,
  "description",
]);
const DESCRIPTION_FORM_KEYS = new Set([...COMMON_KEYS, "description"]);
const SECURITY_FORM_KEYS = new Set([...COMMON_KEYS, ...SECURITY_KEYS]);
const LISTING_FORM_KEYS = new Set([...COMMON_KEYS, "listing"]);

function unreadable(): never {
  throw new Error("unreadable_lifecycle_form");
}

function singleton(formData: FormData, key: string): string {
  const values = formData.getAll(key);
  if (values.length > 1 || values.some((value) => typeof value !== "string")) {
    return unreadable();
  }
  return typeof values[0] === "string" ? values[0] : "";
}

function emptySecurityDraft(): Record<SecurityToggle, string> {
  return {
    sessionChecks: "false",
    ipChecks: "false",
    voterCodes: "false",
    captcha: "false",
    vpnBlocking: "false",
  };
}

export function parseLifecycleForm(formData: FormData): ParsedLifecycleForm {
  const rawIntent = singleton(formData, "intent");
  if (!INTENTS.has(rawIntent as LifecycleIntent)) {
    return unreadable();
  }
  const intent = rawIntent as LifecycleIntent;
  const allowed =
    intent === "add-option" || intent === "update-definition"
      ? DEFINITION_FORM_KEYS
      : intent === "update-description"
        ? DESCRIPTION_FORM_KEYS
        : intent === "update-security"
          ? SECURITY_FORM_KEYS
          : intent === "update-listing"
            ? LISTING_FORM_KEYS
          : COMMON_KEYS;

  for (const [key, value] of formData.entries()) {
    if (!allowed.has(key) || typeof value !== "string") {
      return unreadable();
    }
  }

  for (const key of allowed) {
    if (key !== "option") {
      singleton(formData, key);
    }
  }

  const optionEntries = formData.getAll("option");
  if (
    optionEntries.length > RENDER_OPTION_CEILING ||
    optionEntries.some((entry) => typeof entry !== "string")
  ) {
    return unreadable();
  }

  const commentsEnabled = singleton(formData, "commentsEnabled") || "false";
  if (
    (intent === "add-option" || intent === "update-definition") &&
    commentsEnabled !== "true" &&
    commentsEnabled !== "false"
  ) {
    return unreadable();
  }

  const security = emptySecurityDraft();
  if (intent === "update-security") {
    for (const key of SECURITY_KEYS) {
      // Checkbox absent = off (multiSelect semantics). Only "true" is on.
      security[key] =
        formData.has(key) && singleton(formData, key) === "true"
          ? "true"
          : "false";
    }
  }

  return {
    intent,
    question: singleton(formData, "question"),
    description: singleton(formData, "description"),
    options: optionEntries as string[],
    multiSelect: singleton(formData, "multiSelect") || "false",
    minSelections: singleton(formData, "minSelections"),
    maxSelections: singleton(formData, "maxSelections"),
    commentsEnabled,
    pollType: formData.has("pollType")
      ? singleton(formData, "pollType")
      : null,
    sessionChecks: security.sessionChecks,
    ipChecks: security.ipChecks,
    voterCodes: security.voterCodes,
    captcha: security.captcha,
    vpnBlocking: security.vpnBlocking,
    listing: singleton(formData, "listing"),
  };
}
