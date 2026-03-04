import { type EffectErrorHandler } from "./signal.js";
export interface SecurityRuntimeEvent {
    timestamp: string;
    source: string;
    message: string;
    name: string;
    fatal: boolean;
}
export declare const SECURITY_RUNTIME_EVENT_NAME = "dalila:security-error";
export declare const observabilityEffectErrorHandler: EffectErrorHandler;
export declare function reportObservedEffectError(error: Error, source: string): void;
export declare function installDefaultSecurityObservability(): void;
export declare function getSecurityRuntimeEvents(): readonly SecurityRuntimeEvent[];
export declare function clearSecurityRuntimeEvents(): void;
