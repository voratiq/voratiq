import { buildAuthFailedMessage } from "../messages.js";

export const CLAUDE_PROVIDER_ID = "claude" as const;
export const CLAUDE_SERVICE_NAME = "Claude Code-credentials" as const;
export const CLAUDE_CREDENTIAL_FILENAME = ".credentials.json" as const;
export const CLAUDE_CONFIG_DIRNAME = ".claude" as const;
const CLAUDE_REAUTH_MESSAGE = buildAuthFailedMessage("Claude");
export const CLAUDE_LOGIN_HINT = CLAUDE_REAUTH_MESSAGE;
export const MAC_LOGIN_KEYCHAIN_HINT = CLAUDE_REAUTH_MESSAGE;
export const CLAUDE_OAUTH_RELOGIN_HINT = CLAUDE_REAUTH_MESSAGE;
