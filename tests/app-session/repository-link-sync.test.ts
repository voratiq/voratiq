import { buildRepositoryConnectionEnsureRequest } from "../../src/app-session/repository-link-sync.js";

describe("repository connection ensure request", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("derives request metadata from the repo root and git origin", async () => {
    const payload = await buildRepositoryConnectionEnsureRequest(
      "/Users/test/dev/Voratiq Repo",
      {
        realpathImpl: () =>
          Promise.resolve("/private/Users/test/dev/Voratiq Repo"),
        runGitCommand: () =>
          Promise.resolve("git@github.com:voratiq/voratiq.git"),
      },
    );

    expect(payload.local_repo_key).toMatch(/^repo:[a-f0-9]{64}$/u);
    expect(payload.slug).toBe("voratiq-repo");
    expect(payload.display_name).toBe("Voratiq Repo");
    expect(payload.git_remote_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(payload.git_origin_url).toBe("git@github.com:voratiq/voratiq.git");
  });

  it("uses a deterministic local_repo_key from the resolved repo root", async () => {
    const first = await buildRepositoryConnectionEnsureRequest("/repo", {
      realpathImpl: () => Promise.resolve("/resolved/repo"),
      runGitCommand: () => Promise.resolve(""),
    });
    const second = await buildRepositoryConnectionEnsureRequest("/repo", {
      realpathImpl: () => Promise.resolve("/resolved/repo"),
      runGitCommand: () => Promise.resolve(""),
    });

    expect(first.local_repo_key).toEqual(second.local_repo_key);
  });
});
