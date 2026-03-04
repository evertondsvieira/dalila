import { setDefaultEffectErrorHandler, type EffectErrorHandler } from "./signal.js";

export interface SecurityRuntimeEvent {
  timestamp: string;
  source: string;
  message: string;
  name: string;
  fatal: boolean;
}

export const SECURITY_RUNTIME_EVENT_NAME = "dalila:security-error";

const MAX_SECURITY_RUNTIME_EVENTS = 25;
const SECURITY_MESSAGE_PATTERN =
  /\b(sanitizehtml|trusted types?|srcdoc|javascript:|data:text\/html|xss|csp)\b/i;

const securityRuntimeEvents: SecurityRuntimeEvent[] = [];

let observabilityInstalled = false;

function isSecurityRuntimeError(error: Error): boolean {
  return error.name === "FatalEffectError" || (
    error.message.startsWith("[Dalila]")
    && SECURITY_MESSAGE_PATTERN.test(error.message)
  );
}

function storeSecurityRuntimeEvent(event: SecurityRuntimeEvent): void {
  securityRuntimeEvents.push(event);
  if (securityRuntimeEvents.length > MAX_SECURITY_RUNTIME_EVENTS) {
    securityRuntimeEvents.splice(0, securityRuntimeEvents.length - MAX_SECURITY_RUNTIME_EVENTS);
  }
}

function dispatchSecurityRuntimeEvent(event: SecurityRuntimeEvent): void {
  const dispatcher = globalThis as typeof globalThis & {
    dispatchEvent?: (event: Event) => boolean;
    CustomEvent?: new <T>(type: string, eventInitDict?: CustomEventInit<T>) => CustomEvent<T>;
  };

  if (typeof dispatcher.dispatchEvent !== "function" || typeof dispatcher.CustomEvent !== "function") {
    return;
  }

  dispatcher.dispatchEvent(new dispatcher.CustomEvent(SECURITY_RUNTIME_EVENT_NAME, {
    detail: event,
  }));
}

export const observabilityEffectErrorHandler: EffectErrorHandler = (error, source) => {
  if (isSecurityRuntimeError(error)) {
    const event: SecurityRuntimeEvent = {
      timestamp: new Date().toISOString(),
      source,
      message: error.message,
      name: error.name,
      fatal: error.name === "FatalEffectError",
    };
    storeSecurityRuntimeEvent(event);
    dispatchSecurityRuntimeEvent(event);
    console.error(`[Dalila][security] Error in ${source}:`, error);
    return;
  }

  console.error(`[Dalila] Error in ${source}:`, error);
};

export function reportObservedEffectError(error: Error, source: string): void {
  observabilityEffectErrorHandler(error, source);
}

export function installDefaultSecurityObservability(): void {
  if (observabilityInstalled) return;
  observabilityInstalled = true;
  setDefaultEffectErrorHandler(observabilityEffectErrorHandler);
}

export function getSecurityRuntimeEvents(): readonly SecurityRuntimeEvent[] {
  return securityRuntimeEvents;
}

export function clearSecurityRuntimeEvents(): void {
  securityRuntimeEvents.length = 0;
}
