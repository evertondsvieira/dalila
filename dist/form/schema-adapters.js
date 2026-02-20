let resolvedValibotRuntime;
let pendingValibotRuntime = null;
let attemptedValibotModuleImport = false;
function isPathRelated(pathA, pathB) {
    if (pathA === pathB)
        return true;
    if (pathA.startsWith(`${pathB}.`) || pathA.startsWith(`${pathB}[`))
        return true;
    if (pathB.startsWith(`${pathA}.`) || pathB.startsWith(`${pathA}[`))
        return true;
    return false;
}
function normalizePathSegment(segment) {
    if (typeof segment === "string" || typeof segment === "number")
        return segment;
    if (!segment || typeof segment !== "object")
        return null;
    if ("key" in segment) {
        const key = segment.key;
        if (typeof key === "string" || typeof key === "number")
            return key;
    }
    if ("path" in segment) {
        const path = segment.path;
        if (typeof path === "string" || typeof path === "number")
            return path;
    }
    return null;
}
function normalizePath(path) {
    if (typeof path === "string")
        return path;
    if (typeof path === "number")
        return `[${path}]`;
    if (!Array.isArray(path))
        return undefined;
    let out = "";
    for (const segment of path) {
        const normalized = normalizePathSegment(segment);
        if (normalized == null)
            continue;
        if (typeof normalized === "number") {
            out += `[${normalized}]`;
        }
        else if (out.length === 0) {
            out += normalized;
        }
        else {
            out += `.${normalized}`;
        }
    }
    return out.length > 0 ? out : undefined;
}
function filterIssuesByPath(issues, path) {
    if (!issues || issues.length === 0)
        return [];
    return issues.filter((issue) => issue.path && isPathRelated(issue.path, path));
}
function normalizeAdapterFailure(error, map) {
    const issues = map(error);
    if (issues.length > 0) {
        return { issues };
    }
    return {
        issues: [],
        formError: error instanceof Error ? error.message : "Schema validation failed",
    };
}
function mapZodIssues(error) {
    const issues = error?.issues;
    if (!Array.isArray(issues))
        return [];
    const normalized = [];
    for (const issue of issues) {
        if (!issue || typeof issue !== "object")
            continue;
        const message = issue.message;
        if (typeof message !== "string" || message.length === 0)
            continue;
        normalized.push({
            path: normalizePath(issue.path),
            message,
        });
    }
    return normalized;
}
function mapValibotIssues(error) {
    const issues = error?.issues;
    if (!Array.isArray(issues))
        return [];
    const normalized = [];
    for (const issue of issues) {
        if (!issue || typeof issue !== "object")
            continue;
        const message = issue.message;
        if (typeof message !== "string" || message.length === 0)
            continue;
        normalized.push({
            path: normalizePath(issue.path),
            message,
        });
    }
    return normalized;
}
async function runSafeParseSchema(schema, data) {
    const s = schema;
    if (typeof s.safeParseAsync === "function") {
        const result = await s.safeParseAsync(data);
        const success = result?.success === true;
        if (success) {
            return { ok: true, value: result.data };
        }
        return { ok: false, error: result.error };
    }
    if (typeof s.safeParse === "function") {
        const result = s.safeParse(data);
        const success = result?.success === true;
        if (success) {
            return { ok: true, value: result.data };
        }
        return { ok: false, error: result.error };
    }
    try {
        if (typeof s.parseAsync === "function") {
            return { ok: true, value: await s.parseAsync(data) };
        }
        if (typeof s.parse === "function") {
            return { ok: true, value: s.parse(data) };
        }
    }
    catch (error) {
        return { ok: false, error };
    }
    throw new Error("Invalid schema adapter input: expected safeParse/parse methods.");
}
async function resolveValibotRuntime(runtime) {
    if (runtime)
        return runtime;
    const globalRuntime = globalThis.valibot;
    if (globalRuntime) {
        resolvedValibotRuntime = globalRuntime;
        return globalRuntime;
    }
    if (resolvedValibotRuntime)
        return resolvedValibotRuntime;
    if (attemptedValibotModuleImport)
        return null;
    if (!pendingValibotRuntime) {
        attemptedValibotModuleImport = true;
        pendingValibotRuntime = (async () => {
            try {
                const modName = "valibot";
                const imported = await import(modName);
                const moduleRuntime = imported;
                resolvedValibotRuntime = moduleRuntime;
                return moduleRuntime;
            }
            catch {
                return null;
            }
            finally {
                pendingValibotRuntime = null;
            }
        })();
    }
    return pendingValibotRuntime;
}
async function runValibotParse(schema, data, runtime) {
    const resolvedRuntime = await resolveValibotRuntime(runtime);
    if (resolvedRuntime) {
        if (typeof resolvedRuntime.safeParseAsync === "function") {
            const result = await resolvedRuntime.safeParseAsync(schema, data);
            const success = result?.success === true;
            if (success) {
                return { ok: true, value: result.output ?? result.data };
            }
            return { ok: false, error: result.issues ? { issues: result.issues } : result.error };
        }
        if (typeof resolvedRuntime.safeParse === "function") {
            const result = resolvedRuntime.safeParse(schema, data);
            const success = result?.success === true;
            if (success) {
                return { ok: true, value: result.output ?? result.data };
            }
            return { ok: false, error: result.issues ? { issues: result.issues } : result.error };
        }
        try {
            if (typeof resolvedRuntime.parseAsync === "function") {
                return { ok: true, value: await resolvedRuntime.parseAsync(schema, data) };
            }
            if (typeof resolvedRuntime.parse === "function") {
                return { ok: true, value: resolvedRuntime.parse(schema, data) };
            }
        }
        catch (error) {
            return { ok: false, error };
        }
    }
    try {
        return await runSafeParseSchema(schema, data);
    }
    catch {
        throw new Error("Invalid valibot adapter input: expected valibot safeParse(schema, input) runtime or schema parse methods.");
    }
}
export function zodAdapter(schema) {
    function mapErrors(error) {
        return mapZodIssues(error);
    }
    const runValidate = async (data) => {
        const result = await runSafeParseSchema(schema, data);
        if (result.ok) {
            return { value: result.value, issues: [] };
        }
        return normalizeAdapterFailure(result.error, mapErrors);
    };
    return {
        validate: runValidate,
        async validateField(path, _value, data) {
            const full = await runValidate(data);
            return { ...full, issues: filterIssuesByPath(full.issues, path) };
        },
        mapErrors,
    };
}
export function valibotAdapter(schema, runtime) {
    function mapErrors(error) {
        return mapValibotIssues(error);
    }
    const runValidate = async (data) => {
        const result = await runValibotParse(schema, data, runtime);
        if (result.ok) {
            return { value: result.value, issues: [] };
        }
        return normalizeAdapterFailure(result.error, mapErrors);
    };
    return {
        validate: runValidate,
        async validateField(path, _value, data) {
            const full = await runValidate(data);
            return { ...full, issues: filterIssuesByPath(full.issues, path) };
        },
        mapErrors,
    };
}
function mapYupError(error) {
    const err = error;
    const mapped = [];
    if (Array.isArray(err.inner) && err.inner.length > 0) {
        for (const item of err.inner) {
            if (!item || typeof item.message !== "string")
                continue;
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
export function yupAdapter(schema) {
    const s = schema;
    function mapErrors(error) {
        return mapYupError(error);
    }
    const runValidate = async (data) => {
        if (typeof s.validate !== "function") {
            throw new Error("Invalid yup schema adapter input: expected validate().");
        }
        try {
            const value = await s.validate(data, { abortEarly: false });
            return { value: value, issues: [] };
        }
        catch (error) {
            return normalizeAdapterFailure(error, mapErrors);
        }
    };
    return {
        validate: runValidate,
        async validateField(path, _value, data) {
            if (typeof s.validateAt === "function") {
                try {
                    await s.validateAt(path, data, { abortEarly: false });
                    return { issues: [] };
                }
                catch (error) {
                    const normalized = normalizeAdapterFailure(error, mapErrors);
                    const formLevelIssue = (normalized.issues ?? []).find((issue) => !issue.path);
                    return {
                        formError: normalized.formError ?? formLevelIssue?.message,
                        issues: filterIssuesByPath(normalized.issues, path),
                    };
                }
            }
            const full = await runValidate(data);
            return { ...full, issues: filterIssuesByPath(full.issues, path) };
        },
        mapErrors,
    };
}
