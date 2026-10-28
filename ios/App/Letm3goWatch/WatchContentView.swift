import SwiftUI

struct WatchContentView: View {
    @ObservedObject var recorder: WatchRecorder
    @ObservedObject private var link = WatchConnectivitySession.shared

    private var activities: [String] {
        ["MTB", "Cycling", "Road cycling", "Running", "Hiking", "Walking", "Kitesurfing", "Other"]
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Text("LETM3GO")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)

                if recorder.hasRide {
                    metrics
                    controls
                } else {
                    start
                }

                Text(recorder.status)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)

                if link.pending > 0 {
                    Label("\(link.pending) ride\(link.pending == 1 ? "" : "s") waiting for iPhone", systemImage: "iphone.radiowaves.left.and.right")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                        .multilineTextAlignment(.center)
                }

                // A ride recorded on a different account is kept but not retried; the
                // rider resolves it on the iPhone.
                if link.parked > 0 {
                    Label("\(link.parked) ride\(link.parked == 1 ? "" : "s") saved to another account", systemImage: "person.crop.circle.badge.exclamationmark")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 2)
        }
        .navigationTitle("Ride")
        .onAppear { recorder.refresh() }
    }

    private var metrics: some View {
        VStack(spacing: 6) {
            Text(String(format: "%.2f km", recorder.distanceMeters / 1000))
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .monospacedDigit()
            Text(Self.duration(recorder.activeSeconds))
                .font(.system(size: 15, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
                .monospacedDigit()
            HStack(spacing: 10) {
                Label("\(recorder.pointCount)", systemImage: "point.topleft.down.curvedto.point.bottomright.up")
                if recorder.isRecording { Text("Live") .foregroundStyle(.green) }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
    }

    private var controls: some View {
        VStack(spacing: 8) {
            if recorder.isRecording {
                Button {
                    recorder.pause()
                } label: {
                    Label("Pause", systemImage: "pause.fill")
                        .frame(maxWidth: .infinity)
                }
                .tint(.orange)
            } else {
                Button {
                    recorder.resume()
                } label: {
                    Label("Resume", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .tint(.green)
            }
            Button {
                recorder.finish()
            } label: {
                Label("Finish", systemImage: "flag.checkered")
                    .frame(maxWidth: .infinity)
            }
            .tint(.blue)
            Button(role: .destructive) {
                recorder.discard()
            } label: {
                Label("Discard", systemImage: "trash")
                    .frame(maxWidth: .infinity)
            }
            .font(.footnote)
        }
    }

    private var start: some View {
        VStack(spacing: 8) {
            Picker("Activity", selection: $recorder.activity) {
                ForEach(activities, id: \.self) { Text($0).tag($0) }
            }
            .labelsHidden()
            Button {
                recorder.start()
            } label: {
                Label("Start ride", systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .tint(.green)
            if recorder.permission == "denied" || recorder.permission == "restricted" {
                Text("Location is off. Open Settings on the Watch to allow it.")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
            }
        }
    }

    static func duration(_ seconds: Double) -> String {
        let total = Int(seconds.rounded(.down))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, secs)
            : String(format: "%d:%02d", minutes, secs)
    }
}
