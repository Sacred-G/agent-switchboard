import { useRef } from "react";

export function useLastValidValue<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(null);

  if (value != null) {
    ref.current = value;
  }

  return value ?? ref.current;
}
