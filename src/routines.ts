// Routine preconditions.
//
// A routine used to run on time alone: every `every` interval it created a task even when the data
// source it works on was never configured (uptime alerts, notifications, an exported feed...), or when
// `requires` named a capability no online host has (`os:linux` on a Windows-only fleet). Both cases
// produced noise and nothing else: a pointless agent run that journals "no data source", or a task
// that is parked the moment it is created and re-created on the next tick.
//
// sourceAvailable() tells whether one data source is configured. routineReady() tells whether a
// routine can do its work right now. runRoutines() (src/cli.ts) skips a routine whose gate is closed
// without creating a task, writing a journal line or advancing its due timer — the routine resumes on
// the next tick as soon as the source appears or a capable host comes online.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { type Cfg, capOk } from "./core";

/** The routine fields this module looks at; the rest of the routine is the caller's business. */
export type RoutineGate = {
  name: string;
  /** Hard host capability, comma-separated; one online host must satisfy all of it. */
  requires?: string;
  /** Data sources the routine cannot work without: a [sources] key, `env:NAME` or `file:PATH`. */
  needs?: string | string[];
  /** Soft preference (e.g. os:macos): scheduling only, never a precondition. */
  prefer?: string;
};

/** One online machine: its name and capability tags. */
export type HostCaps = { host: string; caps: string[] };

/** Gate result; `reason` is for logs and tests — callers must not journal it (the point is silence). */
export type GateResult = { ok: true } | { ok: false; reason: string };

/** Comma-separated string or array → trimmed, non-empty entries. */
const split = (v?: string | string[]): string[] =>
  (Array.isArray(v) ? v : (v ?? "").split(",")).map((s) => String(s).trim()).filter(Boolean);

/**
 * Whether one data source is configured. Three forms:
 *   - `env:NAME`  → environment variable NAME is non-empty (tokens, keys);
 *   - `file:PATH` → the file exists, `~` expanded (local exports, caches);
 *   - any other key → the `[sources]` table in config.toml has a non-empty value for it,
 *     e.g. `[sources] uptime = "https://..."`.
 * An empty string, empty array, empty object or false all count as "not configured".
 */
export function sourceAvailable(cfg: Cfg, key: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const k = key.trim();
  if (k.startsWith("env:")) return !!env[k.slice(4).trim()];
  if (k.startsWith("file:")) return existsSync(resolve(k.slice(5).trim().replace(/^~/, homedir())));
  const v = cfg.sources?.[k];
  if (v === undefined || v === null || v === false || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/**
 * Whether this routine can run right now.
 *
 * - Any missing `needs` source → no run (the agent would only report that it has no data);
 * - With `requires`, at least one ONLINE host must satisfy every requirement ("a|b" = either one).
 *   `prefer` is soft and never blocks.
 *
 * Only online hosts count on purpose: a task that can only wait for a missing or offline machine is
 * parked anyway. When such a host comes back, the next tick re-checks and runs immediately.
 */
export function routineReady(cfg: Cfg, r: RoutineGate, hosts: HostCaps[]): GateResult {
  const missing = split(r.needs).filter((k) => !sourceAvailable(cfg, k));
  if (missing.length) return { ok: false, reason: `missing data source: ${missing.join(", ")}` };

  const reqs = split(r.requires);
  if (!reqs.length) return { ok: true };
  if (hosts.some((h) => reqs.every((q) => capOk(q, h.caps)))) return { ok: true };
  return { ok: false, reason: `no online host satisfies: ${reqs.join(", ")}` };
}
