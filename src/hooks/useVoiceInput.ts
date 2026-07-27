import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type VoiceMode = "native" | "web" | null;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(":", 1)[0]?.trim();
  return code || "recognition-failed";
}

export function useVoiceInput(onTranscript: (text: string) => void) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const latestTranscriptRef = useRef("");
  const onTranscriptRef = useRef(onTranscript);
  const modeRef = useRef<VoiceMode>(null);
  const mountedRef = useRef(true);
  const nativeRecordingRef = useRef(false);
  const [mode, setMode] = useState<VoiceMode>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isSupported = mode !== null;

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    let cancelled = false;
    void invoke<boolean>("voice_input_is_supported")
      .then((supported) => {
        if (cancelled) return;
        const detectedMode: VoiceMode = supported
          ? "native"
          : getSpeechRecognition()
            ? "web"
            : null;
        modeRef.current = detectedMode;
        setMode(detectedMode);
      })
      .catch(() => {
        if (cancelled) return;
        const detectedMode: VoiceMode = getSpeechRecognition() ? "web" : null;
        modeRef.current = detectedMode;
        setMode(detectedMode);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopWebRecognition = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const startWebRecognition = useCallback(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition || recognitionRef.current) return;

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    finalTranscriptRef.current = "";
    latestTranscriptRef.current = "";
    setPreview("");
    setError(null);

    recognition.onresult = (event) => {
      let interim = "";
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalTranscriptRef.current += transcript;
        } else {
          interim += transcript;
        }
      }
      latestTranscriptRef.current =
        `${finalTranscriptRef.current}${interim}`.trim();
      setPreview(latestTranscriptRef.current);
    };

    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setError(event.error);
      }
    };

    recognition.onend = () => {
      const transcript =
        finalTranscriptRef.current.trim() || latestTranscriptRef.current;
      recognitionRef.current = null;
      setIsListening(false);
      setPreview("");
      if (transcript) onTranscriptRef.current(transcript);
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setError("start-failed");
    }
  }, []);

  const start = useCallback(() => {
    setError(null);
    setPreview("");
    if (modeRef.current === "native") {
      setIsStarting(true);
      void invoke<void>("voice_input_start")
        .then(() => {
          nativeRecordingRef.current = true;
          if (mountedRef.current) {
            setIsListening(true);
          } else {
            nativeRecordingRef.current = false;
            void invoke("voice_input_cancel").catch(() => {});
          }
        })
        .catch((reason) => {
          if (mountedRef.current) setError(errorCode(reason));
        })
        .finally(() => {
          if (mountedRef.current) setIsStarting(false);
        });
      return;
    }
    startWebRecognition();
  }, [startWebRecognition]);

  const stop = useCallback(() => {
    if (modeRef.current !== "native") {
      stopWebRecognition();
      return;
    }

    setIsListening(false);
    setIsTranscribing(true);
    setPreview("");
    nativeRecordingRef.current = false;
    void invoke<string>("voice_input_stop", {
      locale: navigator.language || "en-US",
    })
      .then((transcript) => {
        if (mountedRef.current && transcript.trim()) {
          onTranscriptRef.current(transcript.trim());
        }
      })
      .catch((reason) => {
        if (mountedRef.current) setError(errorCode(reason));
      })
      .finally(() => {
        if (mountedRef.current) setIsTranscribing(false);
      });
  }, [stopWebRecognition]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
        recognitionRef.current = null;
      }
      if (nativeRecordingRef.current) {
        nativeRecordingRef.current = false;
        void invoke("voice_input_cancel").catch(() => {});
      }
    };
  }, []);

  return {
    isSupported,
    isStarting,
    isListening,
    isTranscribing,
    preview,
    error,
    start,
    stop,
  };
}
