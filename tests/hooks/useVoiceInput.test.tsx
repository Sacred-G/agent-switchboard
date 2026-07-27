import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceInput } from "@/hooks/useVoiceInput";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function StrictModeWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

describe("useVoiceInput", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "voice_input_is_supported") return Promise.resolve(true);
      if (command === "voice_input_stop") {
        return Promise.resolve("native transcript");
      }
      return Promise.resolve();
    });
  });

  it("records and returns a native transcript under React StrictMode", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput(onTranscript), {
      wrapper: StrictModeWrapper,
    });

    await waitFor(() => expect(result.current.isSupported).toBe(true));

    act(() => result.current.start());
    await waitFor(() => expect(result.current.isListening).toBe(true));

    act(() => result.current.stop());
    await waitFor(() =>
      expect(onTranscript).toHaveBeenCalledWith("native transcript"),
    );

    expect(invokeMock).toHaveBeenCalledWith("voice_input_start");
    expect(invokeMock).toHaveBeenCalledWith("voice_input_stop", {
      locale: navigator.language || "en-US",
    });
    expect(result.current.isTranscribing).toBe(false);
  });
});
