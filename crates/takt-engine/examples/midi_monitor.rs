use std::time::Duration;

use takt_engine::midi::{list_midi_devices, open_midi_input};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let mut target_device: Option<String> = None;
    let mut seconds: Option<f32> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--device" if i + 1 < args.len() => {
                target_device = Some(args[i + 1].clone());
                i += 2;
            }
            "--seconds" if i + 1 < args.len() => {
                seconds = Some(args[i + 1].parse()?);
                i += 2;
            }
            _ => i += 1,
        }
    }

    let devices = list_midi_devices()?;
    println!("Available MIDI input devices ({}):", devices.len());
    for (idx, dev) in devices.iter().enumerate() {
        println!("  [{idx}] {}", dev.name);
    }

    let chosen = target_device.or_else(|| devices.first().map(|d| d.name.clone()));
    let Some(name) = chosen else {
        println!("No MIDI input devices found.");
        return Ok(());
    };

    let _handle = open_midi_input(&name, |event| {
        println!("[MIDI] {event:?}");
    })?;
    println!("Listening on '{name}'...");

    match seconds {
        Some(s) => std::thread::sleep(Duration::from_secs_f32(s.max(0.0))),
        None => loop {
            std::thread::sleep(Duration::from_secs(1));
        },
    }

    Ok(())
}

