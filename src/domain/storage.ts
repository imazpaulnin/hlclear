import type { StoredAppState, UserSettings } from "./types";

const STORAGE_KEY = "hlclear.state.v1";

export const defaultSettings: UserSettings = {
  address: "",
  network: "testnet",
  closeMode: "taker",
  slippageBps: "5",
  toleranceUsdc: "0.01",
  maxOrderMarginUsdc: "250"
};

export function loadStoredState(): StoredAppState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createEmptyState();
    }
    const parsed = JSON.parse(raw) as StoredAppState & { snapshot?: StoredAppState["snapshots"] };
    return {
      settings: {
        ...defaultSettings,
        ...parsed.settings
      },
      snapshots: sanitizeSnapshots(parsed.snapshots ?? parsed.snapshot ?? {})
    };
  } catch {
    return createEmptyState();
  }
}

export function persistState(state: StoredAppState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createEmptyState(): StoredAppState {
  return {
    settings: defaultSettings,
    snapshots: {}
  };
}

function sanitizeSnapshots(value: unknown): StoredAppState["snapshots"] {
  if (!value || typeof value !== "object") {
    return {};
  }

  const snapshots = value as Record<string, unknown>;
  const result: NonNullable<StoredAppState["snapshots"]> = {};

  for (const network of ["testnet", "mainnet"] as const) {
    const snapshot = snapshots[network];
    if (isCompatibleSnapshot(snapshot)) {
      result[network] = snapshot as NonNullable<StoredAppState["snapshots"]>[typeof network];
    }
  }

  return result;
}

function isCompatibleSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const snapshot = value as Record<string, unknown>;
  const accountIdentity = asRecord(snapshot.accountIdentity);
  const clearinghouseState = asRecord(snapshot.clearinghouseState);
  const spotClearinghouseState = asRecord(snapshot.spotClearinghouseState);

  return (
    typeof snapshot.address === "string" &&
    typeof snapshot.network === "string" &&
    Array.isArray(clearinghouseState.positions) &&
    Array.isArray(spotClearinghouseState.balances) &&
    typeof accountIdentity.mode === "string"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
