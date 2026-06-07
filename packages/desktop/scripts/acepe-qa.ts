import { runCli } from "./acepe-qa/cli";

const gitRootProcess = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
	cwd: process.cwd(),
	stdout: "pipe",
	stderr: "pipe",
});
const checkoutRoot =
	gitRootProcess.exitCode === 0
		? new TextDecoder().decode(gitRootProcess.stdout).trim()
		: process.cwd();

const exitCode = await runCli(process.argv.slice(2), checkoutRoot);
process.exit(exitCode);
