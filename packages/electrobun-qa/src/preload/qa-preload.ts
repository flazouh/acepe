import * as Schema from "effect/Schema";

import {
	QA_PRELOAD_METHODS,
	QaClickTarget,
	QaEvalPayload,
	QaKeyPayload,
	QaPastePayload,
	QaScrollPayload,
	QaTypePayload,
	QaWaitForPayload,
} from "../host/protocol.ts";

export type { QaPreloadMethod } from "../host/protocol.ts";
export { QA_PRELOAD_METHODS };

export type MemoryNode = {
	readonly id: string;
	readonly tag: string;
	text: string;
	hidden: boolean;
	value: string;
	readonly children: Array<MemoryNode>;
	onClick: (() => void) | null;
};

export type MemoryPage = {
	readonly title: string;
	readonly url: string;
	readonly root: MemoryNode;
	focused: MemoryNode | null;
};

const visibleText = (node: MemoryNode): string =>
	node.text.replace(/\s+/g, " ").trim();

const nodeMatchesText = (node: MemoryNode, text: string): boolean =>
	visibleText(node).includes(text) === true;

const nodeMatchesSelector = (node: MemoryNode, selector: string): boolean => {
	if (selector.startsWith("#") === true) {
		return node.id === selector.slice(1);
	}
	if (selector.startsWith(".") === true) {
		return false;
	}
	return node.tag === selector.toLowerCase();
};

const collectVisible = (node: MemoryNode, acc: Array<MemoryNode>): void => {
	if (node.hidden === true) {
		return;
	}
	acc.push(node);
	for (const child of node.children) {
		collectVisible(child, acc);
	}
};

export type QaQuery = {
	readonly selector?: string;
	readonly text?: string;
};

const findNode = (page: MemoryPage, target: QaQuery): MemoryNode | null => {
	const visible: Array<MemoryNode> = [];
	collectVisible(page.root, visible);
	const selector = target.selector;
	if (selector !== undefined) {
		for (const node of visible) {
			if (nodeMatchesSelector(node, selector) === true) {
				return node;
			}
		}
		return null;
	}
	const text = target.text;
	if (text !== undefined) {
		for (const node of visible) {
			if (nodeMatchesText(node, text) === true) {
				return node;
			}
		}
	}
	return null;
};

const textTreeFromNode = (root: MemoryNode): string => {
	const lines: Array<string> = [];
	const walk = (node: MemoryNode, depth: number): void => {
		if (node.hidden === true) {
			return;
		}
		const indent = "  ".repeat(depth);
		const text = visibleText(node);
		if (text.length > 0) {
			lines.push(`${indent}${text}`);
		}
		const nextDepth = text.length > 0 ? depth + 1 : depth;
		for (const child of node.children) {
			walk(child, nextDepth);
		}
	};
	walk(root, 0);
	return lines.join("\n");
};

// An unscoped call (no selector/text) walks the whole page; a scoped call
// resolves to the matched node, or to `false` - the same not-found sentinel
// click/waitFor already use - when nothing matches. The caller
// (handleQaMethod -> session.call) turns that sentinel into
// QaElementNotFound instead of silently falling back to the whole page.
const resolveScopedNode = (page: MemoryPage, target?: QaQuery): MemoryNode | false => {
	if (target === undefined || (target.selector === undefined && target.text === undefined)) {
		return page.root;
	}
	return findNode(page, target) ?? false;
};

export const snapshotTextFromPage = (
	page: MemoryPage,
	target?: QaQuery,
): string | false => {
	const node = resolveScopedNode(page, target);
	if (node === false) {
		return false;
	}
	return textTreeFromNode(node);
};

const domTreeFromNode = (node: MemoryNode): string => {
	if (node.hidden === true) {
		return "";
	}
	const inner = node.children.map((child) => domTreeFromNode(child)).join("");
	return `<${node.tag} id="${node.id}">${visibleText(node)}${inner}</${node.tag}>`;
};

export const snapshotDomFromPage = (
	page: MemoryPage,
	target?: QaQuery,
): string | false => {
	const node = resolveScopedNode(page, target);
	if (node === false) {
		return false;
	}
	return domTreeFromNode(node);
};

export const clickOnPage = (page: MemoryPage, target: QaQuery): boolean => {
	const node = findNode(page, target);
	if (node === null) {
		return false;
	}
	page.focused = node;
	if (node.onClick !== null) {
		node.onClick();
	}
	return true;
};

export const typeOnPage = (
	page: MemoryPage,
	payload: QaTypePayload,
): boolean => {
	const node =
		payload.selector === undefined
			? page.focused
			: findNode(page, { selector: payload.selector });
	if (node === null) {
		return false;
	}
	if (payload.replace === true) {
		node.value = payload.text;
	} else {
		node.value = `${node.value}${payload.text}`;
	}
	node.text = node.value;
	page.focused = node;
	return true;
};

export const pasteOnPage = (page: MemoryPage, payload: QaPastePayload): boolean => {
	const node =
		payload.selector === undefined
			? page.focused
			: findNode(page, { selector: payload.selector });
	if (node === null) {
		return false;
	}
	node.value = `${node.value}${payload.text}`;
	node.text = node.value;
	page.focused = node;
	return true;
};

export const keyOnPage = (page: MemoryPage, payload: QaKeyPayload): boolean => {
	if (page.focused === null) {
		return false;
	}
	if (payload.key === "Backspace") {
		page.focused.value = page.focused.value.slice(0, -1);
		page.focused.text = page.focused.value;
	}
	return true;
};

export const scrollOnPage = (
	page: MemoryPage,
	payload: QaScrollPayload,
): boolean => {
	page.root.text = `${page.root.text} scrolled:${String(payload.x)},${String(payload.y)}`;
	return true;
};

export const waitForOnPage = (page: MemoryPage, payload: QaQuery): boolean =>
	findNode(page, payload) !== null;

export const pageInfoFromPage = (
	page: MemoryPage,
): { readonly title: string; readonly url: string } => ({
	title: page.title,
	url: page.url,
});

export const evalOnPage = (
	page: MemoryPage,
	payload: QaEvalPayload,
): string => {
	if (payload.source.includes("document.title") === true) {
		return page.title;
	}
	if (
		payload.source.includes("location.href") === true ||
		payload.source.includes("document.URL") === true
	) {
		return page.url;
	}
	return payload.source;
};

export const handleQaMethod = (
	page: MemoryPage,
	method: string,
	params: unknown,
): unknown => {
	if (method === "qa:snapshotText") {
		if (Schema.is(QaClickTarget)(params) === true) {
			return snapshotTextFromPage(page, params);
		}
		return snapshotTextFromPage(page);
	}
	if (method === "qa:snapshotDom") {
		if (Schema.is(QaClickTarget)(params) === true) {
			return snapshotDomFromPage(page, params);
		}
		return snapshotDomFromPage(page);
	}
	if (method === "qa:pageInfo") {
		return pageInfoFromPage(page);
	}
	if (method === "qa:click" && Schema.is(QaClickTarget)(params) === true) {
		return clickOnPage(page, params);
	}
	if (method === "qa:type" && Schema.is(QaTypePayload)(params) === true) {
		return typeOnPage(page, params);
	}
	if (method === "qa:key" && Schema.is(QaKeyPayload)(params) === true) {
		return keyOnPage(page, params);
	}
	if (method === "qa:paste" && Schema.is(QaPastePayload)(params) === true) {
		return pasteOnPage(page, params);
	}
	if (method === "qa:scroll" && Schema.is(QaScrollPayload)(params) === true) {
		return scrollOnPage(page, params);
	}
	if (method === "qa:waitFor" && Schema.is(QaWaitForPayload)(params) === true) {
		return waitForOnPage(page, params);
	}
	if (method === "qa:eval" && Schema.is(QaEvalPayload)(params) === true) {
		return evalOnPage(page, params);
	}
	return null;
};

export const createTogglePage = (): MemoryPage => {
	const status: MemoryNode = {
		id: "status",
		tag: "div",
		text: "Closed",
		hidden: false,
		value: "",
		children: [],
		onClick: null,
	};
	const button: MemoryNode = {
		id: "toggle",
		tag: "button",
		text: "Toggle",
		hidden: false,
		value: "",
		children: [],
		onClick: () => {
			status.text = "Opened";
		},
	};
	return {
		title: "Acepe",
		url: "views://mainview/index.html",
		root: {
			id: "root",
			tag: "body",
			text: "Acepe",
			hidden: false,
			value: "",
			children: [button, status],
			onClick: null,
		},
		focused: null,
	};
};

export const QA_RESULT_MESSAGE_ID = "qa:result";

export const qaDispatchJavascript = (encodedRequest: string): string =>
	`window.__electrobunQa.dispatch(${encodedRequest})`;

const preloadMethodsLiteral = QA_PRELOAD_METHODS.map(
	(method) => `"${method}"`,
).join(",");

export const qaPreloadScript = `(function(){
  var METHODS = [${preloadMethodsLiteral}];
  function visibleText(el) {
    if (!el) return "";
    var name = "";
    if (el.getAttribute) {
      name = el.getAttribute("aria-label") || el.getAttribute("alt") || "";
    }
    var text = "";
    if (el.childNodes) {
      for (var i = 0; i < el.childNodes.length; i++) {
        var child = el.childNodes[i];
        if (child && child.nodeType === 3) {
          text += child.textContent || "";
        }
      }
    }
    return String(name || text).replace(/\\s+/g, " ").trim();
  }
  function isHidden(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.hidden) return true;
    var aria = el.getAttribute && el.getAttribute("aria-hidden");
    if (aria === "true") return true;
    var tag = String(el.tagName || "").toUpperCase();
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return true;
    return false;
  }
  function walkText(el, depth, lines) {
    if (isHidden(el)) return;
    var indent = "";
    for (var i = 0; i < depth; i++) indent += "  ";
    var text = visibleText(el);
    if (text.length > 0) lines.push(indent + text);
    var next = text.length > 0 ? depth + 1 : depth;
    // A shadow root's content is on screen and is not among an element's
    // children. Skipping it made this read report an empty tool card for a
    // rendered diff, which is worse than no answer: it is a confident wrong
    // one. Diffs, and anything else rendered into a shadow root, are read here.
    // Walk the shadow content even when the host itself renders no text of its
    // own: the host is usually an empty wrapper and everything on screen lives
    // inside. Reading only hosts that already had text found nothing.
    if (el.shadowRoot && el.shadowRoot.children) {
      var shadowKids = el.shadowRoot.children;
      for (var s = 0; s < shadowKids.length; s++) walkText(shadowKids[s], next, lines);
    }
    var kids = el.children || [];
    for (var j = 0; j < kids.length; j++) walkText(kids[j], next, lines);
  }
  function scopedRoot(params) {
    if (!params || (!params.selector && !params.text)) {
      return document.body || document.documentElement;
    }
    return findTarget(params);
  }
  function snapshotText(params) {
    var root = scopedRoot(params);
    if (!root) return false;
    var lines = [];
    walkText(root, 0, lines);
    return lines.join("\\n");
  }
  function snapshotDom(params) {
    var root = scopedRoot(params);
    if (!root) return false;
    return root.innerHTML ? String(root.innerHTML) : "";
  }
  function pageInfo() {
    var loc = document.location;
    return {
      title: String(document.title || ""),
      url: String((loc && loc.href) || "")
    };
  }
  function findByText(text) {
    var root = document.body || document.documentElement;
    if (!root || !root.querySelectorAll) return null;
    var all = root.querySelectorAll("*");
    var textMatch = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (isHidden(el)) continue;
      var label = visibleText(el);
      if (label.indexOf(text) !== -1) return el;
      var full = String((el.textContent || "")).replace(/\\s+/g, " ").trim();
      if (full.indexOf(text) !== -1) textMatch = el;
    }
    return textMatch;
  }
  function findTarget(params) {
    params = params || {};
    if (params.selector) {
      return document.querySelector(params.selector);
    }
    if (params.text) return findByText(params.text);
    return null;
  }
  function click(params) {
    var el = findTarget(params);
    if (!el) return false;
    if (typeof el.click === "function") el.click();
    return true;
  }
  function setValueAndDispatchInputChange(el, next) {
    el.value = next;
    if (el.setAttribute) el.setAttribute("value", next);
    if (typeof el.dispatchEvent === "function") {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  function typeInto(params) {
    var el = params && params.selector ? document.querySelector(params.selector) : document.activeElement;
    if (!el) return false;
    if (typeof el.focus === "function") el.focus();
    var incoming = String((params && (params.text || params.value)) || "");
    var next = params && params.replace ? incoming : String((el.value || "") + incoming);
    setValueAndDispatchInputChange(el, next);
    return true;
  }
  var NAMED_KEY_CODES = {
    Enter: 13, Backspace: 8, Tab: 9, Escape: 27, " ": 32, Space: 32,
    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Delete: 46, Home: 36, End: 35,
    "-": 189, "_": 189, "=": 187, "+": 187, ".": 190, ",": 188, "/": 191, "?": 191,
    ";": 186, ":": 186, "'": 222, '"': 222, "[": 219, "]": 221, "\\\\": 220, "|": 220,
    "\`": 192, "~": 192
  };
  function keyCodeFor(key) {
    if (key.length === 1) {
      var upper = key.toUpperCase();
      var code = upper.charCodeAt(0);
      if (code >= 48 && code <= 57) return code;
      if (code >= 65 && code <= 90) return code;
    }
    if (Object.prototype.hasOwnProperty.call(NAMED_KEY_CODES, key)) return NAMED_KEY_CODES[key];
    return 0;
  }
  function keyboardEventWithLegacyCode(type, key, code) {
    var ev = new KeyboardEvent(type, { key: key, code: key, bubbles: true, cancelable: true });
    // The KeyboardEvent constructor does not accept keyCode/which in its init
    // dict (they are legacy getters), but real WebViews still read them -
    // xterm.js key handling in particular branches on ev.keyCode and never
    // reaches its ev.key fallback when keyCode is 0, so a synthetic event
    // with only key set is silently ignored. Shadow the getters with own
    // properties so both the modern and legacy readers agree. keydown alone
    // covers xterm's input path; also firing keypress double-emits (its
    // legacy charCode-based path fires independently of the keydown path
    // for the same character), so only keydown/keyup are dispatched here.
    try {
      Object.defineProperty(ev, "keyCode", { get: function () { return code; } });
      Object.defineProperty(ev, "which", { get: function () { return code; } });
    } catch (e) {
      // Some engines make these non-configurable; the event still carries
      // key/code, which covers listeners that only read the modern API.
    }
    return ev;
  }
  function pressKey(params) {
    var el = document.activeElement;
    if (!el) return false;
    var key = params && params.key ? String(params.key) : "";
    if (key === "Backspace" && typeof el.value === "string") {
      el.value = el.value.slice(0, -1);
    }
    if (typeof el.dispatchEvent === "function") {
      var code = keyCodeFor(key);
      el.dispatchEvent(keyboardEventWithLegacyCode("keydown", key, code));
      el.dispatchEvent(keyboardEventWithLegacyCode("keyup", key, code));
    }
    if (key === "Enter" && el.form && typeof el.form.requestSubmit === "function") {
      el.form.requestSubmit();
    }
    return true;
  }
  function pasteInto(params) {
    var el = params && params.selector ? document.querySelector(params.selector) : document.activeElement;
    if (!el) return false;
    if (typeof el.focus === "function") el.focus();
    var text = String((params && params.text) || "");
    var ok = true;
    if (typeof ClipboardEvent === "function" && typeof DataTransfer === "function") {
      try {
        var data = new DataTransfer();
        data.setData("text/plain", text);
        var ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
        ok = el.dispatchEvent(ev);
      } catch (e) {
        ok = true;
      }
    }
    // Widgets that don't listen for paste (a plain <input>/<textarea> with no
    // custom handler) still need the text to land, so fall back to the same
    // value-set path typeInto uses whenever paste wasn't handled/cancelled.
    if (ok !== false && typeof el.value === "string") {
      setValueAndDispatchInputChange(el, String(el.value || "") + text);
    }
    return true;
  }
  function scrollBy(params) {
    params = params || {};
    var x = params.x || 0;
    var y = params.y || 0;
    if (window.scrollBy) window.scrollBy(x, y);
    return true;
  }
  function waitFor(params) {
    return findTarget(params) !== null;
  }
  function evalSource(params) {
    var source = params && params.source ? String(params.source) : "";
    var fn = new Function("return (" + source + ")");
    var result = fn();
    if (result && typeof result.then === "function") {
      throw new Error("async eval is not supported");
    }
    return result;
  }
  var handlers = {
    "qa:eval": evalSource,
    "qa:snapshotText": snapshotText,
    "qa:snapshotDom": snapshotDom,
    "qa:click": click,
    "qa:type": typeInto,
    "qa:key": pressKey,
    "qa:paste": pasteInto,
    "qa:scroll": scrollBy,
    "qa:waitFor": waitFor,
    "qa:pageInfo": function () { return pageInfo(); }
  };
  function sendResult(result) {
    var packet = JSON.stringify({ type: "message", id: "${QA_RESULT_MESSAGE_ID}", payload: result });
    var bridge = window.__electrobunInternalBridge;
    if (bridge && typeof bridge.postMessage === "function") {
      bridge.postMessage(JSON.stringify([packet]));
    }
  }
  function dispatch(request) {
    request = request || {};
    var method = String(request.method || "");
    var id = String(request.id || "");
    var handler = handlers[method];
    if (!handler) {
      sendResult({ id: id, success: false, payload: { _tag: "QaUnknownCommand", command: method } });
      return;
    }
    try {
      var payload = handler(request.params);
      sendResult({ id: id, success: true, payload: payload });
    } catch (err) {
      sendResult({ id: id, success: false, payload: { _tag: "QaEvalFailed", reason: String(err) } });
    }
  }
  window.__electrobunQa = { dispatch: dispatch, methods: METHODS };
  var previous = window.__electrobun && window.__electrobun.receiveInternalMessageFromBun;
  window.__electrobun = window.__electrobun || {};
  window.__electrobun.receiveInternalMessageFromBun = function (msg) {
    if (msg && msg.type === "request" && String(msg.method || "").indexOf("qa:") === 0) {
      dispatch(msg);
      return;
    }
    if (typeof previous === "function") previous(msg);
  };
})();
`;
