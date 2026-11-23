import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function pythonCommand() {
  if (process.env.SCENE_BRIDGE_PYTHON) return process.env.SCENE_BRIDGE_PYTHON;
  const virtualenv = resolve(".scene-bridge", "venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return access(virtualenv).then(() => virtualenv, () => "python");
}

export async function runPreviewPython(script: string, args: string[]) {
  return run(await pythonCommand(), ["-B", "-X", "utf8", resolve("experiments/f1", script), ...args],
    { timeout: 300_000, windowsHide: true });
}
