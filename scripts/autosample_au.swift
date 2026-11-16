#!/usr/bin/env swift
import AppKit
import AudioToolbox
import AVFoundation
import CoreAudioKit
import Foundation

struct Config {
    var listOnly = false
    var auFilter = "UVI"
    var outDir = "assets/samples/model-d"
    var presetPath: String?
    var minNote = 24
    var maxNote = 90
    var step = 6
    var velocity: UInt8 = 100
    var holdSeconds = 3.5
    var tailSeconds = 1.0
    var sampleRate = 44100.0
}

func parseArgs() -> Config {
    var cfg = Config()
    let args = Array(CommandLine.arguments.dropFirst())
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--list":
            cfg.listOnly = true
        case "--au":
            i += 1
            if i < args.count { cfg.auFilter = args[i] }
        case "--out":
            i += 1
            if i < args.count { cfg.outDir = args[i] }
        case "--preset":
            i += 1
            if i < args.count { cfg.presetPath = args[i] }
        case "--step":
            i += 1
            if i < args.count, let v = Int(args[i]), v >= 1 { cfg.step = v }
        case "--velocity":
            i += 1
            if i < args.count, let v = UInt8(args[i]) { cfg.velocity = min(v, 127) }
        case "--help", "-h":
            print("""
            Usage: swift scripts/autosample_au.swift [options]
              --list                List installed AudioUnit instruments
              --au <name>           Filter AudioUnit name (default: "UVI")
              --out <dir>           Output directory (default: "assets/samples/model-d")
              --preset <file>       Optional .aupreset file for headless rendering
              --step <semitones>    Note interval (default: 6)
              --velocity <1..127>   MIDI velocity (default: 100)
            """)
            exit(0)
        default:
            break
        }
        i += 1
    }
    return cfg
}

func findInstruments() -> [AVAudioUnitComponent] {
    let desc = AudioComponentDescription(
        componentType: kAudioUnitType_MusicDevice,
        componentSubType: 0,
        componentManufacturer: 0,
        componentFlags: 0,
        componentFlagsMask: 0
    )
    return AVAudioUnitComponentManager.shared().components(matching: desc)
}

func renderSamples(
    engine: AVAudioEngine,
    instrument: AVAudioUnitMIDIInstrument,
    outDir: String,
    cfg: Config,
    progress: ((String) -> Void)? = nil
) throws {
    let outURL = URL(fileURLWithPath: outDir, isDirectory: true)
    try FileManager.default.createDirectory(at: outURL, withIntermediateDirectories: true)

    let format = AVAudioFormat(standardFormatWithSampleRate: cfg.sampleRate, channels: 2)!
    let maxFrames: AVAudioFrameCount = 1024

    engine.stop()
    try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: maxFrames)
    try engine.start()

    let notes = Array(stride(from: cfg.minNote, through: cfg.maxNote, by: cfg.step))
    let holdFrames = Int(cfg.holdSeconds * cfg.sampleRate)
    let tailFrames = Int(cfg.tailSeconds * cfg.sampleRate)
    let totalFrames = holdFrames + tailFrames

    for (idx, note) in notes.enumerated() {
        progress?("Rendering note \(note) (\(idx + 1)/\(notes.count))...")
        let fileURL = outURL.appendingPathComponent("\(note).wav")
        let audioFile = try AVAudioFile(
            forWriting: fileURL,
            settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: cfg.sampleRate,
                AVNumberOfChannelsKey: 2,
                AVLinearPCMBitDepthKey: 24,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
            ]
        )

        let buf = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: maxFrames)!
        instrument.startNote(UInt8(note), withVelocity: cfg.velocity, onChannel: 0)

        var rendered = 0
        var noteOffSent = false
        while rendered < totalFrames {
            if !noteOffSent && rendered >= holdFrames {
                instrument.stopNote(UInt8(note), onChannel: 0)
                noteOffSent = true
            }
            let framesToRender = AVAudioFrameCount(min(Int(maxFrames), totalFrames - rendered))
            let status = try engine.renderOffline(framesToRender, to: buf)
            switch status {
            case .success:
                try audioFile.write(from: buf)
            case .insufficientDataFromInputNode, .cannotDoInCurrentContext:
                break
            case .error:
                throw NSError(domain: "AutoSampler", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "Offline render failed on note \(note)"
                ])
            @unknown default:
                break
            }
            rendered += Int(framesToRender)
        }

        // Brief silence flush between notes so release tails don't bleed into the next note
        let flushFrames = Int(0.2 * cfg.sampleRate)
        var flushed = 0
        while flushed < flushFrames {
            let n = AVAudioFrameCount(min(Int(maxFrames), flushFrames - flushed))
            _ = try? engine.renderOffline(n, to: buf)
            flushed += Int(n)
        }
    }

    engine.stop()
    engine.disableManualRenderingMode()
    progress?("Done! Wrote \(notes.count) WAV files to \(outDir)")
}

func sanitizeVoiceId(_ raw: String) -> String {
    let lowered = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let mapped = lowered.map { ch -> Character in
        if ch.isLetter || ch.isNumber || ch == "-" || ch == "_" {
            return ch
        }
        return "-"
    }
    let collapsed = String(mapped)
        .split(separator: "-", omittingEmptySubsequences: true)
        .joined(separator: "-")
    return collapsed.isEmpty ? "custom-voice" : collapsed
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let cfg: Config
    let component: AVAudioUnitComponent
    let engine = AVAudioEngine()
    var instrument: AVAudioUnitMIDIInstrument?
    var window: NSWindow?
    let voiceField = NSTextField(string: "model-d")
    let statusLabel = NSTextField(labelWithString: "Load a Model D voice above, name it, then click Render.")

    init(cfg: Config, component: AVAudioUnitComponent) {
        self.cfg = cfg
        self.component = component
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        AVAudioUnitMIDIInstrument.instantiate(with: component.audioComponentDescription, options: []) { avUnit, error in
            DispatchQueue.main.async {
                if let error = error {
                    NSAlert(error: error).runModal()
                    NSApp.terminate(nil)
                    return
                }
                guard let midiUnit = avUnit as? AVAudioUnitMIDIInstrument else {
                    NSApp.terminate(nil)
                    return
                }
                self.instrument = midiUnit
                self.engine.attach(midiUnit)
                self.engine.connect(midiUnit, to: self.engine.mainMixerNode, format: nil)
                try? self.engine.start()

                midiUnit.auAudioUnit.requestViewController { vc in
                    DispatchQueue.main.async {
                        self.buildWindow(auViewController: vc)
                    }
                }
            }
        }
    }

    func buildWindow(auViewController: NSViewController?) {
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 860, height: 620),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        win.title = "Takt Auto-Sampler — \(component.name)"
        win.center()

        let root = NSStackView()
        root.orientation = .vertical
        root.spacing = 10
        root.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 12, right: 12)

        if let auVC = auViewController {
            auVC.view.setContentHuggingPriority(.defaultLow, for: .vertical)
            root.addArrangedSubview(auVC.view)
        } else {
            let msg = NSTextField(labelWithString: "No AU view available. Ensure your default preset is loaded.")
            root.addArrangedSubview(msg)
        }

        let bar = NSStackView()
        bar.orientation = .horizontal
        bar.spacing = 8

        let voiceLabel = NSTextField(labelWithString: "Voice:")
        voiceField.placeholderString = "e.g. model-d-concert"
        voiceField.widthAnchor.constraint(equalToConstant: 160).isActive = true

        let testBtn = NSButton(title: "Test C4", target: self, action: #selector(onTestC4))
        let renderBtn = NSButton(title: "Render Voice", target: self, action: #selector(onRender))
        renderBtn.bezelStyle = .rounded
        renderBtn.keyEquivalent = "\r"

        statusLabel.lineBreakMode = .byTruncatingMiddle
        statusLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)
        bar.addArrangedSubview(voiceLabel)
        bar.addArrangedSubview(voiceField)
        bar.addArrangedSubview(statusLabel)
        bar.addArrangedSubview(testBtn)
        bar.addArrangedSubview(renderBtn)
        root.addArrangedSubview(bar)

        win.contentView = root
        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = win
    }

    @objc func onTestC4() {
        guard let inst = instrument else { return }
        inst.startNote(60, withVelocity: cfg.velocity, onChannel: 0)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            inst.stopNote(60, onChannel: 0)
        }
    }

    @objc func onRender() {
        guard let inst = instrument else { return }
        let voiceId = sanitizeVoiceId(voiceField.stringValue)
        let targetDir = "assets/samples/\(voiceId)"
        statusLabel.stringValue = "Rendering '\(voiceId)' offline..."
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try renderSamples(engine: self.engine, instrument: inst, outDir: targetDir, cfg: self.cfg) { msg in
                    DispatchQueue.main.async { self.statusLabel.stringValue = msg }
                }
                DispatchQueue.main.async {
                    try? self.engine.start()
                }
            } catch {
                DispatchQueue.main.async {
                    self.statusLabel.stringValue = "Error: \(error.localizedDescription)"
                }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

let cfg = parseArgs()
let instruments = findInstruments()

if cfg.listOnly {
    for c in instruments {
        print("\(c.name) [\(c.manufacturerName)]")
    }
    exit(0)
}

guard let match = instruments.first(where: {
    $0.name.localizedCaseInsensitiveContains(cfg.auFilter) ||
    $0.manufacturerName.localizedCaseInsensitiveContains(cfg.auFilter)
}) else {
    fputs("No AudioUnit instrument matching '\(cfg.auFilter)'. Available:\n", stderr)
    for c in instruments {
        fputs("  - \(c.name) (\(c.manufacturerName))\n", stderr)
    }
    exit(1)
}

if let presetPath = cfg.presetPath {
    let engine = AVAudioEngine()
    let sem = DispatchSemaphore(value: 0)
    var loadedUnit: AVAudioUnitMIDIInstrument?
    AVAudioUnitMIDIInstrument.instantiate(with: match.audioComponentDescription, options: []) { avUnit, err in
        if let err = err {
            fputs("Failed to load AU: \(err)\n", stderr)
            exit(1)
        }
        loadedUnit = avUnit as? AVAudioUnitMIDIInstrument
        sem.signal()
    }
    sem.wait()

    guard let inst = loadedUnit else { exit(1) }
    let plistData = try Data(contentsOf: URL(fileURLWithPath: presetPath))
    let plist = try PropertyListSerialization.propertyList(from: plistData, format: nil)
    inst.auAudioUnit.fullState = plist as? [String: Any]

    engine.attach(inst)
    engine.connect(inst, to: engine.mainMixerNode, format: nil)
    try renderSamples(engine: engine, instrument: inst, outDir: cfg.outDir, cfg: cfg) { print($0) }
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate(cfg: cfg, component: match)
app.delegate = delegate
app.run()

