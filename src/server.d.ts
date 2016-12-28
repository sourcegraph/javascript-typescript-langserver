import { LanguageHandler } from './lang-handler';
/**
 * serve starts a singleton language server instance that uses a
 * cluster of worker processes to achieve some semblance of
 * parallelism.
 */
export declare function serve(clusterSize: number, lspPort: number, strict: boolean, newLangHandler: () => LanguageHandler): Promise<void>;
