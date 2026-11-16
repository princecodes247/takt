use std::f32::consts::TAU;
use std::time::Duration;

use takt_engine::audio::{list_output_devices, open_output_stream, AudioStreamConfig};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let mut device_name: Option<String> = None;
    let mut buffer_size: Option<u32> = None;
    let mut freq_hz: f32 = 440.0;
    let mut seconds: f32 = 2.0;
    let mut list_only = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--device" if i + 1 < args.len() => {
                device_name = Some(args[i + 1].clone());
                i += 2;
            }
            "--buffer-size" if i + 1 < args.len() => {
                buffer_size = Some(args[i + 1].parse()?);
                i += 2;
            }
            "--freq" if i + 1 < args.len() => {
                freq_hz = args[i + 1].parse()?;
                i += 2;
            }
            "--seconds" if i + 1 < args.len() => {
                seconds = args[i + 1].parse()?;
                i += 2;
            }
            "--list" => {
                list_only = true;
                i += 1;
            }
            _ => i += 1,
        }
    }

    let devices = list_output_devices()?;
    println!("Available audio output devices:");
    for (idx, dev) in devices.iter().enumerate() {
        let tag = if dev.is_default { " (default)" } else { "" };
        println!(
            "  [{idx}] {}{} — {} Hz, {} ch, buffers {:?}",
            dev.name, tag, dev.default_sample_rate, dev.channels, dev.supported_buffer_sizes
        );
    }

    if list_only {
        return Ok(());
    }

    let mut phase = 0.0_f32;
    let gain = 0.15_f32;
    let handle = open_output_stream(
        &AudioStreamConfig {
            device_name,
            buffer_size,
        },
        move |output, channels, sample_rate| {
            let ch = channels.max(1) as usize;
            let phase_inc = freq_hz / sample_rate as f32;
            for frame in output.chunks_mut(ch) {
                let sample = (phase * TAU).sin() * gain;
                phase = (phase + phase_inc).fract();
                for s in frame.iter_mut() {
                    *s = sample;
                }
            }
        },
    )?;

    println!(
        "Playing {freq_hz} Hz test tone on '{}' ({} Hz, {} ch, est. buffer latency {:.2} ms) for {seconds}s...",
        handle.device_name, handle.sample_rate, handle.channels, handle.estimated_latency_ms
    );

    std::thread::sleep(Duration::from_secs_f32(seconds.max(0.0)));
    Ok(())
}

