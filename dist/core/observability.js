import { FatalEffectError, setDefaultEffectErrorHandler, } from "./signal.js";
export const SECURITY_RUNTIME_EVENT_NAME = "dalila:security-error";
const MAX_SECURITY_RUNTIME_EVENTS = 25;
const SECURITY_MESSAGE_PATTERN = /\b(sanitizehtml|trusted types?|srcdoc|javascript:|data:text\/html|xss|csp)\b/i;
const securityRuntimeEvents = [];
let observabilityInstalled = false;
function isSecurityRuntimeError(error) {
    return error instanceof FatalEffectError || (error.message.startsWith("[Dalila]")
        && SECURITY_MESSAGE_PATTERN.test(error.message));
}
function storeSecurityRuntimeEvent(event) {
    securityRuntimeEvents.push(event);
    if (securityRuntimeEvents.length > MAX_SECURITY_RUNTIME_EVENTS) {
        securityRuntimeEvents.splice(0, securityRuntimeEvents.length - MAX_SECURITY_RUNTIME_EVENTS);
    }
}
function dispatchSecurityRuntimeEvent(event) {
    const dispatcher = globalThis;
    if (typeof dispatcher.dispatchEvent !== "function" || typeof dispatcher.CustomEvent !== "function") {
        return;
    }
    dispatcher.dispatchEvent(new dispatcher.CustomEvent(SECURITY_RUNTIME_EVENT_NAME, {
        detail: event,
    }));
}
const observabilityEffectErrorHandler = (error, source) => {
    if (isSecurityRuntimeError(error)) {
        const event = {
            timestamp: new Date().toISOString(),
            source,
            message: error.message,
            name: error.name,
            fatal: error instanceof FatalEffectError,
        };
        storeSecurityRuntimeEvent(event);
        dispatchSecurityRuntimeEvent(event);
        console.error(`[Dalila][security] Error in ${source}:`, error);
        return;
    }
    console.error(`[Dalila] Error in ${source}:`, error);
};
export function installDefaultSecurityObservability() {
    if (observabilityInstalled)
        return;
    observabilityInstalled = true;
    setDefaultEffectErrorHandler(observabilityEffectErrorHandler);
}
export function getSecurityRuntimeEvents() {
    return securityRuntimeEvents;
}
export function clearSecurityRuntimeEvents() {
    securityRuntimeEvents.length = 0;
}
