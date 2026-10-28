import { applyCommand, type Command, type CommandType } from "./commands.js";
import type { IdFactory } from "./ids.js";
import { randomId } from "./ids.js";
import { createProject, parseProject } from "./project.js";
import { projectDurationUs } from "./time.js";
import type { Id, Project, ProjectSettings, Us } from "./types.js";

export type ResultOf<T extends CommandType> = T extends "asset.add"
  ? { type: T; assetId: Id }
  : T extends "track.add"
    ? { type: T; trackId: Id }
    : T extends "clip.add"
      ? { type: T; clipId: Id; trackId: Id }
      : T extends "clip.split"
        ? { type: T; leftId: Id; rightId: Id }
        : { type: T };

export interface EditorChange {
  project: Project;
  /** The command that produced this state, or "undo" / "redo" / "load". */
  cause: Command | "undo" | "redo" | "load";
}

export interface EditorOptions {
  /** Start from an existing CPF document (validated). */
  project?: unknown;
  settings?: Partial<ProjectSettings>;
  ids?: IdFactory;
  /** Max undo steps kept in memory. Default 200. */
  historyLimit?: number;
}

export interface Editor {
  /** Current project. Treat as immutable: every change produces a new object. */
  readonly project: Project;
  readonly durationUs: Us;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  dispatch<C extends Command>(command: C): ResultOf<C["type"]>;
  /** Apply several commands as one undo step. All or nothing. */
  batch(commands: Command[]): void;
  undo(): boolean;
  redo(): boolean;
  load(project: unknown): void;
  toJSON(): Project;
  subscribe(listener: (change: EditorChange) => void): () => void;
}

const clone = <T>(v: T): T => structuredClone(v);

export function createEditor(options: EditorOptions = {}): Editor {
  const ids = options.ids ?? randomId;
  const limit = options.historyLimit ?? 200;
  let project: Project = options.project !== undefined ? parseProject(options.project) : createProject(options.settings, ids);
  let past: Project[] = [];
  let future: Project[] = [];
  const listeners = new Set<(change: EditorChange) => void>();

  const emit = (cause: EditorChange["cause"]) => {
    for (const l of listeners) l({ project, cause });
  };

  const commit = (next: Project, cause: EditorChange["cause"]) => {
    past.push(project);
    if (past.length > limit) past = past.slice(past.length - limit);
    future = [];
    project = Object.freeze(next) as Project;
    emit(cause);
  };

  project = Object.freeze(project) as Project;

  return {
    get project() {
      return project;
    },
    get durationUs() {
      return projectDurationUs(project);
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    dispatch(command) {
      const draft = clone(project);
      const result = applyCommand(draft, command, ids);
      commit(draft, command);
      return result as never;
    },
    batch(commands) {
      if (commands.length === 0) return;
      const draft = clone(project);
      for (const c of commands) applyCommand(draft, c, ids);
      commit(draft, commands[commands.length - 1]!);
    },
    undo() {
      const prev = past.pop();
      if (!prev) return false;
      future.push(project);
      project = prev;
      emit("undo");
      return true;
    },
    redo() {
      const next = future.pop();
      if (!next) return false;
      past.push(project);
      project = next;
      emit("redo");
      return true;
    },
    load(input) {
      project = Object.freeze(parseProject(input)) as Project;
      past = [];
      future = [];
      emit("load");
    },
    toJSON() {
      return clone(project);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
