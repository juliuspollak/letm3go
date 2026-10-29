import UIKit
import MapKit
import Capacitor

private let routeColor = UIColor { trait in trait.userInterfaceStyle == .dark ? UIColor(red:0.65,green:0.71,blue:1,alpha:1) : UIColor(red:0.275,green:0.35,blue:0.85,alpha:1) }
private let gapColor = UIColor { trait in trait.userInterfaceStyle == .dark ? UIColor(red:0.55,green:0.58,blue:0.7,alpha:0.9) : UIColor(red:0.45,green:0.49,blue:0.62,alpha:0.9) }
// A dashed connector marks an unobserved stretch between two observed segments.
// It is never rendered like an observed route, so a solid line never implies GPS
// was recorded where it was not.
private final class GapPolyline: MKPolyline {}
private func coordinate(_ value: Any?) -> CLLocationCoordinate2D? {
    guard let p=value as? [Double],p.count==2,p.allSatisfy({$0.isFinite}),abs(p[0])<=90,abs(p[1])<=180 else { return nil }
    return CLLocationCoordinate2D(latitude:p[0],longitude:p[1])
}

// MARK: Map overview (route density, clustered photos, photo preview card)

// The overview's route density: one multi-polyline per weight bucket and zoom
// band, so thousands of journeys are a handful of overlays.
private final class DensityLines:MKMultiPolyline {
    var weight=1
}
// The selected photo's journey, drawn above the density with a casing.
private final class HighlightLine:MKPolyline {
    var casing=false
}
private let brandAccent=UIColor { trait in trait.userInterfaceStyle == .dark ? UIColor(red:0.65,green:0.71,blue:1,alpha:1) : UIColor(red:0.275,green:0.35,blue:0.85,alpha:1) }
private let onBrandAccent=UIColor { trait in trait.userInterfaceStyle == .dark ? UIColor(red:0.08,green:0.11,blue:0.22,alpha:1) : .white }
// Rarely travelled paths are thin and translucent in the app's accent; the most
// travelled warm up to a bright coral-orange, like a personal heatmap.
private func densityStyle(_ weight:Int)->(color:UIColor,width:CGFloat) {
    switch weight {
    case ...1:return (brandAccent.withAlphaComponent(0.45),2)
    case 2:return (brandAccent.withAlphaComponent(0.7),2.5)
    case 3:return (UIColor(red:0.56,green:0.36,blue:0.92,alpha:0.82),3)
    case 4:return (UIColor(red:0.93,green:0.32,blue:0.52,alpha:0.9),3.5)
    default:return (UIColor(red:1,green:0.55,blue:0.2,alpha:1),4)
    }
}
private func densityRenderer(_ lines:DensityLines,dimmed:Bool)->MKOverlayRenderer {
    let renderer=MKMultiPolylineRenderer(multiPolyline:lines)
    let style=densityStyle(lines.weight)
    renderer.strokeColor=style.color;renderer.lineWidth=style.width
    renderer.lineCap = .round;renderer.lineJoin = .round
    renderer.alpha=dimmed ? 0.3 : 1
    return renderer
}
private func highlightRenderer(_ line:HighlightLine)->MKOverlayRenderer {
    let renderer=MKPolylineRenderer(polyline:line)
    renderer.strokeColor=line.casing ? UIColor.systemBackground.withAlphaComponent(0.95) : brandAccent
    renderer.lineWidth=line.casing ? 9 : 5.5
    renderer.lineCap = .round;renderer.lineJoin = .round
    return renderer
}

// Sent once per key by the web layer (setOverview) and named by every embed after
// that. Parsed off the main thread; immutable afterwards.
private final class OverviewData {
    let key:String
    let cells:[Double]
    let levels:[[DensityLines]]
    let focus:[CLLocationCoordinate2D]
    let photos:[[String:Any]]
    let routes:[String:[[CLLocationCoordinate2D]]]
    init?(_ options:[AnyHashable:Any]) {
        guard let key=options["key"] as? String,!key.isEmpty,key.count<=80 else {return nil}
        self.key=key
        var cells:[Double]=[],levels:[[DensityLines]]=[]
        for level in (options["levels"] as? [[String:Any]] ?? []).prefix(6) {
            guard let cell=(level["cell"] as? NSNumber)?.doubleValue,cell.isFinite,cell>0 else {continue}
            var overlays:[DensityLines]=[]
            for bucket in (level["buckets"] as? [[String:Any]] ?? []).prefix(5) {
                let lines=(bucket["lines"] as? [[[Double]]] ?? []).prefix(40000).compactMap { line -> MKPolyline? in
                    let points=line.prefix(5000).compactMap{coordinate($0)}
                    return points.count>1 ? MKPolyline(coordinates:points,count:points.count) : nil
                }
                guard !lines.isEmpty else {continue}
                let overlay=DensityLines(lines)
                overlay.weight=max(1,min(5,(bucket["weight"] as? NSNumber)?.intValue ?? 1))
                overlays.append(overlay)
            }
            cells.append(cell);levels.append(overlays.sorted{$0.weight<$1.weight})
        }
        self.cells=cells;self.levels=levels
        if let f=options["focus"] as? [Double],f.count==4,let south=coordinate([f[0],f[1]]),let north=coordinate([f[2],f[3]]) {focus=[south,north]} else {focus=[]}
        photos=Array((options["photos"] as? [[String:Any]] ?? []).prefix(3000)).filter{coordinate($0["point"]) != nil && $0["photoID"] is String && $0["journeyID"] is String}
        var routes:[String:[[CLLocationCoordinate2D]]]=[:]
        for (id,value) in (options["routes"] as? [String:Any] ?? [:]).prefix(3000) {
            let segments=(value as? [[[Double]]] ?? []).prefix(50).map{Array($0.prefix(2000)).compactMap{coordinate($0)}}.filter{$0.count>1}
            if !segments.isEmpty {routes[id]=segments}
        }
        self.routes=routes
    }
}
private var overviewStore:[String:OverviewData]=[:]
private var overviewOrder:[String]=[]
private func storeOverview(_ data:OverviewData) {
    overviewStore[data.key]=data
    overviewOrder.removeAll{$0==data.key};overviewOrder.append(data.key)
    while overviewOrder.count>6 {overviewStore.removeValue(forKey:overviewOrder.removeFirst())}
}

// Journal photos are read only while the app is unlocked and only for the
// signed-in owner (the same checks as before); the cache is keyed by owner so
// another account never sees them.
private let photoImageCache=NSCache<NSString,UIImage>()
private func journalPhotoImage(_ photoID:String,size:CGFloat,circle:Bool)->UIImage? {
    let recorder=LocationRecorder.shared
    guard recorder.uiUnlocked,let owner=recorder.ownerID else {return nil}
    let key=NSString(string:"\(owner)|\(photoID)|\(size)|\(circle)")
    if let cached=photoImageCache.object(forKey:key) {return cached}
    guard let storage=recorder.storage,
          let trip=recorder.trips.first(where:{$0.details?.photos.contains(where:{$0.id==photoID}) == true}),
          let photo=trip.details?.photos.first(where:{$0.id==photoID}),
          let data=try? storage.readData(name:"media/\(photo.filename)"),
          let source=UIImage(data:data) else {return nil}
    let image=UIGraphicsImageRenderer(size:CGSize(width:size,height:size)).image { _ in
        let bounds=CGRect(x:0,y:0,width:size,height:size)
        (circle ? UIBezierPath(ovalIn:bounds) : UIBezierPath(roundedRect:bounds,cornerRadius:size*0.18)).addClip()
        let ratio=max(size/source.size.width,size/source.size.height)
        let width=source.size.width*ratio,height=source.size.height*ratio
        source.draw(in:CGRect(x:(size-width)/2,y:(size-height)/2,width:width,height:height))
    }
    photoImageCache.setObject(image,forKey:key)
    return image
}
// A photo on the overview: a small circular thumbnail with a white ring and a
// soft shadow; a photo glyph when the image is not on this device.
private func overviewPhotoMarker(_ photoID:String?,size:CGFloat=40,count:Int=0)->UIImage {
    let pad:CGFloat=4
    return UIGraphicsImageRenderer(size:CGSize(width:size+pad*2,height:size+pad*2)).image { context in
        let ctx=context.cgContext
        let bounds=CGRect(x:pad,y:pad,width:size,height:size)
        ctx.saveGState()
        ctx.setShadow(offset:CGSize(width:0,height:1),blur:3,color:UIColor.black.withAlphaComponent(0.3).cgColor)
        UIColor.white.setFill();ctx.fillEllipse(in:bounds)
        ctx.restoreGState()
        let inner=bounds.insetBy(dx:2.5,dy:2.5)
        if let photoID=photoID,let thumbnail=journalPhotoImage(photoID,size:inner.width,circle:true) {
            thumbnail.draw(in:inner)
        } else {
            brandAccent.setFill();ctx.fillEllipse(in:inner)
            if let glyph=UIImage(systemName:"photo.fill")?.withTintColor(.white,renderingMode:.alwaysOriginal) {glyph.draw(in:inner.insetBy(dx:inner.width*0.27,dy:inner.height*0.3))}
        }
        if count>1 {
            let label=(count>99 ? "99+" : String(count)) as NSString
            let attributes:[NSAttributedString.Key:Any]=[.font:UIFont.systemFont(ofSize:11,weight:.bold),.foregroundColor:UIColor.white]
            let s=label.size(withAttributes:attributes)
            let badge=CGRect(x:bounds.maxX-s.width-6,y:bounds.minY-pad+1,width:s.width+10,height:17)
            UIColor.white.setFill();UIBezierPath(roundedRect:badge.insetBy(dx:-1.5,dy:-1.5),cornerRadius:10).fill()
            UIColor(red:1,green:0.45,blue:0.2,alpha:1).setFill();UIBezierPath(roundedRect:badge,cornerRadius:8.5).fill()
            label.draw(at:CGPoint(x:badge.midX-s.width/2,y:badge.midY-s.height/2),withAttributes:attributes)
        }
    }
}
private final class PhotoAnnotationView:MKAnnotationView {
    static let reuse="overview-photo"
    override init(annotation:MKAnnotation?,reuseIdentifier:String?) {
        super.init(annotation:annotation,reuseIdentifier:reuseIdentifier)
        clusteringIdentifier="overview-photos"
        canShowCallout=false
        collisionMode = .circle
        displayPriority = .defaultHigh
        isAccessibilityElement=true
        accessibilityTraits = .button
    }
    required init?(coder:NSCoder){fatalError("init(coder:) unavailable")}
    // Nearby photos merge into one cluster as the map zooms out.
    override func prepareForDisplay() {
        super.prepareForDisplay()
        clusteringIdentifier="overview-photos"
        guard let pin=annotation as? JourneyPin else {return}
        image=overviewPhotoMarker(pin.metadata["photoID"] as? String)
        let journey=(pin.metadata["journeyTitle"] as? String).flatMap{$0.isEmpty ? nil : $0}
        accessibilityLabel=["Photo",journey,pin.metadata["journeyDate"] as? String].compactMap{$0}.joined(separator:", ")
        accessibilityHint="Shows its journey"
    }
    override func setSelected(_ selected:Bool,animated:Bool) {
        super.setSelected(selected,animated:animated)
        zPriority=selected ? .max : .defaultUnselected
        let change={self.transform=selected ? CGAffineTransform(scaleX:1.3,y:1.3) : .identity}
        if animated && !UIAccessibility.isReduceMotionEnabled {UIView.animate(withDuration:0.22,delay:0,usingSpringWithDamping:0.7,initialSpringVelocity:0,options:[.allowUserInteraction],animations:change)} else {change()}
    }
}
private final class PhotoClusterView:MKAnnotationView {
    static let reuse="overview-photo-cluster"
    override init(annotation:MKAnnotation?,reuseIdentifier:String?) {
        super.init(annotation:annotation,reuseIdentifier:reuseIdentifier)
        canShowCallout=false
        collisionMode = .circle
        displayPriority = .defaultHigh
        isAccessibilityElement=true
        accessibilityTraits = .button
    }
    required init?(coder:NSCoder){fatalError("init(coder:) unavailable")}
    override func prepareForDisplay() {
        super.prepareForDisplay()
        guard let cluster=annotation as? MKClusterAnnotation else {return}
        let members=cluster.memberAnnotations.compactMap{$0 as? JourneyPin}
        image=overviewPhotoMarker(members.first?.metadata["photoID"] as? String,size:46,count:members.count)
        accessibilityLabel="\(members.count) photos"
        accessibilityHint="Zooms in to the photos"
    }
}
// Overview photos and their clusters, for both the embedded and full-screen map.
private func overviewAnnotationView(_ mapView:MKMapView,_ annotation:MKAnnotation)->MKAnnotationView? {
    if let cluster=annotation as? MKClusterAnnotation {
        let view=mapView.dequeueReusableAnnotationView(withIdentifier:PhotoClusterView.reuse) ?? PhotoClusterView(annotation:cluster,reuseIdentifier:PhotoClusterView.reuse)
        view.annotation=cluster
        return view
    }
    guard let pin=annotation as? JourneyPin,pin.isOverviewPhoto else {return nil}
    let view=mapView.dequeueReusableAnnotationView(withIdentifier:PhotoAnnotationView.reuse) ?? PhotoAnnotationView(annotation:pin,reuseIdentifier:PhotoAnnotationView.reuse)
    view.annotation=pin
    return view
}

// The preview for a selected photo: thumbnail, journey, date and distance (only
// what is known), View journey and View photo. Drawn inside the map view, so it
// can never be hidden behind MapKit, and above the map's bottom edge, so it never
// sits under the tab bar.
private final class PhotoCard:UIView {
    let thumbnail=UIImageView()
    let titleLabel=UILabel()
    let detailLabel=UILabel()
    let journeyButton:UIButton
    let photoButton:UIButton
    let closeButton=UIButton(type:.system)
    override init(frame:CGRect) {
        let scaled=UIConfigurationTextAttributesTransformer { attributes in
            var updated=attributes
            updated.font=UIFontMetrics(forTextStyle:.subheadline).scaledFont(for:.systemFont(ofSize:15,weight:.semibold))
            return updated
        }
        var primary=UIButton.Configuration.filled()
        primary.title="View journey";primary.baseBackgroundColor=brandAccent;primary.baseForegroundColor=onBrandAccent;primary.cornerStyle = .large
        primary.titleTextAttributesTransformer=scaled
        var secondary=UIButton.Configuration.gray()
        secondary.title="View photo";secondary.baseForegroundColor = .label;secondary.cornerStyle = .large
        secondary.titleTextAttributesTransformer=scaled
        journeyButton=UIButton(configuration:primary);photoButton=UIButton(configuration:secondary)
        super.init(frame:frame)
        layer.cornerRadius=20;layer.cornerCurve = .continuous;clipsToBounds=true
        let blur=UIVisualEffectView(effect:UIBlurEffect(style:.systemThickMaterial))
        blur.translatesAutoresizingMaskIntoConstraints=false
        addSubview(blur)
        thumbnail.clipsToBounds=true;thumbnail.layer.cornerRadius=12;thumbnail.layer.cornerCurve = .continuous
        thumbnail.backgroundColor = .tertiarySystemFill;thumbnail.tintColor = .secondaryLabel
        titleLabel.font=UIFont.preferredFont(forTextStyle:.headline);titleLabel.adjustsFontForContentSizeCategory=true;titleLabel.numberOfLines=2
        detailLabel.font=UIFont.preferredFont(forTextStyle:.subheadline);detailLabel.adjustsFontForContentSizeCategory=true;detailLabel.textColor = .secondaryLabel;detailLabel.numberOfLines=2
        closeButton.setImage(UIImage(systemName:"xmark.circle.fill",withConfiguration:UIImage.SymbolConfiguration(pointSize:22)),for:.normal)
        closeButton.tintColor = .tertiaryLabel
        closeButton.accessibilityLabel="Close photo preview"
        let text=UIStackView(arrangedSubviews:[titleLabel,detailLabel]);text.axis = .vertical;text.spacing=2
        let top=UIStackView(arrangedSubviews:[thumbnail,text,closeButton]);top.spacing=12;top.alignment = .center
        let actions=UIStackView(arrangedSubviews:[journeyButton,photoButton]);actions.spacing=10;actions.distribution = .fillEqually
        let stack=UIStackView(arrangedSubviews:[top,actions]);stack.axis = .vertical;stack.spacing=12
        stack.translatesAutoresizingMaskIntoConstraints=false
        blur.contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            blur.leadingAnchor.constraint(equalTo:leadingAnchor),blur.trailingAnchor.constraint(equalTo:trailingAnchor),blur.topAnchor.constraint(equalTo:topAnchor),blur.bottomAnchor.constraint(equalTo:bottomAnchor),
            stack.leadingAnchor.constraint(equalTo:blur.contentView.leadingAnchor,constant:14),stack.trailingAnchor.constraint(equalTo:blur.contentView.trailingAnchor,constant:-8),
            stack.topAnchor.constraint(equalTo:blur.contentView.topAnchor,constant:12),stack.bottomAnchor.constraint(equalTo:blur.contentView.bottomAnchor,constant:-14),
            thumbnail.widthAnchor.constraint(equalToConstant:56),thumbnail.heightAnchor.constraint(equalToConstant:56),
            closeButton.widthAnchor.constraint(equalToConstant:44),closeButton.heightAnchor.constraint(equalToConstant:44),
            journeyButton.heightAnchor.constraint(greaterThanOrEqualToConstant:44)
        ])
        accessibilityElements=[titleLabel,detailLabel,journeyButton,photoButton,closeButton]
    }
    required init?(coder:NSCoder){fatalError("init(coder:) unavailable")}
    func show(_ metadata:[String:Any]) {
        if let photoID=metadata["photoID"] as? String,let image=journalPhotoImage(photoID,size:112,circle:false) {thumbnail.image=image;thumbnail.contentMode = .scaleAspectFill}
        else {thumbnail.image=UIImage(systemName:"photo");thumbnail.contentMode = .center}
        let text={(value:Any?)->String? in (value as? String).flatMap{$0.isEmpty ? nil : $0}}
        titleLabel.text=text(metadata["journeyTitle"]) ?? text(metadata["title"]) ?? "Journey photo"
        let detail=[text(metadata["journeyDate"]),text(metadata["journeyDistance"])].compactMap{$0}
        detailLabel.text=detail.joined(separator:" · ")
        detailLabel.isHidden=detail.isEmpty
    }
}

private func friendInitialBubble(_ name:String,size:CGFloat=54)->UIImage {
    let display=String(name.prefix(1)).uppercased()
    let renderer=UIGraphicsImageRenderer(size:CGSize(width:size,height:size))
    return renderer.image { ctx in
        let bounds=CGRect(x:0,y:0,width:size,height:size)
        UIColor.systemIndigo.setFill()
        ctx.cgContext.fillEllipse(in:bounds.insetBy(dx:2,dy:2))
        UIColor.white.setStroke()
        let ring=UIBezierPath(ovalIn:bounds.insetBy(dx:2,dy:2))
        ring.lineWidth=3;ring.stroke()
        let font=UIFont.systemFont(ofSize:size*0.4,weight:.bold)
        let attrs:[NSAttributedString.Key:Any]=[.font:font,.foregroundColor:UIColor.white]
        let rect=(display as NSString).boundingRect(with:bounds.size,options:[],attributes:attrs,context:nil)
        (display as NSString).draw(at:CGPoint(x:(size-rect.width)/2,y:(size-rect.height)/2),withAttributes:attrs)
    }
}
private func journalPhotoThumbnail(_ photoID:String, size:CGFloat=48)->UIImage? {
    let recorder=LocationRecorder.shared
    guard recorder.uiUnlocked,recorder.ownerID != nil,
          let storage=recorder.storage,
          let trip=recorder.trips.first(where:{$0.details?.photos.contains(where:{$0.id==photoID}) == true}),
          let photo=trip.details?.photos.first(where:{$0.id==photoID}),
          let data=try? storage.readData(name:"media/\(photo.filename)"),
          let source=UIImage(data:data) else {return nil}
    let renderer=UIGraphicsImageRenderer(size:CGSize(width:size,height:size))
    return renderer.image { _ in
        let bounds=CGRect(x:0,y:0,width:size,height:size)
        UIBezierPath(ovalIn:bounds).addClip()
        let ratio=max(size/source.size.width,size/source.size.height)
        let width=source.size.width*ratio,height=source.size.height*ratio
        source.draw(in:CGRect(x:(size-width)/2,y:(size-height)/2,width:width,height:height))
        UIColor.white.setStroke()
        let ring=UIBezierPath(ovalIn:bounds.insetBy(dx:2,dy:2));ring.lineWidth=3;ring.stroke()
    }
}
// People on the map. Everyone at one place (grouped by the web layer) is a single
// marker: an overlapping stack of avatars so nobody hides behind anyone else, a
// blue ring for the signed-in user, a status dot (green: live, clock: stale) and a
// compact label above the stack ("Home · 2h 15m", "Gym · 42m", "12 min ago").
private let avatarCache=NSCache<NSString,UIImage>()
private func avatarImage(_ source:String?)->UIImage? {
    guard let source=source,source.hasPrefix("data:image/"),let comma=source.firstIndex(of:",") else {return nil}
    let key=NSString(string:"\(source.count):\(source.suffix(80))")
    if let cached=avatarCache.object(forKey:key) {return cached}
    guard let data=Data(base64Encoded:String(source[source.index(after:comma)...])),let image=UIImage(data:data) else {return nil}
    avatarCache.setObject(image,forKey:key)
    return image
}
private let markerInk=UIColor(red:0.13,green:0.15,blue:0.22,alpha:1)
// One avatar: the profile photo, else the initial of a real name, else a neutral
// silhouette (never a made-up initial). Blue ring for the signed-in user.
private func drawAvatar(_ member:[String:Any],in rect:CGRect,context ctx:CGContext,ring:CGFloat) {
    let isSelf=member["self"] as? Bool == true
    ctx.saveGState()
    ctx.setShadow(offset:CGSize(width:0,height:1),blur:2.5,color:UIColor.black.withAlphaComponent(0.28).cgColor)
    (isSelf ? UIColor.systemBlue : UIColor.white).setFill()
    ctx.fillEllipse(in:rect)
    ctx.restoreGState()
    let inner=rect.insetBy(dx:ring,dy:ring)
    ctx.saveGState()
    UIBezierPath(ovalIn:inner).addClip()
    if let photo=avatarImage(member["avatar"] as? String) {
        let ratio=max(inner.width/photo.size.width,inner.height/photo.size.height)
        let w=photo.size.width*ratio,h=photo.size.height*ratio
        photo.draw(in:CGRect(x:inner.midX-w/2,y:inner.midY-h/2,width:w,height:h))
    } else {
        (isSelf ? UIColor.systemBlue : UIColor.systemIndigo).setFill();ctx.fill(inner)
        if ((member["initial"] as? String) ?? "").isEmpty,
           let person=UIImage(systemName:"person.fill")?.withTintColor(.white,renderingMode:.alwaysOriginal) {
            person.draw(in:inner.insetBy(dx:inner.width*0.22,dy:inner.height*0.22))
        } else {
            let initial=((member["initial"] as? String) ?? "?") as NSString
            let attributes:[NSAttributedString.Key:Any]=[.font:UIFont.systemFont(ofSize:inner.height*0.45,weight:.bold),.foregroundColor:UIColor.white]
            let s=initial.size(withAttributes:attributes)
            initial.draw(at:CGPoint(x:inner.midX-s.width/2,y:inner.midY-s.height/2),withAttributes:attributes)
        }
    }
    ctx.restoreGState()
}
private func statusDot(_ state:String,at dot:CGRect,context ctx:CGContext) {
    // A dot never claims a live position that has not been received.
    guard state=="live" || state=="stale" else {return}
    UIColor.white.setFill();ctx.fillEllipse(in:dot)
    (state=="live" ? UIColor.systemGreen : UIColor.systemGray).setFill();ctx.fillEllipse(in:dot.insetBy(dx:2.2,dy:2.2))
    if state=="stale",let clock=UIImage(systemName:"clock.fill")?.withTintColor(.white,renderingMode:.alwaysOriginal) {
        clock.draw(in:dot.insetBy(dx:dot.width*0.26,dy:dot.height*0.26))
    }
}
// Native image sets contain high-resolution artwork; downsample the annotation
// to map-marker points so a 256 px source does not become a 256 pt marker.
private func homeMarkerArtwork(size:CGFloat=42)->UIImage? {
    guard let source=UIImage(named:"Letm3goHome") else{return nil}
    return UIGraphicsImageRenderer(size:CGSize(width:size,height:size)).image { _ in
        source.draw(in:CGRect(x:0,y:0,width:size,height:size))
    }
}
private func labelSymbol(_ kind:String)->String? {
    switch kind {case "home":return "house.fill";case "place":return "mappin";case "stale":return "clock";default:return nil}
}
private func peopleMarker(_ metadata:[String:Any])->(image:UIImage,offset:CGPoint) {
    let members=metadata["members"] as? [[String:Any]] ?? []
    let shown=Array(members.prefix(members.count>3 ? 2 : 3))
    let extra=members.count-shown.count
    let size:CGFloat=44,step:CGFloat=29,pillHeight:CGFloat=22
    let home=metadata["home"] as? Bool == true
    // The web layer decides the words; older payloads only say "home".
    let text=((metadata["label"] as? String).map{String($0.prefix(40))}).flatMap{$0.isEmpty ? nil : $0} ?? (home ? "Home" : nil)
    let kind=(metadata["labelKind"] as? String) ?? (home ? "home" : "")
    let slots=max(1,shown.count+(extra>0 ? 1 : 0))
    let stackWidth=size+CGFloat(slots-1)*step
    let pillFont=UIFont.systemFont(ofSize:12,weight:.semibold)
    let ink:UIColor=kind=="stale" ? .darkGray : markerInk
    let attributes:[NSAttributedString.Key:Any]=[.font:pillFont,.foregroundColor:ink]
    let symbol:UIImage? = kind=="home"
        ? (UIImage(named:"Letm3goHome") ?? UIImage(systemName:"house.fill"))
        : labelSymbol(kind).flatMap{UIImage(systemName:$0,withConfiguration:UIImage.SymbolConfiguration(pointSize:10,weight:.bold))?.withTintColor(ink,renderingMode:.alwaysOriginal)}
    let textWidth=text.map{($0 as NSString).size(withAttributes:attributes).width} ?? 0
    let pillWidth=text==nil ? 0 : textWidth+(symbol==nil ? 0 : 15)+18
    let width=max(stackWidth,pillWidth)+6
    let top:CGFloat=text==nil ? 0 : pillHeight+5
    let height=top+size+6
    let image=UIGraphicsImageRenderer(size:CGSize(width:width,height:height)).image { context in
        let ctx=context.cgContext
        if let text=text {
            let pill=CGRect(x:(width-pillWidth)/2,y:1,width:pillWidth,height:pillHeight)
            ctx.saveGState()
            ctx.setShadow(offset:CGSize(width:0,height:1),blur:2.5,color:UIColor.black.withAlphaComponent(0.22).cgColor)
            UIColor(white:1,alpha:0.97).setFill()
            UIBezierPath(roundedRect:pill,cornerRadius:pillHeight/2).fill()
            ctx.restoreGState()
            var x=pill.minX+9
            if let symbol=symbol {
                symbol.draw(in:CGRect(x:x-1,y:pill.midY-8,width:16,height:16))
                x+=15
            }
            let s=(text as NSString).size(withAttributes:attributes)
            (text as NSString).draw(at:CGPoint(x:x,y:pill.midY-s.height/2),withAttributes:attributes)
        }
        let originX=(width-stackWidth)/2
        for (index,member) in shown.enumerated() {
            let rect=CGRect(x:originX+CGFloat(index)*step,y:top+3,width:size,height:size)
            drawAvatar(member,in:rect,context:ctx,ring:2.5)
            statusDot(member["state"] as? String ?? "",at:CGRect(x:rect.maxX-14,y:rect.maxY-14,width:14,height:14),context:ctx)
        }
        if extra>0 {
            let rect=CGRect(x:originX+CGFloat(shown.count)*step,y:top+3,width:size,height:size)
            UIColor.white.setFill();ctx.fillEllipse(in:rect)
            UIColor.systemGray2.setFill();ctx.fillEllipse(in:rect.insetBy(dx:2.5,dy:2.5))
            let label="+\(extra)" as NSString
            let labelAttributes:[NSAttributedString.Key:Any]=[.font:UIFont.systemFont(ofSize:15,weight:.bold),.foregroundColor:UIColor.white]
            let s=label.size(withAttributes:labelAttributes)
            label.draw(at:CGPoint(x:rect.midX-s.width/2,y:rect.midY-s.height/2),withAttributes:labelAttributes)
        }
    }
    // The avatar centres sit on the coordinate; the label floats above them.
    return (image,CGPoint(x:0,y:-top/2))
}
private func configurePeopleView(_ view:MKAnnotationView,_ pin:JourneyPin) {
    let marker=peopleMarker(pin.metadata)
    view.image=marker.image;view.centerOffset=marker.offset
    view.clipsToBounds=false
    let members=pin.metadata["members"] as? [[String:Any]] ?? []
    // The car runs directly along the 44-point portrait border; the avatar sits
    // 3 pt below the label pill (see peopleMarker).
    let top:CGFloat=(pin.metadata["label"] as? String)?.isEmpty == false ? 27 : ((pin.metadata["home"] as? Bool == true) ? 27 : 0)
    let centre=CGPoint(x:marker.image.size.width/2,y:top+25)
    let orbitKey="\(members.first?["id"] as? String ?? ""):\(centre.x),\(centre.y)"
    // Grouped bubbles represent multiple people; do not imply that everyone is driving.
    let driving=members.count==1 && members[0]["state"] as? String == "live" && members[0]["activity"] as? String == "driving"
    // Every location update redraws the marker; a car still circling the same
    // person in the same place keeps going instead of jumping back to its start.
    // A reused annotation never retains the previous person's car.
    var kept=false
    for child in view.subviews where child.accessibilityIdentifier=="letm3go-driving-car" {
        if driving && !kept && child.accessibilityValue==orbitKey {kept=true;continue}
        child.layer.removeAllAnimations();child.removeFromSuperview()
    }
    if driving,!kept,let artwork=UIImage(named:"Letm3goCar") {
        let car=UIView(frame:CGRect(x:0,y:0,width:24,height:15))
        car.accessibilityIdentifier="letm3go-driving-car"
        car.accessibilityValue=orbitKey
        car.isUserInteractionEnabled=false
        let picture=UIImageView(image:artwork)
        picture.frame=car.bounds;picture.contentMode = .scaleAspectFit
        car.addSubview(picture)
        view.addSubview(car)
        let radius:CGFloat=22
        let orbit=CAKeyframeAnimation(keyPath:"position")
        orbit.path=UIBezierPath(ovalIn:CGRect(x:centre.x-radius,y:centre.y-radius,width:radius*2,height:radius*2)).cgPath
        orbit.rotationMode = .rotateAuto
        orbit.duration=6
        orbit.repeatCount = .infinity
        orbit.calculationMode = .paced
        orbit.isRemovedOnCompletion=false
        car.layer.position=CGPoint(x:centre.x+radius,y:centre.y)
        car.layer.add(orbit,forKey:"letm3go-orbit")
        let suspension=CAKeyframeAnimation(keyPath:"transform.translation.y")
        suspension.values=[0,-1.2,0,0.6,0]
        suspension.keyTimes=[0,0.25,0.5,0.75,1] as [NSNumber]
        suspension.duration=0.42
        suspension.repeatCount = .infinity
        suspension.isRemovedOnCompletion=false
        picture.layer.add(suspension,forKey:"letm3go-suspension")
        if UIAccessibility.isReduceMotionEnabled {
            car.layer.removeAllAnimations()
            picture.layer.removeAllAnimations()
        }
    }
    view.canShowCallout=true
    view.displayPriority = .required
    view.zPriority = .max
    view.isAccessibilityElement=true
    view.accessibilityLabel=[pin.title,pin.subtitle].compactMap{$0}.joined(separator:". ")
}
private func peopleAnnotationView(_ mapView:MKMapView,_ pin:JourneyPin)->MKAnnotationView {
    let view=mapView.dequeueReusableAnnotationView(withIdentifier:"people") ?? MKAnnotationView(annotation:pin,reuseIdentifier:"people")
    view.annotation=pin
    configurePeopleView(view,pin)
    return view
}
// The small avatar pinned to the edge of the map for someone who is off screen.
private func edgeAvatarImage(_ members:[[String:Any]])->UIImage {
    let size:CGFloat=34
    return UIGraphicsImageRenderer(size:CGSize(width:size+6,height:size+6)).image { context in
        let ctx=context.cgContext
        let rect=CGRect(x:3,y:3,width:size,height:size)
        if let first=members.first {
            drawAvatar(first,in:rect,context:ctx,ring:2.2)
            statusDot(first["state"] as? String ?? "",at:CGRect(x:rect.maxX-12,y:rect.maxY-12,width:12,height:12),context:ctx)
        }
        if members.count>1 {
            let label="+\(members.count-1)" as NSString
            let attributes:[NSAttributedString.Key:Any]=[.font:UIFont.systemFont(ofSize:10,weight:.bold),.foregroundColor:UIColor.white]
            let s=label.size(withAttributes:attributes)
            let badge=CGRect(x:rect.maxX-s.width-8,y:rect.minY-2,width:s.width+8,height:15)
            UIColor.white.setFill();UIBezierPath(roundedRect:badge.insetBy(dx:-1.5,dy:-1.5),cornerRadius:9).fill()
            UIColor.systemIndigo.setFill();UIBezierPath(roundedRect:badge,cornerRadius:7.5).fill()
            label.draw(at:CGPoint(x:badge.midX-s.width/2,y:badge.midY-s.height/2),withAttributes:attributes)
        }
    }
}

// Stable identity for a pin, so an update moves or redraws the existing marker
// instead of replacing every annotation. People pins carry their own id (the
// user ids at that place); other pins are identified by what they show.
private func pinID(_ pin:[String:Any])->String {
    if let id=pin["id"] as? String,!id.isEmpty {return id}
    let point=(pin["point"] as? [Double] ?? []).map{String($0)}.joined(separator:",")
    return [pin["kind"] as? String ?? "",point,pin["title"] as? String ?? "",pin["photoID"] as? String ?? "",pin["journeyID"] as? String ?? ""].joined(separator:"|")
}
private func mapXY(_ c:CLLocationCoordinate2D)->MapXY {let p=MKMapPoint(c);return MapXY(x:p.x,y:p.y)}
// What the web layer asks of the camera on the people map. `command` changes only
// for an explicit request (open the map showing everyone, Show everyone, a chosen
// person); otherwise the map keeps the mode it is in, including free exploring.
private struct CameraIntent {
    let key:String
    let mode:FollowMode
    let command:Int
    let includeRoutes:Bool
    init?(_ value:Any?) {
        guard let options=value as? [String:Any],let key=options["key"] as? String,!key.isEmpty else {return nil}
        self.key=String(key.prefix(120))
        mode=FollowMode(name:options["mode"] as? String,person:options["personId"] as? String)
        command=(options["command"] as? NSNumber)?.intValue ?? 0
        includeRoutes=options["includeRoutes"] as? Bool == true
    }
}
private struct MapContent {
    let routes: [[CLLocationCoordinate2D]]
    let gaps: [[CLLocationCoordinate2D]]
    let pins: [[String:Any]]
    let focus:CLLocationCoordinate2D?
    let camera:CameraIntent?
    // The Map overview's density and photos (sent earlier under this key).
    let overview:OverviewData?
    // The number of active layers when the map shows the Map layers button.
    let layersActive:Int?
    init(_ options:[AnyHashable:Any]) {
        focus=coordinate(options["focus"])
        routes=(options["routes"] as? [[[Double]]] ?? []).prefix(250).map { Array($0.prefix(5000)).compactMap { coordinate($0) } }.filter { $0.count > 1 }
        gaps=(options["gaps"] as? [[[Double]]] ?? []).prefix(250).map { Array($0.prefix(2)).compactMap { coordinate($0) } }.filter { $0.count == 2 }
        pins=Array((options["pins"] as? [[String:Any]] ?? []).prefix(500)).filter { coordinate($0["point"]) != nil }
        camera=CameraIntent(options["camera"])
        overview=(options["overview"] as? String).flatMap{overviewStore[$0]}
        layersActive=((options["layers"] as? [String:Any])?["active"] as? NSNumber).map{max(0,min(9,$0.intValue))}
    }
    // The overview is framed by where the density mostly is, not by every photo.
    var coordinates:[CLLocationCoordinate2D] { routes.flatMap{$0}+pins.compactMap { coordinate($0["point"]) }+(overview?.focus ?? []) }
    var peoplePins:[[String:Any]] { pins.filter { ($0["kind"] as? String)=="people" } }
    // Everyone on the map, marked with whether the camera should keep them in view
    // (the web layer leaves out a stale position far from everyone else).
    var cameraTargets:[CameraTarget] {
        var targets=peoplePins.compactMap { pin -> CameraTarget? in
            guard let c=coordinate(pin["point"]) else {return nil}
            let members=(pin["members"] as? [[String:Any]] ?? []).compactMap { $0["id"] as? String }
            return CameraTarget(id:pinID(pin),members:members,point:mapXY(c),latitude:c.latitude,fit:pin["fit"] as? Bool ?? true)
        }
        if camera?.includeRoutes == true {
            let all=routes.flatMap{$0}+(overview?.focus ?? [])
            if let south=all.map(\.latitude).min(),let north=all.map(\.latitude).max(),let west=all.map(\.longitude).min(),let east=all.map(\.longitude).max() {
                for (index,c) in [CLLocationCoordinate2D(latitude:south,longitude:west),CLLocationCoordinate2D(latitude:north,longitude:east)].enumerated() {
                    targets.append(CameraTarget(id:"routes:\(index)",members:[],point:mapXY(c),latitude:c.latitude,fit:true))
                }
            }
        }
        return targets
    }
    var rect:MKMapRect {
        let fitting=focus.map{[$0]} ?? coordinates
        guard !fitting.isEmpty else { return MKMapRect.world }
        var rect=MKMapRect.null
        for c in fitting { let p=MKMapPoint(c);rect=rect.union(MKMapRect(x:p.x,y:p.y,width:1,height:1)) }
        let middle=fitting[fitting.count/2]
        let minimum=1200*MKMapPointsPerMeterAtLatitude(middle.latitude)
        let width=max(rect.width*1.3,minimum),height=max(rect.height*1.3,minimum)
        return MKMapRect(x:rect.midX-width/2,y:rect.midY-height/2,width:width,height:height)
    }
}
// Where the people map was, per account (the key includes the user id), so tab
// changes, remounts and the full-screen map continue from the same camera and
// mode. A new explicit command always wins over a remembered viewport.
private struct CameraMemory {var command:Int;var mode:FollowMode;var camera:MKMapCamera?}
private var cameraMemory:[String:CameraMemory]=[:]

private final class EdgeAvatarButton:UIButton {
    let pointer=CAShapeLayer()
    var personID=""
    override init(frame:CGRect) {
        super.init(frame:frame)
        let path=UIBezierPath()
        path.move(to:CGPoint(x:frame.width-0.5,y:frame.height/2))
        path.addLine(to:CGPoint(x:frame.width-6,y:frame.height/2-5))
        path.addLine(to:CGPoint(x:frame.width-6,y:frame.height/2+5))
        path.close()
        pointer.path=path.cgPath
        pointer.fillColor=UIColor.white.cgColor
        pointer.shadowColor=UIColor.black.cgColor;pointer.shadowOpacity=0.25;pointer.shadowRadius=1.5;pointer.shadowOffset=CGSize(width:0,height:0.5)
        pointer.frame=bounds
        layer.insertSublayer(pointer,at:0)
    }
    required init?(coder:NSCoder){fatalError("init(coder:) unavailable")}
    // A 44 pt touch target around the 40 pt avatar.
    override func point(inside point:CGPoint,with event:UIEvent?)->Bool {bounds.insetBy(dx:-2,dy:-2).contains(point)}
    func point(towards angle:CGFloat) {
        CATransaction.begin();CATransaction.setDisableActions(true)
        pointer.setAffineTransform(CGAffineTransform(rotationAngle:angle))
        CATransaction.commit()
    }
}
private func compassWord(_ angle:CGFloat)->String {
    let words=["east","south-east","south","south-west","west","north-west","north","north-east"]
    var index=Int((angle/(.pi/4)).rounded())%8;if index<0 {index+=8}
    return words[index]
}

// Owns one MKMapView's content: annotations keyed by stable id (moved and
// redrawn in place, never all replaced), overlays rebuilt only when routes
// change, and for the people map the follow camera, off-screen edge avatars, the
// Show everyone control and the "Following" chip. Main thread only.
private final class MapCoordinator:NSObject,UIGestureRecognizerDelegate {
    private(set) weak var map:MKMapView?
    private(set) var content:MapContent
    private var planner=CameraPlanner()
    private var appliedCommand:Int?
    private var hasCamera=false
    private var pins:[String:JourneyPin]=[:]
    private var pinData:[String:Data]=[:]
    private var routeKey:Int?
    private var circles:[String:MKCircle]=[:]
    private var indicators:[String:EdgeAvatarButton]=[:]
    private var indicatorData:[String:Data]=[:]
    private var indicatorVersion:[String:Int]=[:]
    private var contentVersion=0
    private var recognizers:[UIGestureRecognizer]=[]
    private var recenter:UIButton?
    private var chip:UIButton?
    private var compass:MKCompassButton?
    private let controlTop:CGFloat
    var exclusions:()->[CGRect]={[]}
    var onModeChange:((FollowMode,Int)->Void)?
    let fitPadding=UIEdgeInsets(top:40,left:14,bottom:14,right:54)
    // Map overview: density overlays for the current zoom band, clustered photos,
    // the selected photo's highlighted journey and its preview card.
    private var overviewKey:String?
    private var densityLevel:Int?
    private var densityOverlays:[DensityLines]=[]
    private var photoPins:[String:JourneyPin]=[:]
    private var highlight:[HighlightLine]=[]
    private(set) var selectedPhoto:JourneyPin?
    private(set) var densityDimmed=false
    private var card:PhotoCard?
    private var cardBottom:NSLayoutConstraint?
    private var layersButton:UIButton?
    private let showsLayers:Bool
    // action ("journey" or "photo"), photo id, journey id
    var onPhotoAction:((String,String,String)->Void)?
    var onLayers:(()->Void)?

    init(map:MKMapView,content:MapContent,controlTop:CGFloat,showsLayers:Bool=false) {
        self.map=map;self.content=content;self.controlTop=controlTop;self.showsLayers=showsLayers
        super.init()
    }
    var isPeopleMap:Bool {content.camera != nil}
    var mode:FollowMode {planner.mode}

    func apply(_ next:MapContent) {
        content=next
        contentVersion+=1
        guard let map=map else {return}
        var hasher=Hasher()
        for route in next.routes {hasher.combine(route.count);for c in route {hasher.combine(c.latitude);hasher.combine(c.longitude)}}
        hasher.combine(-1)
        for gap in next.gaps {for c in gap {hasher.combine(c.latitude);hasher.combine(c.longitude)}}
        let key=hasher.finalize()
        if key != routeKey {
            map.removeOverlays(map.overlays.filter{!($0 is MKCircle || $0 is DensityLines || $0 is HighlightLine)})
            for segment in next.routes where segment.count>1 {map.addOverlay(MKPolyline(coordinates:segment,count:segment.count))}
            for gap in next.gaps {map.addOverlay(GapPolyline(coordinates:gap,count:gap.count))}
            routeKey=key
        }
        var wantedCircles:[String:(CLLocationCoordinate2D,Double)]=[:]
        for pin in next.pins {
            guard let c=coordinate(pin["point"]),let radius=pin["radius"] as? Double,radius.isFinite,radius>0 else {continue}
            wantedCircles["\(c.latitude),\(c.longitude),\(radius)"]=(c,min(radius,100000))
        }
        for (key,circle) in circles where wantedCircles[key]==nil {map.removeOverlay(circle);circles.removeValue(forKey:key)}
        for (key,value) in wantedCircles where circles[key]==nil {let circle=MKCircle(center:value.0,radius:value.1);circles[key]=circle;map.addOverlay(circle)}

        var seen=Set<String>()
        for metadata in next.pins {
            guard let c=coordinate(metadata["point"]) else {continue}
            let id=pinID(metadata)
            guard seen.insert(id).inserted else {continue}
            var appearance=metadata;appearance.removeValue(forKey:"point")
            let data=(try? JSONSerialization.data(withJSONObject:appearance,options:[.sortedKeys])) ?? Data()
            if let pin=pins[id] {
                let changed=pinData[id] != data
                if changed && (metadata["kind"] as? String) != "people" {
                    // Rare (a renamed photo or place): replace that one annotation.
                    map.removeAnnotation(pin);pins.removeValue(forKey:id)
                } else {
                    if pin.coordinate.latitude != c.latitude || pin.coordinate.longitude != c.longitude {
                        UIView.animate(withDuration:0.6,delay:0,options:[.curveEaseInOut,.allowUserInteraction,.beginFromCurrentState]) {pin.coordinate=c}
                    }
                    if changed {
                        pin.metadata=metadata;pin.title=metadata["title"] as? String;pin.subtitle=metadata["subtitle"] as? String
                        if let view=map.view(for:pin) {configurePeopleView(view,pin)}
                        pinData[id]=data
                    }
                    continue
                }
            }
            let pin=JourneyPin();pin.coordinate=c;pin.title=metadata["title"] as? String;pin.subtitle=metadata["subtitle"] as? String;pin.metadata=metadata;pin.pinID=id
            pins[id]=pin;pinData[id]=data
            map.addAnnotation(pin)
        }
        for (id,pin) in pins where !seen.contains(id) {map.removeAnnotation(pin);pins.removeValue(forKey:id);pinData.removeValue(forKey:id)}
        applyOverview(next.overview)
        updateLayersButton(next.layersActive)
        if isPeopleMap {installControls();applyIntent();plan();layoutIndicators()}
    }

    // MARK: Overview
    // Replaced only when the overview key changes, never on a location update.
    private func applyOverview(_ data:OverviewData?) {
        guard let map=map,data?.key != overviewKey else {return}
        overviewKey=data?.key
        clearSelection(animated:false)
        map.removeOverlays(densityOverlays);densityOverlays=[];densityLevel=nil
        map.removeAnnotations(Array(photoPins.values));photoPins=[:]
        guard let data=data else {return}
        var added:[JourneyPin]=[]
        for metadata in data.photos {
            guard let c=coordinate(metadata["point"]) else {continue}
            let pin=JourneyPin();pin.coordinate=c;pin.metadata=metadata;pin.pinID=pinID(metadata);pin.isOverviewPhoto=true
            pin.title=(metadata["journeyTitle"] as? String).flatMap{$0.isEmpty ? nil : $0} ?? metadata["title"] as? String
            guard photoPins[pin.pinID]==nil else {continue}
            photoPins[pin.pinID]=pin;added.append(pin)
        }
        map.addAnnotations(added)
        updateDensity()
    }
    // One zoom band of the density at a time; switching adds or removes at most
    // five overlays.
    func updateDensity() {
        guard let map=map,let data=content.overview,map.bounds.width>1 else {return}
        let latitude=map.centerCoordinate.latitude
        let metresPerPoint=map.visibleMapRect.size.width/MKMapPointsPerMeterAtLatitude(abs(latitude)<85 ? latitude : 0)/Double(map.bounds.width)
        let level=DensityLevels.choose(cells:data.cells,metresPerPoint:metresPerPoint)
        guard level != densityLevel else {return}
        densityLevel=level
        map.removeOverlays(densityOverlays)
        densityOverlays=level.map{data.levels[$0]} ?? []
        for overlay in densityOverlays {map.addOverlay(overlay,level:.aboveRoads)}
    }
    private func setDensityDimmed(_ dimmed:Bool) {
        guard dimmed != densityDimmed,let map=map else {return}
        densityDimmed=dimmed
        for overlay in densityOverlays {
            guard let renderer=map.renderer(for:overlay) else {continue}
            renderer.alpha=dimmed ? 0.3 : 1;renderer.setNeedsDisplay()
        }
    }
    // First tap on a photo: highlight exactly its journey (when its route is
    // known; nothing is invented otherwise), dim the density and preview it.
    func select(photo pin:JourneyPin) {
        guard let map=map,pin.isOverviewPhoto else {return}
        selectedPhoto=pin
        map.removeOverlays(highlight);highlight=[]
        let journeyID=pin.metadata["journeyID"] as? String ?? ""
        var rect=MKMapRect.null
        for segment in content.overview?.routes[journeyID] ?? [] where segment.count>1 {
            let casing=HighlightLine(coordinates:segment,count:segment.count);casing.casing=true
            let line=HighlightLine(coordinates:segment,count:segment.count)
            highlight.append(contentsOf:[casing,line]);rect=rect.union(line.boundingMapRect)
        }
        for line in highlight {map.addOverlay(line,level:.aboveLabels)}
        setDensityDimmed(!highlight.isEmpty)
        showCard(pin.metadata)
        // Keep the camera unless the journey is out of view, and never chase an
        // enormous one (HighlightCamera).
        let insets=UIEdgeInsets(top:60,left:16,bottom:(card?.bounds.height ?? 150)+28,right:16)
        if !rect.isNull,let visible=box(in:map.bounds.inset(by:insets)),
           let target=HighlightCamera.target(route:MapBox(minX:rect.minX,minY:rect.minY,width:rect.width,height:rect.height),visible:visible) {
            if isPeopleMap,planner.userMoved() {modeChanged()}
            map.setVisibleMapRect(MKMapRect(x:target.minX,y:target.minY,width:target.width,height:target.height),edgePadding:insets,animated:!UIAccessibility.isReduceMotionEnabled)
        }
    }
    // MapKit deselects on a tap on the bare map. Selecting another photo also
    // deselects first, so wait a turn before treating it as a dismissal.
    func deselected(_ annotation:MKAnnotation?) {
        guard let pin=annotation as? JourneyPin,pin===selectedPhoto else {return}
        DispatchQueue.main.async { [weak self] in
            guard let self=self,self.selectedPhoto===pin,self.map?.selectedAnnotations.contains(where:{$0===pin}) != true else {return}
            self.clearSelection(animated:true)
        }
    }
    // A cluster zooms in to its photos; photos too close to separate preview the first.
    func open(cluster:MKClusterAnnotation) {
        guard let map=map else {return}
        map.deselectAnnotation(cluster,animated:false)
        let members=cluster.memberAnnotations.compactMap{$0 as? JourneyPin}
        guard let first=members.first else {return}
        var rect=MKMapRect.null
        for member in members {let p=MKMapPoint(member.coordinate);rect=rect.union(MKMapRect(x:p.x,y:p.y,width:1,height:1))}
        let spread=max(rect.width,rect.height)/MKMapPointsPerMeterAtLatitude(first.coordinate.latitude)
        if spread<40 || map.camera.centerCoordinateDistance<500 {select(photo:first);return}
        if isPeopleMap,planner.userMoved() {modeChanged()}
        map.setVisibleMapRect(rect,edgePadding:UIEdgeInsets(top:80,left:60,bottom:80,right:60),animated:!UIAccessibility.isReduceMotionEnabled)
    }
    func clearSelection(animated:Bool) {
        guard selectedPhoto != nil || card != nil || !highlight.isEmpty else {return}
        if let pin=selectedPhoto {map?.deselectAnnotation(pin,animated:animated)}
        selectedPhoto=nil
        map?.removeOverlays(highlight);highlight=[]
        setDensityDimmed(false)
        hideCard(animated:animated)
    }
    private func showCard(_ metadata:[String:Any]) {
        guard let map=map else {return}
        let card=self.card ?? {
            let created=PhotoCard(frame:.zero)
            created.translatesAutoresizingMaskIntoConstraints=false
            map.addSubview(created)
            let bottom=created.bottomAnchor.constraint(equalTo:map.bottomAnchor,constant:-12)
            let width=created.widthAnchor.constraint(equalTo:map.widthAnchor,constant:-24);width.priority = .defaultHigh
            NSLayoutConstraint.activate([bottom,width,created.centerXAnchor.constraint(equalTo:map.centerXAnchor),created.widthAnchor.constraint(lessThanOrEqualToConstant:440),
                created.leadingAnchor.constraint(greaterThanOrEqualTo:map.leadingAnchor,constant:12),created.topAnchor.constraint(greaterThanOrEqualTo:map.topAnchor,constant:56)])
            created.closeButton.addAction(UIAction{[weak self] _ in self?.clearSelection(animated:true)},for:.touchUpInside)
            created.journeyButton.addAction(UIAction{[weak self] _ in self?.photoAction("journey")},for:.touchUpInside)
            created.photoButton.addAction(UIAction{[weak self] _ in self?.photoAction("photo")},for:.touchUpInside)
            self.card=created;self.cardBottom=bottom
            created.alpha=0
            return created
        }()
        card.show(metadata)
        map.bringSubviewToFront(card)
        map.layoutIfNeeded()
        // Keep Apple's logo and Legal link visible above the card.
        map.layoutMargins.bottom=card.bounds.height+12
        if card.alpha<1 {
            card.transform=UIAccessibility.isReduceMotionEnabled ? .identity : CGAffineTransform(translationX:0,y:24)
            UIView.animate(withDuration:UIAccessibility.isReduceMotionEnabled ? 0.01 : 0.28,delay:0,usingSpringWithDamping:0.86,initialSpringVelocity:0,options:[.allowUserInteraction]) {card.alpha=1;card.transform = .identity}
        }
        UIAccessibility.post(notification:.layoutChanged,argument:card.titleLabel)
        layoutIndicators()
    }
    private func hideCard(animated:Bool) {
        guard let card=card else {return}
        map?.layoutMargins.bottom=0
        let finish={card.alpha=0;card.transform=UIAccessibility.isReduceMotionEnabled ? .identity : CGAffineTransform(translationX:0,y:24)}
        if animated {UIView.animate(withDuration:0.2,animations:finish)} else {finish()}
        layoutIndicators()
    }
    private var cardFrame:CGRect? {card.flatMap{$0.alpha>0.01 ? $0.frame : nil}}
    private func photoAction(_ action:String) {
        guard let pin=selectedPhoto,let photoID=pin.metadata["photoID"] as? String,let journeyID=pin.metadata["journeyID"] as? String else {return}
        onPhotoAction?(action,photoID,journeyID)
    }
    // MARK: Map layers button (embedded map only)
    private func updateLayersButton(_ active:Int?) {
        guard let map=map else {return}
        guard showsLayers,let active=active else {layersButton?.removeFromSuperview();layersButton=nil;return}
        let button=layersButton ?? {
            let created=UIButton(type:.system)
            created.backgroundColor=UIColor.secondarySystemBackground.withAlphaComponent(0.94)
            created.layer.cornerRadius=20
            created.setImage(UIImage(systemName:"slider.horizontal.3",withConfiguration:UIImage.SymbolConfiguration(pointSize:16,weight:.semibold)),for:.normal)
            created.tintColor = .label
            created.frame=CGRect(x:12,y:12,width:40,height:40)
            let dot=UIView(frame:CGRect(x:28,y:7,width:7,height:7))
            dot.backgroundColor=brandAccent;dot.layer.cornerRadius=3.5;dot.isUserInteractionEnabled=false;dot.tag=7
            created.addSubview(dot)
            created.addAction(UIAction{[weak self] _ in self?.onLayers?()},for:.touchUpInside)
            map.addSubview(created)
            layersButton=created
            return created
        }()
        button.viewWithTag(7)?.isHidden=active==0
        button.accessibilityLabel=active>0 ? "Map layers, \(active) active" : "Map layers"
        map.bringSubviewToFront(button)
    }

    // MARK: Camera
    private func applyIntent() {
        guard let intent=content.camera,let map=map else {return}
        if appliedCommand == nil {
            let memory=cameraMemory[intent.key]
            if let memory=memory,memory.command==intent.command,let camera=memory.camera {
                // Remounted (tab change, full screen closed): continue where it was.
                planner.resume(memory.mode)
                map.setCamera(camera,animated:false)
                hasCamera=true
            } else {
                start(intent.mode)
            }
            appliedCommand=intent.command
            updateControls()
        } else if intent.command != appliedCommand {
            start(intent.mode)
            appliedCommand=intent.command
            updateControls()
        }
    }
    private func start(_ mode:FollowMode) {
        if case .person(let id)=mode {planner.follow(id)} else {planner.showAll()}
    }
    // Reload the camera another view of the same map (full screen) left behind.
    func resumeFromMemory() {
        guard let intent=content.camera,let memory=cameraMemory[intent.key],memory.command==appliedCommand else {return}
        planner.resume(memory.mode)
        if let camera=memory.camera {map?.setCamera(camera,animated:false);hasCamera=true}
        updateControls();layoutIndicators()
    }
    func remember() {
        guard let intent=content.camera,let map=map,let command=appliedCommand else {return}
        if cameraMemory[intent.key]==nil && cameraMemory.count>=6 {cameraMemory.removeAll()}
        cameraMemory[intent.key]=CameraMemory(command:command,mode:planner.mode,camera:hasCamera ? (map.camera.copy() as? MKMapCamera) : nil)
    }
    private func visibleBox()->MapBox? {
        guard let map=map,map.bounds.width>80,map.bounds.height>80 else {return nil}
        return box(in:map.bounds.inset(by:fitPadding))
    }
    // The map area under a screen rectangle of the map view.
    private func box(in inner:CGRect)->MapBox? {
        guard let map=map,inner.width>10,inner.height>10 else {return nil}
        let topLeft=MKMapPoint(map.convert(CGPoint(x:inner.minX,y:inner.minY),toCoordinateFrom:map))
        let bottomRight=MKMapPoint(map.convert(CGPoint(x:inner.maxX,y:inner.maxY),toCoordinateFrom:map))
        var width=bottomRight.x-topLeft.x;if width<0 {width+=MKMapSize.world.width}
        let height=bottomRight.y-topLeft.y
        guard width.isFinite,height.isFinite,width>0,height>0 else {return nil}
        return MapBox(minX:topLeft.x,minY:topLeft.y,width:width,height:height)
    }
    func plan() {
        guard isPeopleMap,let map=map,let visible=visibleBox() else {return}
        let before=planner.mode
        if let move=planner.plan(targets:content.cameraTargets,visible:visible,now:CACurrentMediaTime()) {
            // The first camera of a new map is set without an animation from the
            // default region; later ones animate.
            let animate=hasCamera
            switch move {
            case .fit(let box,let animated):
                if map.camera.heading != 0 {let camera=(map.camera.copy() as? MKMapCamera) ?? map.camera;camera.heading=0;map.setCamera(camera,animated:false)}
                map.setVisibleMapRect(MKMapRect(x:box.minX,y:box.minY,width:box.width,height:box.height),edgePadding:fitPadding,animated:animated && animate)
            case .centre(let point,let width,let animated):
                let centre=MKMapPoint(x:point.x,y:point.y)
                if let width=width {
                    let height=width*Double(map.bounds.height/max(1,map.bounds.width))
                    map.setVisibleMapRect(MKMapRect(x:centre.x-width/2,y:centre.y-height/2,width:width,height:height),animated:animated && animate)
                } else {
                    map.setCenter(centre.coordinate,animated:animated && animate)
                }
            }
            hasCamera=true
        }
        if planner.mode != before {modeChanged()}
    }
    private func modeChanged() {
        updateControls();remember()
        onModeChange?(planner.mode,appliedCommand ?? 0)
    }
    func showEveryone() {planner.showAll();modeChanged();plan()}
    func follow(_ personID:String) {planner.follow(personID);modeChanged();plan()}
    @objc private func userGesture(_ recognizer:UIGestureRecognizer) {
        let began=recognizer is UITapGestureRecognizer ? recognizer.state == .ended : recognizer.state == .began
        guard began,planner.userMoved() else {return}
        modeChanged()
    }
    func gestureRecognizer(_ gestureRecognizer:UIGestureRecognizer,shouldRecognizeSimultaneouslyWith other:UIGestureRecognizer)->Bool {true}
    func gestureRecognizer(_ gestureRecognizer:UIGestureRecognizer,shouldReceive touch:UITouch)->Bool {
        // Taps on our own controls are not map gestures.
        !(touch.view is UIControl)
    }
    func regionDidChange() {remember();updateDensity();layoutIndicators()}

    // MARK: Controls
    private func installControls() {
        guard let map=map,recenter==nil else {return}
        map.isPitchEnabled=false
        map.showsCompass=false
        // Only the user's own pans, pinches, rotations and double taps count as
        // exploring; the planner's camera animations never do.
        let pan=UIPanGestureRecognizer(target:self,action:#selector(userGesture(_:)))
        let pinch=UIPinchGestureRecognizer(target:self,action:#selector(userGesture(_:)))
        let rotate=UIRotationGestureRecognizer(target:self,action:#selector(userGesture(_:)))
        let doubleTap=UITapGestureRecognizer(target:self,action:#selector(userGesture(_:)));doubleTap.numberOfTapsRequired=2
        for recognizer in [pan,pinch,rotate,doubleTap] as [UIGestureRecognizer] {
            recognizer.delegate=self;recognizer.cancelsTouchesInView=false;recognizer.delaysTouchesEnded=false
            map.addGestureRecognizer(recognizer);recognizers.append(recognizer)
        }
        let button=UIButton(type:.system)
        button.backgroundColor=UIColor.secondarySystemBackground.withAlphaComponent(0.94)
        button.layer.cornerRadius=18
        button.accessibilityLabel="Show everyone"
        button.addAction(UIAction{[weak self] _ in self?.showEveryone()},for:.touchUpInside)
        map.addSubview(button);recenter=button
        let compass=MKCompassButton(mapView:map)
        compass.compassVisibility = .adaptive
        map.addSubview(compass);self.compass=compass
        var style=UIButton.Configuration.filled()
        style.baseBackgroundColor=UIColor.secondarySystemBackground.withAlphaComponent(0.94)
        style.baseForegroundColor = .label
        style.cornerStyle = .capsule
        style.image=UIImage(systemName:"xmark.circle.fill",withConfiguration:UIImage.SymbolConfiguration(pointSize:13))
        style.imagePlacement = .trailing
        style.imagePadding=6
        style.contentInsets=NSDirectionalEdgeInsets(top:0,leading:12,bottom:0,trailing:10)
        style.titleTextAttributesTransformer=UIConfigurationTextAttributesTransformer { attributes in
            var updated=attributes;updated.font=UIFont.systemFont(ofSize:13,weight:.semibold);return updated
        }
        let chip=UIButton(configuration:style)
        chip.isHidden=true
        chip.addAction(UIAction{[weak self] _ in self?.showEveryone()},for:.touchUpInside)
        map.addSubview(chip);self.chip=chip
        updateControls()
    }
    private func name(of personID:String)->String {
        for pin in content.peoplePins {
            for member in pin["members"] as? [[String:Any]] ?? [] where member["id"] as? String==personID {
                return (member["name"] as? String).flatMap{$0.isEmpty ? nil : $0} ?? "this person"
            }
        }
        return "this person"
    }
    // Frames follow the current bounds (the full-screen map is created before it
    // has a size), so the column always sits at the right edge.
    private func layoutControls() {
        guard let map=map,let recenter=recenter else {return}
        let right=map.bounds.width-16
        recenter.frame=CGRect(x:right-36,y:controlTop,width:36,height:36)
        compass?.frame=CGRect(x:right-38,y:controlTop+44,width:40,height:40)
        if let chip=chip,!chip.isHidden {chip.frame.origin=CGPoint(x:12,y:controlTop)}
    }
    private func updateControls() {
        guard let map=map,let recenter=recenter else {return}
        defer {layoutControls()}
        let following=planner.mode == .all
        recenter.setImage(UIImage(systemName:following ? "person.2.fill" : "person.2",withConfiguration:UIImage.SymbolConfiguration(pointSize:15,weight:.semibold)),for:.normal)
        recenter.tintColor=following ? .systemBlue : .label
        recenter.accessibilityValue=following ? "Showing everyone" : nil
        recenter.accessibilityHint=following ? nil : "Moves the map to show everyone sharing their location"
        if let chip=chip {
            if let id=planner.mode.personID {
                chip.configuration?.title="Following \(name(of:id))"
                chip.accessibilityLabel="Following \(name(of:id)). Show everyone"
                let fitted=chip.sizeThatFits(CGSize(width:map.bounds.width-90,height:32))
                chip.frame=CGRect(x:12,y:controlTop,width:min(fitted.width,map.bounds.width-90),height:32)
                chip.isHidden=false
            } else {chip.isHidden=true}
        }
    }

    // MARK: Edge avatars
    func layoutIndicators() {
        guard isPeopleMap,let map=map,map.bounds.width>80,map.bounds.height>80 else {return}
        layoutControls()
        let bounds=map.bounds
        let middle=CGPoint(x:bounds.midX,y:bounds.midY)
        let centre=MKMapPoint(map.convert(middle,toCoordinateFrom:map))
        let alongX=MKMapPoint(map.convert(CGPoint(x:middle.x+100,y:middle.y),toCoordinateFrom:map))
        let alongY=MKMapPoint(map.convert(CGPoint(x:middle.x,y:middle.y+100),toCoordinateFrom:map))
        let projection=ScreenProjection(centre:MapXY(x:centre.x,y:centre.y),screenCentre:middle,alongX:MapXY(x:alongX.x,y:alongX.y),alongY:MapXY(x:alongY.x,y:alongY.y),distance:100)
        var groups:[String:[[String:Any]]]=[:]
        var items:[(id:String,point:CGPoint)]=[]
        for pin in content.peoplePins {
            guard let c=coordinate(pin["point"]),let point=projection.screenPoint(mapXY(c)) else {continue}
            let id=pinID(pin)
            groups[id]=pin["members"] as? [[String:Any]] ?? []
            items.append((id,point))
        }
        let size:CGFloat=40
        var blocked=[recenter,chip].compactMap{$0}.filter{!$0.isHidden}.map{$0.frame.insetBy(dx:-4,dy:-4)}
        if let compass=compass,compass.alpha>0.01,!compass.isHidden {blocked.append(compass.frame.insetBy(dx:-4,dy:-4))}
        for view in map.subviews where view is UIButton && !(view is EdgeAvatarButton) && !view.isHidden {blocked.append(view.frame.insetBy(dx:-4,dy:-4))}
        // MapKit's Apple Maps logo and Legal link sit at the bottom left (above the
        // photo preview card while it is shown).
        let attribution=bounds.height-map.layoutMargins.bottom
        blocked.append(CGRect(x:0,y:attribution-34,width:130,height:34))
        if let card=cardFrame {blocked.append(card.insetBy(dx:-6,dy:-6))}
        blocked.append(contentsOf:exclusions())
        let placements=EdgeIndicatorLayout.place(items,bounds:bounds.insetBy(dx:6,dy:6),rail:bounds.insetBy(dx:8+size/2,dy:8+size/2),exclusions:blocked,size:size,spacing:size+6)
        var shown=Set<String>()
        for placement in placements {
            guard let members=groups[placement.id] else {continue}
            shown.insert(placement.id)
            let button:EdgeAvatarButton
            if let existing=indicators[placement.id] {button=existing} else {
                button=EdgeAvatarButton(frame:CGRect(x:0,y:0,width:size,height:size))
                button.alpha=0
                button.addAction(UIAction{[weak self,weak button] _ in
                    guard let self=self,let id=button?.personID,!id.isEmpty else {return}
                    self.follow(id)
                },for:.touchUpInside)
                map.addSubview(button)
                indicators[placement.id]=button
                UIView.animate(withDuration:0.2){button.alpha=1}
            }
            // Redrawn only when the people in it change, not on every frame of a pan.
            if indicatorVersion[placement.id] != contentVersion {
                indicatorVersion[placement.id]=contentVersion
                let data=(try? JSONSerialization.data(withJSONObject:members,options:[.sortedKeys])) ?? Data()
                if indicatorData[placement.id] != data {
                    button.setImage(edgeAvatarImage(members).withRenderingMode(.alwaysOriginal),for:.normal)
                    indicatorData[placement.id]=data
                }
            }
            // Follow whoever is already being followed in this group, else its first person.
            let ids=members.compactMap{$0["id"] as? String}
            button.personID=planner.mode.personID.flatMap{ids.contains($0) ? $0 : nil} ?? ids.first ?? ""
            let names=members.compactMap{$0["name"] as? String}
            let status=(members.first?["state"] as? String)=="stale" ? " Last known position." : ""
            button.accessibilityLabel="\(names.joined(separator:", ")), off screen to the \(compassWord(placement.angle)).\(status)"
            button.accessibilityHint="Shows them on the map"
            button.center=placement.centre
            button.point(towards:placement.angle)
        }
        for (id,button) in indicators where !shown.contains(id) {
            indicators.removeValue(forKey:id);indicatorData.removeValue(forKey:id);indicatorVersion.removeValue(forKey:id)
            UIView.animate(withDuration:0.15,animations:{button.alpha=0},completion:{_ in button.removeFromSuperview()})
        }
        if let recenter=recenter {map.bringSubviewToFront(recenter)}
    }

    func detach() {
        remember()
        for recognizer in recognizers {recognizer.view?.removeGestureRecognizer(recognizer)}
        recognizers.removeAll()
        for button in indicators.values {button.removeFromSuperview()}
        indicators.removeAll();indicatorData.removeAll();indicatorVersion.removeAll()
        ([recenter,chip,compass,card,layersButton] as [UIView?]).forEach{$0?.removeFromSuperview()}
        recenter=nil;chip=nil;compass=nil;card=nil;layersButton=nil
        selectedPhoto=nil;highlight=[]
        onModeChange=nil;onPhotoAction=nil;onLayers=nil
    }
}

@objc(AppleMapsPlugin)
public class AppleMapsPlugin: CAPPlugin, CAPBridgedPlugin {
    private weak var presentedMap:AppleMapController?
    private var presentedID:String?
    private var embeddedMaps:[String:MKMapView]=[:]
    private var embeddedContent:[String:MapContent]=[:]
    private var coordinators:[String:MapCoordinator]=[:]
    // Embedded maps hidden while a sheet or the photo viewer covers them.
    private var hiddenMaps=Set<String>()
    private func coordinator(for map:MKMapView)->MapCoordinator? {coordinators.values.first{$0.map===map}}
    private func mapID(for map:MKMapView)->String? {embeddedMaps.first{$0.value===map}?.key}
    // The Map overview's density, photos and highlight routes, once per key.
    @objc func setOverview(_ call:CAPPluginCall) {
        let options=call.options ?? [:]
        DispatchQueue.global(qos:.userInitiated).async {
            guard let data=OverviewData(options) else {call.reject("Map overview unavailable");return}
            DispatchQueue.main.async {storeOverview(data);call.resolve()}
        }
    }
    // MapKit draws above the web view, so a web sheet over the map would be
    // hidden. While one is open the map is hidden (keeping its camera, layers and
    // selection) and the web view shows the still image returned here.
    @objc func hide(_ call:CAPPluginCall) {
        DispatchQueue.main.async {
            guard let id=call.getString("mapID"),let map=self.embeddedMaps[id] else {call.resolve();return}
            let hidden=call.getBool("hidden") ?? true
            var result:[String:Any]=[:]
            if hidden && !map.isHidden && map.bounds.width>1 && map.bounds.height>1 {
                let format=UIGraphicsImageRendererFormat();format.scale=2
                let image=UIGraphicsImageRenderer(bounds:map.bounds,format:format).image { _ in _=map.drawHierarchy(in:map.bounds,afterScreenUpdates:false) }
                if let bytes=image.jpegData(compressionQuality:0.8) {result["image"]="data:image/jpeg;base64,"+bytes.base64EncodedString()}
            }
            if hidden {self.hiddenMaps.insert(id)} else {self.hiddenMaps.remove(id)}
            map.isHidden=hidden || self.presentedID==id
            call.resolve(result)
        }
    }
    fileprivate func reportCamera(_ mapID:String,_ mode:FollowMode,_ command:Int) {
        notifyListeners("cameraChanged",data:["mapID":mapID,"mode":mode.name,"personId":mode.personID.map{$0 as Any} ?? NSNull(),"command":command])
    }
    public let identifier="AppleMapsPlugin"
    public let jsName="AppleMaps"
    public let pluginMethods:[CAPPluginMethod]=[CAPPluginMethod(name:"setAppearance",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"snapshot",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"open",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"close",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"embed",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"unembed",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"setOverview",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"hide",returnType:CAPPluginReturnPromise)]
    @objc func setAppearance(_ call:CAPPluginCall) {
        DispatchQueue.main.async {
            let dark=call.getString("theme")=="dark"
            self.bridge?.viewController?.view.window?.overrideUserInterfaceStyle=dark ? .dark : .light
            let background=dark ? UIColor(red:16/255.0,green:19/255.0,blue:27/255.0,alpha:1) : UIColor(red:246/255.0,green:247/255.0,blue:251/255.0,alpha:1)
            self.bridge?.webView?.backgroundColor=background
            self.bridge?.webView?.scrollView.backgroundColor=background
            self.bridge?.viewController?.setNeedsStatusBarAppearanceUpdate()
            call.resolve()
        }
    }
    @objc func snapshot(_ call:CAPPluginCall) {
        DispatchQueue.main.async {
            let content=MapContent(call.options)
            let options=MKMapSnapshotter.Options()
            options.size=CGSize(width:min(900,max(200,call.getDouble("width") ?? 700)),height:min(700,max(150,call.getDouble("height") ?? 350)))
            options.mapRect=content.rect
            if #available(iOS 17.0, *) {options.preferredConfiguration=MKStandardMapConfiguration(elevationStyle:.flat)} else {options.mapType = .standard}
            options.traitCollection=self.bridge?.viewController?.traitCollection ?? UITraitCollection(userInterfaceStyle:.light)
            let snapshotter=MKMapSnapshotter(options:options)
            snapshotter.start { snapshot,error in
                guard let snapshot=snapshot,error==nil else {call.reject("Apple map preview unavailable");return}
                let trimPreview = call.getBool("trimPreview") == true
                let projection = trimPreview ? content.routes.map { segment in segment.map { c in let p=snapshot.point(for:c); return [Double(p.x),Double(p.y)] } } : []
                let image=UIGraphicsImageRenderer(size:options.size).image { context in
                    snapshot.image.draw(at:.zero)
                    let ctx=context.cgContext
                    // The overview's density at the zoom band this preview shows.
                    let middle=MKMapPoint(x:options.mapRect.midX,y:options.mapRect.midY).coordinate
                    if let overview=content.overview,
                       let level=DensityLevels.choose(cells:overview.cells,metresPerPoint:options.mapRect.size.width/MKMapPointsPerMeterAtLatitude(middle.latitude)/Double(options.size.width)) {
                        for lines in overview.levels[level] {
                            let style=densityStyle(lines.weight)
                            style.color.setStroke()
                            for line in lines.polylines where line.pointCount>1 {
                                let points=line.points()
                                let path=UIBezierPath();path.move(to:snapshot.point(for:points[0].coordinate))
                                for i in 1..<line.pointCount {path.addLine(to:snapshot.point(for:points[i].coordinate))}
                                path.lineWidth=style.width;path.lineCapStyle = .round;path.lineJoinStyle = .round;path.stroke()
                            }
                        }
                    }
                    for segment in content.routes where segment.count>1 {
                        let path=UIBezierPath();path.move(to:snapshot.point(for:segment[0]));for c in segment.dropFirst(){path.addLine(to:snapshot.point(for:c))}
                        UIColor.white.setStroke();path.lineWidth=7;path.lineJoinStyle = .round;path.lineCapStyle = .round;path.stroke()
                        (trimPreview ? UIColor.systemGray3 : routeColor).setStroke();path.lineWidth=3.5;path.stroke()
                    }
                    // Unobserved gaps are dashed so the reader sees incomplete coverage
                    // without a solid line implying a route was actually recorded.
                    for gap in content.gaps {
                        let path=UIBezierPath();path.move(to:snapshot.point(for:gap[0]));path.addLine(to:snapshot.point(for:gap[1]))
                        UIColor.white.setStroke();path.lineWidth=7;path.lineCapStyle = .round;path.stroke()
                        ctx.saveGState();ctx.setLineDash(phase:0,lengths:[7,7]);gapColor.setStroke();path.lineWidth=3.5;path.stroke();ctx.restoreGState()
                    }
                    // The place radius is rendered on previews as well as the fullscreen picker.
                    for pin in content.pins {
                        guard let center=coordinate(pin["point"]),let radius=pin["radius"] as? Double,radius.isFinite,radius>0 else {continue}
                        let circle=MKCircle(center:center,radius:min(radius,100000))
                        let bounds=circle.boundingMapRect
                        let top=MKMapPoint(x:bounds.midX,y:bounds.minY).coordinate
                        let bottom=MKMapPoint(x:bounds.midX,y:bounds.maxY).coordinate
                        let p1=snapshot.point(for:top),p2=snapshot.point(for:bottom),centerPoint=snapshot.point(for:center)
                        let screenRadius=abs(p2.y-p1.y)/2
                        if screenRadius.isFinite && screenRadius>0 && screenRadius<10000 {
                            let rect=CGRect(x:centerPoint.x-screenRadius,y:centerPoint.y-screenRadius,width:screenRadius*2,height:screenRadius*2)
                            ctx.setFillColor(UIColor.systemBlue.withAlphaComponent(0.13).cgColor)
                            ctx.fillEllipse(in:rect)
                            ctx.setStrokeColor(UIColor.systemBlue.withAlphaComponent(0.85).cgColor)
                            ctx.setLineWidth(2.5)
                            ctx.strokeEllipse(in:rect)
                        }
                    }
                    // Draw normal pins first; full-size photo thumbnails must sit above them.
                    for pin in content.pins where (pin["kind"] as? String) != "photo" {
                        guard let c=coordinate(pin["point"]) else {continue};let p=snapshot.point(for:c)
                        if (pin["kind"] as? String)=="people" {
                            let marker=peopleMarker(pin)
                            marker.image.draw(at:CGPoint(x:p.x-marker.image.size.width/2+marker.offset.x,y:p.y-marker.image.size.height/2+marker.offset.y))
                            continue
                        }
                        if (pin["kind"] as? String)=="family-live" {
                            let bounds=CGRect(x:p.x-12,y:p.y-12,width:24,height:24)
                            UIColor.systemPurple.setFill();ctx.fillEllipse(in:bounds)
                            UIColor.white.setStroke();ctx.setLineWidth(3);ctx.strokeEllipse(in:bounds)
                            continue
                        }
                        if (pin["kind"] as? String)=="home-presence" {
                            let count=max(1,min(30,pin["count"] as? Int ?? 1))
                            let bounds=CGRect(x:p.x-21,y:p.y-21,width:42,height:42)
                            UIColor.systemPurple.setFill();ctx.fillEllipse(in:bounds)
                            UIColor.white.setStroke();ctx.setLineWidth(3);ctx.strokeEllipse(in:bounds)
                            if let home=UIImage(named:"Letm3goHome") {
                                home.draw(in:bounds.insetBy(dx:5,dy:5))
                                // Keep saying how many people are at Home.
                                if count>1 {
                                    let badge=CGRect(x:bounds.maxX-15,y:bounds.minY-3,width:18,height:18)
                                    UIColor.white.setFill();ctx.fillEllipse(in:badge)
                                    UIColor.systemPurple.setFill();ctx.fillEllipse(in:badge.insetBy(dx:1.5,dy:1.5))
                                    let number=String(count) as NSString
                                    let attributes:[NSAttributedString.Key:Any]=[.font:UIFont.boldSystemFont(ofSize:10),.foregroundColor:UIColor.white]
                                    let s=number.size(withAttributes:attributes)
                                    number.draw(at:CGPoint(x:badge.midX-s.width/2,y:badge.midY-s.height/2),withAttributes:attributes)
                                }
                                continue
                            }
                            let text=("⌂ " + String(count)) as NSString
                            text.draw(at:CGPoint(x:p.x-14,y:p.y-10),withAttributes:[.font:UIFont.boldSystemFont(ofSize:14),.foregroundColor:UIColor.white])
                            continue
                        }
                        let kind=pin["kind"] as? String ?? ""
                        if kind=="start" || kind=="finish" {
                            let color:UIColor=kind=="start" ? .systemGreen : .systemRed
                            let bounds=CGRect(x:p.x-15,y:p.y-15,width:30,height:30)
                            ctx.setFillColor(color.cgColor);ctx.fillEllipse(in:bounds)
                            ctx.setStrokeColor(UIColor.white.cgColor);ctx.setLineWidth(3);ctx.strokeEllipse(in:bounds)
                            let label=(kind=="start" ? "S" : "F") as NSString
                            let attributes:[NSAttributedString.Key:Any]=[.font:UIFont.boldSystemFont(ofSize:15),.foregroundColor:UIColor.white]
                            let size=label.size(withAttributes:attributes)
                            label.draw(at:CGPoint(x:p.x-size.width/2,y:p.y-size.height/2),withAttributes:attributes)
                        } else {
                            let color=kind=="location" ? UIColor.systemBlue : routeColor
                            ctx.setFillColor(color.cgColor);ctx.setStrokeColor(UIColor.white.cgColor);ctx.setLineWidth(2)
                            ctx.fillEllipse(in:CGRect(x:p.x-5,y:p.y-5,width:10,height:10));ctx.strokeEllipse(in:CGRect(x:p.x-5,y:p.y-5,width:10,height:10))
                        }
                    }
                    for pin in content.pins where (pin["kind"] as? String) == "photo" {
                        guard let c=coordinate(pin["point"]),let photoID=pin["photoID"] as? String else {continue}
                        let p=snapshot.point(for:c)
                        if let thumbnail=journalPhotoThumbnail(photoID,size:52) {
                            thumbnail.draw(in:CGRect(x:p.x-26,y:p.y-26,width:52,height:52))
                        }
                    }
                    // Overview photos, one per 36 points so they never pile up.
                    var drawn:[CGPoint]=[]
                    for pin in content.overview?.photos ?? [] {
                        guard drawn.count<60,let c=coordinate(pin["point"]) else {continue}
                        let p=snapshot.point(for:c)
                        guard CGRect(origin:.zero,size:options.size).contains(p),!drawn.contains(where:{hypot($0.x-p.x,$0.y-p.y)<36}) else {continue}
                        drawn.append(p)
                        let marker=overviewPhotoMarker(pin["photoID"] as? String)
                        marker.draw(at:CGPoint(x:p.x-marker.size.width/2,y:p.y-marker.size.height/2))
                    }
                }
                guard let bytes=image.jpegData(compressionQuality:0.85) else {call.reject("Map preview unavailable");return}
                call.resolve(["image":"data:image/jpeg;base64,"+bytes.base64EncodedString(),"projection":projection])
            }
        }
    }
    @objc func embed(_ call:CAPPluginCall) {
        DispatchQueue.main.async {
            guard let id=call.getString("mapID"), let webView=self.bridge?.webView,
                  let x=call.getDouble("x"),let y=call.getDouble("y"),
                  let width=call.getDouble("width"),let height=call.getDouble("height"),
                  width>80,height>80 else {call.reject("Map layout unavailable");return}
            let content=MapContent(call.options)
            let scroll=webView.scrollView
            let previousContent=self.embeddedContent[id]
            self.embeddedContent[id]=content
            let map=self.embeddedMaps[id] ?? MKMapView(frame:.zero)
            map.frame=CGRect(x:x+scroll.contentOffset.x,y:y+scroll.contentOffset.y,width:width,height:height)
            map.layer.cornerRadius=16;map.clipsToBounds=true
            if self.embeddedMaps[id] == nil {
                map.isZoomEnabled=true;map.isScrollEnabled=true;map.showsCompass=true
                if #available(iOS 16.0, *) {map.preferredConfiguration=MKStandardMapConfiguration(elevationStyle:.realistic)}
                map.delegate=self
                scroll.addSubview(map)
                scroll.bringSubviewToFront(map)
                self.embeddedMaps[id]=map
                let button=UIButton(type:.system)
                button.setImage(UIImage(systemName:"arrow.up.left.and.arrow.down.right"),for:.normal)
                button.backgroundColor=UIColor.secondarySystemBackground.withAlphaComponent(0.94)
                button.layer.cornerRadius=18
                button.frame=CGRect(x:max(0,width-52),y:12,width:36,height:36)
                button.autoresizingMask=[.flexibleLeftMargin]
                button.accessibilityLabel="Open full screen map"
                button.addAction(UIAction { [weak self] _ in
                    guard let self=self,let parent=self.bridge?.viewController,parent.presentedViewController==nil else {return}
                    // Hide the embedded MKMapView while fullscreen MapKit owns the screen.
                    // It otherwise competes for rendering and can leave a blank map.
                    let embedded=self.coordinators[id]
                    embedded?.remember()
                    map.isHidden=true
                    let controller=AppleMapController(content:self.embeddedContent[id] ?? content,picker:false)
                    controller.onCamera={ [weak self] mode,command in self?.reportCamera(id,mode,command) }
                    // The full-screen overview continues from this map's view.
                    controller.initialCamera=map.camera.copy() as? MKMapCamera
                    self.presentedMap=controller;self.presentedID=id
                    controller.completion={ [weak self, weak map, weak embedded] result in
                        map?.isHidden=false
                        // Continue from wherever the full-screen map was left.
                        embedded?.resumeFromMemory()
                        if self?.presentedID==id {self?.presentedID=nil}
                        if let photoID=result["photoID"] as? String,let journeyID=result["journeyID"] as? String {
                            self?.notifyListeners("photoSelected",data:["mapID":id,"photoID":photoID,"journeyID":journeyID,"action":result["action"] as? String ?? "photo"])
                        }
                    }
                    let nav=UINavigationController(rootViewController:controller)
                    nav.modalPresentationStyle = .fullScreen
                    parent.present(nav,animated:true)
                },for:.touchUpInside)
                map.addSubview(button)
            }
            scroll.bringSubviewToFront(map)
            let coordinator=self.coordinators[id] ?? {
                let created=MapCoordinator(map:map,content:content,controlTop:56,showsLayers:true)
                created.onModeChange={ [weak self] mode,command in self?.reportCamera(id,mode,command) }
                created.onPhotoAction={ [weak self] action,photoID,journeyID in
                    self?.notifyListeners("photoSelected",data:["mapID":id,"photoID":photoID,"journeyID":journeyID,"action":action])
                }
                created.onLayers={ [weak self] in self?.notifyListeners("layersTapped",data:["mapID":id]) }
                self.coordinators[id]=created
                return created
            }()
            coordinator.apply(content)
            // The full-screen map opened from this one shows the same people as they move.
            if self.presentedID==id {self.presentedMap?.update(content)}
            if content.camera == nil {
                // The WebView may mount before account/location restoration finishes.
                // Do not preserve an empty map's default country/world viewport when
                // the first usable positions or the user's initial focus arrive.
                let initialPositions=previousContent?.coordinates.isEmpty ?? true
                let initialFocus=previousContent?.focus == nil && content.focus != nil
                if !content.coordinates.isEmpty && (call.getBool("preserveViewport") != true || initialPositions || initialFocus) {
                    map.setVisibleMapRect(content.rect,edgePadding:UIEdgeInsets(top:38,left:25,bottom:38,right:25),animated:false)
                }
            }
            call.resolve()
        }
    }
    @objc func unembed(_ call:CAPPluginCall) {
        DispatchQueue.main.async {
            if let id=call.getString("mapID"),let map=self.embeddedMaps.removeValue(forKey:id) {
                self.embeddedContent.removeValue(forKey:id)
                self.hiddenMaps.remove(id)
                self.coordinators.removeValue(forKey:id)?.detach()
                map.delegate=nil;map.removeFromSuperview()
            }
            call.resolve()
        }
    }
    @objc func close(_ call:CAPPluginCall) {
        DispatchQueue.main.async {
            if let id=call.getString("mapID"),id==self.presentedID {self.presentedMap?.close();self.presentedMap=nil;self.presentedID=nil}
            call.resolve()
        }
    }
    @objc func open(_ call:CAPPluginCall) {
        DispatchQueue.main.async {
            guard let parent=self.bridge?.viewController,parent.presentedViewController==nil else {call.reject("Close the current screen first");return}
            let controller=AppleMapController(content:MapContent(call.options),picker:call.getBool("picker") ?? false)
            let mapID=call.getString("mapID")
            if let mapID=mapID {controller.onCamera={ [weak self] mode,command in self?.reportCamera(mapID,mode,command) }}
            self.presentedMap=controller;self.presentedID=mapID
            controller.completion={ result in call.resolve(result) }
            let navigation=UINavigationController(rootViewController:controller)
            navigation.modalPresentationStyle = .fullScreen
            parent.present(navigation,animated:true)
        }
    }
}
private class JourneyPin:MKPointAnnotation {
    var metadata:[String:Any]=[:]
    var pinID=""
    // A photo of the Map overview: clustered, and selecting it previews its journey.
    var isOverviewPhoto=false
}
private class AppleMapController:UIViewController,MKMapViewDelegate {
    let content:MapContent
    let picker:Bool
    let map=MKMapView()
    var selected:CLLocationCoordinate2D?
    var completion:(([String:Any])->Void)?
    var onCamera:((FollowMode,Int)->Void)?
    // Where the embedded map was, so the full-screen overview opens on the same view.
    var initialCamera:MKMapCamera?
    private var finished=false
    private var coordinator:MapCoordinator?
    private weak var styles:UISegmentedControl?
    init(content:MapContent,picker:Bool){self.content=content;self.picker=picker;super.init(nibName:nil,bundle:nil)}
    // New positions while the full-screen people map is open.
    func update(_ next:MapContent) {if isViewLoaded {coordinator?.apply(next)}}
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        coordinator?.plan();coordinator?.updateDensity();coordinator?.layoutIndicators()
    }
    required init?(coder:NSCoder){fatalError("init(coder:) unavailable")}
    override func viewDidLoad(){
        super.viewDidLoad();title=picker ? "Choose location" : "Your journey"
        view.backgroundColor = .systemBackground
        map.delegate=self;map.translatesAutoresizingMaskIntoConstraints=false
        if #available(iOS 16.0, *) {map.preferredConfiguration=MKStandardMapConfiguration(elevationStyle:.realistic)} else {map.mapType = .standard}
        map.showsCompass=true;map.showsScale=true
        // A map never starts location recording. Only the recorder requests location access.
        map.showsUserLocation=false
        view.addSubview(map)
        NSLayoutConstraint.activate([map.leadingAnchor.constraint(equalTo:view.leadingAnchor),map.trailingAnchor.constraint(equalTo:view.trailingAnchor),map.topAnchor.constraint(equalTo:view.safeAreaLayoutGuide.topAnchor),map.bottomAnchor.constraint(equalTo:view.safeAreaLayoutGuide.bottomAnchor)])
        navigationItem.leftBarButtonItem=UIBarButtonItem(barButtonSystemItem:.close,target:self,action:#selector(close))
        if picker {navigationItem.rightBarButtonItem=UIBarButtonItem(title:"Use location",style:.done,target:self,action:#selector(confirm));navigationItem.rightBarButtonItem?.isEnabled=false}
        let styles=UISegmentedControl(items:["Map","Satellite"]);styles.selectedSegmentIndex=0;styles.addTarget(self,action:#selector(styleChanged(_:)),for:.valueChanged);styles.translatesAutoresizingMaskIntoConstraints=false;view.addSubview(styles)
        styles.backgroundColor = .secondarySystemBackground
        self.styles=styles
        NSLayoutConstraint.activate([styles.centerXAnchor.constraint(equalTo:view.centerXAnchor),styles.topAnchor.constraint(equalTo:map.topAnchor,constant:16),styles.widthAnchor.constraint(equalToConstant:220),styles.heightAnchor.constraint(equalToConstant:36)])
        if picker {
            let tap=UITapGestureRecognizer(target:self,action:#selector(pick(_:)));tap.numberOfTapsRequired=1;map.addGestureRecognizer(tap)
            let hint=UILabel();hint.text="Tap the map to place your pin";hint.font = .preferredFont(forTextStyle:.subheadline);hint.textAlignment = .center;hint.backgroundColor = .secondarySystemBackground;hint.layer.cornerRadius=14;hint.clipsToBounds=true;hint.translatesAutoresizingMaskIntoConstraints=false;view.addSubview(hint)
            NSLayoutConstraint.activate([hint.centerXAnchor.constraint(equalTo:view.centerXAnchor),hint.bottomAnchor.constraint(equalTo:map.bottomAnchor,constant:-24),hint.widthAnchor.constraint(equalToConstant:280),hint.heightAnchor.constraint(equalToConstant:40)])
        }
        if !picker && (content.camera != nil || content.overview != nil) {
            // The people map and the route overview: same annotations, density,
            // photos, camera, edge avatars and controls as the embedded map,
            // continuing from its camera and mode.
            let coordinator=MapCoordinator(map:map,content:content,controlTop:60)
            coordinator.exclusions={ [weak self] in
                guard let self=self,let styles=self.styles else {return []}
                return [self.view.convert(styles.frame,to:self.map).insetBy(dx:-6,dy:-6)]
            }
            coordinator.onModeChange={ [weak self] mode,command in self?.onCamera?(mode,command) }
            coordinator.onPhotoAction={ [weak self] action,photoID,journeyID in self?.finish(["photoID":photoID,"journeyID":journeyID,"action":action]) }
            self.coordinator=coordinator
            if content.camera == nil {
                if let camera=initialCamera {map.setCamera(camera,animated:false)}
                else if !content.coordinates.isEmpty {map.setVisibleMapRect(content.rect,edgePadding:UIEdgeInsets(top:80,left:35,bottom:80,right:35),animated:false)}
            }
            coordinator.apply(content)
            return
        }
        for segment in content.routes where segment.count>1 {
            // Use the same complete coordinate sequence as the preview; draw above labels
            // to prevent Apple Maps road styling from obscuring portions of sparse routes.
            map.addOverlay(MKPolyline(coordinates:segment,count:segment.count),level:.aboveLabels)
        }
        for gap in content.gaps {
            map.addOverlay(GapPolyline(coordinates:gap,count:gap.count),level:.aboveLabels)
        }
        for metadata in content.pins {
            guard let c=coordinate(metadata["point"]) else {continue}
            let pin=JourneyPin();pin.coordinate=c;pin.title=metadata["title"] as? String;pin.subtitle=metadata["subtitle"] as? String;pin.metadata=metadata;map.addAnnotation(pin)
            if let r=metadata["radius"] as? Double,r.isFinite,r>0 {map.addOverlay(MKCircle(center:c,radius:min(r,100000)))}
            if picker {selected=c;navigationItem.rightBarButtonItem?.isEnabled=true}
        }
        if !content.coordinates.isEmpty {map.setVisibleMapRect(content.rect,edgePadding:UIEdgeInsets(top:80,left:35,bottom:80,right:35),animated:false)}
        else {map.setRegion(MKCoordinateRegion(center:CLLocationCoordinate2D(latitude:0,longitude:0),span:MKCoordinateSpan(latitudeDelta:140,longitudeDelta:300)),animated:false)}
    }
    override func viewDidDisappear(_ animated:Bool){super.viewDidDisappear(animated);coordinator?.remember();if !finished {finished=true;completion?(["cancelled":true])};coordinator?.detach();map.delegate=nil}
    private func finish(_ result:[String:Any]) {guard !finished else{return};finished=true;coordinator?.remember();dismiss(animated:true){self.completion?(result)}}
    func mapView(_ mapView:MKMapView,regionDidChangeAnimated animated:Bool) {coordinator?.regionDidChange()}
    func mapViewDidChangeVisibleRegion(_ mapView:MKMapView) {coordinator?.layoutIndicators()}
    @objc func close(){finish(["cancelled":true])}
    @objc func confirm(){if let c=selected {finish(["latitude":c.latitude,"longitude":c.longitude])}}
    @objc func styleChanged(_ sender:UISegmentedControl){if #available(iOS 16.0, *) {map.preferredConfiguration=sender.selectedSegmentIndex==0 ? MKStandardMapConfiguration(elevationStyle:.realistic) : MKHybridMapConfiguration(elevationStyle:.realistic)} else {map.mapType=sender.selectedSegmentIndex==0 ? .standard : .hybrid}}
    @objc func pick(_ sender:UITapGestureRecognizer){
        let p=sender.location(in:map)
        // Ignore controls and annotation taps; only bare-map taps reposition a place.
        if let touched=map.hitTest(p,with:nil),touched is UIControl{return}
        selected=map.convert(p,toCoordinateFrom:map)
        map.removeAnnotations(map.annotations);map.removeOverlays(map.overlays)
        if let c=selected {
            let pin=JourneyPin();pin.coordinate=c;pin.title="Selected location";map.addAnnotation(pin)
            if let radius=content.pins.first?["radius"] as? Double,radius.isFinite,radius>0 {map.addOverlay(MKCircle(center:c,radius:min(radius,100000)))}
        }
        navigationItem.rightBarButtonItem?.isEnabled=true
    }
    func mapView(_ mapView:MKMapView,rendererFor overlay:MKOverlay)->MKOverlayRenderer {
        if let lines=overlay as? DensityLines {return densityRenderer(lines,dimmed:coordinator?.densityDimmed ?? false)}
        if let line=overlay as? HighlightLine {return highlightRenderer(line)}
        if let gap=overlay as? GapPolyline {let renderer=MKPolylineRenderer(polyline:gap);renderer.strokeColor=gapColor;renderer.lineWidth=4;renderer.lineCap = .round;renderer.lineDashPattern=[6,6];return renderer}
        if let line=overlay as? MKPolyline {let renderer=MKPolylineRenderer(polyline:line);renderer.strokeColor=routeColor;renderer.lineWidth=5;renderer.lineCap = .round;renderer.lineJoin = .round;return renderer}
        if let circle=overlay as? MKCircle {let renderer=MKCircleRenderer(circle:circle);renderer.strokeColor = .systemBlue;renderer.fillColor=UIColor.systemBlue.withAlphaComponent(0.12);renderer.lineWidth=1;return renderer}
        return MKOverlayRenderer(overlay:overlay)
    }
    func mapView(_ mapView:MKMapView,viewFor annotation:MKAnnotation)->MKAnnotationView? {
        if let view=overviewAnnotationView(mapView,annotation) {return view}
        guard let pin=annotation as? JourneyPin else{return nil}
        let kind=pin.metadata["kind"] as? String
        if kind=="people" {return peopleAnnotationView(mapView,pin)}
        if kind=="friend-live" {
            let view=MKAnnotationView(annotation:pin,reuseIdentifier:nil)
            view.image=friendInitialBubble((pin.title ?? "F").components(separatedBy:" · ").first ?? "F")
            view.centerOffset=CGPoint(x:0,y:-22)
            view.canShowCallout=true
            view.displayPriority = .required
            return view
        }
        if kind=="family-live" {
            let marker=MKMarkerAnnotationView(annotation:pin,reuseIdentifier:nil)
            marker.markerTintColor = .systemPurple
            marker.glyphImage=UIImage(systemName:"person.crop.circle.fill")
            marker.canShowCallout=true
            return marker
        }
        if kind=="home-presence" {
            let view=MKAnnotationView(annotation:pin,reuseIdentifier:nil)
            view.image=homeMarkerArtwork() ?? UIImage(systemName:"house.fill")
            view.centerOffset=CGPoint(x:0,y:-18)
            view.canShowCallout=true
            return view
        }
        if kind=="photo",let photoID=pin.metadata["photoID"] as? String,
           let thumbnail=journalPhotoThumbnail(photoID,size:52) {
            let view=MKAnnotationView(annotation:pin,reuseIdentifier:nil)
            view.image=thumbnail;view.centerOffset=CGPoint(x:0,y:-24)
            view.canShowCallout=true
            view.rightCalloutAccessoryView=UIButton(type:.detailDisclosure)
            return view
        }
        let marker=MKMarkerAnnotationView(annotation:pin,reuseIdentifier:nil);marker.canShowCallout=true
        marker.markerTintColor=kind=="location" ? .systemBlue : routeColor
        marker.glyphImage=UIImage(systemName:kind=="photo" ? "photo" : "mappin")
        if kind=="start" || kind=="finish" {marker.markerTintColor = kind=="start" ? .systemGreen : .systemRed;marker.glyphImage=nil;marker.glyphText=kind=="start" ? "S" : "F";marker.displayPriority = .required}
        if kind=="photo" {marker.rightCalloutAccessoryView=UIButton(type:.detailDisclosure)}
        return marker
    }
    func mapView(_ mapView:MKMapView,didDeselect view:MKAnnotationView) {coordinator?.deselected(view.annotation)}
    func mapView(_ mapView:MKMapView,didSelect view:MKAnnotationView) {
        if let cluster=view.annotation as? MKClusterAnnotation {coordinator?.open(cluster:cluster);return}
        if let pin=view.annotation as? JourneyPin,pin.isOverviewPhoto {coordinator?.select(photo:pin);return}
        guard !picker,let pin=view.annotation as? JourneyPin,
              (pin.metadata["kind"] as? String)=="photo",
              let photo=pin.metadata["photoID"] as? String,
              let journey=pin.metadata["journeyID"] as? String else{return}
        finish(["photoID":photo,"journeyID":journey])
    }
    func mapView(_ mapView:MKMapView,annotationView view:MKAnnotationView,calloutAccessoryControlTapped control:UIControl){
        guard let pin=view.annotation as? JourneyPin,let photo=pin.metadata["photoID"] as? String,let journey=pin.metadata["journeyID"] as? String else{return}
        finish(["photoID":photo,"journeyID":journey])
    }
}

extension AppleMapsPlugin: MKMapViewDelegate {
    private func reportPhotoSelection(_ mapView:MKMapView,_ annotation:MKAnnotation?) {
        guard let pin=annotation as? JourneyPin,!pin.isOverviewPhoto,
              (pin.metadata["kind"] as? String)=="photo",
              let photoID=pin.metadata["photoID"] as? String,
              let journeyID=pin.metadata["journeyID"] as? String else {return}
        var data:[String:Any]=["photoID":photoID,"journeyID":journeyID,"action":"photo"]
        if let id=mapID(for:mapView) {data["mapID"]=id}
        notifyListeners("photoSelected",data:data)
    }
    public func mapView(_ mapView:MKMapView,didSelect view:MKAnnotationView) {
        if let cluster=view.annotation as? MKClusterAnnotation {coordinator(for:mapView)?.open(cluster:cluster);return}
        if let pin=view.annotation as? JourneyPin,pin.isOverviewPhoto {coordinator(for:mapView)?.select(photo:pin);return}
        reportPhotoSelection(mapView,view.annotation)
    }
    public func mapView(_ mapView:MKMapView,didDeselect view:MKAnnotationView) {
        coordinator(for:mapView)?.deselected(view.annotation)
    }
    public func mapView(_ mapView:MKMapView,regionDidChangeAnimated animated:Bool) {
        coordinator(for:mapView)?.regionDidChange()
    }
    // Called for every frame of a pan, pinch or camera animation, so edge avatars
    // track the map smoothly.
    public func mapViewDidChangeVisibleRegion(_ mapView:MKMapView) {
        coordinator(for:mapView)?.layoutIndicators()
    }
    public func mapView(_ mapView:MKMapView,annotationView view:MKAnnotationView,calloutAccessoryControlTapped control:UIControl) {
        reportPhotoSelection(mapView,view.annotation)
    }
    public func mapView(_ mapView:MKMapView,viewFor annotation:MKAnnotation)->MKAnnotationView? {
        if let view=overviewAnnotationView(mapView,annotation) {return view}
        guard let pin=annotation as? JourneyPin else{return nil}
        let kind=pin.metadata["kind"] as? String ?? ""
        if kind=="people" {return peopleAnnotationView(mapView,pin)}
        let marker=MKMarkerAnnotationView(annotation:pin,reuseIdentifier:nil)
        marker.canShowCallout=true
        if kind=="friend-live" {
            let view=MKAnnotationView(annotation:pin,reuseIdentifier:nil)
            view.image=friendInitialBubble((pin.title ?? "F").components(separatedBy:" · ").first ?? "F")
            view.centerOffset=CGPoint(x:0,y:-22)
            view.canShowCallout=true
            view.displayPriority = .required
            return view
        }
        if kind=="start" || kind=="finish" {
            marker.markerTintColor=kind=="start" ? .systemGreen : .systemRed
            marker.glyphText=kind=="start" ? "S" : "F"
            marker.displayPriority = .required
        } else if kind=="photo" {
            if let photoID=pin.metadata["photoID"] as? String,
               let thumbnail=journalPhotoThumbnail(photoID,size:52) {
                let view=MKAnnotationView(annotation:pin,reuseIdentifier:nil)
                view.image=thumbnail
                view.centerOffset=CGPoint(x:0,y:-24)
                view.canShowCallout=true
                view.displayPriority = .required
                view.rightCalloutAccessoryView=UIButton(type:.detailDisclosure)
                return view
            }
            marker.markerTintColor = .systemOrange
            marker.glyphImage=UIImage(systemName:"photo")
        } else if kind=="home-presence" {
            let view=MKAnnotationView(annotation:pin,reuseIdentifier:nil)
            view.image=homeMarkerArtwork() ?? UIImage(systemName:"house.fill")
            view.centerOffset=CGPoint(x:0,y:-18)
            view.canShowCallout=true
            return view
        } else {
            marker.markerTintColor = .systemBlue
        }
        return marker
    }
    public func mapView(_ mapView:MKMapView,rendererFor overlay:MKOverlay)->MKOverlayRenderer {
        if let lines=overlay as? DensityLines {return densityRenderer(lines,dimmed:coordinator(for:mapView)?.densityDimmed ?? false)}
        if let line=overlay as? HighlightLine {return highlightRenderer(line)}
        if let gap=overlay as? GapPolyline {
            let renderer=MKPolylineRenderer(polyline:gap)
            renderer.strokeColor=gapColor;renderer.lineWidth=4;renderer.lineCap = .round;renderer.lineDashPattern=[6,6]
            return renderer
        }
        if let route=overlay as? MKPolyline {
            let renderer=MKPolylineRenderer(polyline:route)
            renderer.strokeColor=routeColor;renderer.lineWidth=4;renderer.lineCap = .round
            return renderer
        }
        // Accuracy of the signed-in user's position (and saved-place radii).
        if let circle=overlay as? MKCircle {
            let renderer=MKCircleRenderer(circle:circle)
            renderer.strokeColor=UIColor.systemBlue.withAlphaComponent(0.6);renderer.fillColor=UIColor.systemBlue.withAlphaComponent(0.1);renderer.lineWidth=1
            return renderer
        }
        return MKOverlayRenderer(overlay:overlay)
    }
}
