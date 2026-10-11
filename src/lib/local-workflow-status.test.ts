import test from "node:test";
import assert from "node:assert/strict";
import { localWorkflowStatus } from "./local-workflow-status.ts";

test("completed setup is reported as pipeline readiness, not a completed analysis", () => {
  const status = localWorkflowStatus({ action: "setup", status: "COMPLETE", stage: "Pipeline environment is ready." });
  assert.equal(status.title, "Pipeline ready");
  assert.match(status.message, /search the NASA catalog/i);
  assert.equal(status.busy, false);
});

test("running setup remains visibly in progress", () => {
  const status = localWorkflowStatus({ action: "setup", status: "RUNNING", stage: "Installing libraries" });
  assert.equal(status.title, "Setting up pipeline…");
  assert.equal(status.message, "Installing libraries");
  assert.equal(status.busy, true);
});

test("an idle fresh workflow invites area selection and search", () => {
  const status = localWorkflowStatus(null);
  assert.equal(status.title, "Ready when you are");
  assert.match(status.message, /select an area/i);
  assert.equal(status.busy, false);
});
