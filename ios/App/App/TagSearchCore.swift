import Foundation

// Search-as-you-type over the tags already in the journal. These are the rules
// src/lib/tagSearch.js applies in the React tags section; tests/fixtures/tag-search.json
// pins both, so the native field never suggests a tag React would not, and never
// creates a near duplicate of a name the person already uses.
// Tag names are short labels, so counting characters here matches counting UTF-16
// units in JavaScript for everything the journal stores.
enum TagSearch {
    static let suggestionLimit = 6
    static let tagLengthLimit = 50

    // One name however it was typed: capitals and runs of spaces are not a
    // second tag.
    static func normalise(_ value: String?) -> String {
        (value ?? "").split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    static func key(_ value: String?) -> String { normalise(value).lowercased() }

    // The tags a person still uses, filtered as they type. `known` is the history
    // JavaScript already scanned, and a tag already on this activity is never
    // offered again.
    static func suggestions(known: [String], applied: [String], query: String, limit: Int = suggestionLimit) -> [String] {
        let needle = key(query)
        guard !needle.isEmpty else { return [] }
        let appliedKeys = Set(applied.map { key($0) })
        var names: [String: String] = [:]
        var order: [String] = []
        for name in known {
            let clean = normalise(name), cleanKey = clean.lowercased()
            guard !clean.isEmpty, clean.count <= tagLengthLimit, !appliedKeys.contains(cleanKey),
                  cleanKey.contains(needle), names[cleanKey] == nil else { continue }
            names[cleanKey] = clean
            order.append(cleanKey)
        }
        // A prefix of what was typed leads, then the shortest name, so "Cof"
        // offers "Coffee" before "Coffee stop on the way home".
        let sorted = order.sorted { a, b in
            let aPrefix = a.hasPrefix(needle), bPrefix = b.hasPrefix(needle)
            if aPrefix != bPrefix { return aPrefix }
            if a.count != b.count { return a.count < b.count }
            return (names[a] ?? a) < (names[b] ?? b)
        }
        return sorted.prefix(max(0, limit)).compactMap { names[$0] }
    }

    // What a submit would use. An existing spelling always wins, so "bunnings"
    // reuses "Bunnings". `applied` says the tag is already on this activity: the
    // tag is then not added again, but remembering the destination still happens.
    static func choice(known: [String], applied: [String], query: String) -> (name: String, applied: Bool, create: Bool) {
        let text = normalise(query), needle = text.lowercased()
        let onActivity = applied.first { key($0) == needle }
        let existing = onActivity ?? known.first { key($0) == needle }
        return (name: existing.map { normalise($0) } ?? text, applied: onActivity != nil, create: !text.isEmpty && existing == nil)
    }
}
