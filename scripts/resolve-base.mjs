function resolveBasePath() {
  const explicit = process.env.VITE_BASE_PATH;
  if (explicit && explicit.trim().length > 0) {
    return normalizeBase(explicit);
  }

  const repository = process.env.GITHUB_REPOSITORY;
  if (repository && repository.includes("/")) {
    const [, repo] = repository.split("/");
    return normalizeBase(`/${repo}/`);
  }

  return "/";
}

function normalizeBase(value) {
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

process.stdout.write(resolveBasePath());
