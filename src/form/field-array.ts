import { signal, type Signal } from '../core/signal.js';
import type { Scope } from '../core/scope.js';
import type { FieldArray, FieldArrayItem, FieldErrors } from './form-types.js';

export interface FieldArrayOptions {
  form: HTMLFormElement | null;
  scope: Scope | null;
  onMutate?: () => void;
  // Meta-state signals for remapping on reorder
  errors?: Signal<FieldErrors>;
  touchedSet?: Signal<Set<string>>;
  dirtySet?: Signal<Set<string>>;
}

export function createFieldArray<TItem = unknown>(
  basePath: string,
  options: FieldArrayOptions
): FieldArray<TItem> {
  const keys = signal<string[]>([]);
  const values = signal<Map<string, TItem>>(new Map());

  let keyCounter = 0;

  function generateKey(): string {
    return `${basePath}_${keyCounter++}`;
  }

  function remapMetaState(oldIndices: number[], newIndices: number[]): void {
    if (!options.errors && !options.touchedSet && !options.dirtySet) return;

    const indexMap = new Map<number, number>();
    for (let i = 0; i < oldIndices.length; i++) {
      indexMap.set(oldIndices[i], newIndices[i]);
    }

    if (options.errors) {
      options.errors.update((prev) => {
        const next: FieldErrors = {};
        for (const [path, message] of Object.entries(prev)) {
          const newPath = remapPath(path, indexMap);
          next[newPath] = message;
        }
        return next;
      });
    }

    if (options.touchedSet) {
      options.touchedSet.update((prev) => {
        const next = new Set<string>();
        for (const path of prev) {
          next.add(remapPath(path, indexMap));
        }
        return next;
      });
    }

    if (options.dirtySet) {
      options.dirtySet.update((prev) => {
        const next = new Set<string>();
        for (const path of prev) {
          next.add(remapPath(path, indexMap));
        }
        return next;
      });
    }
  }

  function remapPath(path: string, indexMap: Map<number, number>): string {
    const regex = new RegExp(`^${escapeRegExp(basePath)}\\[(\\d+)\\](.*)$`);
    const match = path.match(regex);
    if (!match) return path;

    const oldIndex = parseInt(match[1], 10);
    const rest = match[2];
    const newIndex = indexMap.get(oldIndex);

    if (newIndex === undefined) return path;
    return `${basePath}[${newIndex}]${rest}`;
  }

  function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function fields(): FieldArrayItem<TItem>[] {
    const currentKeys = keys();
    const currentValues = values();

    return currentKeys.map((key) => ({
      key,
      value: currentValues.get(key),
    }));
  }

  function length(): number {
    return keys().length;
  }

  function _getIndex(key: string): number {
    return keys().indexOf(key);
  }

  function _translatePath(path: string): string | null {
    const match = path.match(/^([^\[]+)\[(\d+)\](.*)$/);
    if (!match) return null;

    const [, arrayPath, indexStr, rest] = match;
    if (arrayPath !== basePath) return null;

    const index = parseInt(indexStr, 10);
    const currentKeys = keys();
    const key = currentKeys[index];
    if (!key) return null;

    return `${arrayPath}:${key}${rest}`;
  }

  function append(value: TItem | TItem[]): void {
    const items = Array.isArray(value) ? value : [value];
    const newKeys = items.map(() => generateKey());

    keys.update((prev) => [...prev, ...newKeys]);
    values.update((prev) => {
      const next = new Map(prev);
      newKeys.forEach((key, i) => next.set(key, items[i]));
      return next;
    });
    options.onMutate?.();
  }

  function remove(key: string): void {
    const removeIndex = _getIndex(key);
    const currentLength = keys().length;

    keys.update((prev) => prev.filter((k) => k !== key));
    values.update((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });

    if (removeIndex >= 0) {
      const prefix = `${basePath}[${removeIndex}]`;

      if (options.errors) {
        options.errors.update((prev) => {
          const next: FieldErrors = {};
          for (const [path, message] of Object.entries(prev)) {
            if (!path.startsWith(prefix)) next[path] = message;
          }
          return next;
        });
      }

      if (options.touchedSet) {
        options.touchedSet.update((prev) => {
          const next = new Set<string>();
          for (const path of prev) {
            if (!path.startsWith(prefix)) next.add(path);
          }
          return next;
        });
      }

      if (options.dirtySet) {
        options.dirtySet.update((prev) => {
          const next = new Set<string>();
          for (const path of prev) {
            if (!path.startsWith(prefix)) next.add(path);
          }
          return next;
        });
      }

      const oldIndices: number[] = [];
      const newIndices: number[] = [];
      for (let i = removeIndex + 1; i < currentLength; i++) {
        oldIndices.push(i);
        newIndices.push(i - 1);
      }
      if (oldIndices.length > 0) remapMetaState(oldIndices, newIndices);
    }

    options.onMutate?.();
  }

  function removeAt(index: number): void {
    if (index < 0 || index >= keys().length) return;
    const key = keys()[index];
    if (key) remove(key);
  }

  function insert(index: number, value: TItem): void {
    const len = keys().length;
    if (index < 0 || index > len) return;

    const key = generateKey();
    const currentLength = len;

    const oldIndices: number[] = [];
    const newIndices: number[] = [];
    for (let i = index; i < currentLength; i++) {
      oldIndices.push(i);
      newIndices.push(i + 1);
    }
    if (oldIndices.length > 0) remapMetaState(oldIndices, newIndices);

    keys.update((prev) => {
      const next = [...prev];
      next.splice(index, 0, key);
      return next;
    });

    values.update((prev) => {
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
    options.onMutate?.();
  }

  function move(fromIndex: number, toIndex: number): void {
    const len = keys().length;
    if (fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len) return;
    if (fromIndex === toIndex) return;

    const oldIndices: number[] = [];
    const newIndices: number[] = [];

    if (fromIndex < toIndex) {
      oldIndices.push(fromIndex);
      newIndices.push(toIndex);
      for (let i = fromIndex + 1; i <= toIndex; i++) {
        oldIndices.push(i);
        newIndices.push(i - 1);
      }
    } else {
      oldIndices.push(fromIndex);
      newIndices.push(toIndex);
      for (let i = toIndex; i < fromIndex; i++) {
        oldIndices.push(i);
        newIndices.push(i + 1);
      }
    }

    remapMetaState(oldIndices, newIndices);

    keys.update((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
    options.onMutate?.();
  }

  function swap(indexA: number, indexB: number): void {
    const len = keys().length;
    if (indexA < 0 || indexA >= len || indexB < 0 || indexB >= len) return;
    if (indexA === indexB) return;

    remapMetaState([indexA, indexB], [indexB, indexA]);

    keys.update((prev) => {
      const next = [...prev];
      [next[indexA], next[indexB]] = [next[indexB], next[indexA]];
      return next;
    });
    options.onMutate?.();
  }

  function replace(newValues: TItem[]): void {
    const newKeys = newValues.map(() => generateKey());

    if (options.errors) {
      options.errors.update((prev) => {
        const next: FieldErrors = {};
        for (const [path, message] of Object.entries(prev)) {
          if (!path.startsWith(`${basePath}[`)) next[path] = message;
        }
        return next;
      });
    }

    if (options.touchedSet) {
      options.touchedSet.update((prev) => {
        const next = new Set<string>();
        for (const path of prev) {
          if (!path.startsWith(`${basePath}[`)) next.add(path);
        }
        return next;
      });
    }

    if (options.dirtySet) {
      options.dirtySet.update((prev) => {
        const next = new Set<string>();
        for (const path of prev) {
          if (!path.startsWith(`${basePath}[`)) next.add(path);
        }
        return next;
      });
    }

    keys.set(newKeys);
    values.set(new Map(newKeys.map((key, i) => [key, newValues[i]])));
    options.onMutate?.();
  }

  function update(key: string, value: TItem): void {
    values.update((prev) => {
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
    options.onMutate?.();
  }

  function updateAt(index: number, value: TItem): void {
    if (index < 0 || index >= keys().length) return;
    const key = keys()[index];
    if (key) update(key, value);
  }

  function clear(): void {
    replace([]);
  }

  if (options.scope) {
    options.scope.onCleanup(() => {
      clear();
    });
  }

  return {
    fields,
    append,
    remove,
    removeAt,
    insert,
    move,
    swap,
    replace,
    update,
    updateAt,
    clear,
    length,
    _getIndex,
    _translatePath,
  };
}
