export interface HtmlSinkSecurityOptions {
    strict?: boolean;
    trustedTypes?: boolean;
    trustedTypesPolicyName?: string;
    trustedTypesPolicy?: TrustedTypesHtmlPolicy | null;
}
export interface ResolvedHtmlSinkSecurityOptions {
    strict: boolean;
    trustedTypes: boolean;
    trustedTypesPolicyName: string;
    trustedTypesPolicy: TrustedTypesHtmlPolicy | null;
}
export interface TrustedTypesHtmlPolicy {
    createHTML: (input: string) => unknown;
}
export declare function hasExecutableHtmlSinkPattern(value: string): boolean;
export declare function resolveHtmlSinkSecurityOptions(security?: HtmlSinkSecurityOptions): ResolvedHtmlSinkSecurityOptions;
export declare function setElementInnerHTML(element: Element, html: string, security?: HtmlSinkSecurityOptions): void;
export declare function setTemplateInnerHTML(template: HTMLTemplateElement, html: string, security?: HtmlSinkSecurityOptions): void;
export declare function setTemplateInnerHTMLForParsing(template: HTMLTemplateElement, html: string, security?: HtmlSinkSecurityOptions): void;
