export function formatMessageTimestamp(date: Date | string | number): string {
	const value = typeof date === "string" && /^\d+$/.test(date) ? Number.parseInt(date, 10) : date;
	const parsedDate = new Date(value);
	return parsedDate.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
}

export function formatMessageLatency(ms: number): string {
	if (ms < 1000) {
		return `${ms.toFixed(0)}ms`;
	}

	return `${(ms / 1000).toFixed(1)}s`;
}
