// Native rc22 c59d10af WorktreeToggle/BaseMenu and CreationCard logic.
// Primitive presentation is replaced by small DOM equivalents; request/cancel,
// pending, branch choices, blockers and creation state logic remain native.
import * as react from 'react';
import * as react_jsx_runtime from 'react/jsx-runtime';
const clsx=(...values)=>values.filter(Boolean).join(' ');
const assertNever=value=>{throw Error(String(value))};
const icon=props=>react.createElement('svg',{'aria-hidden':true,className:props.className,width:props.size??14,height:props.size??14});
const _deepseek_ai_dsh_client_ui_primitives=new Proxy({
 Tooltip:({children})=>children,
 Button:({children,icon,variant,size,className,...props})=>react.createElement('button',{...props,type:'button',className:['_button_1ulci_2',size==='sm'?'_sm_1ulci_28':'_md_1ulci_23',variant==='primary'?'_primary_1ulci_36':variant==='outline'?'_outline_1ulci_56':'_ghost_1ulci_46',className].filter(Boolean).join(' ')},icon,children),
 Menu:({anchor,open,items,onSelect})=>react.createElement(react.Fragment,null,anchor,open&&react.createElement('div',{role:'menu','data-menu-material':'translucent'},items.filter(row=>row.id!=='title').map(row=>react.createElement('button',{key:row.id,role:'menuitem',onClick:()=>onSelect(row.id)},row.label))))
},{get:(target,key)=>target[key]??icon});
const WorktreeToggle_module_css_default = {
			"base": "mtc7-a_base",
			"baseLabel": "mtc7-a_baseLabel",
			"checkbox": "mtc7-a_checkbox",
			"chevron": "mtc7-a_chevron",
			"chevronOpen": "mtc7-a_chevronOpen",
			"current": "mtc7-a_current",
			"option": "mtc7-a_option",
			"optionName": "mtc7-a_optionName",
			"optionNote": "mtc7-a_optionNote",
			"root": "mtc7-a_root",
			"toggle": "mtc7-a_toggle"
		};
const WorktreeProgress_module_css_default = {
			"actions": "n75qPq_actions",
			"branch": "n75qPq_branch",
			"card": "n75qPq_card",
			"chevron": "n75qPq_chevron",
			"chevronOpen": "n75qPq_chevronOpen",
			"code": "n75qPq_code",
			"details": "n75qPq_details",
			"disclosure": "n75qPq_disclosure",
			"dock": "n75qPq_dock",
			"done": "n75qPq_done",
			"error": "n75qPq_error",
			"failed": "n75qPq_failed",
			"footer": "n75qPq_footer",
			"glyph": "n75qPq_glyph",
			"header": "n75qPq_header",
			"message": "n75qPq_message",
			"note": "n75qPq_note",
			"step": "n75qPq_step",
			"steps": "n75qPq_steps",
			"title": "n75qPq_title",
			"waiting": "n75qPq_waiting",
			"warning": "n75qPq_warning"
		};
function BaseMenu({ base, held, branches, request, t }) {
			const [listed, setListed] = (0, react.useState)(null);
			const [open, setOpen] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(false);
			const show = () => {
				if (open) {
					setOpen(false);
					return;
				}
				setLoading(true);
				branches().then((result) => {
					setLoading(false);
					if (result === void 0) return;
					setListed(result);
					setOpen(true);
				});
			};
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open,
				items: [{
					type: "label",
					id: "title",
					text: t("worktree.baseMenu")
				}, ...(listed?.branches ?? []).map((name) => ({
					id: name,
					label: name === listed?.current ? (0, react_jsx_runtime.jsxs)("span", {
						className: WorktreeToggle_module_css_default.option,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: WorktreeToggle_module_css_default.optionName,
							children: name
						}), (0, react_jsx_runtime.jsx)("span", {
							className: WorktreeToggle_module_css_default.optionNote,
							children: t("worktree.currentBranch")
						})]
					}) : (0, react_jsx_runtime.jsx)("span", {
						className: WorktreeToggle_module_css_default.optionName,
						children: name
					})
				}))],
				selectedId: base ?? void 0,
				onSelect: (id) => {
					setOpen(false);
					if (id !== base) request(id);
				},
				onClose: () => {
					setOpen(false);
				},
				side: "bottom",
				align: "end",
				portal: true,
				anchor: (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: WorktreeToggle_module_css_default.base,
					"aria-haspopup": "menu",
					"aria-expanded": open,
					disabled: loading || held,
					onClick: show,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: WorktreeToggle_module_css_default.baseLabel,
						children: base === null ? t("worktree.baseHead") : t("worktree.base", { branch: base })
					}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
						size: 12,
						className: clsx(WorktreeToggle_module_css_default.chevron, open && WorktreeToggle_module_css_default.chevronOpen)
					})]
				})
			});
		}
		/** What the option shows for a panel state, or undefined while it stays hidden. */
		function optionOf(state) {
			if (state === null || !state.worktree.editable) return void 0;
			const blocker = state.worktree.blocker;
			if (blocker === "not-git") return void 0;
			const checkout = state.checkout;
			if (checkout.state !== "ready") return void 0;
			return {
				blocker,
				current: checkout.checkout.branch,
				commit: checkout.checkout.commit
			};
		}
		/**
		* Render the worktree option while the Session can still start in a worktree:
		* the current branch, or the base branch menu once requested, then the checkbox.
		* A blocked request keeps its selected base visible without a menu; the checkbox
		* only withdraws it. Branch details support pointer, touch, and keyboard access.
		* The request stays fixed while the worktree is being created.
		* @param props - panel snapshot hook, request actions, and copy.
		* @returns the option, or nothing outside a known Git checkout, once a turn started,
		* the request settled, or no worktree service is mounted.
		*/
		function WorktreeToggle({ usePanel, request, cancel, branches, t }) {
			const state = usePanel((snapshot) => snapshot.state);
			const [pending, setPending] = (0, react.useState)(null);
			const option = optionOf(state);
			if (state === null || option === void 0) return null;
			const held = state.worktree.creation !== null;
			const requested = pending ?? state.worktree.request !== null;
			const usable = option.blocker === null;
			const disabled = held || pending !== null || !usable && !requested;
			const current = option.current ?? (option.commit === null ? t("checkout.detached") : t("worktree.detachedTip", { commit: option.commit }));
			const base = state.worktree.request === null ? option.current : state.worktree.request.from;
			const branchText = requested ? base === null ? t("worktree.baseHead") : t("worktree.base", { branch: base }) : current;
			const branchTip = requested || option.current === null ? branchText : t("worktree.currentBranchTip", { branch: option.current });
			const change = (checked) => {
				setPending(checked);
				(checked ? request(option.current) : cancel()).then(() => {
					setPending(null);
				});
			};
			return (0, react_jsx_runtime.jsxs)("span", {
				className: WorktreeToggle_module_css_default.root,
				"data-forge-worktree": "",
				children: [requested && usable ? (0, react_jsx_runtime.jsx)(BaseMenu, {
					base: state.worktree.request?.from ?? option.current,
					held,
					branches,
					request,
					t
				}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: branchTip,
					side: "bottom",
					portal: true,
					openOnClick: true,
					children: (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: WorktreeToggle_module_css_default.current,
						"aria-label": branchTip,
						"data-forge-current-branch": requested ? void 0 : "",
						"data-forge-base-branch": requested ? "" : void 0,
						children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 14 }), (0, react_jsx_runtime.jsx)("span", {
							className: WorktreeToggle_module_css_default.baseLabel,
							children: branchText
						})]
					})
				}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: option.blocker === null ? t("worktree.hint") : t(`worktree.blocked.${option.blocker}`),
					side: "bottom",
					delayMs: 500,
					children: (0, react_jsx_runtime.jsxs)("label", {
						className: WorktreeToggle_module_css_default.toggle,
						"data-disabled": disabled ? "" : void 0,
						children: [(0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							className: WorktreeToggle_module_css_default.checkbox,
							checked: requested,
							disabled,
							onChange: (event) => {
								change(event.currentTarget.checked);
							}
						}), t("worktree.label")]
					})
				})]
			});
		}
		
const CREATION_STEPS = [{
			phase: "prepare",
			label: "creation.prepare"
		}, {
			phase: "checkout",
			label: "creation.checkout"
		}];
		const RESTORATION_STEPS = [{
			phase: "prepare",
			label: "restoration.prepare"
		}, {
			phase: "checkout",
			label: "creation.checkout"
		}];
		function stepState(current, failed, phase) {
			if (phase === current) return failed ? "failed" : "running";
			return phase === "prepare" ? "done" : "waiting";
		}
		function Steps({ steps, phase, failed, t }) {
			return (0, react_jsx_runtime.jsx)("ul", {
				className: WorktreeProgress_module_css_default.steps,
				children: steps.map((step) => (0, react_jsx_runtime.jsxs)("li", {
					className: WorktreeProgress_module_css_default.step,
					"data-state": stepState(phase, failed, step.phase),
					children: [(0, react_jsx_runtime.jsx)(StepIcon, { state: stepState(phase, failed, step.phase) }), (0, react_jsx_runtime.jsx)("span", { children: t(step.label) })]
				}, step.phase))
			});
		}
		function StepIcon({ state }) {
			switch (state) {
				case "done": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {
					size: 14,
					className: WorktreeProgress_module_css_default.done
				});
				case "running": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
					state: "ongoing",
					size: 14
				});
				case "failed": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, {
					size: 14,
					className: WorktreeProgress_module_css_default.failed
				});
				case "waiting": return (0, react_jsx_runtime.jsx)("span", {
					className: WorktreeProgress_module_css_default.waiting,
					"aria-hidden": "true"
				});
				/* v8 ignore next -- closed StepState union exhaustiveness guard */
				default: return assertNever(state, "StepState");
			}
		}
		/** The running attempt, else the failed or stopped one a message waits after, or undefined without either. */
		function creationOf(worktree) {
			const { creation, failure, waiting } = worktree;
			if (creation !== null) return {
				...creation,
				state: "running",
				message: null
			};
			if (waiting !== "creation") return void 0;
			if (failure !== null) return {
				...failure,
				state: "failed",
				held: false
			};
			return {
				state: "stopped",
				phase: "prepare",
				branch: null,
				from: worktree.request?.from ?? null,
				message: null,
				held: false
			};
		}
		function Details({ creation, t }) {
			return (0, react_jsx_runtime.jsxs)("dl", {
				className: WorktreeProgress_module_css_default.details,
				children: [
					creation.branch !== null && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("creation.branch") }), (0, react_jsx_runtime.jsx)("dd", {
						className: WorktreeProgress_module_css_default.code,
						children: creation.branch
					})] }),
					(0, react_jsx_runtime.jsx)("dt", { children: t("creation.base") }),
					(0, react_jsx_runtime.jsx)("dd", {
						className: WorktreeProgress_module_css_default.code,
						children: creation.from ?? t("creation.head")
					}),
					creation.message !== null && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("creation.error") }), (0, react_jsx_runtime.jsx)("dd", {
						className: WorktreeProgress_module_css_default.message,
						children: creation.message
					})] })
				]
			});
		}
		const CREATION_TITLE = {
			running: "creation.title",
			failed: "creation.failed",
			stopped: "creation.stopped"
		};
		function CreationCard({ creation, stop, retry, withdraw, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			const running = creation.state === "running";
			const failed = creation.state === "failed";
			const title = t(CREATION_TITLE[creation.state]);
			return (0, react_jsx_runtime.jsx)("div", {
				className: WorktreeProgress_module_css_default.dock,
				"data-forge-creation": running ? creation.phase : creation.state,
				children: (0, react_jsx_runtime.jsxs)("section", {
					className: WorktreeProgress_module_css_default.card,
					"aria-label": title,
					"aria-busy": running,
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: WorktreeProgress_module_css_default.header,
							children: [
								(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, {
									size: 14,
									className: WorktreeProgress_module_css_default.glyph
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: WorktreeProgress_module_css_default.title,
									children: title
								}),
								creation.branch !== null && (0, react_jsx_runtime.jsx)("span", {
									className: WorktreeProgress_module_css_default.branch,
									children: creation.branch
								})
							]
						}),
						creation.state !== "stopped" && (0, react_jsx_runtime.jsx)(Steps, {
							steps: CREATION_STEPS,
							phase: creation.phase,
							failed,
							t
						}),
						(open || failed) && (0, react_jsx_runtime.jsx)(Details, {
							creation,
							t
						}),
						!running && (0, react_jsx_runtime.jsx)("p", {
							className: WorktreeProgress_module_css_default.note,
							children: t("creation.waiting")
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: WorktreeProgress_module_css_default.footer,
							children: [
								running && (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: WorktreeProgress_module_css_default.disclosure,
									"aria-expanded": open,
									onClick: () => {
										setOpen(!open);
									},
									children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, {
										size: 12,
										className: open ? WorktreeProgress_module_css_default.chevronOpen : WorktreeProgress_module_css_default.chevron
									}), t("creation.details")]
								}),
								!running && (0, react_jsx_runtime.jsxs)("span", {
									className: WorktreeProgress_module_css_default.actions,
									children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "primary",
										onClick: retry,
										children: t("creation.retry")
									}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "ghost",
										onClick: withdraw,
										children: t("creation.skip")
									})]
								}),
								creation.held && (0, react_jsx_runtime.jsx)("span", {
									className: WorktreeProgress_module_css_default.actions,
									children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "ghost",
										icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 14 }),
										onClick: stop,
										children: t("creation.cancel")
									})
								})
							]
						})
					]
				})
			});
		}
		
export {WorktreeToggle,CreationCard};
