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
  dispose(): void;
}
