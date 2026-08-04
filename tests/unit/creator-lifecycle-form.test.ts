import { describe, expect, it } from "vitest";
import { parseLifecycleForm } from "../../src/lib/creator-lifecycle-form";
import { RENDER_OPTION_CEILING } from "../../src/modules/polls/caps";

describe("creator lifecycle form parsing", () => {
  it("parses a valid repeated-option definition submission", () => {
    const form = new FormData();
    form.set("intent", "update-definition");
    form.set("question", "Route truth?");
    form.append("option", "Alpha");
    form.append("option", "Beta");
    form.set("multiSelect", "false");

    expect(parseLifecycleForm(form)).toMatchObject({
      intent: "update-definition",
      question: "Route truth?",
      options: ["Alpha", "Beta"],
      multiSelect: "false",
    });
  });

  it("rejects forbidden definition keys by presence even when empty", () => {
    const form = new FormData();
    form.set("intent", "close");
    form.set("question", "");

    expect(() => parseLifecycleForm(form)).toThrow("unreadable_lifecycle_form");
  });

  it("rejects duplicate singleton fields", () => {
    const form = new FormData();
    form.set("intent", "update-description");
    form.append("description", "first");
    form.append("description", "second");

    expect(() => parseLifecycleForm(form)).toThrow("unreadable_lifecycle_form");
  });

  it("rejects File-valued fields instead of coercing them to empty strings", () => {
    const form = new FormData();
    form.set("intent", "update-description");
    form.set("description", new File(["forged"], "description.txt"));

    expect(() => parseLifecycleForm(form)).toThrow("unreadable_lifecycle_form");
  });

  it("rejects option arrays beyond the render ceiling", () => {
    const form = new FormData();
    form.set("intent", "add-option");
    for (let index = 0; index <= RENDER_OPTION_CEILING; index += 1) {
      form.append("option", "");
    }

    expect(() => parseLifecycleForm(form)).toThrow("unreadable_lifecycle_form");
  });

  it("rejects unknown fields on destructive intents", () => {
    const form = new FormData();
    form.set("intent", "delete");
    form.set("admin", "true");

    expect(() => parseLifecycleForm(form)).toThrow("unreadable_lifecycle_form");
  });

  it("allows reset-demo with only the intent and CSRF token", () => {
    const form = new FormData();
    form.set("intent", "reset-demo");
    form.set("csrf_token", "token");
    expect(parseLifecycleForm(form).intent).toBe("reset-demo");
    form.set("poll_id", "forged");
    expect(() => parseLifecycleForm(form)).toThrow("unreadable_lifecycle_form");
  });

  it("parses an update-security intent with true-only toggle semantics", () => {
    const form = new FormData();
    form.set("intent", "update-security");
    form.set("csrf_token", "token");
    form.set("sessionChecks", "true");
    form.set("captcha", "true");

    expect(parseLifecycleForm(form)).toMatchObject({
      intent: "update-security",
      sessionChecks: "true",
      ipChecks: "false",
      voterCodes: "false",
      captcha: "true",
      vpnBlocking: "false",
    });
  });

  it("rejects unknown keys on an update-security submission", () => {
    const form = new FormData();
    form.set("intent", "update-security");
    form.set("csrf_token", "token");
    form.set("sessionChecks", "true");
    form.set("question", "forged");

    expect(() => parseLifecycleForm(form)).toThrow("unreadable_lifecycle_form");
  });

  it("parses an update-listing intent with its listing value", () => {
    const form = new FormData();
    form.set("intent", "update-listing");
    form.set("csrf_token", "token");
    form.set("listing", "listed");

    expect(parseLifecycleForm(form)).toMatchObject({
      intent: "update-listing",
      listing: "listed",
    });
  });

  it("rejects unknown keys on an update-listing submission", () => {
    const form = new FormData();
    form.set("intent", "update-listing");
    form.set("csrf_token", "token");
    form.set("listing", "unlisted");
    form.set("question", "forged");

    expect(() => parseLifecycleForm(form)).toThrow("unreadable_lifecycle_form");
  });
});
