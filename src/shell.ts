// The daemon runs with the machine's Windows PATH, and its front is not always the tool we mean: the WSL
// launcher (C:\Windows\System32\bash.exe) sits before Git Bash, and scoop's shims carry an MSYS tar 1.23.
// The launcher hands the command to a Linux distro that reads "C:/Users/..." as a relative path, and that
// tar crashes when it forks gzip ("Child returned status 5"), so every signal, wait check and web client
// download would fail on such a machine. Resolve both to the Git for Windows tools instead; on other
// platforms PATH already names the right ones.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const WSL_SHELL = /[\\/](Windows[\\/]System32|Microsoft[\\/]WindowsApps)[\\/]bash\.exe$/i;

const pathDirs = () => (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean);

let shell: string | undefined;
/** The POSIX shell for signals and wait checks: Git Bash on Windows, never the WSL launcher. */
export function bashPath(): string {
  if (shell) return shell;
  if (process.platform !== "win32") return (shell = "bash");
  // PATH first (a portable or scoop Git is found there), then the default install locations.
  const candidates = [
    ...pathDirs().map((d) => join(d, "bash.exe")),
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ];
  shell = candidates.find((p) => !WSL_SHELL.test(p) && existsSync(p)) ?? "bash";
  return shell;
}

let tarBin: string | undefined;
/** GNU tar with a working gzip: the MSYS one some Windows PATHs offer crashes when it forks. */
export function tarPath(): string {
  if (tarBin) return tarBin;
  if (process.platform !== "win32") return (tarBin = "tar");
  // Git for Windows ships tar beside bash in usr/bin; the second candidate covers a bash in Git's bin.
  const dir = dirname(bashPath());
  const candidates = [
    join(dir, "tar.exe"),
    resolve(dir, "..", "usr", "bin", "tar.exe"),
    ...pathDirs().map((d) => join(d, "tar.exe")),
  ];
  tarBin = candidates.find((p) => existsSync(p)) ?? "tar";
  return tarBin;
}
