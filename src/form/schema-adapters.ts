import type {
  FormSchemaAdapter,
  SchemaValidationIssue,
  SchemaValidationResult,
} from "./form-types.js";

interface ValibotRuntime {
  safeParseAsync?: (schema: unknown, input: unknown) => Promise<unknown>;
  safeParse?: (schema: unknown, input: unknown) => unknown;
  parseAsync?: (schema: unknown, input: unknown) => Promise<unknown>;
  parse?: (schema: unknown, input: unknown) => unknown;
}

declare global {
  // Optional global runtime hook for environments that expose valibot on window/globalThis.
  var valibot: ValibotRuntime | undefined;
}

let resolvedValibotRuntime: ValibotRuntime | null | undefined;
let pendingValibotRuntime: Promise<ValibotRuntime | null> | null = null;
let attemptedValibotModuleImport = false;

function isPathRelated(pathA: string, pathB: string): boolean {
  if (pathA === pathB) return true;
  if (pathA.startsWith(`${pathB}.`) || pathA.startsWith(`${pathB}[`)) return true;
  if (pathB.startsWith(`${pathA}.`) || pathB.startsWith(`${pathA}[`)) return true;
  return false;
}

function normalizePathSegment(segment: unknown): string | number | null {
  if (typeof segment === "string" || typeof segment === "number") return segment;
  if (!segment || typeof segment !== "object") return null;
  if ("key" in segment) {
    const key = (segment as { key?: unknown }).key;
    if (typeof key === "string" || typeof key === "number") return key;
  }
  if ("path" in segment) {
    const path = (segment as { path?: unknown }).path;
    if (typeof path === "string" || typeof path === "number") return path;
  }
  return null;
}

function normalizePath(path: unknown): string | undefined {
  if (typeof path === "string") return path;
  if (typeof path === "number") return `[${path}]`;
  if (!Array.isArray(path)) return undefined;

  let out = "";
  for (const segment of path) {
    const normalized = normalizePathSegment(segment);
    if (normalized == null) continue;
    if (typeof normalized === "number") {
      out += `[${normalized}]`;
    } else if (out.length === 0) {
      out += normalized;
    } else {
      out += `.${normalized}`;
    }
  }
  return out.length > 0 ? out : undefined;
}

function filterIssuesByPath(
  issues: readonly SchemaValidationIssue[] | undefined,
  path: string
): SchemaValidationIssue[] {
  if (!issues || issues.length === 0) return [];
  return issues.filter((issue) => issue.path && isPathRelated(issue.path, path));
}

function normalizeAdapterFailure(
  error: unknown,
  map: (error: unknown) => SchemaValidationIssue[]
): SchemaValidationResult<unknown> {
  const issues = map(error);
  if (issues.length > 0) {
    return { issues };
  }
  return {
    issues: [],
    formError: error instanceof Error ? error.message : "Schema validation failed",
  };
}

function mapZodIssues(error: unknown): SchemaValidationIssue[] {
  const issues = (error as { issues?: unknown })?.issues;
  if (!Array.isArray(issues)) return [];
  const normalized: SchemaValidationIssue[] = [];
  for (const issue of issues) {
    if (!issue || typeof issue !== "object") continue;
    const message = (issue as { message?: unknown }).message;
    if (typeof message !== "string" || message.length === 0) continue;
    normalized.push({
      path: normalizePath((issue as { path?: unknown }).path),
      message,
    });
  }
  return normalized;
}

function mapValibotIssues(error: unknown): SchemaValidationIssue[] {
  const issues = (error as { issues?: unknown })?.issues;
  if (!Array.isArray(issues)) return [];
  const normalized: SchemaValidationIssue[] = [];
  for (const issue of issues) {
    if (!issue || typeof issue !== "object") continue;
    const message = (issue as { message?: unknown }).message;
    if (typeof message !== "string" || message.length === 0) continue;
    normalized.push({
      path: normalizePath((issue as { path?: unknown }).path),
      message,
    });
  }
  return normalized;
}

async function runSafeParseSchema(
  schema: unknown,
  data: unknown
): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }> {
  const s = schema as {
    safeParseAsync?: (input: unknown) => Promise<unknown>;
    safeParse?: (input: unknown) => unknown;
    parseAsync?: (input: unknown) => Promise<unknown>;
    parse?: (input: unknown) => unknown;
  };

  if (typeof s.safeParseAsync === "function") {
    const result = await s.safeParseAsync(data);
    const success = (result as { success?: unknown })?.success === true;
    if (success) {
      return { ok: true, value: (result as { data?: unknown }).data };
    }
    return { ok: false, error: (result as { error?: unknown }).error };
  }

  if (typeof s.safeParse === "function") {
    const result = s.safeParse(data);
    const success = (result as { success?: unknown })?.success === true;
    if (success) {
      return { ok: true, value: (result as { data?: unknown }).data };
    }
    return { ok: false, error: (result as { error?: unknown }).error };
  }

  try {
    if (typeof s.parseAsync === "function") {
      return { ok: true, value: await s.parseAsync(data) };
    }
    if (typeof s.parse === "function") {
      return { ok: true, value: s.parse(data) };
    }
  } catch (error) {
    return { ok: false, error };
  }

  throw new Error("Invalid schema adapter input: expected safeParse/parse methods.");
}

async function resolveValibotRuntime(
  runtime?: ValibotRuntime
): Promise<ValibotRuntime | null> {
  if (runtime) return runtime;

  const globalRuntime = globalThis.valibot;
  if (globalRuntime) {
    resolvedValibotRuntime = globalRuntime;
    return globalRuntime;
  }

  if (resolvedValibotRuntime) return resolvedValibotRuntime;
  if (attemptedValibotModuleImport) return null;

  if (!pendingValibotRuntime) {
    attemptedValibotModuleImport = true;
    pendingValibotRuntime = (async () => {
      try {
        const modName = "valibot";
        const imported = await import(modName);
        const moduleRuntime = imported as unknown as ValibotRuntime;
        resolvedValibotRuntime = moduleRuntime;
        return moduleRuntime;
      } catch {
        return null;
      } finally {
        pendingValibotRuntime = null;
      }
    })();
  }

  return pendingValibotRuntime;
}

async function runValibotParse(
  schema: unknown,
  data: unknown,
  runtime?: ValibotRuntime
): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }> {
  const resolvedRuntime = await resolveValibotRuntime(runtime);

  if (resolvedRuntime) {
    if (typeof resolvedRuntime.safeParseAsync === "function") {
      const result = await resolvedRuntime.safeParseAsync(schema, data);
      const success = (result as { success?: unknown })?.success === true;
      if (success) {
        return { ok: true, value: (result as { output?: unknown; data?: unknown }).output ?? (result as { data?: unknown }).data };
      }
      return { ok: false, error: (result as { issues?: unknown; error?: unknown }).issues ? { issues: (result as { issues?: unknown }).issues } : (result as { error?: unknown }).error };
    }
    if (typeof resolvedRuntime.safeParse === "function") {
      const result = resolvedRuntime.safeParse(schema, data);
      const success = (result as { success?: unknown })?.success === true;
      if (success) {
        return { ok: true, value: (result as { output?: unknown; data?: unknown }).output ?? (result as { data?: unknown }).data };
      }
      return { ok: false, error: (result as { issues?: unknown; error?: unknown }).issues ? { issues: (result as { issues?: unknown }).issues } : (result as { error?: unknown }).error };
    }
    try {
      if (typeof resolvedRuntime.parseAsync === "function") {
        return { ok: true, value: await resolvedRuntime.parseAsync(schema, data) };
      }
      if (typeof resolvedRuntime.parse === "function") {
        return { ok: true, value: resolvedRuntime.parse(schema, data) };
      }
    } catch (error) {
      return { ok: false, error };
    }
  }

  try {
    return await runSafeParseSchema(schema, data);
  } catch {
    throw new Error(
      "Invalid valibot adapter input: expected valibot safeParse(schema, input) runtime or schema parse methods."
    );
  }
}

export function zodAdapter<T = unknown>(schema: unknown): FormSchemaAdapter<T> {
  function mapErrors(error: unknown): SchemaValidationIssue[] {
    return mapZodIssues(error);
  }

  const runValidate = async (data: unknown): Promise<SchemaValidationResult<T>> => {
    const result = await runSafeParseSchema(schema, data);
    if (result.ok) {
      return { value: result.value as T, issues: [] };
    }
    return normalizeAdapterFailure(result.error, mapErrors) as SchemaValidationResult<T>;
  };

  return {
    validate: runValidate,
    async validateField(path: string, _value: unknown, data: unknown): Promise<SchemaValidationResult<T>> {
      const full = await runValidate(data);
      return { ...full, issues: filterIssuesByPath(full.issues, path) };
    },
    mapErrors,
  };
}

export function valibotAdapter<T = unknown>(
  schema: unknown,
  runtime?: ValibotRuntime
): FormSchemaAdapter<T> {
  function mapErrors(error: unknown): SchemaValidationIssue[] {
    return mapValibotIssues(error);
  }

  const runValidate = async (data: unknown): Promise<SchemaValidationResult<T>> => {
    const result = await runValibotParse(schema, data, runtime);
    if (result.ok) {
      return { value: result.value as T, issues: [] };
    }
    return normalizeAdapterFailure(result.error, mapErrors) as SchemaValidationResult<T>;
  };

  return {
    validate: runValidate,
    async validateField(path: string, _value: unknown, data: unknown): Promise<SchemaValidationResult<T>> {
      const full = await runValidate(data);
      return { ...full, issues: filterIssuesByPath(full.issues, path) };
    },
    mapErrors,
  };
}

function mapYupError(error: unknown): SchemaValidationIssue[] {
  const err = error as {
    inner?: Array<{ path?: unknown; message?: unknown }>;
    path?: unknown;
    message?: unknown;
  };
  const mapped: SchemaValidationIssue[] = [];
  if (Array.isArray(err.inner) && err.inner.length > 0) {
    for (const item of err.inner) {
      if (!item || typeof item.message !== "string") continue;
      mapped.push({ path: typeof item.path === "string" ? item.path : undefined, message: item.message });
    }
    return mapped;
  }
  if (typeof err.message === "string" && err.message.length > 0) {
    mapped.push({
      path: typeof err.path === "string" ? err.path : undefined,
      message: err.message,
    });
  }
  return mapped;
}

export function yupAdapter<T = unknown>(schema: unknown): FormSchemaAdapter<T> {
  const s = schema as {
    validate?: (data: unknown, opts?: unknown) => Promise<unknown>;
    validateAt?: (path: string, data: unknown, opts?: unknown) => Promise<unknown>;
  };

  function mapErrors(error: unknown): SchemaValidationIssue[] {
    return mapYupError(error);
  }

  const runValidate = async (data: unknown): Promise<SchemaValidationResult<T>> => {
    if (typeof s.validate !== "function") {
      throw new Error("Invalid yup schema adapter input: expected validate().");
    }
    try {
      const value = await s.validate(data, { abortEarly: false });
      return { value: value as T, issues: [] };
    } catch (error) {
      return normalizeAdapterFailure(error, mapErrors) as SchemaValidationResult<T>;
    }
  };

  return {
    validate: runValidate,
    async validateField(path: string, _value: unknown, data: unknown): Promise<SchemaValidationResult<T>> {
      if (typeof s.validateAt === "function") {
        try {
          await s.validateAt(path, data, { abortEarly: false });
          return { issues: [] };
        } catch (error) {
          const normalized = normalizeAdapterFailure(error, mapErrors);
          const formLevelIssue = (normalized.issues ?? []).find((issue) => !issue.path);
          return {
            formError: normalized.formError ?? formLevelIssue?.message,
            issues: filterIssuesByPath(normalized.issues, path),
          } as SchemaValidationResult<T>;
        }
      }

      const full = await runValidate(data);
      return { ...full, issues: filterIssuesByPath(full.issues, path) };
    },
    mapErrors,
  };
}
