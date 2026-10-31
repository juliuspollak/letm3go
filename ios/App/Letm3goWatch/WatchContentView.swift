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
    case settings
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
                    case .settings: WatchSettingsView(recorder: recorder)
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
        let onFoot = WatchCatalog.usesPace(activity)
        guard meters >= 20, seconds >= 10 else { return ("—", onFoot ? "PACE /KM" : "KM/H") }
        if onFoot {
            let perKm = seconds / (meters / 1000)
            return (perKm < 5999 ? String(format: "%d:%02d", Int(perKm) / 60, Int(perKm) % 60) : "—", "PACE /KM")
        }
        return (String(format: "%.1f", meters / seconds * 3.6), "KM/H")
    }
    // The last GPS speed, shown the same way as the average beside it.
    static func current(activity: String, metresPerSecond: Double?) -> String {
        guard let speed = metresPerSecond, speed >= 0.3 else { return "—" }
        if WatchCatalog.usesPace(activity) {
            let perKm = 1000 / speed
            return perKm < 5999 ? String(format: "%d:%02d", Int(perKm) / 60, Int(perKm) % 60) : "—"
        }
        return String(format: "%.1f", speed * 3.6)
    }
    static func bpm(_ value: Double?) -> String { value.map { String(Int($0.rounded())) } ?? "—" }
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
                    Text(title).font(.headline).lineLimit(1).minimumScaleFactor(0.7)
                    if let detail { Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
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
                }
                if !recorder.hasRide, let phone = phoneRecording {
                    Label(phone.label, systemImage: "iphone").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                }
                WatchActionButton(title: "Past Activities", detail: waitingDetail, symbol: "clock.arrow.circlepath", tint: .blue) { path = [.history] }
                // The last setup, one tap from Ready ("Mountain bike · Turbo Levo").
                if !recorder.hasRide, let last = recorder.memory.last {
                    WatchActionButton(title: "Start again", detail: [WatchCatalog.choice(last.activity)?.title, last.detail].compactMap { $0 }.joined(separator: " · "),
                                      symbol: WatchCatalog.choice(last.activity)?.symbol ?? "arrow.clockwise", tint: .mint) {
                        path = [.ready(last)]
                    }
                }
                WatchActionButton(title: "Settings", symbol: "gearshape", tint: .gray) { path = [.settings] }
            }
        }
        .navigationTitle("Letm3go")
    }

    private var phoneRecording: RecordingPresence? {
        CrossDeviceRecording.active(link.remoteRecording, ownerID: link.ownerID, now: Date().timeIntervalSince1970)
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
            // No bikes from the Collection: start without one. A remembered bike is
            // never attached silently here (it may have left the Collection);
            // repeating the last setup is what Start again is for.
            path.append(.ready(WatchStartConfig(activity: activity)))
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
    @State private var indoor = false

    private func begin(anyway: Bool) {
        var chosen = setup
        chosen.indoor = indoor && WatchCatalog.supportsIndoor(setup.activity) ? true : nil
        recorder.start(chosen, anyway: anyway)
        path = recorder.hasRide ? [.recording] : path
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                WatchActivityIcon(symbol: WatchCatalog.choice(setup.activity)?.symbol ?? "figure.walk", size: 30)
                Text(setup.title).font(.headline).multilineTextAlignment(.center)
                if let bike = setup.equipmentName {
                    Label(bike, systemImage: setup.equipmentKind == "ebike" ? "bolt.fill" : "bicycle")
                        .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                }
                if WatchCatalog.supportsIndoor(setup.activity) {
                    Toggle("Indoor", isOn: $indoor).font(.footnote)
                }
                if let other = recorder.startBlocked {
                    Label(other.label, systemImage: "iphone").font(.footnote.weight(.semibold)).foregroundStyle(.orange)
                    Button("Start Anyway") { begin(anyway: true) }.font(.footnote)
                } else {
                    Button { begin(anyway: false) } label: {
                        Label("Start", systemImage: "play.fill").font(.title3.weight(.bold)).frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .tint(.green)
                    .disabled(recorder.hasRide)
                }
                if !recorder.hasRide, recorder.status.hasPrefix("Can't start") {
                    Text(recorder.status).font(.caption2).foregroundStyle(.red).multilineTextAlignment(.center)
                }
                if recorder.permission == "denied" || recorder.permission == "restricted" {
                    Text("Location is off. Allow it in Settings › Privacy › Location.").font(.caption2).foregroundStyle(.orange).multilineTextAlignment(.center)
                } else if recorder.permission == "unknown", !recorder.hasRide, recorder.status.hasPrefix("Allow") {
                    Text(recorder.status).font(.caption2).foregroundStyle(.orange).multilineTextAlignment(.center)
                }
            }
        }
        .navigationTitle("Ready")
        .onAppear { indoor = setup.indoor == true; recorder.clearStartBlock() }
        // A start waiting for the location prompt opens the recording screen once it begins.
        .onChange(of: recorder.hasRide) { started in if started { path = [.recording] } }
    }
}

// MARK: - Recording

struct WatchRecordingView: View {
    @ObservedObject var recorder: WatchRecorder
    @Binding var path: [WatchRoute]
    @State private var confirming = false

    private var activity: String { recorder.config.activity }
    private var indoor: Bool { recorder.config.indoor == true }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            ScrollView {
                VStack(spacing: 4) {
                    status(now: context.date.timeIntervalSince1970)
                    if let warning = recorder.storageWarning {
                        Label(warning, systemImage: "exclamationmark.triangle.fill").font(.caption2.weight(.semibold)).foregroundStyle(.red)
                    }
                    if let other = recorder.otherRecording {
                        Label("Also \(other.label)", systemImage: "iphone").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                    }
                    Text(WatchFormat.clock(recorder.activeSeconds))
                        .font(.system(size: 36, weight: .semibold, design: .rounded)).monospacedDigit()
                        .minimumScaleFactor(0.6).lineLimit(1)
                        .accessibilityLabel("Elapsed \(WatchFormat.clock(recorder.activeSeconds))")
                    heartRate
                    if !indoor {
                        HStack(alignment: .top) {
                            metric(WatchFormat.distance(recorder.distanceMeters), "DISTANCE")
                            let pace = WatchFormat.pace(activity: activity, meters: recorder.distanceMeters, seconds: recorder.activeSeconds)
                            metric(pace.value, "AVG " + pace.label)
                        }
                        HStack(alignment: .top) {
                            metric(WatchFormat.current(activity: activity, metresPerSecond: recorder.currentSpeed), WatchCatalog.usesPace(activity) ? "NOW /KM" : "NOW KM/H")
                            if WatchCatalog.showsElevation(activity) { metric("\(Int(recorder.elevationGain.rounded())) m", "CLIMB") }
                        }
                    }
                    if let average = recorder.heartRateSummary?.average {
                        HStack(alignment: .top) {
                            metric(WatchFormat.bpm(average), "AVG BPM")
                            metric(WatchFormat.bpm(recorder.heartRateSummary?.maximum), "MAX BPM")
                        }
                    }
                    controls
                }
            }
        }
        .navigationTitle(WatchCatalog.choice(recorder.config.activity)?.title ?? recorder.config.activity)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(recorder.hasRide)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                if recorder.hasRide && !recorder.softLocked { Button { path = [] } label: { Image(systemName: "house") }.accessibilityLabel("Home") }
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

    @ViewBuilder private var heartRate: some View {
        switch recorder.heartRate {
        case .live(let bpm):
            Label("\(Int(bpm.rounded())) BPM", systemImage: "heart.fill")
                .font(.title3.weight(.semibold)).monospacedDigit().foregroundStyle(.red)
                .accessibilityLabel("Heart rate \(Int(bpm.rounded())) beats per minute")
        case .waiting, .unavailable:
            Label(recorder.heartRate.label, systemImage: "heart").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
        case .paused, .off:
            EmptyView()
        }
    }

    // While the screen is locked in the app there is nothing to press by accident:
    // Water Lock itself blocks touch, and the on-screen lock takes a long press.
    @ViewBuilder private var controls: some View {
        if recorder.softLocked {
            Text("Hold to Unlock")
                .font(.footnote.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
                .background(.gray.opacity(0.25), in: Capsule())
                .onLongPressGesture(minimumDuration: 1.5) { recorder.softUnlock() }
                .accessibilityLabel("Screen locked. Touch and hold to unlock")
        } else {
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
                Button { recorder.lockScreen() } label: { Image(systemName: "drop.fill").font(.title3) }
                    .tint(.blue).accessibilityLabel("Lock screen")
            }
            .frame(minHeight: 44)
        }
    }

    private func status(now: Double) -> some View {
        let fresh = recorder.lastFixAt.map { now - $0 < 20 } ?? false
        let (text, color): (String, Color) = !recorder.isRecording ? ("Paused", .orange) : indoor ? ("Indoor · Recording", .green) : fresh ? ("GPS · Recording", .green) : ("Finding GPS…", .yellow)
        return Label(text, systemImage: recorder.isRecording ? (indoor ? "house.fill" : "location.fill") : "pause.fill")
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

struct WatchSettingsView: View {
    @ObservedObject var recorder: WatchRecorder
    var body: some View {
        List {
            Toggle("Automatically Lock During Recording", isOn: $recorder.autoLock)
            Text("Water Lock stops accidental touches. Press and hold the Digital Crown to unlock. Recording carries on either way.")
                .font(.caption2).foregroundStyle(.secondary)
        }
        .navigationTitle("Settings")
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
                    if ride.averageHeartRate != nil {
                        HStack {
                            summaryMetric(WatchFormat.bpm(ride.averageHeartRate), "AVG BPM")
                            summaryMetric(WatchFormat.bpm(ride.maximumHeartRate), "MAX BPM")
                        }
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
                            Text(WatchCatalog.choice(ride.activity)?.title ?? ride.activity).font(.headline).lineLimit(1).minimumScaleFactor(0.8)
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
                    if ride.averageHeartRate != nil {
                        Text("\(WatchFormat.bpm(ride.averageHeartRate)) avg · \(WatchFormat.bpm(ride.maximumHeartRate)) max BPM").font(.footnote).foregroundStyle(.secondary)
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
