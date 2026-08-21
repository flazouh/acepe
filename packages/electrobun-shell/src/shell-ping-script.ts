import { RPC_ROUNDTRIP_MESSAGE } from "./ping.ts"

export const ACEPE_SHELL_INLINE_PING_ATTR = "data-acepe-shell-inline-ping"

export const acepeShellPingScript = (message: string): string =>
	`(function(){
  var tries = 0;
  function send() {
    var bridge = window.__electrobunBunBridge;
    if (!bridge || typeof bridge.postMessage !== "function") {
      tries += 1;
      if (tries < 40) {
        setTimeout(send, 50);
      }
      return;
    }
    bridge.postMessage(JSON.stringify({
      type: "request",
      id: 1,
      method: "ping",
      params: { message: ${JSON.stringify(message)} }
    }));
  }
  send();
})();`

export const injectAcepeShellPingScript = (html: string): string => {
	if (html.includes(ACEPE_SHELL_INLINE_PING_ATTR) === true) {
		return html
	}
	const tag = `<script ${ACEPE_SHELL_INLINE_PING_ATTR}="true">${acepeShellPingScript(RPC_ROUNDTRIP_MESSAGE)}</script>`
	if (html.includes("</head>") === true) {
		return html.split("</head>").join(`${tag}</head>`)
	}
	return `${html}${tag}`
}
