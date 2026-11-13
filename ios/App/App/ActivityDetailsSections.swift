import SwiftUI

struct ActivityHeaderSection: View {
    @ObservedObject var model: ActivityDetailsViewModel
    var body: some View {
        let p = model.presentation, h = p.header
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(h.title).font(.title2.bold()).lineLimit(model.panelPosition == .collapsed ? 1 : 3)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 4)
                if h.local {
                    Button { model.sheet = .editor } label: {
                        Image(systemName: "square.and.pencil")
                            .font(.system(size: 19, weight: .semibold))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.primary)
                    .accessibilityLabel("Edit activity")
                    .accessibilityIdentifier("activity.header.edit")
                    .disabled(model.busy)
                    Button { model.sheet = .privacy } label: {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 19, weight: .semibold))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.primary)
                    .accessibilityLabel("Share activity")
                    .accessibilityIdentifier("activity.header.privacy")
                }
            }
            Text(h.subtitle).font(.subheadline).foregroundColor(DetailStyle.muted)
            if !h.location.isEmpty { Label(h.location, systemImage: "mappin.and.ellipse").font(.subheadline).foregroundColor(DetailStyle.muted) }
            if let equipment = p.equipment, equipment.label != nil || equipment.action != nil {
                Button { model.sheet = .equipment } label: {
                    Label(equipment.label ?? equipment.action ?? "", systemImage: equipment.label == nil ? "plus" : "bicycle")
                        .font(.subheadline.weight(.medium)).foregroundColor(.primary)
                }
                .disabled(!equipment.editable || model.busy).padding(.top, 2)
                .accessibilityLabel(equipment.label.map { "Equipment: \($0). Change equipment" } ?? equipment.action ?? "")
            }
        }
    }
}

struct ActivitySummarySection: View {
    let items: [ActivityPresentation.Readout]
    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 10, alignment: .topLeading)]
    var body: some View {
        if !items.isEmpty {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.label).font(.caption).foregroundColor(DetailStyle.muted)
                        Text(item.value).font(.title3.weight(.semibold).monospacedDigit())
                        if let detail = item.detail { Text(detail).font(.caption2).foregroundColor(DetailStyle.muted) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(DetailStyle.cardFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

struct ConsentCard: View {
    let title: String
    @ObservedObject var model: ActivityDetailsViewModel
    let resolve: (Bool) -> ActivityMutation
    var body: some View {
        DetailCard(title: title, symbol: "applewatch") {
            DetailFootnote(text: "This was recorded before your Apple Watch knew which account to use. Add it only if you wore the Watch for this activity.")
            HStack {
                Button("Remove it") { Task { await model.perform(resolve(false)) } }.buttonStyle(DetailButtonStyle())
                Button("This was me") { Task { await model.perform(resolve(true)) } }.buttonStyle(DetailButtonStyle(kind: .primary))
            }.disabled(model.busy)
        }
    }
}

struct ActivityNoticesSection: View {
    @ObservedObject var model: ActivityDetailsViewModel
    var body: some View {
        let p = model.presentation
        if p.consent.energy { ConsentCard(title: "Measured energy waiting for you", model: model) { .resolveEnergy(accept: $0) } }
        ForEach(p.notices) { notice in
            DetailCard(title: notice.title, symbol: nil) { DetailFootnote(text: notice.text) }
                .accessibilityElement(children: .combine)
        }
        if !p.sources.isEmpty {
            DetailCard(title: "Recordings of this drive", symbol: "doc.on.doc") {
                DetailFootnote(text: "Both sources are preserved. Photos and notes stay with their originals.")
                ForEach(p.sources) { source in
                    Button(source.label) { open(source.id) }.buttonStyle(DetailButtonStyle())
                }
            }
        }
        if !model.message.isEmpty, model.sheet == nil { DetailFootnote(text: model.message).accessibilityAddTraits(.updatesFrequently) }
        if !model.errorMessage.isEmpty {
            Label(model.errorMessage, systemImage: "exclamationmark.triangle").font(.footnote).foregroundColor(.red)
                .accessibilityIdentifier("activity.error")
        }
    }
    private func open(_ id: String) {
        Task { do { _ = try await model.request("openActivity", args: ["id": id]) } catch { model.errorMessage = error.localizedDescription } }
    }
}

struct ActivitySegmentsSection: View {
    @ObservedObject var model: ActivityDetailsViewModel
    @State private var open: String?
    private func counts(_ row: ActivityPresentation.RiddenSegment) -> String {
        "\(row.thisRide) attempt\(row.thisRide == 1 ? "" : "s") on this ride"
    }
    var body: some View {
        let s = model.presentation.segments
        if s.allowed {
            Button { model.startSegment() } label: { Label("Create Segment", systemImage: "flag").frame(maxWidth: .infinity) }
                .buttonStyle(DetailButtonStyle()).disabled(model.busy)
        }
        if !s.list.isEmpty {
            DetailCard(title: "Segments", symbol: "flag") {
                ForEach(s.list) { row in
                    Button { open = open == row.id ? nil : row.id } label: {
                        HStack(alignment: .top, spacing: 8) {
                            Circle().fill(Color(hex: row.color)).frame(width: 12, height: 12).padding(.top, 4).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.name).font(.subheadline.weight(.semibold)).foregroundColor(.primary)
                                Text(counts(row)).font(.footnote).foregroundColor(DetailStyle.muted)
                            }
                            Spacer()
                            Image(systemName: open == row.id ? "chevron.up" : "chevron.down").font(.footnote).foregroundColor(DetailStyle.muted)
                        }.frame(minHeight: 44)
                    }
                    .accessibilityValue(open == row.id ? "Expanded" : "Collapsed")
                    if let best=row.personalBest {
                        Button {
                            guard !best.current else {return}
                            Task {do {_ = try await model.request("openActivity",args:["id":best.activityID])} catch {model.errorMessage=error.localizedDescription}}
                        } label: {
                            VStack(alignment:.leading,spacing:3) {
                                Text("Your PR \(best.time)").font(.headline).foregroundColor(.primary)
                                Text("\(best.when) \u{00b7} \(best.title)").font(.caption).foregroundColor(DetailStyle.muted)
                                if !best.current {Text("Open PR ride").font(.caption.weight(.semibold))}
                            }.frame(maxWidth:.infinity,alignment:.leading)
                        }.accessibilityIdentifier("segment.personal-best")
                    }
                    if let best=row.thisRideBest {Text("Best this ride: \(best.time)").font(.subheadline.weight(.semibold))}
                    if row.newPR == true {Label("New personal record",systemImage:"trophy.fill").foregroundColor(.green)}
                    if let comparison=row.comparison {Text(comparison).font(.footnote).foregroundColor(DetailStyle.muted)}
                    if open == row.id {
                        Text("\(row.total) detected attempts across \(row.rideCount) available ride\(row.rideCount == 1 ? "" : "s"). Quickest attempts first.")
                            .font(.footnote).foregroundColor(DetailStyle.muted)
                        ForEach(row.passes) { pass in passRow(pass) }
                    }
                }
            }
        }
    }
    private func passRow(_ pass: ActivityPresentation.SegmentPass) -> some View {
        Button {
            guard !pass.current else { return }
            Task { do { _ = try await model.request("openActivity", args: ["id": pass.activityID]) } catch { model.errorMessage = error.localizedDescription } }
        } label: {
            HStack(spacing: 8) {
                Text("\(pass.rank)").font(.footnote.monospacedDigit()).foregroundColor(DetailStyle.muted).frame(minWidth: 22, alignment: .leading)
                Text(pass.time).font(.subheadline.weight(.semibold).monospacedDigit()).foregroundColor(.primary)
                VStack(alignment: .leading, spacing: 0) {
                    Text(pass.current ? "This ride" : pass.title).font(.footnote).foregroundColor(.primary).lineLimit(1)
                    Text(pass.interrupted == true ? "\(pass.when) · estimated, recording stopped mid-lap" : pass.when).font(.caption).foregroundColor(DetailStyle.muted)
                }
                Spacer()
            }.frame(minHeight: 40)
        }
        .accessibilityIdentifier("segment.pass")
    }
}

struct SegmentEditorCard: View {
    @ObservedObject var model: ActivityDetailsViewModel
    let draft: ActivityDetailsViewModel.SegmentDraft
    @State private var name: String
    @State private var tried = false
    init(model: ActivityDetailsViewModel, draft: ActivityDetailsViewModel.SegmentDraft) {
        self.model = model; self.draft = draft
        _name = State(initialValue: draft.name)
    }
    var body: some View {
        if let picking = draft.picking { pickingCard(picking) } else { editing }
    }
    // Fits the collapsed panel, which gives the screen to the map: one row, one hint.
    private func pickingCard(_ picking: ActivityDetailsViewModel.Picking) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(picking == .start ? "Tap where the segment starts" : "Now tap where it ends")
                    .font(.subheadline.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.85)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 2)
                if case .finish = picking {
                    Button { model.repickSegment() } label: { Image(systemName: "arrow.counterclockwise") }
                        .buttonStyle(DetailButtonStyle()).accessibilityLabel("Start over")
                } else {
                    Button { model.chooseWithSliders() } label: { Image(systemName: "slider.horizontal.3") }
                        .buttonStyle(DetailButtonStyle()).accessibilityLabel("Choose with sliders")
                }
                Button("Cancel") { model.cancelSegment() }.buttonStyle(DetailButtonStyle()).accessibilityIdentifier("segment.cancel")
            }
            DetailFootnote(text: model.pickProblem.isEmpty ? "Tap the route. Zoom in for a precise spot." : model.pickProblem)
                .accessibilityIdentifier("segment.hint")
        }
    }
    private var editing: some View {
        let points = model.points
        let figures = draft.start < draft.end && draft.end < points.count ? NamedSegments.measure(points, start: draft.start, end: draft.end, automatic: model.automatic) : nil
        let problem = NamedSegments.problem(start: draft.start, end: draft.end, points: points, automatic: model.automatic)
        return DetailCard(title: draft.existing ? "Edit segment" : "Create segment", symbol: "flag") {
            DetailFootnote(text: "This section is published to the community segment library when it syncs. Only the selected route is shared; your activity and health measurements stay private.")
            RangeSlider(start: draft.start, end: draft.end, first: draft.window.lowerBound, last: draft.window.upperBound, startLabel: "Segment start", endLabel: "Segment finish", onBegin: model.rememberSegmentRange) { model.setSegment(start: $0, end: $1) }
            HStack {
                NudgeReadout(label: "Start") { model.nudgeSegment(start: $0) }
                NudgeReadout(label: "Finish") { model.nudgeSegment(end: $0) }
            }
            ReadoutPair(label: "Length", value: ActivityDetailsFormat.distance(meters: figures?.distanceMeters ?? 0, unit: model.presentation.unit))
            if let gap = figures?.gapSeconds, gap > 0 { DetailFootnote(text: "Includes \(ActivityDetailsFormat.clock(gap)) without GPS; that stretch is not drawn or counted.") }
            if let problem { DetailFootnote(text: problem.message) }
            TextField("Segment name", text: $name).textFieldStyle(.roundedBorder).accessibilityIdentifier("segment.name")
                .onChange(of: name) { if $0.count > NamedSegments.maximumNameLength { name = String($0.prefix(NamedSegments.maximumNameLength)) } }
            if tried, NamedSegments.cleanName(name) == nil { Text("Name the segment to save it.").font(.footnote).foregroundColor(.red) }
            if !model.errorMessage.isEmpty { Text(model.errorMessage).font(.footnote).foregroundColor(.red).accessibilityIdentifier("segment.error") }
            HStack {
                Button("Pick on map") { model.repickSegment() }.buttonStyle(DetailButtonStyle())
                Button { model.undoSegment() } label: { Image(systemName: "arrow.uturn.backward") }
                    .buttonStyle(DetailButtonStyle()).disabled(draft.history.isEmpty).accessibilityLabel("Undo handle change")
                Button("Cancel") { model.cancelSegment() }.buttonStyle(DetailButtonStyle()).accessibilityIdentifier("segment.cancel")
                Button(model.busy ? "Saving…" : "Save") {
                    tried = true
                    guard let clean = NamedSegments.cleanName(name), problem == nil else { return }
                    Task { await model.saveSegment(name: clean) }
                }.buttonStyle(DetailButtonStyle(kind: .primary)).disabled(model.busy || problem != nil).accessibilityLabel("Save Segment")
            }
        }
    }
}

// One GPS fix at a time, for the last few seconds of a short section.
struct NudgeReadout: View {
    let label: String
    let move: (Int) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundColor(DetailStyle.muted)
            HStack(spacing: 6) {
                Button { move(-1) } label: { Image(systemName: "minus") }.buttonStyle(DetailButtonStyle()).accessibilityLabel("Move \(label.lowercased()) earlier")
                Button { move(1) } label: { Image(systemName: "plus") }.buttonStyle(DetailButtonStyle()).accessibilityLabel("Move \(label.lowercased()) later")
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ReadoutPair: View {
    let label: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption).foregroundColor(DetailStyle.muted)
            Text(value).font(.subheadline.weight(.medium).monospacedDigit())
        }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
    }
}

enum ActivityClock {
    private static let formatter: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_AU"); f.dateFormat = "h:mm:ss a"; return f
    }()
    static func time(_ points: [GPSPoint], _ index: Int) -> String {
        guard points.indices.contains(index) else { return "—" }
        return formatter.string(from: Date(timeIntervalSince1970: points[index].timestamp))
    }
}

// Two handles on one track, each usable with VoiceOver as an adjustable element.
struct RangeSlider: View {
    let start: Int
    let end: Int
    // The part of the recording the track covers.
    var first: Int = 0
    let last: Int
    let startLabel: String
    let endLabel: String
    var onBegin: () -> Void = {}
    let onChange: (Int, Int) -> Void
    @State private var dragging = false
    private let thumb: CGFloat = 28
    var body: some View {
        GeometryReader { geometry in
            let width = max(1, geometry.size.width - thumb)
            let span = CGFloat(max(1, last - first))
            let x = { (index: Int) in CGFloat(index - first) / span * width }
            ZStack(alignment: .leading) {
                Capsule().fill(Color(.tertiarySystemFill)).frame(height: 6).padding(.horizontal, thumb / 2)
                Capsule().fill(Color.accentColor).frame(width: max(0, x(end) - x(start)), height: 6).offset(x: x(start) + thumb / 2)
                handle(label: startLabel, value: start, x: x(start), width: width) { onChange(min($0, end - 1), end) } adjust: { onChange(max(first, min(start + $0, end - 1)), end) }
                handle(label: endLabel, value: end, x: x(end), width: width) { onChange(start, max($0, start + 1)) } adjust: { onChange(start, min(last, max(end + $0, start + 1))) }
            }.frame(height: 44).coordinateSpace(name: "range")
        }.frame(height: 44)
    }
    private func handle(label: String, value: Int, x: CGFloat, width: CGFloat, set: @escaping (Int) -> Void, adjust: @escaping (Int) -> Void) -> some View {
        Circle().fill(Color.white).frame(width: thumb, height: thumb)
            .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
            .frame(width: 44, height: 44).contentShape(Rectangle())
            .offset(x: x - (44 - thumb) / 2)
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .named("range"))
                .onEnded { _ in dragging = false }
                .onChanged { value in
                    if !dragging { dragging = true; onBegin() }
                    set(first + Int(((value.location.x - thumb / 2) / width * CGFloat(last - first)).rounded()).clamped(0, last - first))
                })
            .accessibilityElement().accessibilityLabel(label).accessibilityValue("\(Int(Double(value - first) / Double(max(1, last - first)) * 100)) percent")
            .accessibilityAdjustableAction { direction in
                onBegin()
                let step = max(1, (last - first) / 50)
                adjust(direction == .increment ? step : -step)
            }
    }
}
private extension Int { func clamped(_ low: Int, _ high: Int) -> Int { Swift.min(high, Swift.max(low, self)) } }

extension Color {
    init(hex: String) {
        let value = UInt32(hex.dropFirst(), radix: 16) ?? 0
        self.init(red: Double(value >> 16 & 255) / 255, green: Double(value >> 8 & 255) / 255, blue: Double(value & 255) / 255)
    }
}

struct ActivityRouteSection: View {
    @ObservedObject var model: ActivityDetailsViewModel
    var body: some View {
        if let trim = model.presentation.trim, trim.pointCount >= 2 {
            DetailCard(title: "Route shown on map", symbol: "point.topleft.down.curvedto.point.bottomright.up") {
                DetailFootnote(text: "Choose which part of this recording appears on the map. Original GPS points are kept.")
                Button("Choose visible route") { model.startTrim() }.buttonStyle(DetailButtonStyle())
            }
        }
    }
}

struct RouteTrimCard: View {
    @ObservedObject var model: ActivityDetailsViewModel
    let trim: ActivityPresentation.Trim
    var body: some View {
        let range = model.trimRange(trim), points = model.points, last = trim.pointCount - 1
        let changed = range.start != trim.start || range.end != trim.end
        DetailCard(title: "Route shown on map", symbol: "point.topleft.down.curvedto.point.bottomright.up") {
            DetailFootnote(text: "Original GPS points are kept. The map above updates as you drag.")
            RangeSlider(start: range.start, end: range.end, last: last, startLabel: "Visible route start", endLabel: "Visible route finish") {
                model.setTrim(.init(start: $0, end: $1))
            }
            HStack {
                ReadoutPair(label: "Start", value: ActivityClock.time(points, range.start))
                ReadoutPair(label: "Finish", value: ActivityClock.time(points, range.end))
            }
            HStack {
                Button("Show full route") { model.resetTrim(trim) }.buttonStyle(DetailButtonStyle())
                Button("Cancel") { model.cancelTrim() }.buttonStyle(DetailButtonStyle()).accessibilityIdentifier("trim.cancel")
                Button("Save") { Task { await model.saveTrim(trim) } }.accessibilityIdentifier("trim.save")
                    
                    .buttonStyle(DetailButtonStyle(kind: .primary)).disabled(model.busy || range.start >= range.end || !changed)
                    .accessibilityLabel("Save visible route")
            }
        }
    }
}

struct ActivityTrailSection: View {
    @ObservedObject var model: ActivityDetailsViewModel
    private struct TrailChoice: Identifiable { var id: String; var name: String; var detail: String; var segmentID: String?; var distanceMeters: Double? }
    @State private var open = false
    @State private var loading = false
    @State private var trails: [TrailChoice]?
    @State private var problem = ""
    @State private var note = ""
    @State private var loadedFor = ""
    var body: some View {
        if let trail = model.presentation.trail {
            DetailCard(title: "Trail", symbol: "mountain.2") {
                if let label = trail.linkedLabel {
                    Text(label).font(.subheadline.weight(.semibold))
                    DetailFootnote(text: "Linked privately on this device. Community trail details are not changed by this ride.")
                    HStack {
                        Button("Change trail") { browse() }.buttonStyle(DetailButtonStyle()).disabled(model.busy || loading)
                        Button("Remove link") { unlink() }.buttonStyle(DetailButtonStyle(kind: .destructive)).disabled(model.busy)
                    }
                } else {
                    DetailFootnote(text: "Link this ride to a nearby community trail. The link is stored with the activity, so it works offline and never publishes your route.")
                    Button(loading ? "Looking for trails…" : "Find nearby trails") { browse() }.buttonStyle(DetailButtonStyle()).disabled(model.busy || loading)
                }
                if open {
                    if loading { ProgressView("Looking for trails near this ride…").font(.footnote) }
                    if !problem.isEmpty { DetailFootnote(text: problem); Button("Try again") { browse(force: true) }.buttonStyle(DetailButtonStyle()) }
                    if !loading, problem.isEmpty, trails?.isEmpty == true { DetailFootnote(text: "No community trails found near this ride yet.") }
                    ForEach(trails ?? []) { choice in
                        Button { link(choice) } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(choice.name).font(.subheadline.weight(.semibold)).foregroundColor(.primary)
                                    Text(choice.detail).font(.caption).foregroundColor(DetailStyle.muted)
                                }
                                Spacer()
                                Image(systemName: choice.id == trail.linkedID ? "checkmark" : "link")
                            }
                        }.disabled(model.busy)
                    }
                }
                if !note.isEmpty { DetailFootnote(text: note) }
            }
        }
    }
    private func browse(force: Bool = false) {
        open = true; note = ""
        let key = "\(model.presentation.activityID):\(model.points.count)"
        if !force, trails != nil, loadedFor == key { return }
        loading = true; problem = ""
        Task {
            defer { loading = false }
            do {
                let result = try await model.request("findTrails")
                let rows = result["trails"] as? [[String: Any]] ?? []
                trails = rows.compactMap { row in
                    guard let id = row["id"] as? String else { return nil }
                    return TrailChoice(id: id, name: row["name"] as? String ?? "Trail", detail: row["detail"] as? String ?? "", segmentID: row["trailSegmentID"] as? String, distanceMeters: (row["trailDistanceMeters"] as? NSNumber)?.doubleValue)
                }
                loadedFor = key
                if let text = result["note"] as? String { trails = nil; note = text }
            } catch { trails = nil; loadedFor = ""; problem = error.localizedDescription }
        }
    }
    private func link(_ choice: TrailChoice) {
        Task {
            if await model.perform(.assignTrail(.init(id: choice.id, name: choice.name, segmentID: choice.segmentID, distanceMeters: choice.distanceMeters))) {
                open = false; note = "Linked to \(choice.name)."
            }
        }
    }
    private func unlink() {
        Task {
            if await model.perform(.assignTrail(nil)) {
                open = false; trails = nil; loadedFor = ""; note = "Trail link removed. The ride is unchanged and its GPS stays private."
            }
        }
    }
}

struct ActivityStorySection: View {
    let story: ActivityPresentation.Story
    var body: some View {
        DetailCard(title: "Your story", symbol: "text.quote") {
            Text(story.description.isEmpty ? "Add a description to remember the little details." : story.description)
                .font(.subheadline).foregroundColor(story.description.isEmpty ? .secondary : .primary)
            if !story.notes.isEmpty { Text(story.notes).font(.subheadline) }
            if !story.tags.isEmpty { Text(story.tags.joined(separator: " · ")).font(.footnote).foregroundColor(DetailStyle.muted) }
        }
    }
}

struct ActivityFactsSection: View {
    let presentation: ActivityPresentation
    var body: some View {
        DetailCard(title: "About this recording", symbol: "info.circle") {
            HStack(alignment: .top) { ForEach(presentation.metrics) { ReadoutPair(label: $0.label, value: $0.value) } }
            ForEach(presentation.facts?.lines ?? [], id: \.self) { Text($0).font(.footnote) }
            ForEach(presentation.facts?.evidence ?? [], id: \.self) { Text($0).font(.caption).foregroundColor(DetailStyle.muted) }
        }
    }
}

struct ActivityStopsSection: View {
    @ObservedObject var model: ActivityDetailsViewModel
    var body: some View {
        if !model.presentation.stops.isEmpty {
            DetailCard(title: "Stops along the way", symbol: "mappin.circle") {
                ForEach(model.presentation.stops) { stop in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(stop.name).font(.subheadline.weight(.semibold))
                            Spacer()
                            if stop.canIgnore {
                                Button("Not a stop") {
                                    Task { await model.groupingAct(["type": "stop", "id": stop.id, "name": stop.name, "tags": stop.tags, "ignored": true]) }
                                }.font(.footnote).frame(minHeight: 44)
                            }
                        }
                        Text(stop.detail).font(.footnote).foregroundColor(DetailStyle.muted)
                        if let nearby = stop.nearby { Text("Nearby: \(nearby)").font(.caption).foregroundColor(DetailStyle.muted) }
                    }
                }
            }
        }
    }
}

struct ActivityDiagnosticsSection: View {
    @ObservedObject var model: ActivityDetailsViewModel
    // The report is sent as feedback (with the ticket, for the sender and admins
    // only), never copied. The IDs make a retry return the same ticket and file.
    @State private var note = ""
    @State private var sending = false
    @State private var sent: String?
    @State private var sendError: String?
    @State private var ids = (token: UUID().uuidString.lowercased(), report: UUID().uuidString.lowercased())
    private func send(_ report: String) async {
        sending = true; sendError = nil
        do {
            let result = try await model.request("sendRecordingReport", args: ["note": note, "report": report, "token": ids.token, "reportID": ids.report], timeout: 60)
            sent = result["reference"] as? String ?? ""
        } catch { sendError = error.localizedDescription }
        sending = false
    }
    var body: some View {
        if let d = model.presentation.diagnostics {
            DisclosureGroup("Recording diagnostics") {
                VStack(alignment: .leading, spacing: 8) {
                    DetailFootnote(text: "The measurements below are from GPS samples actually saved with this activity. They cannot reconstruct missing travel.")
                    ForEach(d.stats) { stat in HStack { Text(stat.label).font(.footnote); Spacer(); Text(stat.value).font(.footnote.weight(.semibold)) } }
                    if !d.warnings.isEmpty {
                        Text("Possible recording issues").font(.footnote.weight(.semibold))
                        ForEach(d.warnings, id: \.self) { Text("• \($0)").font(.footnote) }
                    }
                    ForEach(Array(d.events.enumerated()), id: \.offset) { Text($0.element).font(.caption).foregroundColor(DetailStyle.muted) }
                    if let sent {
                        DetailFootnote(text: "Sent as feedback \(sent). Quote this number when you ask about it; replies appear under Feedback → My feedback.")
                    } else {
                        TextField("What went wrong? (optional)", text: $note).font(.footnote).textFieldStyle(.roundedBorder).disabled(sending)
                        Button(sending ? "Sending…" : "Send recording report as feedback") { Task { await send(d.report) } }
                            .buttonStyle(DetailButtonStyle()).disabled(sending)
                        if let sendError { DetailFootnote(text: sendError) }
                    }
                    DetailFootnote(text: "A trip may be incomplete if iOS wakes the app after departure. No app can recover coordinates that iOS never provided.")
                }.padding(.top, 6)
            }
            .font(.subheadline.weight(.semibold))
            .padding(14)
            .background(DetailStyle.cardFill, in: RoundedRectangle(cornerRadius: DetailStyle.radius, style: .continuous))
        }
    }
}

struct ActivityDangerSection: View {
    @ObservedObject var model: ActivityDetailsViewModel
    var body: some View {
        if model.presentation.header.local {
            Button(role: .destructive) { model.deleting = true } label: { Label("Delete activity", systemImage: "trash").frame(maxWidth: .infinity) }
                .buttonStyle(DetailButtonStyle(kind: .destructive))
                .confirmationDialog("Permanently delete this activity?", isPresented: $model.deleting, titleVisibility: .visible) {
                    Button("Delete permanently", role: .destructive) { Task { await model.deleteActivity() } }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("Its local route, photo copies and activity record will be removed. A deletion tombstone prevents a delayed save restoring it. Original photos in your library stay intact.")
                }
        }
    }
}

struct TextEntrySheet: View {
    let title: String
    let label: String
    @Binding var text: String
    var limit: Int = 500
    var valid: Bool = true
    let save: () -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationView {
            Form { TextField(label, text: $text).onChange(of: text) { if $0.count > limit { text = String($0.prefix(limit)) } } }
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).disabled(!valid) }
                }
        }.navigationViewStyle(.stack)
    }
}

// The tags section of the journal: every action is the grouping action React uses.
struct ActivityTagsSection: View {
    @ObservedObject var model: ActivityDetailsViewModel
    private struct Suggestion: Identifiable { var id: String { tag }; let tag: String; let source: String }
    @State private var value = ""
    @State private var remember = false
    @State private var notice = ""
    @State private var scanning = false
    @State private var suggestions: [Suggestion] = []
    @State private var working = false
    var body: some View {
        if let tags = model.presentation.tags {
            DetailCard(title: "Your tags", symbol: "tag") {
                DetailFootnote(text: tags.note.isEmpty ? "Personal tags describe this trip. To recognise a destination on future visits, also save it as a place." : tags.note)
                FlowTags(items: tags.auto + tags.custom, disabled: working || tags.readOnly) { tag in
                    if tags.custom.contains(tag) { act(["type": "manualTags", "anchor": tags.anchor, "tags": tags.custom.filter { $0 != tag }]) }
                    else { act(["type": "hideTag", "anchor": tags.anchor, "tag": tag]) }
                }
                if let destination = tags.destination {
                    DisclosureGroup("\(destination.name) — \(destination.summary)") {
                        ForEach(destination.activities) { activity in
                            VStack(alignment: .leading) {
                                Button(activity.title) { open(activity.id) }.disabled(!activity.openable)
                                if let comparison = activity.comparison { Text(comparison).font(.caption).foregroundColor(DetailStyle.muted) }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }.font(.footnote)
                }
                if !tags.readOnly {
                    Button(scanning ? "Checking route…" : "Find more places on this route") { scan() }
                        .buttonStyle(DetailButtonStyle()).disabled(scanning || working)
                    ForEach(suggestions) { suggestion in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(suggestion.tag).font(.subheadline.weight(.semibold))
                                Text(suggestion.source).font(.caption).foregroundColor(DetailStyle.muted)
                            }
                            Spacer()
                            Button("Add") { resolve(suggestion, ["type": "manualTags", "anchor": tags.anchor, "tags": tags.custom + [suggestion.tag]]) }.disabled(working || tags.custom.count >= tags.limit)
                            Button("Skip") { resolve(suggestion, ["type": "hideTag", "anchor": tags.anchor, "tag": suggestion.tag]) }.disabled(working)
                        }
                    }
                    if !tags.hidden.isEmpty {
                        DisclosureGroup("Hidden tags (\(tags.hidden.count))") {
                            ForEach(tags.hidden, id: \.self) { tag in
                                Button("Restore \(tag)") { act(["type": "restoreTag", "anchor": tags.anchor, "tag": tag]) }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }.font(.footnote)
                    }
                    HStack {
                        TextField("Search or add a tag", text: $value).textFieldStyle(.roundedBorder)
                            .textInputAutocapitalization(.words).autocorrectionDisabled()
                            .accessibilityLabel("New custom tag")
                        // The label says what a press will do. A tag the activity
                        // already carries has nothing to add, so it is named and
                        // disabled until the Remember toggle gives it something to do.
                        Button(actionLabel(tags)) { add(tags) }
                            .buttonStyle(DetailButtonStyle())
                            .disabled(working || actionKind(tags) == nil || actionKind(tags) == .applied
                                || (!pick(tags).applied && tags.custom.count >= tags.limit))
                    }
                    if actionKind(tags) == .applied {
                        DetailFootnote(text: tags.appliedExplanation)
                    }
                    // The tags this person already uses, filtered as they type. Nothing
                    // is looked up: the history arrived with the presentation.
                    ForEach(matches(tags), id: \.self) { name in
                        Button(name) { add(tags, name: name) }
                            .font(.footnote)
                            .accessibilityLabel("Use tag \(name)")
                    }
                    if tags.canRemember {
                        Toggle(tags.rememberLabel.isEmpty ? "Remember the destination for future trips (200 m radius)" : tags.rememberLabel, isOn: $remember)
                            .font(.footnote)
                    }
                }
                if !notice.isEmpty { DetailFootnote(text: notice) }
            }
        }
    }
    private func act(_ action: [String: Any], then: (() -> Void)? = nil) {
        working = true
        Task { let ok = await model.groupingAct(action); working = false; if ok { then?() } }
    }
    private func resolve(_ suggestion: Suggestion, _ action: [String: Any]) {
        act(action) { suggestions.removeAll { $0.tag == suggestion.tag } }
    }
    private func open(_ id: String) {
        Task { do { _ = try await model.request("openActivity", args: ["id": id]) } catch { notice = error.localizedDescription } }
    }
    private func scan() {
        guard !scanning else { return }
        scanning = true; suggestions = []; notice = "Preparing route locations…"
        Task {
            defer { scanning = false }
            do {
                let result = try await model.request("scanPlaces", timeout: 120) { notice = $0 }
                suggestions = (result["suggestions"] as? [[String: Any]] ?? []).compactMap { row in (row["tag"] as? String).map { Suggestion(tag: $0, source: row["source"] as? String ?? "Apple Maps") } }
                notice = result["notice"] as? String ?? ""
            } catch { notice = error.localizedDescription }
        }
    }
    private func add(_ tags: ActivityPresentation.Tags, name: String? = nil) {
        guard !working else { return }
        let chosen = TagSearch.choice(known: tags.known, applied: tags.auto + tags.custom, query: name ?? value)
        guard !chosen.name.isEmpty else { return }
        let remembering = remember && tags.canRemember
        // A tag already on this trip never blocks remembering the destination: the
        // tag is skipped, the place is still saved. This is the silent no-op the
        // section used to fall into.
        if chosen.applied && !remembering {
            notice = tags.appliedExplanation
            return
        }
        working = true; notice = ""
        Task {
            defer { working = false }
            do {
                // One request, coordinated in JavaScript, so a partial failure says
                // the same thing here as it does in React and keeps the typed name
                // and the tick for the retry.
                let result = try await model.request("tagAndRemember", args: ["name": chosen.name, "remember": remembering])
                notice = result["notice"] as? String ?? ""
                if result["clear"] as? Bool == true { value = ""; remember = false }
            } catch { notice = error.localizedDescription }
        }
    }
    private func pick(_ tags: ActivityPresentation.Tags) -> (name: String, applied: Bool, create: Bool) {
        TagSearch.choice(known: tags.known, applied: tags.auto + tags.custom, query: value)
    }
    private func matches(_ tags: ActivityPresentation.Tags) -> [String] {
        TagSearch.suggestions(known: tags.known, applied: tags.auto + tags.custom, query: value)
    }
    private func actionKind(_ tags: ActivityPresentation.Tags) -> TagSearch.Action? {
        TagSearch.action(name: value, applied: pick(tags).applied, remembering: remember && tags.canRemember)
    }
    private func actionLabel(_ tags: ActivityPresentation.Tags) -> String {
        let labels = tags.actionLabels
        switch actionKind(tags) {
        case .add: return labels.add
        case .remember: return labels.remember
        case .applied: return labels.applied
        case nil: return labels.add
        }
    }
}

struct FlowTags: View {
    let items: [String]
    let disabled: Bool
    let remove: (String) -> Void
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(items, id: \.self) { tag in
                HStack(spacing: 4) {
                    Text(tag).font(.footnote).lineLimit(1)
                    Button { remove(tag) } label: { Image(systemName: "xmark.circle.fill") }
                        .disabled(disabled).accessibilityLabel("Remove tag \(tag)").frame(minWidth: 30, minHeight: 30)
                }
                .padding(.leading, 10).padding(.trailing, 2)
                .background(Color(.tertiarySystemFill), in: Capsule())
            }
        }
    }
}
