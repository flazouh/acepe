import { join } from "node:path";
import { err, okAsync, type ResultAsync } from "neverthrow";
import { type CommandRunner, runCommand, type TauriMcpFailure } from "./tauri-mcp";

export type ScreenPoint = {
	readonly x: number;
	readonly y: number;
};

export type NativePointerMover = (point: ScreenPoint) => ResultAsync<null, TauriMcpFailure>;

export function moveNativePointer(
	point: ScreenPoint,
	runner: CommandRunner = runCommand
): ResultAsync<null, TauriMcpFailure> {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
		return err({
			code: "native_pointer_invalid_point",
			message: "Native pointer coordinates must be finite numbers.",
		});
	}
	const helperPath = join(import.meta.dir, "native-pointer.swift");
	return runner(["/usr/bin/swift", helperPath, point.x.toString(), point.y.toString()]).andThen(
		(execution) => {
			if (execution.code !== 0) {
				return err({
					code: "native_pointer_move_failed",
					message:
						execution.stderr.trim() ||
						execution.stdout.trim() ||
						"The macOS pointer helper failed.",
				});
			}
			return okAsync(null);
		}
	);
}
