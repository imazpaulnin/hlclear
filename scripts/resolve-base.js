export function resolveBasePath() {
    var explicit = process.env.VITE_BASE_PATH;
    if (explicit && explicit.trim().length > 0) {
        return normalizeBase(explicit);
    }
    var repository = process.env.GITHUB_REPOSITORY;
    if (repository && repository.includes("/")) {
        var _a = repository.split("/"), repo = _a[1];
        return normalizeBase("/".concat(repo, "/"));
    }
    return "/";
}
function normalizeBase(value) {
    var withLeading = value.startsWith("/") ? value : "/".concat(value);
    return withLeading.endsWith("/") ? withLeading : "".concat(withLeading, "/");
}
