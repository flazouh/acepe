export function scrollToEnd(node: HTMLElement) {
	node.scrollTop = node.scrollHeight;
	const observer = new MutationObserver(() => {
		node.scrollTop = node.scrollHeight;
	});
	observer.observe(node, {
		childList: true,
		subtree: true,
		characterData: true,
	});
	return {
		destroy() {
			observer.disconnect();
		},
	};
}
