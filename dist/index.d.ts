import type { Plugin } from "@opencode-ai/plugin";
export interface PluginConfig {
    endpoint: string;
    healthEndpoint: string;
    logDir: string;
    logFileName: string;
    authProvider: string;
    authLabel: string;
    authPromptMessage: string;
}
export declare function configure(overrides: Partial<PluginConfig>): void;
export declare const DebugPlugin: Plugin;
