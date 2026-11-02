import type { ContextProjectionRead, Disposer } from './ports.ts';
import type { SessionEnvironment, SessionMetrics } from '../../shared/session-info.ts';

export interface SessionInfoSnapshot {
  readonly session: string | null;
  readonly visible: boolean;
  readonly left: number;
  readonly top: number;
  readonly height: number;
  readonly zh: boolean;
  readonly workspace: string;
  readonly cwd: string;
  readonly context: ContextProjectionRead | null;
  readonly metrics: SessionMetrics;
  readonly environment: SessionEnvironment | null;
  readonly environmentState: 'loading' | 'ready' | 'error' | 'restart';
}

export interface SessionInfoPort {
  getSnapshot(): SessionInfoSnapshot;
  subscribe(listener: () => void): Disposer;
  toggle(): void;
  retry(): void;
  /** Preview one file in the right column; `path` is absolute or Session-relative. */
  openFile(path: string): void;
  /** Preview the SKILL.md the Session's catalog lists under `name`. */
  openSkill(name: string): void;
  /** Reveal the Session's Files tree. */
  openFilesView(): void;
  dispose(): void;
}
