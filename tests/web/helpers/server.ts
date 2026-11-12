import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

// Run from the repo root (npm scripts always do). cwd, not import.meta, so it works under tsx CJS or ESM.
const root = process.cwd();
const runNext = path.join(root, "tests", "web", "helpers", "run-next.cjs"); // `next`, plus die-with-parent

const BUILD_TIMEOUT_MS = 8 * 60_000;
const START_TIMEOUT_MS = 60_000;

const win = process.platform === "win32";

/** Only what the OS and Node need to run a process. Everything else the caller has (secrets, CI vars, NODE_OPTIONS) is dropped. */
const OS_ENV = win ? ["PATH", "SystemRoot", "TEMP", "TMP"] : ["PATH", "HOME", "TMPDIR", "LANG"];

/**
 * The server's whole environment: the OS allowlist, `SITE_NOINDEX` (the one named pass-through, left out
 * entirely when the caller has not set it), and obvious dummy values so `next build` / `next start` boot
 * with no database and no real secrets. Never spread `process.env` here: a real DB, Redis, OCM, Maps or
 * Firebase credential in the caller's shell must not reach the e2e server.
 */
export function testEnv(baseUrl: string): NodeJS.ProcessEnv {
  const inherited: Record<string, string> = {};
  for (const name of [...OS_ENV, "SITE_NOINDEX"]) {
    const v = process.env[name];
    if (v !== undefined) inherited[name] = v;
  }
  return {
    ...inherited,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: "postgresql://e2e:e2e@127.0.0.1:1/e2e-no-database", // port 1: connect refuses fast
    NEXTAUTH_SECRET: "e2e-dummy-secret-not-for-real-use",
    NEXTAUTH_URL: baseUrl,
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "e2e-dummy-maps-key",
    SYNC_SECRET_KEY: "e2e-dummy-sync-key",
  };
}

/**
 * Next loads `.env*` from the working directory, which would hand real values to the server.
 * Refuse to run if any exists (`.env.example` is fine). Looks at directory entries only; never reads a file.
 */
export function assertNoEnvFiles(dir: string = root): void {
  const found = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => /^\.env(\..+)?$/.test(e.name) && e.name !== ".env.example" && !e.isDirectory())
    .map((e) => e.name);
  if (found.length) {
    throw new Error(
      `Refusing to start the e2e server: ${found.join(", ")} found in ${dir}. Next would load it and the server could read real secrets. ` +
        `Run the e2e tests from a checkout without .env files (e.g. a clean worktree).`,
    );
  }
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [runNext, ...args], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
    detached: !win, // POSIX: own process group so kill() takes workers too
  });
  let log = "";
  const keep = (b: Buffer) => (log = (log + b).slice(-20_000));
  child.stdout!.on("data", keep); // always drain, or a full pipe stalls the child
  child.stderr!.on("data", keep);
  const done = new Promise<number | null>((resolve) => {
    child.once("error", (e) => {
      log += `\nspawn error: ${e.message}`;
      resolve(null);
    });
    child.once("exit", (code) => resolve(code));
  });
  return { child, done, logs: () => log };
}

/** Kill the whole process tree. Safe to call twice. */
function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  try {
    if (win) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

let built: Promise<void> | undefined; // once per test process; one process per *.e2e.ts file

function build(env: NodeJS.ProcessEnv) {
  built ??= (async () => {
    const b = run(["build"], env);
    const timer = setTimeout(() => kill(b.child), BUILD_TIMEOUT_MS);
    const code = await b.done;
    clearTimeout(timer);
    if (code !== 0) throw new Error(`next build failed (exit ${code})\n${b.logs()}`);
  })();
  return built;
}

export interface TestServer {
  baseUrl: string;
  /** Kills the server tree and resolves once it has exited. Idempotent. */
  stop(): Promise<void>;
  /** Tail of the server's stdout+stderr, for failure messages. */
  logs(): string;
}

/** Build once per test process, then `next start` on a free loopback port. `extraEnv` is added on top of testEnv() (default: nothing, i.e. closed). */
export async function startServer(extraEnv: Record<string, string> = {}): Promise<TestServer> {
  assertNoEnvFiles();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...testEnv(baseUrl), ...extraEnv }; // extraEnv: per-file build settings, e.g. a dummy APP_ORIGIN for the go-live build
  await build(env);

  const srv = run(["start", "-p", String(port), "-H", "127.0.0.1"], env);
  const stop = async () => {
    kill(srv.child);
    await Promise.race([srv.done, new Promise((r) => setTimeout(r, 10_000))]);
  };

  const deadline = Date.now() + START_TIMEOUT_MS;
  try {
    for (;;) {
      if (srv.child.exitCode !== null) throw new Error(`next start exited early (${srv.child.exitCode})\n${srv.logs()}`);
      if (Date.now() > deadline) throw new Error(`next start not ready after ${START_TIMEOUT_MS}ms\n${srv.logs()}`);
      try {
        await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) }); // any HTTP answer = listening
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  } catch (e) {
    await stop();
    throw e;
  }
  return { baseUrl, stop, logs: srv.logs };
}
