export interface SecuritySmokeFinding {
    filePath: string;
    line: number;
    col: number;
    severity: 'error' | 'warning';
    message: string;
}
export declare function runSecuritySmokeChecks(scanPath: string): Promise<number>;
