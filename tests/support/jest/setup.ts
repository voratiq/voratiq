import { isSandboxRuntimeSupported } from "../sandbox-requirements.js";

if (!process.env.TERM) {
  process.env.TERM = "dumb";
}

isSandboxRuntimeSupported();
