// Edit-poll definition/description enhancement (Story 1.12).
import { enhanceDefinitionForm } from "./poll-definition-form";

// Definition form (pre-Vote).
enhanceDefinitionForm({
  formSelector: "[data-edit-poll-form]",
  primaryIntent: "update-definition",
  primarySelector: 'button[name="intent"][value="update-definition"]',
  pendingLabel: "SAVING…",
  idleLabel: "SAVE CHANGES",
});

// Description-only form (post-Vote / locked).
enhanceDefinitionForm({
  formSelector: "[data-edit-description-form]",
  primaryIntent: "update-description",
  primarySelector: 'button[name="intent"][value="update-description"]',
  pendingLabel: "SAVING…",
  idleLabel: "SAVE DESCRIPTION",
});
