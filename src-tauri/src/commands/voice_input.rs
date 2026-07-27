use tauri::AppHandle;

#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use objc2_foundation::{NSLocale, NSString, NSURL};
#[cfg(target_os = "macos")]
use objc2_new::AnyThread;
#[cfg(target_os = "macos")]
use objc2_speech::{
    SFSpeechRecognitionResult, SFSpeechRecognitionTaskHint, SFSpeechRecognizer,
    SFSpeechRecognizerAuthorizationStatus, SFSpeechURLRecognitionRequest,
};
#[cfg(target_os = "macos")]
use tauri_plugin_audio_recorder::{AudioFormat, AudioQuality, AudioRecorderExt, RecordingConfig};

#[cfg(target_os = "macos")]
const MAX_RECORDING_SECONDS: u32 = 120;

#[tauri::command]
pub fn voice_input_is_supported() -> bool {
    cfg!(target_os = "macos")
}

#[tauri::command]
pub async fn voice_input_start(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let output_path = format!("voice-input-{}", uuid::Uuid::new_v4());
        tauri::async_runtime::spawn_blocking(move || {
            app.audio_recorder()
                .start_recording(RecordingConfig {
                    output_path,
                    format: AudioFormat::Wav,
                    quality: AudioQuality::Low,
                    max_duration: MAX_RECORDING_SECONDS,
                    device_id: None,
                })
                .map_err(|error| map_recording_error(&error.to_string()))
        })
        .await
        .map_err(|error| format!("audio-capture:{error}"))?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("unsupported:Native voice input is not available on this platform".to_string())
    }
}

#[tauri::command]
pub async fn voice_input_stop(app: AppHandle, locale: Option<String>) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let recording = app
                .audio_recorder()
                .stop_recording()
                .map_err(|error| map_recording_error(&error.to_string()))?;
            let audio_path = std::path::PathBuf::from(&recording.file_path);

            let result = transcribe_recording(&audio_path, locale.as_deref());
            if let Err(error) = std::fs::remove_file(&audio_path) {
                log::warn!(
                    "failed to remove temporary voice recording {}: {error}",
                    audio_path.display()
                );
            }
            result
        })
        .await
        .map_err(|error| format!("recognition-failed:{error}"))?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, locale);
        Err("unsupported:Native voice input is not available on this platform".to_string())
    }
}

#[tauri::command]
pub async fn voice_input_cancel(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let recording = app
                .audio_recorder()
                .stop_recording()
                .map_err(|error| map_recording_error(&error.to_string()))?;
            if let Err(error) = std::fs::remove_file(&recording.file_path) {
                log::warn!(
                    "failed to remove cancelled voice recording {}: {error}",
                    recording.file_path
                );
            }
            Ok(())
        })
        .await
        .map_err(|error| format!("audio-capture:{error}"))?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn transcribe_recording(
    audio_path: &std::path::Path,
    locale: Option<&str>,
) -> Result<String, String> {
    request_speech_authorization()?;

    objc2::rc::autoreleasepool(|_| unsafe {
        let recognizer = locale
            .filter(|value| !value.trim().is_empty())
            .and_then(|value| {
                let locale_identifier = NSString::from_str(value);
                let locale = NSLocale::localeWithLocaleIdentifier(&locale_identifier);
                SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &locale)
            })
            .or_else(|| SFSpeechRecognizer::init(SFSpeechRecognizer::alloc()))
            .ok_or_else(|| {
                "recognition-unavailable:No speech recognizer supports the selected locale"
                    .to_string()
            })?;

        if !recognizer.isAvailable() {
            return Err(
                "recognition-unavailable:Apple Speech recognition is currently unavailable"
                    .to_string(),
            );
        }
        recognizer.setDefaultTaskHint(SFSpeechRecognitionTaskHint::Dictation);

        let path = NSString::from_str(&audio_path.to_string_lossy());
        let url = NSURL::fileURLWithPath(&path);
        let request = SFSpeechURLRecognitionRequest::initWithURL(
            SFSpeechURLRecognitionRequest::alloc(),
            &url,
        );
        request.setTaskHint(SFSpeechRecognitionTaskHint::Dictation);
        request.setShouldReportPartialResults(false);

        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let sender = std::sync::Mutex::new(Some(sender));
        let handler = RcBlock::new(
            move |result: *mut SFSpeechRecognitionResult, error: *mut objc2_foundation::NSError| {
                let Ok(mut sender) = sender.lock() else {
                    return;
                };
                let Some(sender) = sender.take() else {
                    return;
                };

                let outcome = if let Some(error) = error.as_ref() {
                    Err(format!(
                        "recognition-failed:{}",
                        error.localizedDescription()
                    ))
                } else if let Some(result) = result.as_ref() {
                    let transcript = result.bestTranscription().formattedString().to_string();
                    if transcript.trim().is_empty() {
                        Err("no-speech:No speech was recognized".to_string())
                    } else {
                        Ok(transcript)
                    }
                } else {
                    Err("no-speech:No speech was recognized".to_string())
                };
                let _ = sender.send(outcome);
            },
        );
        let _task = recognizer.recognitionTaskWithRequest_resultHandler(&request, &handler);

        receiver
            .recv_timeout(std::time::Duration::from_secs(45))
            .map_err(|_| "recognition-failed:Speech recognition timed out".to_string())?
    })
}

#[cfg(target_os = "macos")]
fn request_speech_authorization() -> Result<(), String> {
    let current = unsafe { SFSpeechRecognizer::authorizationStatus() };
    let status = if current == SFSpeechRecognizerAuthorizationStatus::NotDetermined {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let handler = RcBlock::new(move |status| {
            let _ = sender.send(status);
        });
        unsafe { SFSpeechRecognizer::requestAuthorization(&handler) };
        receiver
            .recv_timeout(std::time::Duration::from_secs(60))
            .map_err(|_| {
                "not-allowed:Speech recognition permission request timed out".to_string()
            })?
    } else {
        current
    };

    if status == SFSpeechRecognizerAuthorizationStatus::Authorized {
        Ok(())
    } else {
        Err("not-allowed:Speech recognition permission was denied".to_string())
    }
}

#[cfg(target_os = "macos")]
fn map_recording_error(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("permission") || lower.contains("denied") {
        format!("not-allowed:{message}")
    } else if lower.contains("already recording") {
        format!("already-recording:{message}")
    } else {
        format!("audio-capture:{message}")
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn recording_errors_are_mapped_to_stable_frontend_codes() {
        assert!(super::map_recording_error("permission denied").starts_with("not-allowed:"));
        assert!(super::map_recording_error("Already recording").starts_with("already-recording:"));
        assert!(super::map_recording_error("no input device").starts_with("audio-capture:"));
    }
}
