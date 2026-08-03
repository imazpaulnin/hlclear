import type { StoredAppState, UserSettings } from "./types";

const STORAGE_KEY = "hlclear.state.v1";

export const defaultSettings: UserSettings = {
  address: "",
  network: "testnet",
  closeMode: "taker",
  slippageBps: "5",
  toleranceUsdc: "0.01"
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
      snapshots: parsed.snapshots ?? parsed.snapshot ?? {}
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
