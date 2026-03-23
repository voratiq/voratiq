export const DEFAULT_VERIFICATION_ERROR_CONTEXT =
  "Verification config `.voratiq/verification.yaml`" as const;

export class VerificationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationConfigError";
  }
}

export class MissingVerificationConfigError extends VerificationConfigError {
  public readonly filePath: string;

  constructor(filePath: string) {
    super(`${DEFAULT_VERIFICATION_ERROR_CONTEXT} not found: ${filePath}`);
    this.name = "MissingVerificationConfigError";
    this.filePath = filePath;
  }
}

export class VerificationYamlParseError extends VerificationConfigError {
  constructor(message: string) {
    super(message);
    this.name = "VerificationYamlParseError";
  }
}
