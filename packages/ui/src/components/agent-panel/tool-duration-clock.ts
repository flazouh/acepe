import { readable } from "svelte/store";

export const toolDurationClock = readable(Date.now(), (set) => {
	const update = () => {
		set(Date.now());
	};

	update();
	if (typeof window === "undefined") {
		return () => {};
	}

	const intervalId = window.setInterval(update, 1000);

	return () => {
		window.clearInterval(intervalId);
	};
});
