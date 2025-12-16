Ping the npm registry repeatedly to verify connectivity.

- Run: `curl -sf https://registry.npmjs.org/`
- If the request fails, retry up to 10 times with no delay between attempts.
- Save either the response body or the final error message to `npm-ping-result.txt` at the repository root.
