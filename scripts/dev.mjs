import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm" : "npm";

function run(label, args) {
  const child = spawn(npmCommand, args, {
    stdio: "inherit",
    shell: isWindows,
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
    }
  });

  child.on("error", (error) => {
    console.error(`${label} failed to start`, error);
    process.exitCode = 1;
  });

  return child;
}

const processes = [
  run("api", ["run", "dev:api"]),
  run("web", ["run", "dev:web"]),
];

function shutdown(signal) {
  for (const child of processes) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
