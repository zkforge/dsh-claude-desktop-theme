// Native header-scroll.js from Windows DSH rc22 c59d10af.
// Isolated from its published module so tests execute the real measurements,
// clone, inline translation/width/clip writes and scroll lifecycle.
const PARTS = [
	"title",
	"intro",
	"toolbar",
	"tabs"
];
/**
* Measure the existing resting and compact CSS layouts in an inert, out-of-flow copy.
* Their independent flex wrapping requires pixel measurements; interpolating only positioned
* contents leaves the real header's resting footprint and the scroll range unchanged.
* @returns A ref callback that disposes its element observers and scroll listener on detachment.
*/
function createPluginHeaderRef() {
	let dispose;
	return (element) => {
		dispose?.();
		dispose = element === null ? void 0 : attach(element);
	};
}
export function attach(bar) {
	const body = bar.parentElement;
	const parts = [];
	let distance = 1;
	let restHeight = 0;
	let compactHeight = 0;
	let disposed = false;
	const scroll = () => {
		const offset = Math.max(0, body.scrollTop);
		bar.toggleAttribute("data-compact", offset >= distance);
		bar.toggleAttribute("data-scrolled", offset > 0);
		for (const part of parts) {
			const progress = Math.min(1, offset / part.distance);
			part.element.style.translate = `${(part.to.x - part.from.x) * progress}px ${(part.to.y - part.from.y) * progress}px`;
			part.element.style.width = `${part.from.width + (part.to.width - part.from.width) * progress}px`;
			if (part.clipStart !== void 0 && part.clipEnd !== void 0) {
				const clip = Math.max(0, Math.min(1, (offset - part.clipStart) / (part.clipEnd - part.clipStart)));
				part.element.style.clipPath = `inset(${clip * 100}% 0 0)`;
			} else part.element.style.removeProperty("clip-path");
			if (part.element.dataset.pluginHeaderPart === "intro") part.element.inert = offset >= (part.clipEnd ?? part.distance);
		}
		bar.style.setProperty("--plugin-header-paint-height", `${Math.max(compactHeight, restHeight - offset)}px`);
	};
	const measure = () => {
		if (disposed) return;
		body.style.setProperty("--plugin-page-scrollbar-width", `${body.offsetWidth - body.clientWidth}px`);
		const clone = bar.cloneNode(true);
		clone.removeAttribute("data-natural");
		clone.removeAttribute("data-compact");
		clone.removeAttribute("data-scrolled");
		clone.setAttribute("data-measuring", "");
		clone.setAttribute("aria-hidden", "true");
		clone.inert = true;
		clone.style.width = `${bar.getBoundingClientRect().width}px`;
		for (const element of clone.querySelectorAll("[id], [data-plugin-header-part]")) {
			element.removeAttribute("id");
			if (element.hasAttribute("data-plugin-header-part")) element.removeAttribute("style");
		}
		body.append(clone);
		const snapshot = () => {
			const head = clone.querySelector("header").getBoundingClientRect();
			const boxes = /* @__PURE__ */ new Map();
			for (const name of PARTS) {
				const element = clone.querySelector(`[data-plugin-header-part="${name}"]`);
				if (element === null) continue;
				const box = element.getBoundingClientRect();
				boxes.set(name, {
					x: box.x - head.x,
					y: box.y - head.y,
					width: box.width,
					height: box.height
				});
			}
			return {
				height: clone.getBoundingClientRect().height,
				boxes
			};
		};
		let resting;
		let compact;
		try {
			resting = snapshot();
			clone.setAttribute("data-compact", "");
			compact = snapshot();
		} finally {
			clone.remove();
		}
		restHeight = resting.height;
		compactHeight = compact.height;
		distance = Math.max(1, restHeight - compactHeight);
		parts.length = 0;
		const hasTabs = resting.boxes.has("tabs");
		const compactTitle = compact.boxes.get("title");
		for (const name of PARTS) {
			const from = resting.boxes.get(name);
			if (from === void 0) continue;
			const element = bar.querySelector(`[data-plugin-header-part="${name}"]`);
			let to = compact.boxes.get(name);
			let clipStart;
			let clipEnd;
			if (name === "intro" || name === "title" && hasTabs) {
				to = {
					...from,
					y: -from.height
				};
				if (name === "intro" && !hasTabs) {
					clipStart = Math.max(0, from.y - compactTitle.y - compactTitle.height);
					clipEnd = clipStart + from.height;
					to.y = from.y - clipEnd;
				}
			}
			const travel = Math.max(1, Math.abs(to.y - from.y));
			distance = Math.max(distance, travel);
			element.style.setProperty("--plugin-part-x", `${from.x}px`);
			element.style.setProperty("--plugin-part-y", `${from.y}px`);
			element.style.setProperty("--plugin-part-width", `${from.width}px`);
			parts.push({
				element,
				from,
				to,
				distance: travel,
				...clipStart !== void 0 && clipEnd !== void 0 ? {
					clipStart,
					clipEnd
				} : {}
			});
		}
		bar.style.setProperty("--plugin-header-rest-height", `${restHeight}px`);
		bar.style.setProperty("--plugin-header-compact-height", `${compactHeight}px`);
		bar.style.setProperty("--plugin-header-travel", `${distance}px`);
		body.style.setProperty("--plugin-header-scroll-padding", `${compactHeight + 8}px`);
		bar.setAttribute("data-natural", "");
		scroll();
	};
	measure();
	const resize = new ResizeObserver(measure);
	resize.observe(body);
	const mutation = new MutationObserver(measure);
	mutation.observe(bar.querySelector("header"), {
		childList: true,
		characterData: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["hidden"]
	});
	body.addEventListener("scroll", scroll, { passive: true });
	document.fonts.addEventListener("loadingdone", measure);
	return () => {
		disposed = true;
		resize.disconnect();
		mutation.disconnect();
		body.removeEventListener("scroll", scroll);
		document.fonts.removeEventListener("loadingdone", measure);
		body.style.removeProperty("--plugin-header-scroll-padding");
		body.style.removeProperty("--plugin-page-scrollbar-width");
	};
}
