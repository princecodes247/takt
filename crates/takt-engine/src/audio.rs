use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, SampleFormat, SizedSample, StreamConfig, SupportedBufferSize};

use crate::EngineError;

const COMMON_BUFFER_SIZES: &[u32] = &[64, 128, 256, 512, 1024];

/// Metadata describing an available audio output device.
#[derive(Debug, Clone)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
    pub default_sample_rate: u32,
    pub channels: u16,
    pub supported_buffer_sizes: Vec<u32>,
}

/// Configuration for opening an audio output stream.
#[derive(Debug, Clone, Default)]
pub struct AudioStreamConfig {
    pub device_name: Option<String>,
    pub buffer_size: Option<u32>,
}

/// Active audio output stream and its negotiated parameters.
pub struct AudioStreamHandle {
    _stream: cpal::Stream,
    pub device_name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub buffer_size: Option<u32>,
    pub estimated_latency_ms: f32,
}

/// Lists all available audio output devices on the default host.
pub fn list_output_devices() -> Result<Vec<AudioDeviceInfo>, EngineError> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|d| d.name().ok());

    let devices = host
        .output_devices()
        .map_err(|e| EngineError::DeviceQuery(e.to_string()))?;

    let mut result = Vec::new();
    for device in devices {
        let Ok(name) = device.name() else {
            continue;
        };
        let Ok(default_cfg) = device.default_output_config() else {
            continue;
        };

        let supported_buffer_sizes = match default_cfg.buffer_size() {
            SupportedBufferSize::Range { min, max } => COMMON_BUFFER_SIZES
                .iter()
                .copied()
                .filter(|&size| size >= *min && size <= *max)
                .collect(),
            SupportedBufferSize::Unknown => COMMON_BUFFER_SIZES.to_vec(),
        };

        result.push(AudioDeviceInfo {
            is_default: default_name.as_deref() == Some(name.as_str()),
            name,
            default_sample_rate: default_cfg.sample_rate().0,
            channels: default_cfg.channels(),
            supported_buffer_sizes,
        });
    }

    Ok(result)
}

/// Opens an audio output stream and starts playback immediately.
///
/// `render_fn` is called on the real-time audio thread with:
/// `(interleaved_f32_buffer, channels, sample_rate)`.
pub fn open_output_stream<F>(
    config: &AudioStreamConfig,
    mut render_fn: F,
) -> Result<AudioStreamHandle, EngineError>
where
    F: FnMut(&mut [f32], u16, u32) + Send + 'static,
{
    let host = cpal::default_host();
    let device = match &config.device_name {
        Some(target_name) => host
            .output_devices()
            .map_err(|e| EngineError::DeviceQuery(e.to_string()))?
            .find(|d| d.name().ok().as_deref() == Some(target_name.as_str()))
            .ok_or_else(|| EngineError::DeviceNotFound(target_name.clone()))?,
        None => host
            .default_output_device()
            .ok_or(EngineError::NoOutputDevice)?,
    };

    let device_name = device
        .name()
        .unwrap_or_else(|_| "Unknown Output Device".to_string());
    let supported_cfg = device
        .default_output_config()
        .map_err(|e| EngineError::StreamError(e.to_string()))?;

    let sample_format = supported_cfg.sample_format();
    let mut stream_cfg: StreamConfig = supported_cfg.into();
    if let Some(frames) = config.buffer_size {
        stream_cfg.buffer_size = BufferSize::Fixed(frames);
    }

    let sample_rate = stream_cfg.sample_rate.0;
    let channels = stream_cfg.channels;
    let effective_buffer = config.buffer_size;
    let estimated_latency_ms = effective_buffer
        .map(|frames| (frames as f32 / sample_rate as f32) * 1000.0)
        .unwrap_or_else(|| (512.0 / sample_rate as f32) * 1000.0);

    let err_fn = |err| {
        eprintln!("takt-engine audio stream error: {err}");
    };

    let stream = match sample_format {
        SampleFormat::F32 => build_typed_stream::<f32, _>(&device, &stream_cfg, move |out, ch, sr| {
            render_fn(out, ch, sr);
        }, err_fn)?,
        SampleFormat::I16 => build_typed_stream::<i16, _>(&device, &stream_cfg, move |out, ch, sr| {
            render_fn(out, ch, sr);
        }, err_fn)?,
        SampleFormat::U16 => build_typed_stream::<u16, _>(&device, &stream_cfg, move |out, ch, sr| {
            render_fn(out, ch, sr);
        }, err_fn)?,
        other => {
            return Err(EngineError::StreamError(format!(
                "unsupported sample format: {other:?}"
            )));
        }
    };

    stream
        .play()
        .map_err(|e| EngineError::StreamError(e.to_string()))?;

    Ok(AudioStreamHandle {
        _stream: stream,
        device_name,
        sample_rate,
        channels,
        buffer_size: effective_buffer,
        estimated_latency_ms,
    })
}

fn build_typed_stream<T, F>(
    device: &cpal::Device,
    config: &StreamConfig,
    mut render_f32: F,
    err_fn: fn(cpal::StreamError),
) -> Result<cpal::Stream, EngineError>
where
    T: SizedSample + FromF32Sample,
    F: FnMut(&mut [f32], u16, u32) + Send + 'static,
{
    let channels = config.channels;
    let sample_rate = config.sample_rate.0;
    // Pre-allocate scratch buffer for non-f32 device formats so the audio callback never allocates.
    let initial_cap = if T::IS_F32 { 0 } else { 8192 * channels as usize };
    let mut scratch = vec![0.0_f32; initial_cap];

    device
        .build_output_stream(
            config,
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                if T::IS_F32 {
                    // SAFETY: T is f32, so the slice has identical layout.
                    let f32_slice = unsafe {
                        std::slice::from_raw_parts_mut(data.as_mut_ptr() as *mut f32, data.len())
                    };
                    render_f32(f32_slice, channels, sample_rate);
                    return;
                }

                let len = data.len().min(scratch.len());
                let buf = &mut scratch[..len];
                render_f32(buf, channels, sample_rate);
                for (dst, &src) in data.iter_mut().zip(buf.iter()) {
                    *dst = T::from_f32(src);
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| EngineError::StreamError(e.to_string()))
}

trait FromF32Sample {
    const IS_F32: bool;
    fn from_f32(sample: f32) -> Self;
}

impl FromF32Sample for f32 {
    const IS_F32: bool = true;
    #[inline]
    fn from_f32(sample: f32) -> Self {
        sample
    }
}

impl FromF32Sample for i16 {
    const IS_F32: bool = false;
    #[inline]
    fn from_f32(sample: f32) -> Self {
        (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
    }
}

impl FromF32Sample for u16 {
    const IS_F32: bool = false;
    #[inline]
    fn from_f32(sample: f32) -> Self {
        let norm = (sample.clamp(-1.0, 1.0) + 1.0) * 0.5;
        (norm * u16::MAX as f32) as u16
    }
}
