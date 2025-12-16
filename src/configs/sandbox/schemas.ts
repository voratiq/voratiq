import { z } from "zod";

import { relativeToRoot } from "../../utils/path.js";
import {
  DEFAULT_SANDBOX_ERROR_CONTEXT,
  SandboxConfigurationError,
} from "./errors.js";

const domainSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, {
    message: "`allowedDomains` entries must be non-empty strings",
  });

const pathSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, {
    message: "Path entries must be non-empty strings",
  });

const networkOverrideShape = {
  allowedDomains: z
    .array(domainSchema)
    .min(1, {
      message: "`allowedDomains` overrides must include at least one domain",
    })
    .optional(),
  deniedDomains: z.array(domainSchema).optional(),
  allowLocalBinding: z.boolean().optional(),
  allowUnixSockets: z
    .array(pathSchema)
    .min(1, {
      message: "`allowUnixSockets` overrides must include at least one path",
    })
    .optional(),
  allowAllUnixSockets: z.boolean().optional(),
} as const;

export const networkOverrideSchema = z.object(networkOverrideShape).strict();

export const denialBackoffOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    warningThreshold: z.number().int().positive().optional(),
    delayThreshold: z.number().int().positive().optional(),
    delayMs: z.number().int().nonnegative().optional(),
    failFastThreshold: z.number().int().positive().optional(),
    windowMs: z.number().int().positive().optional(),
  })
  .strict();

export const filesystemOverrideSchema = z
  .object({
    allowWrite: z
      .array(pathSchema)
      .min(1, {
        message: "`allowWrite` overrides must include at least one path",
      })
      .optional(),
    denyRead: z.array(pathSchema).min(1).optional(),
    denyWrite: z.array(pathSchema).min(1).optional(),
  })
  .strict();

export const providerOverrideSchema = z
  .object({
    ...networkOverrideShape,
    network: networkOverrideSchema.optional(),
    filesystem: filesystemOverrideSchema.optional(),
    denialBackoff: denialBackoffOverrideSchema.optional(),
  })
  .strict();

export const sandboxConfigSchema = z.object({
  providers: z.record(z.string(), providerOverrideSchema),
});

export type NetworkOverride = z.infer<typeof networkOverrideSchema>;
export type DenialBackoffOverride = z.infer<typeof denialBackoffOverrideSchema>;
export type FilesystemOverride = z.infer<typeof filesystemOverrideSchema>;
export type ProviderOverride = z.infer<typeof providerOverrideSchema>;
export type SandboxOverrideDocument = z.infer<typeof sandboxConfigSchema>;

export function validateSandboxOverrides(
  document: unknown,
  root: string,
  filePath: string,
): SandboxOverrideDocument {
  try {
    return sandboxConfigSchema.parse(document);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      const path = issue?.path?.join(".") ?? "";
      const detail = issue?.message ?? "Invalid configuration";
      const scopedDetail =
        path.length > 0
          ? `${DEFAULT_SANDBOX_ERROR_CONTEXT}: ${relativeToRoot(root, filePath)} (${path}): ${detail}.`
          : `${DEFAULT_SANDBOX_ERROR_CONTEXT}: ${relativeToRoot(root, filePath)}: ${detail}.`;
      throw new SandboxConfigurationError(scopedDetail);
    }
    throw error;
  }
}
