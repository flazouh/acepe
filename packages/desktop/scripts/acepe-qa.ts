import { runCli } from "./acepe-qa/cli";

const exitCode = await runCli(process.argv.slice(2), process.cwd());
process.exit(exitCode);
