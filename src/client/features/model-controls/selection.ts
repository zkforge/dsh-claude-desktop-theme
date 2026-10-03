import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { ModelCatalogModel, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types';

export interface EffortChoice { readonly id: string | undefined; readonly name: string; }

/** What the Effort card derives from one catalog route and its saved selection. */
export interface EffortView {
  /** Slider stops: the advertised tiers in provider order; empty when the model advertises none. */
  readonly choices: readonly EffortChoice[];
  /** Stop the thumb rests on before any drag: the saved tier, else the provider's own tier, else the first stop. */
  readonly preview: number;
  /** Effective effort id: the saved tier, else the provider's advertised default. */
  readonly effort: string | undefined;
  /** Caption the trigger shows: the name of the stop `preview` marks, else the retained one, else the empty-catalog fallback. */
  readonly caption: string | undefined;
}

/** The two captions the card cannot derive from the catalog alone. */
export interface EffortViewCopy {
  /** Fallback caption for a catalog that answers with no tier to name, read only where the trigger stays disabled. */
  readonly defaultName: string;
  /** Caption the directory retained for a route that left the catalog. */
  readonly retainedEffort?: string | undefined;
}

/**
 * Derive the commit-time validation domain of one route.
 *
 * The card's stops are the advertised tiers alone — see `effortView`, which
 * lays the slider out — so this list is not what the panel shows. It is kept
 * because `effortSelection` validates against it, and that domain is the
 * historical one: a catalog naming no default still admits `undefined` as
 * "follow the provider default" beside every tier it advertises.
 *
 * @param model - the route's catalog model.
 * @param defaultName - caption the absent default is admitted under.
 * @returns every id a commit may carry, in provider order.
 */
export function effortChoices(model: ModelCatalogModel | undefined, defaultName: string): EffortChoice[] {
  const reasoning = model?.reasoning;
  if (!reasoning) return [];
  return [
    ...(reasoning.defaultEffort === undefined ? [{ id: undefined, name: defaultName }] : []),
    ...reasoning.efforts,
  ];
}

/**
 * Lay out the card's stops, the resting thumb, and the trigger caption.
 *
 * The stops are the model's advertised tiers in provider order: the provider
 * default is a *position* on that track, never a stop of its own, so a catalog
 * that names no default — or names one its tiers do not carry — has no position
 * to mark rather than an extra stop to show. `preview` rests the thumb on the
 * saved tier while the catalog still carries it, else on the tier the provider
 * names as its default, else on the first stop: the historical resting place,
 * now reached without a Default stop to fall back onto.
 *
 * The caption names the stop the thumb rests on, so the trigger can never
 * advertise a tier the panel has no stop for. Two states stay outside that
 * reading because the catalog cannot name them: a route that left the catalog
 * keeps the directory's retained caption, and a route with nothing on the
 * track keeps `copy.defaultName` — the host's own wording — as its only
 * honest fallback, on a trigger that is disabled and opens no panel anyway.
 *
 * @param model - the route's catalog model.
 * @param current - the saved selection of that same route.
 * @param copy - the empty-catalog caption and the directory's retained one.
 * @returns stops, the resting thumb, the effective effort id, and the trigger caption.
 */
export function effortView(model: ModelCatalogModel | undefined, current: ModelSelection | null, copy: EffortViewCopy): EffortView {
  const reasoning = model?.reasoning;
  const choices = reasoning?.efforts ?? [];
  const saved = current?.reasoningEffort;
  const savedIndex = saved === undefined ? -1 : choices.findIndex(choice => choice.id === saved);
  const defaultIndex = reasoning?.defaultEffort === undefined
    ? -1
    : choices.findIndex(choice => choice.id === reasoning.defaultEffort);
  const preview = savedIndex >= 0 ? savedIndex : defaultIndex >= 0 ? defaultIndex : 0;
  return {
    choices,
    preview,
    effort: saved ?? reasoning?.defaultEffort,
    caption: saved !== undefined
      /* A saved tier the catalog dropped has no stop to name; the directory's
         retained caption is the one record of what the route still stores. */
      ? choices[savedIndex]?.name ?? copy.retainedEffort ?? saved
      /* No explicit pick reads as the thumb's own stop, never as a Default tier
         the panel does not offer. A route without a reasoning section has only
         the retained caption, and a reasoning catalog with an empty track — the
         sole degradation — has only the host's wording to fall back on. */
      : reasoning === undefined ? copy.retainedEffort : choices[preview]?.name ?? copy.defaultName,
  };
}

/** Same-model picks retain effort; a different model starts at its own default. */
export function modelSelection(provider: string, model: ModelCatalogModel, current: ModelSelection | null): ModelSelection {
  const effort = current?.provider === provider && current.model === model.id
    ? current.reasoningEffort ?? model.reasoning?.defaultEffort : model.reasoning?.defaultEffort;
  return { provider, model: model.id, ...(effort === undefined ? {} : { reasoningEffort: effort }) };
}

/** Read the latest directory at commit time so a stale drag cannot change another model. */
export function effortSelection(state: ModelDirectoryState, route: ModelSelection, effort: string | undefined): ModelSelection | null {
  if (!state.current || state.current.provider !== route.provider || state.current.model !== route.model || state.pending) return null;
  const model = state.groups.find(group => group.id === route.provider)?.models.find(model => model.id === route.model);
  if (!model?.reasoning || !effortChoices(model, '').some(choice => choice.id === effort)) return null;
  return { provider: route.provider, model: route.model, ...(effort === undefined ? {} : { reasoningEffort: effort }) };
}
