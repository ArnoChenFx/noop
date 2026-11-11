import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { failoverAccount } from "../src/accounts";
import { P, allowedClis, pickTask, runnableClis, writeDoc } from "../src/core";

const cfg = { clis: { agents: { "claude-only": ["claude"], mixed: ["codex", "claude"] } } } as any;

test("allowedClis: the owner's per-agent setting beats the task's own cli", () => {
  expect(allowedClis({ agent: "claude-only", cli: "codex" }, cfg)).toEqual(["claude"]); // planner or pin said codex
  expect(allowedClis({ agent: "mixed", cli: "claude" }, cfg)).toEqual(["codex", "claude"]);
  expect(allowedClis({ agent: "other", cli: "codex" }, cfg)).toEqual(["codex"]); // no setting: the task's pick
  expect(allowedClis({ agent: "other", cli: "auto" }, cfg)).toEqual(["claude", "codex"]);
  expect(allowedClis({ agent: "other" }, cfg)).toEqual(["claude", "codex"]);
});

test("runnableClis: a per-agent setting is a hard limit, otherwise the other CLI stays a fallback", () => {
  expect(runnableClis({ agent: "claude-only", cli: "claude" }, cfg)).toEqual(["claude"]);
  expect(runnableClis({ agent: "claude-only", cli: "codex" }, cfg)).toEqual(["claude"]);
  expect(runnableClis({ agent: "mixed" }, cfg)).toEqual(["codex", "claude"]);
  expect(runnableClis({ agent: "other", cli: "claude" }, cfg)).toEqual(["claude", "codex"]); // the pick first, then a fallback
  expect(runnableClis({ agent: "other", cli: "codex" }, cfg)).toEqual(["codex", "claude"]);
  expect(runnableClis({ agent: "other" }, cfg)).toEqual(["claude", "codex"]);
});

test("recovery stays inside runnableClis: Claude-only work never lands on Codex, other work still can", () => {
  const all = () => true;
  const accts = { accounts: [{ cli: "claude", name: "zz-test-a" }, { cli: "codex", name: "zz-test-c" }] } as any;
  const claude = { cli: "claude", name: "zz-test-a", dir: "" };
  expect(failoverAccount(accts, claude, runnableClis({ agent: "claude-only", cli: "claude" }, cfg), all)).toBeNull();
  expect(failoverAccount(accts, claude, runnableClis({ agent: "other", cli: "claude" }, cfg), all)?.cli).toBe("codex");
});

test("pickTask: a task no usable account can take is skipped, not claimed again every tick", () => {
  if (!Bun.which("claude")) return; // chooseCli only offers tasks whose CLI is installed here
  const at = new Date(Date.now() - 3600_000).toISOString();
  const blocked = P("tasks", "inbox", "T-9301.md"), free = P("tasks", "inbox", "T-9302.md");
  try {
    writeDoc(blocked, { id: "T-9301", title: "Claude-only, Claude cooling down", agent: "claude-only", priority: "urgent", planned: at, created: at }, "x");
    writeDoc(free, { id: "T-9302", title: "any CLI will do", agent: "other", priority: "high", planned: at, created: at }, "y");
    expect(pickTask(cfg, 0, true)).toContain("T-9301"); // nothing to skip: the urgent task comes first, as before
    const skipped = pickTask(cfg, 0, true, (m) => m.agent !== "claude-only");
    expect(skipped).not.toContain("T-9301");
    expect(skipped).toContain("T-9302");
  } finally {
    rmSync(blocked, { force: true });
    rmSync(free, { force: true });
  }
});
