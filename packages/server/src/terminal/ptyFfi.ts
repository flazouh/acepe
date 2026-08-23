import { dlopen, FFIType, read as readPointer } from "bun:ffi"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

export class PtyFfiError extends Schema.TaggedError<PtyFfiError>()("PtyFfiError", {
	operation: Schema.String,
	errno: Schema.Number,
	detail: Schema.String
}) {
	override get message(): string {
		return `PTY FFI ${this.operation} failed (errno ${this.errno}): ${this.detail}`
	}
}

export type PtyPair = {
	readonly master: number
	readonly slave: number
}

export type PtyWinsize = {
	readonly cols: number
	readonly rows: number
}

export const EAGAIN = 35
export const EINTR = 4

const LIBSYSTEM = "/usr/lib/libSystem.B.dylib"
const LIBKERNEL = "/usr/lib/system/libsystem_kernel.dylib"
const F_GETFL = 3
const F_SETFL = 4
const O_NONBLOCK = 4
const TIOCSWINSZ = 0x80087467
const TIOCGWINSZ = 0x40087468

const SYSTEM_SYMBOLS = {
	openpty: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
		returns: FFIType.i32
	},
	close: {
		args: [FFIType.i32],
		returns: FFIType.i32
	},
	read: {
		args: [FFIType.i32, FFIType.ptr, FFIType.u64],
		returns: FFIType.i64
	},
	write: {
		args: [FFIType.i32, FFIType.ptr, FFIType.u64],
		returns: FFIType.i64
	},
	__error: {
		args: [],
		returns: FFIType.ptr
	}
} as const

const KERNEL_SYMBOLS = {
	__ioctl: {
		args: [FFIType.i32, FFIType.u64, FFIType.ptr],
		returns: FFIType.i32
	},
	__fcntl: {
		args: [FFIType.i32, FFIType.i32, FFIType.i32],
		returns: FFIType.i32
	}
} as const

const causeMessage = (cause: {}): string => {
	if (Predicate.hasProperty(cause, "message") === true && Predicate.isString(cause.message) === true) {
		return cause.message
	}
	return "unknown failure"
}

const encodeWinsize = (size: PtyWinsize): Uint16Array =>
	new Uint16Array([size.rows, size.cols, 0, 0])

const decodeWinsize = (win: Uint16Array): PtyWinsize => ({
	rows: win[0] ?? 0,
	cols: win[1] ?? 0
})

let nativeLibs: ReturnType<typeof openNativeLibs> | undefined

const openNativeLibs = () => {
	const system = dlopen(LIBSYSTEM, SYSTEM_SYMBOLS)
	const kernel = dlopen(LIBKERNEL, KERNEL_SYMBOLS)
	return {
		openpty: system.symbols.openpty,
		close: system.symbols.close,
		read: system.symbols.read,
		write: system.symbols.write,
		error: system.symbols.__error,
		// Darwin libc ioctl is variadic; bun:ffi cannot pass the winsize pointer.
		// libsystem_kernel __ioctl is a fixed 3-argument syscall.
		ioctl: kernel.symbols.__ioctl,
		fcntl: kernel.symbols.__fcntl
	}
}

const requireLibs = () => {
	if (nativeLibs !== undefined) {
		return nativeLibs
	}
	nativeLibs = openNativeLibs()
	return nativeLibs
}

const loadLibs = Effect.fn("ptyFfi.loadLibs")(() =>
	Effect.try({
		try: requireLibs,
		catch: (cause) =>
			new PtyFfiError({
				operation: "dlopen",
				errno: 0,
				detail: Predicate.isObject(cause) === true ? causeMessage(cause) : "unknown failure"
			})
	})
)

export const lastErrno = (): number => {
	const libs = nativeLibs
	if (libs === undefined) {
		return 0
	}
	const errorPtr = libs.error()
	if (errorPtr === null) {
		return 0
	}
	return readPointer.i32(errorPtr)
}

export const closeFd = (fd: number): number => requireLibs().close(fd)

export const readFd = (fd: number, buffer: Uint8Array): number =>
	Number(requireLibs().read(fd, buffer, BigInt(buffer.byteLength)))

export const writeFd = (fd: number, bytes: Uint8Array): number =>
	Number(requireLibs().write(fd, bytes, BigInt(bytes.byteLength)))

export const openPtyPair = Effect.fn("ptyFfi.openPtyPair")(function*(size: PtyWinsize) {
	const libs = yield* loadLibs()
	const masterBuf = new Int32Array(1)
	const slaveBuf = new Int32Array(1)
	const win = encodeWinsize(size)
	const rc = libs.openpty(masterBuf, slaveBuf, null, null, win)
	if (rc !== 0) {
		return yield* new PtyFfiError({
			operation: "openpty",
			errno: lastErrno(),
			detail: "openpty failed"
		})
	}
	const master = masterBuf[0]
	const slave = slaveBuf[0]
	if (master === undefined || slave === undefined || master < 0 || slave < 0) {
		return yield* new PtyFfiError({
			operation: "openpty",
			errno: 0,
			detail: "openpty returned invalid fds"
		})
	}
	return { master, slave }
})

export const setWinsizeSync = (fd: number, size: PtyWinsize): number =>
	requireLibs().ioctl(fd, BigInt(TIOCSWINSZ), encodeWinsize(size))

export const setWinsize = Effect.fn("ptyFfi.setWinsize")(function*(fd: number, size: PtyWinsize) {
	yield* loadLibs()
	const rc = setWinsizeSync(fd, size)
	if (rc !== 0) {
		return yield* new PtyFfiError({
			operation: "TIOCSWINSZ",
			errno: lastErrno(),
			detail: "ioctl TIOCSWINSZ failed"
		})
	}
})

export const getWinsize = Effect.fn("ptyFfi.getWinsize")(function*(fd: number) {
	const libs = yield* loadLibs()
	const win = new Uint16Array(4)
	const rc = libs.ioctl(fd, BigInt(TIOCGWINSZ), win)
	if (rc !== 0) {
		return yield* new PtyFfiError({
			operation: "TIOCGWINSZ",
			errno: lastErrno(),
			detail: "ioctl TIOCGWINSZ failed"
		})
	}
	return decodeWinsize(win)
})

export const setNonblock = Effect.fn("ptyFfi.setNonblock")(function*(fd: number) {
	const libs = yield* loadLibs()
	const flags = libs.fcntl(fd, F_GETFL, 0)
	if (flags < 0) {
		return yield* new PtyFfiError({
			operation: "fcntl",
			errno: lastErrno(),
			detail: "F_GETFL failed"
		})
	}
	const rc = libs.fcntl(fd, F_SETFL, flags | O_NONBLOCK)
	if (rc !== 0) {
		return yield* new PtyFfiError({
			operation: "fcntl",
			errno: lastErrno(),
			detail: "F_SETFL O_NONBLOCK failed"
		})
	}
})
