#if KITE_DIAGNOSTIC
import SwiftUI

struct KiteDiagnosticView: View {
    @ObservedObject private var kite = KiteDiagnosticRecorder.shared
    @Environment(\.scenePhase) private var scenePhase

    private var verdict: (String, Color) {
        switch kite.status {
        case .idle: return ("Not recording", .secondary)
        case .requested: return ("Requested — no samples yet", .orange)
        case .delivering: return ("Sensors delivering", .green)
        case .stalled: return ("STALLED — no samples", .red)
        case .resumedAfterGap: return ("Resumed after a gap", .yellow)
        case .stopping: return ("Stopping…", .orange)
        case .saved: return ("Saved on Watch", .green)
        case .failed: return ("Failed", .red)
        }
    }

    var body: some View {
        List {
            Section {
                Text(verdict.0).font(.headline).foregroundStyle(verdict.1)
                if kite.isRecording {
                    Button("Stop Diagnostic Recording", role: .destructive) { kite.stop() }
                } else {
                    Button("Start Diagnostic Recording") { kite.start() }
                    Toggle("Extended runtime", isOn: $kite.useExtendedRuntime)
                }
                if !kite.message.isEmpty { Text(kite.message).font(.caption2) }
            }
            Section("Live") {
                row("Duration", WatchFormat.clock(kite.elapsed))
                row("Last sample", kite.lastSampleAgo.map { String(format: "%.1f s ago", $0) } ?? "none yet")
                row("Extended runtime", kite.extendedState)
                ForEach(KiteStream.allCases, id: \.self) { s in
                    row(s.rawValue, "\(kite.counts[s] ?? 0) · \(String(format: "%.1f", kite.rates[s] ?? 0)) Hz")
                }
            }
            if !kite.recentEvents.isEmpty {
                Section("Events") {
                    ForEach(Array(kite.recentEvents.enumerated()), id: \.offset) { _, e in
                        Text("\(e.kind): \(e.message)").font(.caption2).foregroundStyle(["sensor-error", "stalled", "interruption", "sensor-unavailable"].contains(e.kind) ? .red : .secondary)
                    }
                }
            }
            Section("Recordings") {
                ForEach(kite.recordings) { r in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(WatchFormat.clock(r.durationSeconds)) · \(r.bytes / 1024) KB" + (r.complete ? "" : " · incomplete")).font(.caption)
                        Text(r.delivered ? "On iPhone" : (r.lastError ?? "Not on iPhone yet")).font(.caption2).foregroundStyle(r.delivered ? .green : .orange)
                        HStack {
                            Button("Send") { kite.send(r.id) }
                            Button("Delete", role: .destructive) { kite.delete(r.id) }
                        }.font(.caption2)
                    }
                }
                if kite.recordings.isEmpty { Text("None").font(.caption2).foregroundStyle(.secondary) }
            }
        }
        .navigationTitle("Kite Diagnostic")
        .onChange(of: scenePhase) { kite.scene($0) }
        .onAppear { kite.refreshRecordings(); kite.retryUndelivered() }
    }

    private func row(_ k: String, _ v: String) -> some View {
        HStack { Text(k).font(.caption2); Spacer(); Text(v).font(.caption2).foregroundStyle(.secondary) }
    }
}
#endif
