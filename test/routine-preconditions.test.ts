// Routine preconditions: when a data source is missing or no online host satisfies `requires`,
// runRoutines must stay quiet — no task, no journal line, and no due-timer advance.
import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA, P, list, today } from "../src/core";
import { runRoutines } from "../src/cli";
import { routineReady, sourceAvailable } from "../src/routines";

// Tests only run inside the throwaway data dir set up by preload.ts, never the real hub.
if (!DATA.startsWith(tmpdir())) throw new Error(`refusing to run: DATA=${DATA} is not a temp dir`);
afterAll(() => rmSync(DATA, { recursive: true, force: true }));
beforeEach(() => {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(P("journal"), { recursive: true });
});

const winbox = { host: "testbox", caps: ["os:windows", "host:testbox", "arch:x64", "cli:bun", "cli:node"] };

// ---------------------------------------------------------------- routineReady / sourceAvailable

test("requires: one host must satisfy every requirement", () => {
  expect(routineReady({}, { name: "r", requires: "os:windows" }, [winbox]).ok).toBe(true);
  // comma = all required
  expect(routineReady({}, { name: "r", requires: "os:windows,cli:bun" }, [winbox]).ok).toBe(true);
  expect(routineReady({}, { name: "r", requires: "os:windows,cli:cargo" }, [winbox]).ok).toBe(false);
  // pipe = either one
  expect(routineReady({}, { name: "r", requires: "os:linux|os:windows" }, [winbox]).ok).toBe(true);
  // one host satisfying everything is enough; not every host has to
  expect(routineReady({}, { name: "r", requires: "os:linux" }, [winbox, { host: "testmac", caps: ["os:linux"] }]).ok).toBe(true);
});

test("requires with no matching online host blocks and explains why", () => {
  const res = routineReady({}, { name: "r", requires: "os:linux" }, [winbox]);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toContain("os:linux");
});

test("prefer is soft and never blocks a routine", () => {
  expect(routineReady({}, { name: "r", requires: "os:windows", prefer: "os:macos" }, [winbox]).ok).toBe(true);
});

test("needs: [sources] keys, env: and file: forms", () => {
  const cfg = { sources: { uptime: "https://u.example/api", empty: "", none: [] as string[] } };
  expect(sourceAvailable(cfg, "uptime")).toBe(true);
  expect(sourceAvailable(cfg, "empty")).toBe(false);
  expect(sourceAvailable(cfg, "none")).toBe(false);
  expect(sourceAvailable(cfg, "absent")).toBe(false);

  expect(sourceAvailable(cfg, "env:NOOP_TEST_SOURCE", { NOOP_TEST_SOURCE: "1" } as NodeJS.ProcessEnv)).toBe(true);
  expect(sourceAvailable(cfg, "env:NOOP_TEST_SOURCE", {} as NodeJS.ProcessEnv)).toBe(false);

  const dir = mkdtempSync(join(tmpdir(), "noop-src-"));
  const feed = join(dir, "feed.json").replace(/\\/g, "/");
  expect(sourceAvailable(cfg, `file:${feed}`)).toBe(false);
  writeFileSync(feed, "{}");
  expect(sourceAvailable(cfg, `file:${feed}`)).toBe(true);
  rmSync(dir, { recursive: true, force: true });

  // needs accepts an array or a comma-separated string; any missing source blocks the routine
  expect(routineReady(cfg, { name: "r", needs: "uptime" }, []).ok).toBe(true);
  expect(routineReady(cfg, { name: "r", needs: ["uptime"] }, []).ok).toBe(true);
  expect(routineReady(cfg, { name: "r", needs: ["uptime", "absent"] }, []).ok).toBe(false);
  expect(routineReady(cfg, { name: "r", needs: "uptime,absent" }, []).ok).toBe(false);
});

// ---------------------------------------------------------------- wiring with runRoutines

const routine = (extra: Record<string, unknown>) =>
  ({ enabled: true, every: "10m", agent: "reporter", prompt: "check the source", readonly: true, ...extra });

const journalText = () => {
  const f = P("journal", `${today()}.md`);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
};

test("a routine blocked by a missing data source creates no task and writes no journal", () => {
  runRoutines({ idle: { enabled: false }, routine: [routine({ name: "watch", needs: "uptime" })] }, "testbox", true);
  expect(list(P("tasks", "inbox"))).toEqual([]);
  expect(journalText()).not.toContain("watch");
});

test("a routine whose requires no online host meets creates no task", () => {
  // No machine can ever have os:plan9 in its caps, so this gate can never open.
  runRoutines({ idle: { enabled: false }, routine: [routine({ name: "linux-only", requires: "os:plan9" })] }, "testbox", true);
  expect(list(P("tasks", "inbox"))).toEqual([]);
  expect(journalText()).not.toContain("linux-only");
});

test("control: once the source exists the same routine creates exactly one task", () => {
  runRoutines({ idle: { enabled: false }, sources: { uptime: "https://u.example/api" }, routine: [routine({ name: "watch", needs: "uptime" })] }, "testbox", true);
  expect(list(P("tasks", "inbox")).length).toBe(1);
  expect(journalText()).toContain("routine `watch`");
});

test("control: a routine without preconditions keeps its old behaviour", () => {
  runRoutines({ idle: { enabled: false }, routine: [routine({ name: "plain" })] }, "testbox", true);
  expect(list(P("tasks", "inbox")).length).toBe(1);
  expect(journalText()).toContain("routine `plain`");
});
