// Entry used by server.ts instead of calling the `next` bin directly: `node run-next.cjs <next args>`.
// The child is spawned with an IPC channel, which closes when the test process dies for ANY reason
// (even SIGKILL / TerminateProcess), so the server can never outlive the test run.
// (Not a `node --require` preload: Next re-serialises execArgv + NODE_OPTIONS for its build workers and
// mangles two --require flags into one bogus module path when the caller's NODE_OPTIONS also has one.)
process.on("disconnect", () => process.exit(0));
const nextBin = require.resolve("next/dist/bin/next");
process.argv.splice(1, 1, nextBin); // [node, <next bin>, ...next args]
// eslint-disable-next-line @typescript-eslint/no-require-imports -- this file's whole job is to run the next bin
require(nextBin);
