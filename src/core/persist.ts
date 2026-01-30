import { effect, type Signal } from './signal.js';
import { getCurrentScope } from './scope.js';

/**
 * Storage interface (compatible with localStorage, sessionStorage, etc.)
 */
export interface StateStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}

/**
 * Serialization interface
 */
export interface Serializer<T> {
  serialize(value: T): string;
  deserialize(value: string): T;
}

/**
 * Persist options
 */
export interface PersistOptions<T> {
  name: string;
  storage?: StateStorage;
  serializer?: Serializer<T>;
  version?: number;
  migrate?: (persistedState: unknown, version: number) => T;
  merge?: 'replace' | 'shallow';
  onRehydrate?: (state: T) => void;
  onError?: (error: Error) => void;

  /**
   * Dev-server only hint (not used by runtime yet).
   * Kept for forward-compat with preload injection.
   */
  preload?: boolean;
}

const defaultSerializer: Serializer<any> = {
  serialize: JSON.stringify,
  deserialize: JSON.parse,
};

function isPromiseLike<T = any>(v: unknown): v is Promise<T> {
  return !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as any).then === 'function';
}

function safeDefaultStorage(): StateStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function parseVersion(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function isPlainObject(v: unknown): v is Record<string, any> {
  if (!v || typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  return Object.getPrototypeOf(v) === Object.prototype;
}

/**
 * Create a persisted signal that automatically syncs with storage.
 */
export function persist<T>(baseSignal: Signal<T>, options: PersistOptions<T>): Signal<T> {
  const {
    name,
    storage = safeDefaultStorage(),
    serializer = defaultSerializer as Serializer<T>,
    version,
    merge = 'replace',
    onRehydrate,
    onError,
    migrate,
  } = options;

  if (!name) {
    throw new Error('[Dalila] persist() requires a "name" option');
  }

  if (!storage) {
    console.warn(`[Dalila] persist(): storage not available for "${name}", persistence disabled`);
    return baseSignal;
  }

  const storageKey = name;
  const versionKey = version !== undefined ? `${name}:version` : undefined;

  // ---- Core safety flags ----
  // hydrated=false blocks writes so we don't overwrite storage before async read resolves.
  let hydrated = false;

  // becomes true if user changes signal before hydration completes
  let dirtyBeforeHydrate = false;

  /**
   * Hydration write guard:
   * The dirty listener below uses baseSignal.on(), which would also fire for the
   * hydration set() itself. This guard prevents hydration from counting as "user dirty".
   */
  let isHydrationWrite = false;

  // temporary listener to detect changes before hydration completes
  let removeDirtyListener: (() => void) | null = null;

  /**
   * Write-back dedupe (best effort):
   * Avoid rewriting the same serialized value back to storage after hydration.
   *
   * - lastSaved: what we believe is currently in storage
   * - pendingSaved: what we've already queued to write
   *
   * This prevents: storage -> hydrate -> effect runs -> serialize -> setItem(same value)
   */
  let lastSaved: string | null = null;
  let pendingSaved: string | null = null;

  // Same idea for version key (when enabled)
  let lastSavedVersion: string | null = null;
  let pendingSavedVersion: string | null = null;

  const handleError = (err: unknown, ctx: string) => {
    const e = toError(err);
    if (onError) onError(e);
    else console.error(`[Dalila] persist(): ${ctx} "${name}"`, e);
  };

  const applyHydration = (value: T) => {
    // Ensure dirty listener does not treat hydration as user mutation.
    const setHydratedValue = (next: T) => {
      isHydrationWrite = true;
      try {
        baseSignal.set(next);
      } finally {
        isHydrationWrite = false;
      }
    };

    if (merge === 'shallow' && isPlainObject(value)) {
      const current = baseSignal.peek();
      if (isPlainObject(current)) {
        setHydratedValue({ ...current, ...value } as T);
        return;
      }
    }

    setHydratedValue(value);
  };

  // Ensure async writes don't land out-of-order (queue them)
  let writeChain: Promise<void> = Promise.resolve();

  const queueWrite = (fn: () => void | Promise<void>) => {
    writeChain = writeChain
      .then(() => fn())
      .catch((err) => {
        // If a queued write fails, clear pending so future writes aren't blocked.
        pendingSaved = null;
        pendingSavedVersion = null;
        handleError(err, 'failed to save');
      });
  };

  /**
   * Enqueue write with dedupe:
   * - if value/version already matches what's saved (or already queued), no-op.
   */
  const enqueuePersist = (serialized: string, versionStr: string | null) => {
    const needsValue = serialized !== lastSaved && serialized !== pendingSaved;

    const needsVersion =
      !!versionKey &&
      versionStr !== null &&
      versionStr !== lastSavedVersion &&
      versionStr !== pendingSavedVersion;

    if (!needsValue && !needsVersion) return;

    if (needsValue) pendingSaved = serialized;
    if (needsVersion) pendingSavedVersion = versionStr!;

    queueWrite(async () => {
      // Write value
      if (needsValue) {
        const r1 = storage.setItem(storageKey, serialized);
        if (isPromiseLike(r1)) await r1;

        lastSaved = serialized;
        if (pendingSaved === serialized) pendingSaved = null;
      }

      // Write version
      if (needsVersion && versionKey && versionStr !== null) {
        const r2 = storage.setItem(versionKey, versionStr);
        if (isPromiseLike(r2)) await r2;

        lastSavedVersion = versionStr;
        if (pendingSavedVersion === versionStr) pendingSavedVersion = null;
      }
    });
  };

  const persistValue = (value: T) => {
    // Don't write until hydration finishes (prevents overwriting stored state).
    if (!hydrated) return;

    let serialized: string;
    try {
      serialized = serializer.serialize(value);
    } catch (err) {
      handleError(err, 'failed to serialize');
      return;
    }

    const versionStr = versionKey ? String(version) : null;
    enqueuePersist(serialized, versionStr);
  };

  /**
   * Hydrate from already-read storage strings.
   * For sync storage we can read versionKey synchronously too.
   */
  const hydrateFromStored = (storedValue: string, storedVersionRaw: string | null) => {
    // Track current storage contents to avoid immediate write-back.
    lastSaved = storedValue;
    pendingSaved = null;

    if (versionKey) {
      lastSavedVersion = storedVersionRaw;
      pendingSavedVersion = null;
    }

    const deserialized = serializer.deserialize(storedValue) as T;

    if (version !== undefined && versionKey && migrate) {
      const storedVersion = parseVersion(storedVersionRaw);

      if (storedVersion !== version) {
        const migrated = migrate(deserialized, storedVersion);
        applyHydration(migrated);

        // Save migrated data to storage (don't leave old data with new version)
        let migratedSerialized: string;
        try {
          migratedSerialized = serializer.serialize(baseSignal.peek());
        } catch (err) {
          handleError(err, 'failed to serialize migrated data');
          return;
        }

        enqueuePersist(migratedSerialized, String(version));
        return;
      }
    }

    applyHydration(deserialized);
  };

  const finalizeHydration = (didUserChangeBefore: boolean) => {
    hydrated = true;

    // Remove temporary dirty listener (no longer needed after hydration)
    if (removeDirtyListener) {
      removeDirtyListener();
      removeDirtyListener = null;
    }

    // If user changed before hydrate finished, we must persist current value at least once,
    // because the change already happened while hydrated=false and won't re-trigger.
    if (didUserChangeBefore) {
      persistValue(baseSignal.peek());
    }

    if (onRehydrate) {
      try {
        onRehydrate(baseSignal.peek());
      } catch (err) {
        handleError(err, 'onRehydrate threw');
      }
    }
  };

  const hydrate = () => {
    try {
      const stored = storage.getItem(storageKey);

      // async storage
      if (isPromiseLike(stored)) {
        return stored
          .then(async (storedValue) => {
            if (storedValue === null) {
              finalizeHydration(dirtyBeforeHydrate);
              return;
            }

            // Track value even if we skip applying due to dirty (helps dedupe correctness).
            lastSaved = storedValue;
            pendingSaved = null;

            // If user changed before hydration finished, prefer local state:
            // do NOT apply storedValue (prevents "rollback" to old storage).
            if (dirtyBeforeHydrate) {
              // Best-effort track version too (if enabled), not required for correctness.
              if (versionKey) {
                try {
                  const v = await storage.getItem(versionKey);
                  lastSavedVersion = typeof v === 'string' ? v : null;
                  pendingSavedVersion = null;
                } catch {
                  // ignore
                }
              }

              finalizeHydration(true);
              return;
            }

            let storedVersionRaw: string | null = null;
            if (versionKey) {
              const v = await storage.getItem(versionKey);
              storedVersionRaw = typeof v === 'string' ? v : null;
            }

            hydrateFromStored(storedValue, storedVersionRaw);
            finalizeHydration(false);
          })
          .catch((err) => {
            handleError(err, 'failed to hydrate');
            // Even on error, allow future writes (otherwise persist becomes inert)
            finalizeHydration(dirtyBeforeHydrate);
          });
      }

      // sync storage
      if (stored === null) {
        finalizeHydration(false);
        return;
      }

      let storedVersionRaw: string | null = null;
      if (versionKey) {
        const v = storage.getItem(versionKey);
        storedVersionRaw = isPromiseLike(v) ? null : typeof v === 'string' ? v : null;
      }

      hydrateFromStored(stored, storedVersionRaw);
      finalizeHydration(false);
    } catch (err) {
      handleError(err, 'failed to hydrate');
      finalizeHydration(dirtyBeforeHydrate);
    }
  };

  // ---- Set up persistence + dirty tracking ----

  // Perfect dirty detection: track any changes before hydration completes.
  // This catches even synchronous sets before the effect's first run.
  if (!hydrated) {
    removeDirtyListener = baseSignal.on(() => {
      // Ignore hydration writes (hydration must NOT count as "user dirty").
      if (!hydrated && !isHydrationWrite) dirtyBeforeHydrate = true;
    });
  }

  const scope = getCurrentScope();

  if (scope) {
    effect(() => {
      const value = baseSignal();

      // After hydration completes, persist normally
      if (hydrated) {
        persistValue(value);
      }
    });

    // Clean up temporary dirty listener when scope disposes (if still active)
    if (removeDirtyListener) {
      scope.onCleanup(removeDirtyListener);
    }
  } else {
    // No scope: use manual subscription.
    // Dirty-before-hydrate is still handled by the temporary dirty listener above.
    baseSignal.on((value) => {
      if (hydrated) {
        persistValue(value);
      }
    });
  }

  // Hydrate after wiring subscribers so async hydration sets can trigger persist if needed.
  const hydration = hydrate();
  if (isPromiseLike(hydration)) {
    hydration.catch((err) => {
      // already handled inside hydrate(), but keep as last-resort safety
      console.error(`[Dalila] persist(): hydration promise rejected for "${name}"`, err);
    });
  }

  return baseSignal;
}

/**
 * Helper to create JSON storage wrapper
 */
export function createJSONStorage(getStorage: () => StateStorage): StateStorage {
  return getStorage();
}

/**
 * Clear persisted data for a given key
 */
export function clearPersisted(
  name: string,
  storage: StateStorage = safeDefaultStorage() ?? ({} as StateStorage)
): void {
  if (!storage.removeItem) {
    console.warn(`[Dalila] clearPersisted(): storage.removeItem not available for "${name}"`);
    return;
  }
  try {
    void storage.removeItem(name);
    void storage.removeItem(`${name}:version`);
  } catch (err) {
    console.error(`[Dalila] clearPersisted(): failed for "${name}"`, err);
  }
}

/**
 * Options for preload script generation
 */
export interface PreloadScriptOptions {
  storageKey: string;
  defaultValue: string;
  target?: 'documentElement' | 'body';
  attribute?: string;
  storageType?: 'localStorage' | 'sessionStorage';
}

/**
 * Generate a minimal inline script to prevent FOUC.
 *
 * NOTE: Assumes the value in storage was JSON serialized (default serializer).
 */
export function createPreloadScript(options: PreloadScriptOptions): string {
  const {
    storageKey,
    defaultValue,
    target = 'documentElement',
    attribute = 'data-theme',
    storageType = 'localStorage',
  } = options;

  // Use JSON.stringify to safely embed strings (avoid breaking quotes / injection)
  const k = JSON.stringify(storageKey);
  const d = JSON.stringify(defaultValue);
  const a = JSON.stringify(attribute);

  // Still minified
  return `(function(){try{var s=${storageType}.getItem(${k});var v=s==null?${d}:JSON.parse(s);document.${target}.setAttribute(${a},v)}catch(e){document.${target}.setAttribute(${a},${d})}})();`;
}

export function createThemeScript(storageKey: string, defaultTheme: string = 'light'): string {
  return createPreloadScript({
    storageKey,
    defaultValue: defaultTheme,
    target: 'documentElement',
    attribute: 'data-theme',
  });
}
