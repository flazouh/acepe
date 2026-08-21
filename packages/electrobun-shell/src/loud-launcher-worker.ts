import { ShellStartupError } from "./shell-startup-error.ts"

export const QUIET_LAUNCHER_WORKER = "new Worker(appEntrypointPath, {});"

export const LOUD_LAUNCHER_WORKER = `const worker = new Worker(appEntrypointPath, { stdout: "inherit", stderr: "inherit" });
  worker.addEventListener("error", (event) => {
    process.stderr.write("[LAUNCHER] Worker error: " + String(event && event.message ? event.message : event) + "\\n");
  });`

export const launcherWorkerIsLoud = (mainJs: string): boolean =>
	mainJs.includes('stdout: "inherit"') === true && mainJs.includes('stderr: "inherit"') === true

export const makeLauncherWorkerLoud = (mainJs: string): string => {
	if (launcherWorkerIsLoud(mainJs) === true) {
		return mainJs
	}
	if (mainJs.includes(QUIET_LAUNCHER_WORKER) === false) {
		throw new ShellStartupError({
			reason: "launcher main.js has no Worker(appEntrypointPath, {}) call",
		})
	}
	return mainJs.replace(QUIET_LAUNCHER_WORKER, LOUD_LAUNCHER_WORKER)
}
