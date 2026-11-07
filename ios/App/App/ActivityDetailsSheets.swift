import MapKit
import SwiftUI
import UIKit

// MARK: Heart rate

struct ActivityHeartSection: View {
    @ObservedObject var model: ActivityDetailsViewModel
    var body: some View {
        if model.presentation.consent.heartRate {
            ConsentCard(title: "Heart rate waiting for you", model: model) { .resolveHeartRate(accept: $0) }
        } else if let heart = model.presentation.heart {
            if let note = heart.noneNote { DetailFootnote(text: note) }
            if let runs = heart.runs, let start = heart.start, let end = heart.end {
                DetailCard(title: "Heart rate", symbol: "heart") {
                    HStack {
                        ReadoutPair(label: "Average", value: heart.average ?? "—")
                        ReadoutPair(label: "Maximum", value: heart.maximum ?? "—")
                    }
                    HeartChart(runs: runs, pauses: heart.pauses ?? [], start: start, end: end, label: heart.chartLabel ?? "Heart rate over time")
                    if heart.pauses?.isEmpty == false { DetailFootnote(text: "Shaded: paused, not recorded.") }
                    if let note = heart.gapsNote { DetailFootnote(text: note) }
                    Text("Time in zones").font(.subheadline.weight(.semibold)).padding(.top, 4)
                    HeartZonesView(model: model, heart: heart)
                }
            }
        }
    }
}

// Drawn with Canvas, which the iOS 15 deployment target supports; a run stays a
// separate line, so a pause or a sensor gap is never joined.
struct HeartChart: View {
    let runs: [[ActivityPresentation.HeartSample]]
    let pauses: [[Double]]
    let start: Double
    let end: Double
    let label: String
    @State private var focus: ActivityPresentation.HeartSample?
    var body: some View {
        let samples = runs.flatMap { $0 }, values = samples.map(\.bpm), top = values.max() ?? 180
        let low = floor((values.min() ?? 60) / 10) * 10
        let high = ceil(top / 10) * 10 + (top.truncatingRemainder(dividingBy: 10) == 0 ? 10 : 0)
        VStack(alignment: .leading, spacing: 4) {
            Group {
                if let focus {
                    Text("\(Int(focus.bpm)) BPM").font(.subheadline.weight(.semibold)) +
                        Text("  \(ActivityDetailsFormat.stopwatch(focus.t - start))\(focus.place.isEmpty ? "" : " · \(focus.place)")").font(.footnote)
                } else { Text("Touch the graph to read a moment").font(.footnote).foregroundColor(DetailStyle.muted) }
            }
            GeometryReader { geometry in
                let size = geometry.size
                let x = { (t: Double) in CGFloat((t - start) / max(1, end - start)) * size.width }
                let y = { (bpm: Double) in CGFloat((high - bpm) / max(1, high - low)) * size.height }
                Canvas { context, _ in
                    for pause in pauses where pause.count == 2 {
                        context.fill(Path(CGRect(x: x(pause[0]), y: 0, width: max(1, x(pause[1]) - x(pause[0])), height: size.height)), with: .color(.secondary.opacity(0.18)))
                    }
                    for value in [low, ((low + high) / 2).rounded(), high] {
                        var grid = Path(); grid.move(to: CGPoint(x: 0, y: y(value))); grid.addLine(to: CGPoint(x: size.width, y: y(value)))
                        context.stroke(grid, with: .color(.secondary.opacity(0.25)), lineWidth: 0.5)
                    }
                    for run in runs {
                        if run.count == 1, let lone = run.first {
                            context.fill(Path(ellipseIn: CGRect(x: x(lone.t) - 2, y: y(lone.bpm) - 2, width: 4, height: 4)), with: .color(.red))
                            continue
                        }
                        var line = Path()
                        for (index, sample) in run.enumerated() {
                            let point = CGPoint(x: x(sample.t), y: y(sample.bpm))
                            if index == 0 { line.move(to: point) } else { line.addLine(to: point) }
                        }
                        context.stroke(line, with: .color(.red), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                    }
                    if let focus {
                        var cross = Path(); cross.move(to: CGPoint(x: x(focus.t), y: 0)); cross.addLine(to: CGPoint(x: x(focus.t), y: size.height))
                        context.stroke(cross, with: .color(.primary.opacity(0.5)), lineWidth: 1)
                    }
                }
                .contentShape(Rectangle())
                // Horizontal only: a vertical drag on the graph keeps scrolling the panel.
                .simultaneousGesture(DragGesture(minimumDistance: 8).onChanged { value in
                    guard abs(value.translation.width) > abs(value.translation.height) else { return }
                    let time = start + Double(value.location.x / max(1, size.width)) * (end - start)
                    focus = samples.min { abs($0.t - time) < abs($1.t - time) }
                }.onEnded { _ in focus = nil })
            }
            .frame(height: 132)
            .accessibilityElement().accessibilityLabel(label).accessibilityAddTraits(.isImage)
            HStack { Text("0:00"); Spacer(); Text(ActivityDetailsFormat.stopwatch(end - start)) }.font(.caption2).foregroundColor(DetailStyle.muted)
        }
    }
}

struct HeartZonesView: View {
    @ObservedObject var model: ActivityDetailsViewModel
    let heart: ActivityPresentation.Heart
    @State private var draft = ""
    private func save(_ value: String) {
        Task { do { _ = try await model.request("setMaximumHeartRate", args: ["value": value]) } catch { model.errorMessage = error.localizedDescription } }
    }
    var body: some View {
        if let zones = heart.zones {
            ForEach(zones.rows) { zone in
                HStack(spacing: 8) {
                    Text(zone.name).font(.footnote).frame(width: 56, alignment: .leading)
                    Text(zone.range).font(.footnote.monospacedDigit()).foregroundColor(DetailStyle.muted).frame(width: 68, alignment: .leading)
                    GeometryReader { geometry in
                        Capsule().fill(Color.red.opacity(0.7)).frame(width: max(2, geometry.size.width * zone.share), height: 8).frame(maxHeight: .infinity)
                    }.accessibilityHidden(true)
                    Text(zone.time).font(.footnote.monospacedDigit()).frame(width: 56, alignment: .trailing)
                }.accessibilityElement(children: .combine).frame(minHeight: 22)
            }
            DetailFootnote(text: zones.note)
            Button("Change maximum heart rate") { draft = heart.savedMaximum.map { String(Int($0)) } ?? ""; save("") }.font(.footnote)
        } else {
            HStack {
                TextField("BPM", text: $draft).keyboardType(.numberPad).textFieldStyle(.roundedBorder).accessibilityLabel("Maximum heart rate in BPM")
                Button("Show zones") { save(draft) }.buttonStyle(DetailButtonStyle()).disabled(draft.isEmpty)
            }
            DetailFootnote(text: "Zones need your own maximum, from a test or your doctor. This activity reached \(Int(heart.maximumValue ?? 0)) BPM, which may be lower than your true maximum.")
        }
    }
}

// MARK: Edit

struct ActivityEditorSheet: View {
    @ObservedObject var model: ActivityDetailsViewModel
    let editor: ActivityPresentation.Editor?
    // The version these fields were copied from, however far the activity moves on.
    private let openedAt: Double?
    @State private var title: String
    @State private var activity: String
    @State private var description: String
    @State private var notes: String
    @State private var tags: String
    @State private var collection: String
    @State private var equipment: String
    private static let saved = "__saved"
    @State private var problem = ""
    @Environment(\.dismiss) private var dismiss
    init(model: ActivityDetailsViewModel) {
        self.model = model
        let e = model.presentation.editor
        editor = e
        openedAt = model.presentation.updatedAt
        _title = State(initialValue: e?.title ?? "")
        _activity = State(initialValue: e?.activity ?? "Walking")
        _description = State(initialValue: e?.description ?? "")
        _notes = State(initialValue: e?.notes ?? "")
        _tags = State(initialValue: e?.tags ?? "")
        _collection = State(initialValue: e?.collection ?? "")
        let chosen = e?.equipment.contains { $0.id == e?.vehicleID } == true ? e?.vehicleID : nil
        _equipment = State(initialValue: chosen ?? (e?.vehicle != nil ? Self.saved : ""))
    }
    var body: some View {
        NavigationView {
            Form {
                Section { DetailFootnote(text: "Private and saved on this device. Your activity correction takes precedence over predictions.") }
                if !problem.isEmpty { Section { Text(problem).font(.footnote).foregroundColor(.red) } }
                Section {
                    TextField("Title", text: $title)
                    Picker("Activity", selection: $activity) { ForEach(editor?.types ?? []) { Text($0.label).tag($0.value) } }
                }
                Section("Description") { TextEditor(text: $description).frame(minHeight: 72) }
                Section("Notes") { TextEditor(text: $notes).frame(minHeight: 72) }
                Section {
                    TextField("Tags (comma separated)", text: $tags)
                    TextField("Holiday / collection", text: $collection)
                    Picker("Equipment", selection: $equipment) {
                        Text("No equipment").tag("")
                        if let vehicle = editor?.vehicle, editor?.equipment.contains(where: { $0.id == editor?.vehicleID }) != true { Text(vehicle).tag(Self.saved) }
                        ForEach(editor?.equipment ?? []) { Text($0.title).tag($0.id) }
                    }
                }
            }
            .navigationTitle("Edit activity").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.busy ? "Saving…" : "Save") { save() }.disabled(model.busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }.navigationViewStyle(.stack)
    }
    private func save() {
        let e = editor, item = e?.equipment.first { $0.id == equipment }
        let edit = ActivityMutation.Edit(
            title: title == e?.title ? (model.presentation.header.recordedTitle) : String(title.prefix(150)), activity: activity,
            description: String(description.prefix(4000)), notes: String(notes.prefix(4000)),
            tags: tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
            collection: String(collection.prefix(100)),
            vehicle: equipment.isEmpty ? nil : equipment == Self.saved ? e?.vehicle : item?.title,
            vehicleID: equipment == Self.saved ? e?.vehicleID : item?.id)
        Task {
            if await model.perform(.edit(edit), loadedUpdatedAt: .some(openedAt)) { dismiss() }
            else { problem = model.errorMessage.isEmpty ? "Changes were not saved. Review the error and retry." : model.errorMessage }
        }
    }
}

// MARK: Equipment

struct ActivityEquipmentSheet: View {
    @ObservedObject var model: ActivityDetailsViewModel
    @State private var selected: [String]
    @State private var adding = false
    @State private var problem = ""
    @Environment(\.dismiss) private var dismiss
    init(model: ActivityDetailsViewModel) {
        self.model = model
        _selected = State(initialValue: model.presentation.equipment?.selected ?? [])
    }
    private var equipment: ActivityPresentation.Equipment? { model.presentation.equipment }
    var body: some View {
        NavigationView {
            List {
                Section {
                    if equipment?.options.isEmpty != false { DetailFootnote(text: equipment?.emptyNote ?? "") }
                    ForEach(equipment?.options ?? []) { option in
                        Button { pick(option) } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(option.title).foregroundColor(.primary)
                                    Text(option.archived ? "\(option.detail) · Archived" : option.detail).font(.caption).foregroundColor(DetailStyle.muted)
                                }
                                Spacer()
                                if selected.contains(option.id) { Image(systemName: "checkmark").foregroundColor(.accentColor) }
                            }
                        }
                        .accessibilityAddTraits(selected.contains(option.id) ? .isSelected : [])
                        .disabled(model.busy)
                    }
                } footer: {
                    if equipment?.multi == true { Text("Tap a kite and a board to use both. Tapping again removes it.") }
                }
                if !problem.isEmpty { Text(problem).font(.footnote).foregroundColor(.red) }
                Section {
                    if !selected.isEmpty { Button("Remove from this activity", role: .destructive) { selected = []; save([], close: true) }.disabled(model.busy) }
                    Button("Add to Collection") { adding = true }.disabled(model.busy)
                }
            }
            .navigationTitle(equipment?.multi == true ? "What did you use?" : "What did you use it with?").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .background(NavigationLink(isActive: $adding) { ActivityNewEquipmentView(model: model) { adding = false } } label: { EmptyView() }.hidden())
        }.navigationViewStyle(.stack)
    }
    private func pick(_ option: ActivityPresentation.EquipmentOption) {
        if equipment?.multi != true { selected = [option.id]; save([option.id], close: true); return }
        selected = selected.contains(option.id) ? selected.filter { $0 != option.id } : selected + [option.id]
        save(selected, close: false)
    }
    private func save(_ ids: [String], close: Bool) {
        problem = ""
        Task {
            if await model.perform(.assignEquipment(ids)) { if close { dismiss() } }
            else { problem = "Equipment could not be saved. Please retry." }
        }
    }
}

// Quick add. The Garage screen keeps the complete item editor (photo and category
// attributes); this adds what is needed to choose the item here.
struct ActivityNewEquipmentView: View {
    @ObservedObject var model: ActivityDetailsViewModel
    let done: () -> Void
    private struct Category: Identifiable { let id: String; let label: String; let preferred: Bool }
    @State private var categories: [Category] = []
    @State private var category = "other"
    @State private var name = ""
    @State private var make = ""
    @State private var itemModel = ""
    @State private var problem = ""
    @State private var saving = false
    var body: some View {
        Form {
            Section {
                Picker("Category", selection: $category) { ForEach(categories) { Text($0.label).tag($0.id) } }
                TextField("Name", text: $name)
                TextField("Brand", text: $make)
                TextField("Model", text: $itemModel)
            } footer: { Text("Add a photo and more detail from your Collection.") }
            if !problem.isEmpty { Text(problem).font(.footnote).foregroundColor(.red) }
        }
        .navigationTitle("Add to Collection")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(saving ? "Saving…" : "Save") { save() }.disabled(saving) } }
        .task {
            guard let result = try? await model.request("equipmentCategories"), let rows = result["categories"] as? [[String: Any]] else { return }
            categories = rows.compactMap { row in
                guard let id = row["id"] as? String, let label = row["label"] as? String else { return nil }
                return Category(id: id, label: label, preferred: row["preferred"] as? Bool == true)
            }
            if let first = categories.first(where: \.preferred) { category = first.id }
        }
    }
    private func save() {
        saving = true; problem = ""
        Task {
            defer { saving = false }
            do { _ = try await model.request("addEquipment", args: ["category": category, "name": name, "make": make, "model": itemModel]); done() }
            catch { problem = error.localizedDescription }
        }
    }
}

// MARK: Privacy

private struct RoutePreview: UIViewRepresentable {
    let segments: [[[Double]]]
    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView(); map.delegate = context.coordinator; map.isUserInteractionEnabled = false; map.showsUserLocation = false
        var rect = MKMapRect.null
        for segment in segments {
            let coordinates = segment.compactMap { $0.count == 2 ? CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) : nil }
            guard coordinates.count > 1 else { continue }
            let line = MKPolyline(coordinates: coordinates, count: coordinates.count)
            map.addOverlay(line); rect = rect.union(line.boundingMapRect)
        }
        if !rect.isNull { map.setVisibleMapRect(rect, edgePadding: UIEdgeInsets(top: 20, left: 20, bottom: 20, right: 20), animated: false) }
        return map
    }
    func updateUIView(_ map: MKMapView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator: NSObject, MKMapViewDelegate {
        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            let renderer = MKPolylineRenderer(overlay: overlay); renderer.strokeColor = .systemIndigo; renderer.lineWidth = 3
            return renderer
        }
    }
}

// The one sharing control for an activity you own: household, friends (any
// combination) or a public link, opened from the header's Share button. It opens
// with the confirmed selection from the database and changes nothing until the
// server confirms a save, so a failure keeps the last confirmed state.
struct ActivityPrivacySheet: View {
    @ObservedObject var model: ActivityDetailsViewModel
    private struct Friend: Identifiable, Equatable { let id: String; let name: String }
    @State private var audience: String?
    @State private var confirmedHousehold = false
    @State private var confirmedFriends = Set<String>()
    @State private var household = false
    @State private var friends = Set<String>()
    @State private var publicLink = false
    @State private var people: [Friend] = []
    @State private var householdName: String?
    @State private var consent = false
    @State private var loading = true
    @State private var saving = false
    @State private var inviting = false
    @State private var problem = ""
    @State private var done = ""
    @State private var confirmStop = false
    @Environment(\.dismiss) private var dismiss

    private var shared: Bool { ["friends", "household", "public"].contains(audience ?? "") }
    private var nothingSelected: Bool { !household && friends.isEmpty && !publicLink }
    private var changed: Bool {
        publicLink ? audience != "public" : (audience == "public" || household != confirmedHousehold || friends != confirmedFriends)
    }
    // Sharing uploads the reviewed copy: the first time, or when it becomes public.
    private var needsConsent: Bool { changed && !nothingSelected && (publicLink ? audience != "public" : !shared || audience == "public") }
    private var statusText: String {
        if loading { return "Checking current sharing…" }
        switch audience {
        case "private": return "Only you can see this activity."
        case "public": return "Anyone with the link can see a copy of this activity."
        case "friends", "household":
            let names = people.filter { confirmedFriends.contains($0.id) }.map(\.name)
            let parts = (confirmedHousehold ? ["your household"] : []) + (names.isEmpty ? [] : [names.joined(separator: ", ")])
            return "Shared with \(parts.joined(separator: " and "))."
        default: return "Current sharing could not be confirmed."
        }
    }
    private func binding(_ id: String) -> Binding<Bool> {
        Binding(get: { friends.contains(id) }, set: { on in if on { friends.insert(id) } else { friends.remove(id) }; consent = false; done = "" })
    }
    var body: some View {
        NavigationView {
            Form {
                Section { Text(statusText).font(.footnote) }
                Section("Share with") {
                    if let name = householdName {
                        Toggle(isOn: $household) { Label("Household · \(name)", systemImage: "house") }
                            .disabled(saving || loading || publicLink)
                    }
                    ForEach(people) { friend in
                        Toggle(isOn: binding(friend.id)) { Label(friend.name, systemImage: "person") }
                            .disabled(saving || loading || publicLink)
                    }
                    if !loading && people.isEmpty && householdName == nil { DetailFootnote(text: "You have no friends or household yet. Invite someone to share with them.") }
                    Button { createInvite() } label: { Label(inviting ? "Preparing invitation…" : "Add friends", systemImage: "person.badge.plus") }
                        .disabled(saving || inviting)
                }
                Section {
                    Toggle(isOn: $publicLink) { Label("Anyone with the link", systemImage: "globe") }
                        .disabled(saving || loading)
                } header: { Text("Public link") } footer: { Text("A public link replaces household and friend sharing.") }
                if needsConsent, let preview = model.presentation.privacy {
                    Section("Preview of the shared copy") {
                        DetailFootnote(text: "Your title, description and route below will be shared. Home and Work areas are hidden, but landmarks may still identify places. Photos and private notes are not included.")
                        Text(preview.title).font(.headline)
                        if !preview.description.isEmpty { Text(preview.description).font(.subheadline) }
                        if preview.segments.isEmpty { DetailFootnote(text: "No route points remain after privacy masking.") }
                        else { RoutePreview(segments: preview.segments).frame(height: 180).listRowInsets(EdgeInsets()) }
                        Toggle("I agree to upload this activity and my saved Home/Work locations privately, and share the reviewed copy.", isOn: $consent).font(.footnote).disabled(saving || loading)
                    }
                }
                if !done.isEmpty { DetailFootnote(text: done) }
                if !problem.isEmpty { Text(problem).font(.footnote).foregroundColor(.red) }
                if changed && !loading {
                    Button(saving ? "Saving…" : "Save") { nothingSelected ? (confirmStop = true) : save(publicLink ? "public" : "share") }
                        .disabled(saving || (needsConsent && !consent) || (nothingSelected && !shared))
                        .accessibilityIdentifier("activity.share.save")
                }
                if shared && !loading {
                    Button("Stop sharing", role: .destructive) { confirmStop = true }.disabled(saving)
                }
            }
            .onChange(of: publicLink) { on in if on { household = false; friends = [] }; consent = false; done = "" }
            .onChange(of: household) { _ in consent = false; done = "" }
            .navigationTitle("Share activity").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving).accessibilityLabel("Close sharing") } }
            .interactiveDismissDisabled(saving)
            .alert("Stop sharing?", isPresented: $confirmStop) {
                Button("Stop sharing", role: .destructive) { save("private") }
                Button("Keep sharing", role: .cancel) {}
            } message: { Text("Nobody else will be able to see this activity. Copies others already saved cannot be recalled.") }
            .task(id: model.presentation.updatedAt) { await load() }
        }.navigationViewStyle(.stack)
    }
    private func apply(_ result: [String: Any]) {
        audience = result["audience"] as? String
        confirmedHousehold = result["household"] as? Bool ?? false
        confirmedFriends = Set((result["friends"] as? [String]) ?? [])
        household = confirmedHousehold; friends = confirmedFriends; publicLink = audience == "public"; consent = false
    }
    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let result = try await model.request("privacyStatus")
            let options = result["options"] as? [String: Any] ?? [:]
            people = ((options["friends"] as? [[String: Any]]) ?? []).compactMap { item in
                guard let id = item["id"] as? String else { return nil }
                return Friend(id: id, name: item["name"] as? String ?? "Friend")
            }
            householdName = options["household"] as? String
            apply(result)
        } catch { problem = "Sharing status is unavailable. You can retry, or stop sharing this activity." }
    }
    private func save(_ choice: String) {
        saving = true; problem = ""; done = ""
        Task {
            defer { saving = false }
            do {
                let result = try await model.request("privacySave", args: ["choice": choice, "household": household, "friends": Array(friends).sorted()], timeout: 180)
                apply(result)
                done = result["message"] as? String ?? ""
            } catch ActivityDetailsError.timedOut {
                audience = nil
                problem = "This is taking longer than expected, so the result is not confirmed. Close this and check again before relying on it."
            } catch {
                // The server kept the last confirmed sharing; show that, not the attempted one.
                household = confirmedHousehold; friends = confirmedFriends; publicLink = audience == "public"
                problem = error.localizedDescription
            }
        }
    }
    private func createInvite() {
        inviting = true; problem = ""
        Task {
            defer { inviting = false }
            do {
                let result = try await model.request("createFriendInvite")
                if let text = result["text"] as? String, !text.isEmpty { presentShare(text) }
            } catch { problem = error.localizedDescription }
        }
    }
}

// The iOS share sheet for an invitation, over whatever is showing. A SwiftUI
// sheet nested in this sheet stops every sheet on the screen from presenting.
@MainActor private func presentShare(_ text: String) {
    guard let root = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first?.rootViewController else { return }
    var top = root
    while let next = top.presentedViewController { top = next }
    let sheet = UIActivityViewController(activityItems: [text], applicationActivities: nil)
    sheet.popoverPresentationController?.sourceView = top.view
    sheet.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 0, height: 0)
    top.present(sheet, animated: true)
}

// MARK: Photo suggestions

struct ActivitySuggestionsSheet: View {
    @ObservedObject var model: ActivityDetailsViewModel
    private struct Candidate: Identifiable, Equatable {
        var id: String { assetID }
        let assetID: String
        let image: UIImage?
        let captureTime: Double
        let hasLocation: Bool
        var skipped: Bool
    }
    @State private var candidates: [Candidate] = []
    @State private var selected = Set<String>()
    @State private var imported = Set<String>()
    @State private var failed: [String: String] = [:]
    @State private var showSkipped = false
    @State private var limited = false
    @State private var total: Int?
    @State private var hasMore = false
    @State private var nextOffset = 0
    @State private var loading = true
    @State private var working = false
    @State private var cancelRequested = false
    @State private var progress = (done: 0, total: 0)
    @State private var result = ""
    @State private var problem = ""
    @Environment(\.dismiss) private var dismiss
    private static let time: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_AU"); f.dateFormat = "d MMM · h:mm a"; return f }()
    private var existing: [ActivityPresentation.Photo] { model.presentation.photos.items }
    private var visible: [Candidate] { candidates.filter { !imported.contains($0.assetID) && (showSkipped || !$0.skipped) } }
    private var duplicates: Set<String> { Set(candidates.map(\.assetID).filter { ActivitySuggestionRules.isDuplicate(assetID: $0, existing: existing) }) }
    private var ready: [Candidate] { visible.filter { selected.contains($0.assetID) && !$0.skipped && !duplicates.contains($0.assetID) } }
    private var remaining: Int { ActivitySuggestionRules.remaining(existing: existing.count) }
    private func stamp(_ seconds: Double) -> String {
        let formatter = Self.time
        formatter.timeZone = model.presentation.header.timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
        return formatter.string(from: Date(timeIntervalSince1970: seconds))
    }
    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 8)]
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    DetailFootnote(text: limited ? "Showing locally available photos within your limited library access." : "Showing locally available photos captured during this activity.")
                    if let total { DetailFootnote(text: "\(candidates.count) of \(total) shown · \(remaining) photo slot\(remaining == 1 ? "" : "s") left") }
                    if !problem.isEmpty { Text(problem).font(.footnote).foregroundColor(.red) }
                    if !result.isEmpty { DetailFootnote(text: result) }
                    LazyVGrid(columns: columns, spacing: 8) { ForEach(visible) { cell($0) } }
                    if loading { ProgressView().frame(maxWidth: .infinity) }
                    else if visible.isEmpty { DetailFootnote(text: "No photos to suggest for this activity.") }
                    if hasMore { Button("Load more") { Task { await load(reset: false) } }.buttonStyle(DetailButtonStyle()).disabled(loading || working) }
                    Toggle("Show skipped photos", isOn: $showSkipped).font(.footnote)
                }.padding()
            }
            .navigationTitle("Find journey photos").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(working ? "Stop" : "Close") { if working { cancelRequested = true } else { dismiss() } }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(working ? "Adding \(progress.done)/\(progress.total)" : "Add \(ready.count)") { Task { await addSelected() } }
                        .disabled(working || ready.isEmpty || ready.count > remaining)
                }
            }
            .task { await load(reset: true) }
        }
        .navigationViewStyle(.stack)
        .interactiveDismissDisabled(working)
    }
    private func cell(_ candidate: Candidate) -> some View {
        let isDuplicate = duplicates.contains(candidate.assetID), isSelected = selected.contains(candidate.assetID)
        return VStack(alignment: .leading, spacing: 3) {
            Button {
                guard !isDuplicate, !working else { return }
                if isSelected { selected.remove(candidate.assetID) } else { selected.insert(candidate.assetID) }
            } label: {
                ZStack(alignment: .topTrailing) {
                    Color(.tertiarySystemFill)
                    if let image = candidate.image { Image(uiImage: image).resizable().scaledToFill() }
                    else { Text("Download in Photos").font(.caption2).foregroundColor(DetailStyle.muted).padding(4) }
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle").foregroundColor(isSelected ? .accentColor : .white).padding(4)
                }
                .frame(height: 104).clipped().clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .disabled(isDuplicate)
            .accessibilityLabel("Photo, \(stamp(candidate.captureTime))")
            .accessibilityAddTraits(isSelected ? .isSelected : [])
            Text(isDuplicate ? "Already added" : candidate.hasLocation ? "Date match · photo GPS" : "Date match only").font(.caption2).foregroundColor(DetailStyle.muted)
            Text(stamp(candidate.captureTime)).font(.caption2).foregroundColor(DetailStyle.muted)
            if let message = failed[candidate.assetID] { Text(message).font(.caption2).foregroundColor(.red) }
            Button(candidate.skipped ? "Undo skip" : "Skip") { skip(candidate) }.font(.caption2).frame(minHeight: 30)
        }
    }
    private func skip(_ candidate: Candidate) {
        guard let index = candidates.firstIndex(of: candidate) else { return }
        candidates[index].skipped.toggle()
        selected.remove(candidate.assetID)
        model.service.skipSuggestion(activityID: model.presentation.activityID, assetID: candidate.assetID, skipped: candidates[index].skipped)
    }
    private func load(reset: Bool) async {
        loading = true
        defer { loading = false }
        do {
            var offset = reset ? 0 : nextOffset
            // A page whose rows are unusable steps forward rather than looking finished.
            while true {
                let page = try await model.service.suggestions(activityID: model.presentation.activityID, offset: offset)
                let rows = page["suggestions"] as? [[String: Any]] ?? []
                let known = Set(candidates.map(\.assetID))
                let fresh = rows.compactMap { row -> Candidate? in
                    guard let id = row["assetID"] as? String, !known.contains(id) else { return nil }
                    let data = (row["thumbnail"] as? String).flatMap { $0.components(separatedBy: ",").last }.flatMap { Data(base64Encoded: $0) }
                    return Candidate(assetID: id, image: data.flatMap(UIImage.init(data:)), captureTime: row["captureTime"] as? Double ?? 0, hasLocation: row["hasLocation"] as? Bool == true, skipped: row["skipped"] as? Bool == true)
                }
                candidates += fresh
                limited = page["limited"] as? Bool == true
                total = page["total"] as? Int
                hasMore = page["hasMore"] as? Bool == true
                let next = page["nextOffset"] as? Int ?? offset
                nextOffset = next
                guard hasMore, rows.isEmpty, next > offset else { break }
                offset = next
            }
        } catch { problem = error.localizedDescription }
    }
    private func addSelected() async {
        let batch = ready
        working = true; cancelRequested = false; failed = [:]; result = ""; problem = ""; progress = (0, batch.count)
        var added = 0, cancelled = 0
        for (index, candidate) in batch.enumerated() {
            if cancelRequested { cancelled = batch.count - index; break }
            do {
                try await model.service.acceptSuggestion(activityID: model.presentation.activityID, assetID: candidate.assetID, ownerID: model.presentation.ownerID)
                imported.insert(candidate.assetID); selected.remove(candidate.assetID); added += 1
            } catch {
                failed[candidate.assetID] = error.localizedDescription
                if !ActivitySuggestionRules.retryable(error.localizedDescription) { selected.remove(candidate.assetID) }
            }
            progress.done = index + 1
        }
        working = false
        var parts = ["\(added) added"]
        if !failed.isEmpty { parts.append("\(failed.count) failed") }
        if cancelled > 0 { parts.append("\(cancelled) cancelled") }
        result = parts.joined(separator: " · ")
    }
}
