pub mod audio;
pub mod backing;
pub mod engine;
pub mod midi;
pub mod sampler;
pub mod voice;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("no audio output device available")]
    NoOutputDevice,
    #[error("audio device not found: {0}")]
    DeviceNotFound(String),
    #[error("failed to query audio devices: {0}")]
    DeviceQuery(String),
    #[error("failed to build or start audio stream: {0}")]
    StreamError(String),
    #[error("failed to load sample: {0}")]
    SampleLoad(String),
}
