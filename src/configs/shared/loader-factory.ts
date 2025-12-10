import process from "node:process";

import { isMissing, readUtf8File } from "../../utils/fs.js";

export type ReadFileFn = (path: string) => string;

export interface BaseConfigLoaderOptions {
  root?: string;
  filePath?: string;
}

export interface ConfigLoaderContext<TOptions extends BaseConfigLoaderOptions> {
  root: string;
  filePath: string;
  options: Readonly<TOptions>;
}

export interface ConfigLoaderFactorySpec<
  TResult,
  TOptions extends BaseConfigLoaderOptions,
> {
  resolveFilePath: (root: string, options: Readonly<TOptions>) => string;
  selectReadFile?: (options: Readonly<TOptions>) => ReadFileFn | undefined;
  handleMissing: (context: ConfigLoaderContext<TOptions>) => TResult;
  parse: (content: string, context: ConfigLoaderContext<TOptions>) => TResult;
  prepareContent?: (
    content: string,
    context: ConfigLoaderContext<TOptions>,
  ) => string;
}

export type ConfigLoader<TOptions extends BaseConfigLoaderOptions, TResult> = (
  options?: TOptions,
) => TResult;

export function createConfigLoader<
  TResult,
  TOptions extends BaseConfigLoaderOptions,
>(
  spec: ConfigLoaderFactorySpec<TResult, TOptions>,
): ConfigLoader<TOptions, TResult> {
  return (optionsArg) => {
    const options = (optionsArg ?? {}) as Readonly<TOptions>;
    const root = options.root ?? process.cwd();
    const filePath = spec.resolveFilePath(root, options);
    const context: ConfigLoaderContext<TOptions> = {
      root,
      filePath,
      options,
    };

    const readFileOverride = spec.selectReadFile?.(options);
    const readFile = readFileOverride ?? defaultReadFile;

    let content: string;
    try {
      content = readFile(filePath);
    } catch (error) {
      if (isMissing(error)) {
        return spec.handleMissing(context);
      }
      throw error;
    }

    const prepared = spec.prepareContent
      ? spec.prepareContent(content, context)
      : content;

    return spec.parse(prepared, context);
  };
}

function defaultReadFile(path: string): string {
  return readUtf8File(path, "utf8");
}
