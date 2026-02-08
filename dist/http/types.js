/**
 * HTTP Client Types
 *
 * Type definitions for the Dalila HTTP client.
 * Designed for simplicity and SPA-first workflows.
 */
/**
 * HTTP error with structured information.
 */
export class HttpError extends Error {
    constructor(message, type, config, options) {
        super(message);
        this.name = 'HttpError';
        this.type = type;
        this.config = config;
        this.status = options?.status;
        this.data = options?.data;
        this.response = options?.response;
    }
}
