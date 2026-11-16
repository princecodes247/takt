use std::time::{Duration, Instant};

use takt_engine::engine::TaktEngine;
use takt_engine::midi::MidiEvent;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let mut seconds: f64 = 10.0;
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--seconds" && i + 1 < args.len() {
            seconds = args[i + 1].parse()?;
            i += 2;
        } else {
            i += 1;
        }
    }

    let mut engine = TaktEngine::new(None)?;
    let sounds = ["piano", "epiano", "pad"];
    let chord: [u8; 10] = [48, 52, 55, 59, 60, 64, 67, 71, 72, 76];

    let start = Instant::now();
    let total = Duration::from_secs_f64(seconds.max(0.5));
    let mut cycle: u64 = 0;

    println!("Starting Takt soak test for {seconds:.1}s...");
    while start.elapsed() < total {
        let sound_id = sounds[(cycle as usize) % sounds.len()];
        engine.select_sound(sound_id)?;

        // Sustain down + 10-note chord
        engine.inject_midi_event(MidiEvent::SustainPedal {
            channel: 0,
            pressed: true,
        });
        for (idx, &note) in chord.iter().enumerate() {
            engine.inject_midi_event(MidiEvent::NoteOn {
                channel: 0,
                note,
                velocity: 85 + (idx as u8 * 3),
            });
        }
        std::thread::sleep(Duration::from_millis(80));

        // Pitch bend + mod wheel
        engine.inject_midi_event(MidiEvent::PitchBend {
            channel: 0,
            value: 2048,
        });
        engine.inject_midi_event(MidiEvent::ModWheel {
            channel: 0,
            value: 64,
        });

        // Key-off while sustain is still down
        for &note in &chord {
            engine.inject_midi_event(MidiEvent::NoteOff { channel: 0, note });
        }
        std::thread::sleep(Duration::from_millis(80));

        // Sustain up + reset bend
        engine.inject_midi_event(MidiEvent::SustainPedal {
            channel: 0,
            pressed: false,
        });
        engine.inject_midi_event(MidiEvent::PitchBend {
            channel: 0,
            value: 0,
        });
        std::thread::sleep(Duration::from_millis(120));

        if cycle % 10 == 0 {
            let st = engine.status();
            println!(
                "[{:>6.1}s] sound={} voices={} playing={} latency={:.2}ms",
                start.elapsed().as_secs_f64(),
                st.active_sound_id,
                st.active_voices,
                st.is_playing,
                st.estimated_latency_ms
            );
        }
        cycle += 1;
    }

    engine.panic();
    std::thread::sleep(Duration::from_millis(50));
    let final_status = engine.status();
    assert_eq!(
        final_status.active_voices, 0,
        "stuck voices detected after panic!"
    );
    println!("Soak test passed cleanly ({cycle} cycles, 0 stuck voices).");
    Ok(())
}

