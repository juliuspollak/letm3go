import SwiftUI

// The watch is for starting, following and finishing an activity, and for a
// quick look at recent ones. Home has two actions (Resume first when a ride is
// open); starting is Activity → (subtype) → (bike) → Start, with the last setup
// one tap away. Recording, the outbox and acknowledgements are WatchRecorder's
// and WatchConnectivitySession's, unchanged.
enum WatchRoute: Hashable {
    case activities
    case family(String)
    case equipment(String)
    case ready(WatchStartConfig)
    case recording
    case summary
    case history
    case detail(String)
}

struct WatchContentView: View {
    @ObservedObject var recorder: WatchRecorder
    @ObservedObject private var link = WatchConnectivitySession.shared
    @State private var path: [WatchRoute]

    init(recorder: WatchRecorder, initialPath: [WatchRoute] = []) {
        self.recorder = recorder
        _path = State(initialValue: initialPath)
    }

    var body: some View {
        NavigationStack(path: $path) {
            WatchHome(recorder: recorder, link: link, path: $path)
                .navigationDestination(for: WatchRoute.self) { route in
                    switch route {
                    case .activities: WatchActivityGrid(recorder: recorder, link: link, path: $path, family: nil)
                    case .family(let id): WatchActivityGrid(recorder: recorder, link: link, path: $path, family: id)
                    case .equipment(let activity): WatchEquipmentPicker(recorder: recorder, link: link, path: $path, activity: activity)
                    case .ready(let setup): WatchReadyView(recorder: recorder, path: $path, setup: setup)
                    case .recording: WatchRecordingView(recorder: recorder, path: $path)
                    case .summary: WatchSummaryView(recorder: recorder, link: link, path: $path)
                    case .history: WatchHistoryList(recorder: recorder, link: link, path: $path)
                    case .detail(let id): WatchHistoryDetail(recorder: recorder, link: link, path: $path, id: id)
                    }
                }
        }
        .onAppear { recorder.refresh() }
        .onChange(of: link.ownerID) { _ in recorder.loadAccountData() }
    }
}

// MARK: - Shared pieces

enum WatchFormat {
    static func clock(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded(.down)))
        let hours = total / 3600, minutes = (total % 3600) / 60, secs = total % 60
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, secs) : String(format: "%d:%02d", minutes, secs)
    }
    static func distance(_ meters: Double) -> String {
        meters < 1000 ? "\(Int(meters.rounded())) m" : String(format: "%.2f km", meters / 1000)
    }
    // Pace for activities on foot, speed on a bike or board.
    static func pace(activity: String, meters: Double, seconds: Double) -> (value: String, label: String) {
        let onFoot = ["Walking", "Running", "Hiking"].contains(activity)
        guard meters >= 20, seconds >= 10 else { return ("—", onFoot ? "PACE /KM" : "KM/H") }
        if onFoot {
            let perKm = seconds / (meters / 1000)
            return (perKm < 5999 ? String(format: "%d:%02d", Int(perKm) / 60, Int(perKm) % 60) : "—", "PACE /KM")
        }
        return (String(format: "%.1f", meters / seconds * 3.6), "KM/H")
    }
    static func date(_ seconds: Double) -> String {
        let date = Date(timeIntervalSince1970: seconds)
        if Calendar.current.isDateInToday(date) { return "Today " + date.formatted(date: .omitted, time: .shortened) }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }
}

struct WatchActivityIcon: View {
    let symbol: String
    var tint: Color = .green
    var size: CGFloat = 26
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size * 1.7, height: size * 1.7)
            .background(tint.opacity(0.18), in: Circle())
            .accessibilityHidden(true)
    }
}

// A large, full-width action: icon, title and an optional line below.
struct WatchActionButton: View {
    let title: String
    var detail: String? = nil
    let symbol: String
    var tint: Color = .green
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol).font(.title3.weight(.semibold)).foregroundStyle(tint).frame(width: 28).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.headline).lineLimit(2).minimumScaleFactor(0.8)
                    if let detail { Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Home

struct WatchHome: View {
    @ObservedObject var recorder: WatchRecorder
    @ObservedObject var link: WatchConnectivitySession
    @Binding var path: [WatchRoute]

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if recorder.hasRide {
                    WatchActionButton(title: "Resume Activity", detail: resumeDetail, symbol: recorder.isRecording ? "record.circle" : "pause.circle.fill", tint: .orange) {
                        path = [.recording]
                    }
                    .tint(.orange)
                } else {
                    WatchActionButton(title: "Start Activity", symbol: "play.fill") { path = [.activities] }
                    if let last = recorder.memory.last {
                        WatchActionButton(title: "Start again", detail: [last.title, last.detail].compactMap { $0 }.joined(separator: " · "),
                                          symbol: WatchCatalog.choice(last.activity)?.symbol ?? "arrow.clockwise", tint: .mint) {
                            path = [.ready(last)]
                        }
                    }
                }
                WatchActionButton(title: "Past Activities", detail: waitingDetail, symbol: "clock.arrow.circlepath", tint: .blue) { path = [.history] }
            }
        }
        .navigationTitle("Letm3go")
    }

    private var resumeDetail: String {
        "\(recorder.config.title) · \(WatchFormat.clock(recorder.activeSeconds))"
    }
    private var waitingDetail: String? {
        if link.broken > 0 { return "\(link.broken) couldn't sync" }
        if link.pending > 0 { return "\(link.pending) waiting for iPhone" }
        return nil
    }
}

// MARK: - Choosing

struct WatchActivityGrid: View {
    @ObservedObject var recorder: WatchRecorder
    @ObservedObject var link: WatchConnectivitySession
    @Binding var path: [WatchRoute]
    let family: String?

    struct Tile: Identifiable { let id: String; let title: String; let symbol: String }
    private var items: [Tile] {
        if let family, let group = WatchCatalog.families.first(where: { $0.id == family }) {
            return group.choices.map { Tile(id: $0.activity, title: $0.title, symbol: $0.symbol) }
        }
        return WatchCatalog.families.map { Tile(id: $0.id, title: $0.title, symbol: $0.symbol) }
    }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(items) { item in
                    Button { choose(item.id) } label: {
                        VStack(spacing: 6) {
                            WatchActivityIcon(symbol: item.symbol, size: 22)
                            Text(item.title).font(.footnote.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                        }
                        .frame(maxWidth: .infinity, minHeight: 84)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel(item.title)
                }
            }
        }
        .navigationTitle(family ?? "Activity")
    }

    private func choose(_ id: String) {
        if family == nil, let group = WatchCatalog.families.first(where: { $0.id == id }), group.hasSubtypes {
            path.append(.family(id))
            return
        }
        let activity = family == nil ? (WatchCatalog.families.first { $0.id == id }?.choices.first?.activity ?? id) : id
        if !WatchEquipmentCatalog.compatible(link.equipment, activity: activity).isEmpty {
            path.append(.equipment(activity))
        } else {
            // No bikes on the watch: start without one, or with the one remembered.
            path.append(.ready(WatchStartConfig(activity: activity, equipment: recorder.rememberedEquipment(for: activity))))
        }
    }
}

struct WatchEquipmentPicker: View {
    @ObservedObject var recorder: WatchRecorder
    @ObservedObject var link: WatchConnectivitySession
    @Binding var path: [WatchRoute]
    let activity: String

    private var bikes: [WatchEquipment] {
        let items = WatchEquipmentCatalog.compatible(link.equipment, activity: activity)
        guard let last = recorder.rememberedEquipment(for: activity), let index = items.firstIndex(where: { $0.id == last.id }) else { return items }
        var ordered = items; ordered.insert(ordered.remove(at: index), at: 0)
        return ordered
    }

    var body: some View {
        List {
            ForEach(bikes) { bike in
                Button { path.append(.ready(WatchStartConfig(activity: activity, equipment: bike))) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: bike.isElectric ? "bolt.fill" : "bicycle").foregroundStyle(bike.isElectric ? .yellow : .green).frame(width: 24)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(bike.name).font(.headline).lineLimit(2)
                            Text(bike.isElectric ? "E-bike" : "Bike").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .accessibilityLabel("\(bike.name), \(bike.isElectric ? "e-bike" : "bike")")
            }
            Button { path.append(.ready(WatchStartConfig(activity: activity))) } label: {
                Label("No bike", systemImage: "minus.circle").foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Bike")
    }
}

struct WatchReadyView: View {
    @ObservedObject var recorder: WatchRecorder
    @Binding var path: [WatchRoute]
    let setup: WatchStartConfig

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                WatchActivityIcon(symbol: WatchCatalog.choice(setup.activity)?.symbol ?? "figure.walk", size: 30)
                Text(setup.title).font(.headline).multilineTextAlignment(.center)
                if let bike = setup.equipmentName {
                    Label(bike, systemImage: setup.equipmentKind == "ebike" ? "bolt.fill" : "bicycle")
                        .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                }
                Button {
                    recorder.start(setup)
                    path = recorder.hasRide ? [.recording] : path
                } label: {
                    Label("Start", systemImage: "play.fill").font(.title3.weight(.bold)).frame(maxWidth: .infinity, minHeight: 48)
                }
                .tint(.green)
                .disabled(recorder.hasRide)
                if recorder.permission == "denied" || recorder.permission == "restricted" {
                    Text("Location is off. Allow it in Settings › Privacy › Location.").font(.caption2).foregroundStyle(.orange).multilineTextAlignment(.center)
                } else if recorder.permission == "unknown", !recorder.hasRide, recorder.status.hasPrefix("Allow") {
                    Text(recorder.status).font(.caption2).foregroundStyle(.orange).multilineTextAlignment(.center)
                }
            }
        }
        .navigationTitle("Ready")
        // A start waiting for the location prompt opens the recording screen once it begins.
        .onChange(of: recorder.hasRide) { started in if started { path = [.recording] } }
    }
}

// MARK: - Recording

struct WatchRecordingView: View {
    @ObservedObject var recorder: WatchRecorder
    @Binding var path: [WatchRoute]
    @State private var confirming = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            ScrollView {
                VStack(spacing: 6) {
                    status(now: context.date.timeIntervalSince1970)
                    Text(WatchFormat.clock(recorder.activeSeconds))
                        .font(.system(size: 40, weight: .semibold, design: .rounded)).monospacedDigit()
                        .minimumScaleFactor(0.6).lineLimit(1)
                        .accessibilityLabel("Elapsed \(WatchFormat.clock(recorder.activeSeconds))")
                    HStack(alignment: .top) {
                        metric(WatchFormat.distance(recorder.distanceMeters), "DISTANCE")
                        let pace = WatchFormat.pace(activity: recorder.config.activity, meters: recorder.distanceMeters, seconds: recorder.activeSeconds)
                        metric(pace.value, pace.label)
                    }
                    HStack(spacing: 8) {
                        if recorder.isRecording {
                            Button { recorder.pause() } label: { Image(systemName: "pause.fill").font(.title3) }
                                .tint(.orange).accessibilityLabel("Pause")
                        } else {
                            Button { recorder.resume() } label: { Image(systemName: "play.fill").font(.title3) }
                                .tint(.green).accessibilityLabel("Resume")
                        }
                        Button { confirming = true } label: { Image(systemName: "stop.fill").font(.title3) }
                            .tint(.red).accessibilityLabel("Finish")
                    }
                    .frame(minHeight: 48)
                }
            }
        }
        .navigationTitle(recorder.config.title)
        .navigationBarBackButtonHidden(recorder.hasRide)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                if recorder.hasRide { Button { path = [] } label: { Image(systemName: "house") }.accessibilityLabel("Home") }
            }
        }
        .confirmationDialog("Finish this activity?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Finish & Save") {
                recorder.finish()
                path = [.summary]
            }
            Button("Discard", role: .destructive) {
                recorder.discard()
                path = []
            }
            Button("Keep Recording", role: .cancel) {}
        }
        .onChange(of: recorder.hasRide) { open in if !open && path.last == .recording { path = [] } }
    }

    private func status(now: Double) -> some View {
        let fresh = recorder.lastFixAt.map { now - $0 < 20 } ?? false
        let (text, color): (String, Color) = !recorder.isRecording ? ("Paused", .orange) : fresh ? ("GPS · Recording", .green) : ("Finding GPS…", .yellow)
        return Label(text, systemImage: recorder.isRecording ? "location.fill" : "pause.fill")
            .font(.caption2.weight(.semibold)).foregroundStyle(color)
    }

    private func metric(_ value: String, _ label: String) -> some View {
        VStack(spacing: 0) {
            Text(value).font(.title3.weight(.semibold)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
            Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

struct WatchSummaryView: View {
    @ObservedObject var recorder: WatchRecorder
    @ObservedObject var link: WatchConnectivitySession
    @Binding var path: [WatchRoute]

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if let ride = recorder.lastFinished {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 34)).foregroundStyle(.green).accessibilityHidden(true)
                    Text(ride.config.title).font(.headline)
                    if let bike = ride.equipmentName { Text(bike).font(.footnote).foregroundStyle(.secondary) }
                    HStack {
                        summaryMetric(WatchFormat.distance(ride.distanceMeters), "DISTANCE")
                        summaryMetric(WatchFormat.clock(ride.activeSeconds), "TIME")
                    }
                    WatchSyncBadge(status: WatchHistory.status(ride, outbox: link.outboxEntries()))
                } else {
                    // Finished without enough GPS to keep (the recorder said why).
                    Image(systemName: "exclamationmark.circle").font(.system(size: 30)).foregroundStyle(.orange)
                    Text(recorder.status).font(.footnote).multilineTextAlignment(.center)
                }
                Button("Done") { path = [] }.tint(.green)
            }
        }
        .navigationBarBackButtonHidden(true)
        .navigationTitle("Saved")
    }

    private func summaryMetric(_ value: String, _ label: String) -> some View {
        VStack(spacing: 0) {
            Text(value).font(.title3.weight(.semibold)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
            Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Past activities

struct WatchSyncBadge: View {
    let status: WatchSyncStatus
    var body: some View {
        let (symbol, color): (String, Color) = {
            switch status {
            case .onIPhone: return ("iphone", .green)
            case .waiting: return ("arrow.triangle.2.circlepath", .orange)
            case .otherAccount: return ("person.crop.circle.badge.exclamationmark", .secondary)
            case .failed: return ("exclamationmark.triangle.fill", .red)
            case .notSent: return ("minus.circle", .secondary)
            }
        }()
        return Label(status.label, systemImage: symbol).font(.caption2.weight(.semibold)).foregroundStyle(color)
    }
}

struct WatchHistoryList: View {
    @ObservedObject var recorder: WatchRecorder
    @ObservedObject var link: WatchConnectivitySession
    @Binding var path: [WatchRoute]

    var body: some View {
        let outbox = link.outboxEntries()
        List {
            if recorder.history.isEmpty {
                Text("Activities you record on this Watch appear here.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(recorder.history) { ride in
                Button { path.append(.detail(ride.id)) } label: {
                    HStack(spacing: 8) {
                        WatchActivityIcon(symbol: WatchCatalog.choice(ride.activity)?.symbol ?? "figure.walk", size: 14)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(ride.config.title).font(.headline).lineLimit(1).minimumScaleFactor(0.8)
                            Text("\(WatchFormat.date(ride.startedAt)) · \(WatchFormat.distance(ride.distanceMeters)) · \(WatchFormat.clock(ride.activeSeconds))")
                                .font(.caption2).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
                            WatchSyncBadge(status: WatchHistory.status(ride, outbox: outbox))
                        }
                    }
                }
                .swipeActions(edge: .leading) {
                    if !recorder.hasRide {
                        Button { path = [.ready(ride.config)] } label: { Label("Start Again", systemImage: "arrow.clockwise") }.tint(.green)
                    }
                }
            }
            if link.broken > 0 {
                Button(role: .destructive) { link.clearUnreadableRides() } label: {
                    Label("Clear \(link.broken) that can't sync", systemImage: "xmark")
                }
                .font(.caption2)
            }
        }
        .navigationTitle("Past")
    }
}

struct WatchHistoryDetail: View {
    @ObservedObject var recorder: WatchRecorder
    @ObservedObject var link: WatchConnectivitySession
    @Binding var path: [WatchRoute]
    let id: String

    var body: some View {
        ScrollView {
            if let ride = recorder.history.first(where: { $0.id == id }) {
                VStack(spacing: 8) {
                    WatchActivityIcon(symbol: WatchCatalog.choice(ride.activity)?.symbol ?? "figure.walk", size: 22)
                    Text(ride.config.title).font(.headline).multilineTextAlignment(.center)
                    if let bike = ride.equipmentName { Text(bike).font(.footnote).foregroundStyle(.secondary) }
                    Text(WatchFormat.date(ride.startedAt)).font(.footnote).foregroundStyle(.secondary)
                    HStack {
                        VStack { Text(WatchFormat.distance(ride.distanceMeters)).font(.title3.weight(.semibold)); Text("DISTANCE").font(.system(size: 10)).foregroundStyle(.secondary) }.frame(maxWidth: .infinity)
                        VStack { Text(WatchFormat.clock(ride.activeSeconds)).font(.title3.weight(.semibold)).monospacedDigit(); Text("TIME").font(.system(size: 10)).foregroundStyle(.secondary) }.frame(maxWidth: .infinity)
                    }
                    WatchSyncBadge(status: WatchHistory.status(ride, outbox: link.outboxEntries()))
                    Button { path = [.ready(ride.config)] } label: {
                        Label("Start Again", systemImage: "arrow.clockwise").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .tint(.green)
                    .disabled(recorder.hasRide)
                }
            } else {
                Text("This activity is no longer on the Watch.").font(.footnote)
            }
        }
        .navigationTitle("Activity")
    }
}
