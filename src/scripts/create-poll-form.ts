// Create-poll enhancement — wraps the shared definition form enhancer.
import { enhanceDefinitionForm } from "./poll-definition-form";

enhanceDefinitionForm({
  formSelector: "[data-create-poll-form]",
  primaryIntent: "publish",
  primarySelector: 'button[name="intent"][value="publish"]',
  pendingLabel: "PUBLISHING…",
  idleLabel: "PUBLISH POLL",
  stampTimeZone: true,
});
