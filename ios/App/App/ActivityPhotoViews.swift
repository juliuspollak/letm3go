import SwiftUI
import UIKit

// A private photo, loaded away from the main thread at the size shown. A row that
// scrolls off cancels its load through the view's task.
struct PrivateThumbnail: View {
    let photoID: String
    let size: CGFloat
    let service: ActivityDetailsService
    @State private var image: UIImage?
    var body: some View {
        ZStack {
            Color(.tertiarySystemFill)
            if let image { Image(uiImage: image).resizable().scaledToFill() }
            else { Image(systemName: "photo").foregroundColor(.secondary) }
        }
        .task(id: photoID) {
            let loaded = await service.thumbnail(photoID: photoID, size: size)
            if !Task.isCancelled { image = loaded }
        }
    }
}

struct ActivityMomentsSection: View {
    @ObservedObject var model: ActivityDetailsViewModel
    var body: some View {
        let photos = model.presentation.photos, ordered = photos.ordered
        DetailCard(title: ordered.isEmpty ? "Photos and memories" : "\(ordered.count) photo\(ordered.count == 1 ? "" : "s")", symbol: "photo.on.rectangle.angled") {
            if let cover = ordered.first {
                Button { model.showPhoto(cover.id) } label: {
                    GeometryReader { geometry in
                        PrivateThumbnail(photoID: cover.id, size: 640, service: model.service)
                            .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                    }
                    .aspectRatio(16 / 10, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .accessibilityLabel("Open cover photo: \(cover.caption.isEmpty ? "Activity photo" : cover.caption)")
                if ordered.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 8) {
                            ForEach(ordered.dropFirst()) { photo in
                                Button { model.showPhoto(photo.id) } label: {
                                    PrivateThumbnail(photoID: photo.id, size: 88, service: model.service)
                                        .frame(width: 88, height: 88).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                }.accessibilityLabel(photo.caption.isEmpty ? "Open photo" : "Open photo: \(photo.caption)")
                            }
                        }
                    }
                }
            } else {
                DetailFootnote(text: photos.local ? "Add photos from this activity to keep the day together." : "No photos were added to this activity.")
            }
            if photos.local {
                HStack {
                    Button { model.addPhotos() } label: { Label(model.addingPhotos ? "Adding photos…" : "Add photos", systemImage: "photo.badge.plus") }
                        .buttonStyle(DetailButtonStyle(kind: .primary))
                    Button { model.sheet = .suggestions } label: { Label("Find journey photos", systemImage: "camera") }
                        .buttonStyle(DetailButtonStyle())
                }.disabled(model.busy || model.addingPhotos)
                DetailFootnote(text: "Only selected photos are copied locally. No automatic uploads. Dashed map bubbles indicate timestamp-inferred locations.")
            }
        }
    }
}

private struct ZoomingImage: UIViewRepresentable {
    let image: UIImage
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.minimumZoomScale = 1; scroll.maximumZoomScale = 5
        scroll.delegate = context.coordinator
        scroll.showsHorizontalScrollIndicator = false; scroll.showsVerticalScrollIndicator = false
        let view = UIImageView(image: image)
        view.contentMode = .scaleAspectFit
        view.frame = scroll.bounds
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.addSubview(view)
        context.coordinator.view = view
        return scroll
    }
    func updateUIView(_ scroll: UIScrollView, context: Context) { context.coordinator.view?.image = image }
    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var view: UIImageView?
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { view }
    }
}

private struct FullPhoto: View {
    let activityID: String
    let photoID: String
    let service: ActivityDetailsService
    @State private var image: UIImage?
    @State private var missing = false
    var body: some View {
        Group {
            if let image { ZoomingImage(image: image) }
            else if missing { Label("Photo unavailable", systemImage: "photo").foregroundColor(.white) }
            else { ProgressView().tint(.white) }
        }
        .task(id: photoID) {
            let pixels = max(UIScreen.main.bounds.width, UIScreen.main.bounds.height) * UIScreen.main.scale * 1.5
            let loaded = await service.fullImage(activityID: activityID, photoID: photoID, pixels: pixels)
            if Task.isCancelled { return }
            image = loaded; missing = loaded == nil
        }
    }
}

// Photos are viewed, captioned, made the cover and removed here.
struct ActivityPhotoViewer: View {
    @ObservedObject var model: ActivityDetailsViewModel
    @State private var current: String
    @State private var caption = ""
    @State private var editing = false
    @State private var removing = false
    @Environment(\.dismiss) private var dismiss
    init(model: ActivityDetailsViewModel, initialID: String) {
        self.model = model
        _current = State(initialValue: initialID)
    }
    private var photo: ActivityPresentation.Photo? { model.presentation.photos.items.first { $0.id == current } }
    var body: some View {
        let photos = model.presentation.photos
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()
            TabView(selection: $current) {
                ForEach(photos.ordered) { item in
                    FullPhoto(activityID: model.presentation.activityID, photoID: item.id, service: model.service).tag(item.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .automatic))
            .ignoresSafeArea()
            VStack(alignment: .leading, spacing: 8) {
                if let photo {
                    if !photo.caption.isEmpty { Text(photo.caption).font(.subheadline).foregroundColor(.white) }
                    Text("\(photo.locationSource) · Private").font(.caption).foregroundColor(.white.opacity(0.75))
                    if photos.local {
                        HStack {
                            Button("Caption") { caption = photo.caption; editing = true }.buttonStyle(DetailButtonStyle())
                            Button("Use as cover") { Task { await model.perform(.editPhoto(id: photo.id, caption: nil, cover: true, remove: false)) } }
                                .buttonStyle(DetailButtonStyle()).disabled(model.busy || photos.coverID == photo.id)
                            Button("Remove") { removing = true }.buttonStyle(DetailButtonStyle(kind: .destructive)).disabled(model.busy)
                        }
                    }
                    if !model.errorMessage.isEmpty { Text(model.errorMessage).font(.footnote).foregroundColor(.red) }
                }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom))
        }
        .overlay(alignment: .topTrailing) {
            Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.title).foregroundColor(.white) }
                .padding().accessibilityLabel("Close photographs")
        }
        .onChange(of: photos.items.map(\.id)) { ids in
            // The last photo was removed, or this one went away underneath the viewer.
            if ids.isEmpty { dismiss() } else if !ids.contains(current), let next = photos.ordered.first { current = next.id }
        }
        .sheet(isPresented: $editing) {
            TextEntrySheet(title: "Photo caption", label: "Photo caption", text: $caption) {
                let text = caption
                editing = false
                Task { await model.perform(.editPhoto(id: current, caption: text, cover: false, remove: false)) }
            }
        }
        .confirmationDialog("Remove this photo from the activity?", isPresented: $removing, titleVisibility: .visible) {
            Button("Remove photo", role: .destructive) {
                let id = current
                Task { await model.perform(.editPhoto(id: id, caption: nil, cover: false, remove: true)) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { Text("The original in your library stays intact.") }
    }
}
