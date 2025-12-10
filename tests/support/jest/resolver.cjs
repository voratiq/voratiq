const { defaultResolver } = require("jest-resolve");

function tryResolve(alternatives, options, resolver) {
  for (const candidate of alternatives) {
    if (!candidate) {
      continue;
    }
    try {
      return resolver(candidate, options);
    } catch (error) {
      if (error && typeof error.message === "string") {
        continue;
      }
    }
  }
  return undefined;
}

module.exports = (request, options) => {
  const resolver = options.defaultResolver ?? defaultResolver;
  try {
    return resolver(request, options);
  } catch (initialError) {
    if (request.endsWith(".js")) {
      const withoutExtension = request.slice(0, -3);
      const rewriteCandidates = [
        `${withoutExtension}.ts`,
        `${withoutExtension}.tsx`,
        `${withoutExtension}.mts`,
        withoutExtension,
      ];
      const resolved = tryResolve(rewriteCandidates, options, resolver);
      if (resolved) {
        return resolved;
      }
    }

    throw initialError;
  }
};
