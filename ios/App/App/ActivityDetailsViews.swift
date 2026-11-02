import SwiftUI
import UIKit

// One visual language for the whole screen. Every section is a `DetailCard`.
enum DetailStyle {
    static let spacing: CGFloat = 16
    static let radius: CGFloat = 14
    static let margin: CGFloat = 16
    static let cardFill = Color(.secondarySystemBackground)
}

struct DetailCard<Content: View>: View {
    var title: String?
    var symbol: String?
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title {
                Label { Text(title).font(.headline) } icon: { if let symbol { Image(systemName: symbol) } }
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(DetailStyle.cardFill, in: RoundedRectangle(cornerRadius: DetailStyle.radius, style: .continuous))
    }
}

struct DetailButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, destructive }
    var kind: Kind = .secondary
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .frame(minHeight: 44)
            .foregroundColor(kind == .primary ? .white : kind == .destructive ? .red : .accentColor)
            .background(kind == .primary ? Color.accentColor : Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .opacity(!enabled ? 0.45 : configuration.isPressed ? 0.7 : 1)
    }
}

struct DetailFootnote: View {
    let text: String
    var body: some View { Text(text).font(.footnote).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true) }
}

struct ActivityNoRouteView: View {
    let text: (title: String, detail: String)
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "mappin.slash").font(.largeTitle).foregroundColor(.secondary)
            Text(text.title).font(.title3.weight(.semibold))
            Text(text.detail).font(.subheadline).foregroundColor(.secondary).multilineTextAlignment(.center)
        }
        .padding(.top, 96).padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
    }
}

// Finds the UIScrollView behind a SwiftUI ScrollView so the panel can hand a drag
// over between itself and the content.
private struct ScrollViewReporter: UIViewRepresentable {
    let found: (UIScrollView) -> Void
    func makeUIView(context: Context) -> ReporterView { ReporterView(found: found) }
    func updateUIView(_ view: ReporterView, context: Context) {}
    final class ReporterView: UIView {
        let found: (UIScrollView) -> Void
        init(found: @escaping (UIScrollView) -> Void) { self.found = found; super.init(frame: .zero); isUserInteractionEnabled = false }
        required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard window != nil else { return }
            var ancestor = superview
            while let view = ancestor {
                if let scroll = view as? UIScrollView { let found = found; DispatchQueue.main.async { found(scroll) }; return }
                ancestor = view.superview
            }
        }
    }
}

// The complete Activity Details screen inside the panel. Collapsed shows the
// heading; medium adds the figures and photos; expanded reads as a full page.
struct ActivityDetailsRootView: View {
    @ObservedObject var model: ActivityDetailsViewModel
    let trackScrollView: (UIScrollView) -> Void
    var body: some View {
        ScrollView {
            // Choosing a range needs the map in view, and the panel only scrolls its
            // content when expanded, so an editor replaces the page at medium.
            if let draft = model.segmentDraft {
                editor { SegmentEditorCard(model: model, draft: draft).id(draft.segmentID) }
            } else if model.trimming, let trim = model.presentation.trim {
                editor { RouteTrimCard(model: model, trim: trim) }
            } else {
                LazyVStack(alignment: .leading, spacing: DetailStyle.spacing) {
                    ActivityHeaderSection(model: model).background(ScrollViewReporter(found: trackScrollView))
                    ActivitySummarySection(items: model.presentation.summary)
                    ActivityNoticesSection(model: model)
                    ActivityMomentsSection(model: model)
                    ActivitySegmentsSection(model: model)
                    ActivityTrailSection(model: model)
                    ActivityRouteSection(model: model)
                    ActivityHeartSection(model: model)
                    ActivityStorySection(story: model.presentation.story)
                    ActivityTagsSection(model: model)
                    ActivityStopsSection(model: model)
                    ActivityFactsSection(presentation: model.presentation)
                    ActivityDiagnosticsSection(model: model)
                    ActivityDangerSection(model: model)
                }
                .padding(.horizontal, DetailStyle.margin).padding(.top, 16).padding(.bottom, 40)
            }
        }
        .sheet(item: $model.sheet) { sheet in
            switch sheet {
            case .editor: ActivityEditorSheet(model: model)
            case .equipment: ActivityEquipmentSheet(model: model)
            case .privacy: ActivityPrivacySheet(model: model)
            case .suggestions: ActivitySuggestionsSheet(model: model)
            }
        }
        .fullScreenCover(item: $model.photoFocus) { focus in
            ActivityPhotoViewer(model: model, initialID: focus.id)
        }
    }
    private func editor<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content().padding(.horizontal, DetailStyle.margin).padding(.top, 16).padding(.bottom, 40)
    }
}
