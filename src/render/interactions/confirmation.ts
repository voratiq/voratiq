import process from "node:process";
import { createInterface } from "node:readline/promises";

export interface ConfirmationOptions {
  message: string;
  defaultValue: boolean;
  prefaceLines?: string[];
}

export interface PromptOptions {
  message: string;
  defaultValue?: string;
  prefaceLines?: string[];
}

export interface ConfirmationInteractor {
  confirm(options: ConfirmationOptions): Promise<boolean>;
  prompt(options: PromptOptions): Promise<string>;
  close(): void;
}

export interface ConfirmationInteractorOptions {
  assumeYes?: boolean;
}

export function createConfirmationInteractor(
  options: ConfirmationInteractorOptions = {},
): ConfirmationInteractor {
  const { assumeYes = false } = options;
  const readlineInterface = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    async confirm(options: ConfirmationOptions): Promise<boolean> {
      const { message, defaultValue, prefaceLines = [] } = options;

      if (assumeYes) {
        return true;
      }

      for (const line of prefaceLines) {
        if (line.length === 0) {
          process.stdout.write("\n");
        } else {
          process.stdout.write(`${line}\n`);
        }
      }

      const suffix = defaultValue ? "[Y/n]" : "[y/N]";

      for (;;) {
        const response = await readlineInterface.question(
          `${message} ${suffix}: `,
        );
        const normalized = response.trim().toLowerCase();
        if (normalized.length === 0) {
          return defaultValue;
        }
        if (normalized === "y" || normalized === "yes") {
          return true;
        }
        if (normalized === "n" || normalized === "no") {
          return false;
        }
        process.stdout.write("Please answer Y or N.\n");
      }
    },
    async prompt(options: PromptOptions): Promise<string> {
      const { message, defaultValue, prefaceLines = [] } = options;

      if (assumeYes) {
        return defaultValue ?? "";
      }

      for (const line of prefaceLines) {
        if (line.length === 0) {
          process.stdout.write("\n");
        } else {
          process.stdout.write(`${line}\n`);
        }
      }

      const suffix =
        defaultValue && defaultValue.length > 0 ? ` [${defaultValue}]` : "";
      const isInlinePrompt = message.trim() === ">";
      const promptLabel = isInlinePrompt ? "> " : `${message}${suffix}: `;
      const response = await readlineInterface.question(promptLabel);
      if (response.trim().length === 0) {
        return defaultValue ?? "";
      }
      return response.trim();
    },
    close(): void {
      readlineInterface.close();
    },
  };
}
