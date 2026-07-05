import { useManagedAuth } from "./useManagedAuth";

export function useCodexOauth() {
  return useManagedAuth("codex_oauth");
}
