import { test } from "node:test";
import assert from "node:assert/strict";

import * as core from "../dist/core/index.js";
import * as form from "../dist/form/index.js";
import * as router from "../dist/router/index.js";
import * as ui from "../dist/components/ui/index.js";
import * as dialog from "../dist/components/ui/dialog/index.js";

test("core public surface does not expose watch test internals", () => {
  assert.equal("__resetWarningsForTests" in core, false);
});

test("core public surface keeps lifecycle helper aliases", () => {
  assert.equal(typeof core.useEvent, "function");
  assert.equal(typeof core.useInterval, "function");
  assert.equal(typeof core.useTimeout, "function");
  assert.equal(typeof core.useFetch, "function");
});

test("form public surface does not expose WRAPPED_HANDLER", () => {
  assert.equal("WRAPPED_HANDLER" in form, false);
});

test("router public surface does not expose getCurrentRouter", () => {
  assert.equal("getCurrentRouter" in router, false);
});

test("ui public surface does not expose dialog internal attach helper", () => {
  assert.equal("_attachDialogBehavior" in ui, false);
  assert.equal("_attachDialogBehavior" in dialog, false);
});
