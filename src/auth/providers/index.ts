import { claudeAuthProvider } from "./claude.js";
import { codexAuthProvider } from "./codex.js";
import { geminiAuthProvider } from "./gemini.js";
import type { AuthProvider } from "./types.js";

const REGISTRY = new Map<string, AuthProvider>();

registerAuthProvider(claudeAuthProvider);
registerAuthProvider(codexAuthProvider);
registerAuthProvider(geminiAuthProvider);

function registerAuthProvider(provider: AuthProvider): void {
  if (REGISTRY.has(provider.id)) {
    return;
  }
  REGISTRY.set(provider.id, provider);
}

export function resolveAuthProvider(id: string): AuthProvider | undefined {
  return REGISTRY.get(id);
}
