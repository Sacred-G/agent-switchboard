import { useState, useCallback, useEffect, useRef } from "react";
import TOML from "smol-toml";

export function useCodexTomlValidation() {
  const [configError, setConfigError] = useState("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const validateToml = useCallback((tomlText: string): boolean => {
    if (!tomlText.trim()) {
      setConfigError("");
      return true;
    }

    try {
      TOML.parse(tomlText);
      setConfigError("");
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "TOML format error";
      setConfigError(errorMessage);
      return false;
    }
  }, []);

  const debouncedValidate = useCallback(
    (tomlText: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        validateToml(tomlText);
      }, 500);
    },
    [validateToml],
  );

  const clearError = useCallback(() => {
    setConfigError("");
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    configError,
    validateToml,
    debouncedValidate,
    clearError,
  };
}
