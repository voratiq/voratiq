import { spawn } from "node:child_process";

function resolveOpenCommand(url: string) {
  switch (process.platform) {
    case "darwin":
      return { command: "open", args: [url] };
    case "win32":
      return { command: "cmd", args: ["/c", "start", "", url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
}

export function openExternalUrl(url: string): Promise<boolean> {
  if (process.env.VORATIQ_DISABLE_BROWSER_OPEN === "1") {
    return Promise.resolve(false);
  }

  const { command, args } = resolveOpenCommand(url);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (opened: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(opened);
    };

    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
      });
      child.once("spawn", () => {
        settle(true);
      });
      child.once("error", () => {
        settle(false);
      });
      child.unref();
    } catch {
      settle(false);
    }
  });
}
