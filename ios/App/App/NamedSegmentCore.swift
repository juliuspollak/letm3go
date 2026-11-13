import Foundation

// MARK: Named segments
//
// A named section of one recording ("Rock Garden Descent"). It is a reference
// into the activity's own fixes, never new geometry: the two ends are recorded
// fix indices, checked against those fixes' timestamps, and every figure is
// measured from the fixes between them. The recording itself is never changed by
// creating, renaming or deleting a segment; it is separate from the visible route
// window (visibleRouteStart/End), from a linked MTB trail and from publishing.
struct NamedSegment: Codable, Equatable {
    var id: String
    var name: String
    var startIndex: Int
    var endIndex: Int
    // Stable references: the fixes' own timestamps, so a segment can be found
    // again if the recording's fixes are ever renumbered (destructive trimming).
    var startTimestamp: Double
    var endTimestamp: Double
    var distanceMeters: Double
    // Elapsed time between the two fixes; `gapSeconds` of it had no GPS.
    var durationSeconds: Double
    var gapSeconds: Double
    var pointCount: Int
    // Index into a fixed palette, kept for the segment's life so its colour never
    // changes when another segment is added or removed.
    var colorIndex: Int
    // A simplified copy of the real fixes, one line per observed stretch, kept
    // for recognising this section on a later recording. Never interpolated.
    var geometry: [[[Double]]]
    var visibility: String = "private"
    var createdAt: Double
    var updatedAt: Double
}

enum NamedSegments {
    static let maximumPerActivity = 20
    static let minimumPoints = 5
    static let minimumMeters: Double = 50
    static let maximumNameLength = 80
    static let paletteSize = 8
    static let geometryBudget = 200

    enum Failure: Error, Equatable {
        case invalidID, name, range, tooFewPoints, tooShort, noObservedRoute, limit, notFound
        var message: String {
            switch self {
            case .invalidID: return "This segment could not be saved. Try again."
            case .name: return "Give the segment a name (up to 80 characters)."
            case .range: return "Choose a start before the finish on this recording."
            case .tooFewPoints: return "Choose a longer section: a segment needs at least \(NamedSegments.minimumPoints) GPS points."
            case .tooShort: return "Choose a longer section: a segment must cover at least \(Int(NamedSegments.minimumMeters)) m of recorded route."
            case .noObservedRoute: return "This section has no continuous GPS route."
            case .limit: return "An activity can have up to \(NamedSegments.maximumPerActivity) segments."
            case .notFound: return "That segment no longer exists."
            }
        }
    }

    static func cleanName(_ raw: String) -> String? {
        let name = raw.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
        guard !name.isEmpty, name.count <= maximumNameLength else { return nil }
        return name
    }

    // Consecutive fixes are one observed stretch only within the same recording
    // segment and without an unobserved gap between them.
    static func connected(_ a: GPSPoint, _ b: GPSPoint) -> Bool {
        a.segment == b.segment && b.timestamp > a.timestamp && !RecordedActivity.unobservedGap(from: a, to: b)
    }

    static func runs(_ points: ArraySlice<GPSPoint>) -> [[GPSPoint]] {
        var result: [[GPSPoint]] = []
        var previous: GPSPoint?
        for point in points {
            if let last = previous, connected(last, point) { result[result.count - 1].append(point) } else { result.append([point]) }
            previous = point
        }
        return result
    }

    struct Measure: Equatable { var distanceMeters: Double; var durationSeconds: Double; var gapSeconds: Double; var observedRuns: Int }
    static func measure(_ points: [GPSPoint], start: Int, end: Int, automatic: Bool) -> Measure {
        let slice = points[start...end]
        let stretches = runs(slice)
        let distance = stretches.reduce(0) { $0 + RecordedActivity.measuredDistance($1, automatic: automatic) }
        var gap = 0.0
        for (a, b) in zip(slice, slice.dropFirst()) where !connected(a, b) { gap += max(0, b.timestamp - a.timestamp) }
        return Measure(distanceMeters: distance, durationSeconds: max(0, points[end].timestamp - points[start].timestamp),
                       gapSeconds: gap, observedRuns: stretches.filter { $0.count > 1 }.count)
    }

    // Real fixes only, never more than `budget` of them in total, and never a
    // line across a gap. Policy:
    // 1. Each observed stretch (two or more connected fixes) is drawn
    //    separately, from its own first fix to its own last fix.
    // 2. If there are more stretches than the budget can draw (budget / 2,
    //    two fixes each), the longest stretches by recorded distance are kept,
    //    in recording order, and the shortest are left out of this copy. The
    //    recording itself, and the segment's figures, are unaffected: this copy
    //    is only for recognising the section on another ride.
    // 3. Each kept stretch gets its two ends; the rest of the budget is shared
    //    in proportion to each stretch's remaining fixes, sampled evenly.
    static func geometry(_ points: [GPSPoint], start: Int, end: Int, budget: Int = geometryBudget) -> [[[Double]]] {
        guard budget >= 2, start >= 0, end < points.count, start < end else { return [] }
        var stretches = runs(points[start...end]).filter { $0.count > 1 }
        let maximumStretches = budget / 2
        if stretches.count > maximumStretches {
            let longest = stretches.indices.sorted {
                let a = RecordedActivity.measuredDistance(stretches[$0], automatic: false), b = RecordedActivity.measuredDistance(stretches[$1], automatic: false)
                return a != b ? a > b : $0 < $1
            }
            let kept = Set(longest.prefix(maximumStretches))
            stretches = stretches.indices.filter { kept.contains($0) }.map { stretches[$0] }
        }
        let interior = stretches.reduce(0) { $0 + $1.count - 2 }
        let spare = budget - 2 * stretches.count
        return stretches.map { run in
            let extra = interior > 0 ? Int((Double(spare) * Double(run.count - 2) / Double(interior)).rounded(.down)) : 0
            let share = min(run.count, 2 + extra)
            guard run.count > share else { return run.map { [$0.latitude, $0.longitude] } }
            let step = Double(run.count - 1) / Double(share - 1)
            var picked: [Int] = []
            for k in 0..<share { let index = Int((Double(k) * step).rounded()); if picked.last != index { picked.append(index) } }
            if picked.last != run.count - 1 { picked.append(run.count - 1) }
            return picked.map { [run[$0].latitude, run[$0].longitude] }
        }
    }

    // The rule a range must meet, shared with the live editor.
    static func problem(start: Int, end: Int, points: [GPSPoint], automatic: Bool) -> Failure? {
        guard start >= 0, end < points.count, start < end else { return .range }
        guard end - start + 1 >= minimumPoints else { return .tooFewPoints }
        let figures = measure(points, start: start, end: end, automatic: automatic)
        guard figures.observedRuns > 0 else { return .noObservedRoute }
        return figures.distanceMeters >= minimumMeters ? nil : .tooShort
    }

    // Create a segment, or update the one with the same id (rename or new ends).
    // A repeated submission of the same id therefore never makes a duplicate.
    static func make(id rawID: String, name rawName: String, start: Int, end: Int, points: [GPSPoint], automatic: Bool,
                     existing: [NamedSegment], now: Double) -> Result<NamedSegment, Failure> {
        guard let uuid = UUID(uuidString: rawID) else { return .failure(.invalidID) }
        let id = uuid.uuidString.lowercased()
        guard let name = cleanName(rawName) else { return .failure(.name) }
        guard start >= 0, end < points.count, start < end else { return .failure(.range) }
        let previous = existing.first { $0.id == id }
        if previous == nil, existing.count >= maximumPerActivity { return .failure(.limit) }
        if let failure = problem(start: start, end: end, points: points, automatic: automatic) { return .failure(failure) }
        let figures = measure(points, start: start, end: end, automatic: automatic)
        let used = Set(existing.filter { $0.id != id }.map { $0.colorIndex })
        let color = previous?.colorIndex ?? (0..<paletteSize).first { !used.contains($0) } ?? existing.count % paletteSize
        return .success(NamedSegment(id: id, name: name, startIndex: start, endIndex: end,
                                     startTimestamp: points[start].timestamp, endTimestamp: points[end].timestamp,
                                     distanceMeters: figures.distanceMeters, durationSeconds: figures.durationSeconds,
                                     gapSeconds: figures.gapSeconds, pointCount: end - start + 1, colorIndex: color,
                                     geometry: geometry(points, start: start, end: end), visibility: previous?.visibility ?? "private",
                                     createdAt: previous?.createdAt ?? now, updatedAt: now))
    }

    static func upsert(_ segment: NamedSegment, into existing: [NamedSegment]) -> [NamedSegment] {
        (existing.filter { $0.id != segment.id } + [segment]).sorted { ($0.startIndex, $0.createdAt) < ($1.startIndex, $1.createdAt) }
    }
    static func removing(_ id: String, from existing: [NamedSegment]) -> [NamedSegment]? {
        let key = id.lowercased()
        guard existing.contains(where: { $0.id == key }) else { return nil }
        return existing.filter { $0.id != key }
    }

    // A segment whose ends still name the same fixes.
    static func valid(_ segment: NamedSegment, points: [GPSPoint]) -> Bool {
        segment.startIndex >= 0 && segment.endIndex < points.count && segment.startIndex < segment.endIndex &&
            points[segment.startIndex].timestamp == segment.startTimestamp && points[segment.endIndex].timestamp == segment.endTimestamp
    }

    // After destructive trimming, each segment is found again by its fixes'
    // timestamps; one whose fixes were cut away is dropped, never stretched.
    static func remapped(_ segments: [NamedSegment], from original: [GPSPoint], to kept: [GPSPoint]) -> [NamedSegment] {
        var index: [Double: Int] = [:]
        for (i, point) in kept.enumerated() where index[point.timestamp] == nil { index[point.timestamp] = i }
        return segments.compactMap { segment in
            guard let start = index[segment.startTimestamp], let end = index[segment.endTimestamp], start < end else { return nil }
            var moved = segment
            moved.startIndex = start; moved.endIndex = end
            return moved
        }
    }
}

// A segment restored from a cloud backup carries no geometry copy (the route's
// own fixes are restored with it); older or partial records decode with
// defaults rather than failing the whole activity.
extension NamedSegment {
    enum CodingKeys: String, CodingKey {
        case id, name, startIndex, endIndex, startTimestamp, endTimestamp, distanceMeters, durationSeconds
        case gapSeconds, pointCount, colorIndex, geometry, visibility, createdAt, updatedAt
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        startIndex = try c.decode(Int.self, forKey: .startIndex)
        endIndex = try c.decode(Int.self, forKey: .endIndex)
        startTimestamp = try c.decode(Double.self, forKey: .startTimestamp)
        endTimestamp = try c.decode(Double.self, forKey: .endTimestamp)
        distanceMeters = try c.decode(Double.self, forKey: .distanceMeters)
        durationSeconds = try c.decode(Double.self, forKey: .durationSeconds)
        gapSeconds = try c.decodeIfPresent(Double.self, forKey: .gapSeconds) ?? 0
        pointCount = try c.decodeIfPresent(Int.self, forKey: .pointCount) ?? max(0, endIndex - startIndex + 1)
        colorIndex = try c.decodeIfPresent(Int.self, forKey: .colorIndex) ?? 0
        geometry = try c.decodeIfPresent([[[Double]]].self, forKey: .geometry) ?? []
        visibility = try c.decodeIfPresent(String.self, forKey: .visibility) ?? "private"
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? createdAt
    }
}

// Owner-scoped, pre-resampled definitions. The same 5 m reference used by the
// post-ride JS matcher is transferred once; live GPS never needs the network.
struct WatchSegmentDefinition: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var activity: String
    var reference: [[Double]] // latitude, longitude, distance along
    var lengthMeters: Double
    var bestSeconds: Double?
    var bestAt: Double?
    var bestActivityID: String?
    var valid: Bool {
        guard !id.isEmpty,id.count<=100,!name.isEmpty,name.count<=160,
              ["MTB","Cycling","Road cycling","Walking","Running","Hiking"].contains(activity),
              lengthMeters.isFinite,lengthMeters>=50,lengthMeters<=100000,
              reference.count>=2,reference.count<=4096 else {return false}
        var previous = -1.0
        for p in reference {
            guard p.count==3,p.allSatisfy({$0.isFinite}),abs(p[0])<=90,abs(p[1])<=180,p[2]>=0,p[2]>previous else {return false}
            previous=p[2]
        }
        return reference[0][2]==0 && abs(previous-lengthMeters)<0.01
            && (bestSeconds == nil || (bestSeconds!.isFinite && bestSeconds!>0 && bestSeconds!<=86400))
            && (bestAt == nil || bestAt!.isFinite)
    }
}
struct WatchSegmentCatalogue: Codable, Equatable {
    var schema: Int
    var ownerID: String
    var revision: String
    var generatedAt: Double
    var definitions: [WatchSegmentDefinition]
    static let byteLimit=4_000_000
    static func decode(_ data:Data,owner:String?) -> Self? {
        guard data.count<=byteLimit,let owner=WatchOwnership.normalize(owner),
              let value=try? JSONDecoder().decode(Self.self,from:data),value.schema==1,
              WatchOwnership.normalize(value.ownerID)==owner,value.revision.count==64,
              value.revision.allSatisfy({$0.isHexDigit}),value.generatedAt.isFinite,
              value.definitions.count<=128,value.definitions.allSatisfy(\.valid),
              value.definitions.reduce(0,{$0+$1.reference.count})<=32768,
              Set(value.definitions.map(\.id)).count==value.definitions.count else {return nil}
        return value
    }
}
struct WatchSegmentFeedback: Equatable {
    var id: String
    var name: String
    var startedAt: Double
    var elapsedSeconds: Double
    var bestSeconds: Double?
    var finished: Bool
    var interrupted: Bool
    var newRecord: Bool { finished && !interrupted && bestSeconds != nil && elapsedSeconds.rounded()<bestSeconds!.rounded() }
}

// Incremental counterpart of segmentMatcher's ordered walk. One bounded state per
// nearby candidate, no rescanning the recording on every fix and no ghost position.
struct WatchLiveSegments {
    private struct Sample {var along:Double;var offset:Double;var point:WatchPoint}
    private struct Candidate {
        var ref=0;var previous=0.0;var maximum=0.0;var minimum=0.0
        var samples:[Sample]=[];var lastRaw:WatchPoint?;var lastOnRoute:Double?
        var interrupted=false;var announced=false
    }
    private var definitions:[WatchSegmentDefinition]=[]
    private var candidates:[String:Candidate]=[:]
    private var previous:WatchPoint?
    private(set) var feedback:WatchSegmentFeedback?
    private(set) var revision=""
    private(set) var starts=0,finishes=0
    mutating func configure(_ catalogue:WatchSegmentCatalogue?,activity:String) {
        definitions=(catalogue?.definitions ?? []).filter { Self.compatible($0.activity,activity) }
        revision=catalogue?.revision ?? "";candidates=[:];previous=nil;feedback=nil;starts=0;finishes=0
    }
    mutating func interrupt(){for id in Array(candidates.keys) {candidates[id]?.interrupted=true};if feedback?.finished==false {feedback?.interrupted=true};previous=nil}
    private mutating func cancel(_ id:String){candidates.removeValue(forKey:id);if feedback?.id==id&&feedback?.finished==false {feedback=nil}}
    static func compatible(_ a:String,_ b:String)->Bool {
        let cycling=["MTB","Cycling","Road cycling"]
        return a==b || (cycling.contains(a)&&cycling.contains(b))
    }
    private static func point(_ ref:[Double],time:Double=0)->WatchPoint {
        WatchPoint(latitude:ref[0],longitude:ref[1],timestamp:time,accuracy:0,altitude:0,speed:0)
    }
    private static func projection(_ def:WatchSegmentDefinition,_ state:Candidate,_ p:WatchPoint)->(Int,Double,Double) {
        let r=def.reference,reach=max(40,max(0,p.timestamp-(state.lastOnRoute ?? p.timestamp))*30)
        let lo=max(0,state.ref-8),hi=min(r.count-1,state.ref+Int(ceil(reach/5))+1)
        var best=lo,distance=Double.infinity
        for k in lo...hi {let d=p.distance(to:point(r[k]));if d<distance {best=k;distance=d}}
        if best<state.ref {
            var ahead=state.ref,ad=Double.infinity
            for k in state.ref...hi {let d=p.distance(to:point(r[k]));if d<ad {ahead=k;ad=d}}
            if ad<=distance+10 {best=ahead;distance=ad}
        }
        var along=r[best][2]
        if best==0 || best==r.count-1 {
            let a=r[best==0 ? 0 : r.count-2],b=r[best==0 ? 1 : r.count-1]
            let dx=b[0]-a[0],dy=b[1]-a[1],square=dx*dx+dy*dy
            let t=square>0 ? ((p.latitude-a[0])*dx+(p.longitude-a[1])*dy)/square : 0
            along=a[2]+t*(b[2]-a[2])
        }
        return (best,along,distance)
    }
    private static func crossing(_ a:WatchPoint,_ b:WatchPoint,_ spot:WatchPoint)->Bool {
        let dx=b.longitude-a.longitude,dy=b.latitude-a.latitude,square=dx*dx+dy*dy
        guard square>0 else {return false}
        let t=((spot.longitude-a.longitude)*dx+(spot.latitude-a.latitude)*dy)/square
        guard t>=0,t<=1 else {return false}
        let at=WatchPoint(latitude:a.latitude+dy*t,longitude:a.longitude+dx*t,timestamp:0,accuracy:0,altitude:0,speed:0)
        return at.distance(to:spot)<=30
    }
    private static func at(_ values:[Sample],_ along:Double)->Double {
        for (i,b) in values.enumerated() where b.along>=along {
            guard i>0 else {return b.point.timestamp}
            let a=values[i-1],delta=b.along-a.along
            return delta==0 ? b.point.timestamp : a.point.timestamp+(along-a.along)/delta*(b.point.timestamp-a.point.timestamp)
        }
        return values.last?.point.timestamp ?? 0
    }
    private static func coverage(_ samples:[Sample],length:Double)->Double {
        var covered=0
        for checkpoint in 0..<20 {
            let target=length*Double(checkpoint)/19
            let near=samples.contains {abs($0.along-target)<=10}
            let span=zip(samples,samples.dropFirst()).contains {a,b in a.along<=target && target<=b.along && b.along-a.along<=150}
            if near||span {covered+=1}
        }
        return Double(covered)/20
    }
    // Returns only transitions; the view may read feedback between fixes.
    mutating func ingest(_ p:WatchPoint)->[(kind:String,feedback:WatchSegmentFeedback)] {
        guard p.latitude.isFinite,p.longitude.isFinite,p.timestamp.isFinite,p.accuracy.isFinite,
              abs(p.latitude)<=90,abs(p.longitude)<=180,p.accuracy>=0,p.accuracy<65,
              previous==nil || p.timestamp>previous!.timestamp else {return []}
        var events:[(kind:String,feedback:WatchSegmentFeedback)]=[]
        defer {previous=p}
        for def in definitions {
            let first=Self.point(def.reference[0]),last=Self.point(def.reference[def.reference.count-1])
            var state=candidates[def.id]
            if state==nil {
                let passing=previous.map { $0.segment==p.segment && p.timestamp-$0.timestamp<=45 && Self.crossing($0,p,first) } ?? false
                guard p.distance(to:first)<=30 || passing else {continue}
                guard candidates.count<8 else {continue}
                state=Candidate()
                if passing,let before=previous {state!.samples=[Sample(along: -before.distance(to:first),offset:0,point:before)]}
            }
            guard var c=state else {continue}
            if let raw=c.lastRaw {
                let dt=p.timestamp-raw.timestamp
                if raw.segment != p.segment || dt>180 || (dt>45&&raw.distance(to:p)>max(50,raw.accuracy+p.accuracy)) {
                    if !c.announced && c.maximum<=30 {c.samples=[];c.minimum=0;c.maximum=0;c.interrupted=false}
                    else {c.interrupted=true}
                }
                if dt>300 {cancel(def.id);continue}
            }
            c.lastRaw=p
            let (ref,along,offset)=Self.projection(def,c,p)
            let since=max(0,p.timestamp-(c.lastOnRoute ?? p.timestamp)),reach=max(40,since*30)
            if offset>20+min(max(0,p.accuracy),25) {
                if !c.samples.isEmpty&&since<=20 {candidates[def.id]=c;continue}
                cancel(def.id);continue
            }
            if along<c.previous-40 || along>c.previous+reach+5 || c.samples.count>=8192 {
                cancel(def.id);continue
            }
            c.ref=ref;c.previous=along;c.minimum=min(c.minimum,along);c.maximum=max(c.maximum,along);c.lastOnRoute=p.timestamp
            c.samples.append(Sample(along:along,offset:offset,point:p))
            let start=Self.at(c.samples,0)
            if !c.announced && along>=10 && along-(c.samples.first?.along ?? along)>=10 && c.samples.count>=2 {
                c.announced=true;starts+=1
                let startFeedback=WatchSegmentFeedback(id:def.id,name:def.name,startedAt:start,elapsedSeconds:max(0,p.timestamp-start),bestSeconds:def.bestSeconds,finished:false,interrupted:c.interrupted)
                events.append(("start",startFeedback))
            }
            if c.announced {
                feedback=WatchSegmentFeedback(id:def.id,name:def.name,startedAt:start,elapsedSeconds:max(0,p.timestamp-start),bestSeconds:def.bestSeconds,finished:false,interrupted:c.interrupted)
            }
            if along>=def.lengthMeters-5 {
                let observed=c.samples.filter {$0.along>=0&&$0.along<=def.lengthMeters}
                let samples=observed.isEmpty ? c.samples : observed
                let mean=samples.reduce(0,{$0+$1.point.accuracy})/Double(samples.count)
                if c.announced && mean<65 && Self.coverage(samples,length:def.lengthMeters)>=0.6 && p.distance(to:last)<=45 {
                    let seconds=max(0,(Self.at(c.samples,def.lengthMeters)-start).rounded())
                    feedback=WatchSegmentFeedback(id:def.id,name:def.name,startedAt:start,elapsedSeconds:seconds,bestSeconds:def.bestSeconds,finished:true,interrupted:c.interrupted)
                    finishes+=1
                    if let result=feedback {events.append((result.interrupted ? "interrupted" : "finish",result))}
                    if !c.interrupted,seconds>0,let i=definitions.firstIndex(where:{$0.id==def.id}),seconds<(definitions[i].bestSeconds ?? .infinity) {
                        definitions[i].bestSeconds=seconds;definitions[i].bestAt=start
                    }
                }
                candidates.removeValue(forKey:def.id)
            } else {candidates[def.id]=c}
        }
        return events
    }
}
