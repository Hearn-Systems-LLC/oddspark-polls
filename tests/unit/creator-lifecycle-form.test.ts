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
});
