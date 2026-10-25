import UIKit
import MapKit
import Capacitor

private let routeColor = UIColor { trait in trait.userInterfaceStyle == .dark ? UIColor(red:0.65,green:0.71,blue:1,alpha:1) : UIColor(red:0.275,green:0.35,blue:0.85,alpha:1) }
private func coordinate(_ value: Any?) -> CLLocationCoordinate2D? {
    guard let p=value as? [Double],p.count==2,p.allSatisfy({$0.isFinite}),abs(p[0])<=90,abs(p[1])<=180 else { return nil }
    return CLLocationCoordinate2D(latitude:p[0],longitude:p[1])
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
private struct MapContent {
    let routes: [[CLLocationCoordinate2D]]
    let pins: [[String:Any]]
    init(_ options:[AnyHashable:Any]) {
        routes=(options["routes"] as? [[[Double]]] ?? []).prefix(250).map { Array($0.prefix(5000)).compactMap { coordinate($0) } }.filter { !$0.isEmpty }
        pins=Array((options["pins"] as? [[String:Any]] ?? []).prefix(500)).filter { coordinate($0["point"]) != nil }
    }
    var coordinates:[CLLocationCoordinate2D] { routes.flatMap{$0}+pins.compactMap { coordinate($0["point"]) } }
    var rect:MKMapRect {
        guard !coordinates.isEmpty else { return MKMapRect.world }
        var rect=MKMapRect.null
        for c in coordinates { let p=MKMapPoint(c);rect=rect.union(MKMapRect(x:p.x,y:p.y,width:1,height:1)) }
        let middle=coordinates[coordinates.count/2]
        let minimum=1200*MKMapPointsPerMeterAtLatitude(middle.latitude)
        let width=max(rect.width*1.3,minimum),height=max(rect.height*1.3,minimum)
        return MKMapRect(x:rect.midX-width/2,y:rect.midY-height/2,width:width,height:height)
    }
}
@objc(AppleMapsPlugin)
public class AppleMapsPlugin: CAPPlugin, CAPBridgedPlugin {
    private weak var presentedMap:AppleMapController?
    private var presentedID:String?
    public let identifier="AppleMapsPlugin"
    public let jsName="AppleMaps"
    public let pluginMethods:[CAPPluginMethod]=[CAPPluginMethod(name:"setAppearance",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"snapshot",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"open",returnType:CAPPluginReturnPromise),CAPPluginMethod(name:"close",returnType:CAPPluginReturnPromise)]
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
                    for segment in content.routes where segment.count>1 {
                        let path=UIBezierPath();path.move(to:snapshot.point(for:segment[0]));for c in segment.dropFirst(){path.addLine(to:snapshot.point(for:c))}
                        UIColor.white.setStroke();path.lineWidth=7;path.lineJoinStyle = .round;path.lineCapStyle = .round;path.stroke()
                        (trimPreview ? UIColor.systemGray3 : routeColor).setStroke();path.lineWidth=3.5;path.stroke()
                    }
                    for pin in content.pins {
                        guard let c=coordinate(pin["point"]) else {continue};let p=snapshot.point(for:c)
                        // No image bytes or private file paths are passed into MapKit.
                        if (pin["kind"] as? String)=="photo",
                           let photoID=pin["photoID"] as? String,
                           let thumbnail=journalPhotoThumbnail(photoID,size:38) {
                            thumbnail.draw(in:CGRect(x:p.x-19,y:p.y-19,width:38,height:38))
                            continue
                        }
                        let color=(pin["kind"] as? String)=="location" ? UIColor.systemBlue : routeColor
                        ctx.setFillColor(color.cgColor);ctx.setStrokeColor(UIColor.white.cgColor);ctx.setLineWidth(2)
                        ctx.fillEllipse(in:CGRect(x:p.x-5,y:p.y-5,width:10,height:10));ctx.strokeEllipse(in:CGRect(x:p.x-5,y:p.y-5,width:10,height:10))
                    }
                }
                guard let bytes=image.jpegData(compressionQuality:0.85) else {call.reject("Map preview unavailable");return}
                call.resolve(["image":"data:image/jpeg;base64,"+bytes.base64EncodedString(),"projection":projection])
            }
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
            self.presentedMap=controller;self.presentedID=call.getString("mapID")
            controller.completion={ result in call.resolve(result) }
            let navigation=UINavigationController(rootViewController:controller)
            navigation.modalPresentationStyle = .fullScreen
            parent.present(navigation,animated:true)
        }
    }
}
private class JourneyPin:MKPointAnnotation {
    var metadata:[String:Any]=[:]
}
private class AppleMapController:UIViewController,MKMapViewDelegate {
    let content:MapContent
    let picker:Bool
    let map=MKMapView()
    var selected:CLLocationCoordinate2D?
    var completion:(([String:Any])->Void)?
    private var finished=false
    init(content:MapContent,picker:Bool){self.content=content;self.picker=picker;super.init(nibName:nil,bundle:nil)}
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
        NSLayoutConstraint.activate([styles.centerXAnchor.constraint(equalTo:view.centerXAnchor),styles.topAnchor.constraint(equalTo:map.topAnchor,constant:16),styles.widthAnchor.constraint(equalToConstant:220),styles.heightAnchor.constraint(equalToConstant:36)])
        if picker {
            let tap=UITapGestureRecognizer(target:self,action:#selector(pick(_:)));tap.numberOfTapsRequired=1;map.addGestureRecognizer(tap)
            let hint=UILabel();hint.text="Tap the map to place your pin";hint.font = .preferredFont(forTextStyle:.subheadline);hint.textAlignment = .center;hint.backgroundColor = .secondarySystemBackground;hint.layer.cornerRadius=14;hint.clipsToBounds=true;hint.translatesAutoresizingMaskIntoConstraints=false;view.addSubview(hint)
            NSLayoutConstraint.activate([hint.centerXAnchor.constraint(equalTo:view.centerXAnchor),hint.bottomAnchor.constraint(equalTo:map.bottomAnchor,constant:-24),hint.widthAnchor.constraint(equalToConstant:280),hint.heightAnchor.constraint(equalToConstant:40)])
        }
        for segment in content.routes where segment.count>1 {map.addOverlay(MKPolyline(coordinates:segment,count:segment.count))}
        for metadata in content.pins {
            guard let c=coordinate(metadata["point"]) else {continue}
            let pin=JourneyPin();pin.coordinate=c;pin.title=metadata["title"] as? String;pin.metadata=metadata;map.addAnnotation(pin)
            if let r=metadata["radius"] as? Double,r.isFinite,r>0 {map.addOverlay(MKCircle(center:c,radius:min(r,100000)))}
            if picker {selected=c;navigationItem.rightBarButtonItem?.isEnabled=true}
        }
        if !content.coordinates.isEmpty {map.setVisibleMapRect(content.rect,edgePadding:UIEdgeInsets(top:80,left:35,bottom:80,right:35),animated:false)}
        else {map.setRegion(MKCoordinateRegion(center:CLLocationCoordinate2D(latitude:0,longitude:0),span:MKCoordinateSpan(latitudeDelta:140,longitudeDelta:300)),animated:false)}
    }
    override func viewDidDisappear(_ animated:Bool){super.viewDidDisappear(animated);if !finished {finished=true;completion?(["cancelled":true])};map.delegate=nil}
    private func finish(_ result:[String:Any]) {guard !finished else{return};finished=true;dismiss(animated:true){self.completion?(result)}}
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
        if let line=overlay as? MKPolyline {let renderer=MKPolylineRenderer(polyline:line);renderer.strokeColor=routeColor;renderer.lineWidth=4;renderer.lineCap = .round;return renderer}
        if let circle=overlay as? MKCircle {let renderer=MKCircleRenderer(circle:circle);renderer.strokeColor = .systemBlue;renderer.fillColor=UIColor.systemBlue.withAlphaComponent(0.12);renderer.lineWidth=1;return renderer}
        return MKOverlayRenderer(overlay:overlay)
    }
    func mapView(_ mapView:MKMapView,viewFor annotation:MKAnnotation)->MKAnnotationView? {
        guard let pin=annotation as? JourneyPin else{return nil}
        let kind=pin.metadata["kind"] as? String
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
        marker.glyphImage=UIImage(systemName:kind=="photo" ? "photo" : kind=="finish" ? "flag.checkered" : kind=="start" ? "play.fill" : "mappin")
        if kind=="photo" {marker.rightCalloutAccessoryView=UIButton(type:.detailDisclosure)}
        return marker
    }
    func mapView(_ mapView:MKMapView,annotationView view:MKAnnotationView,calloutAccessoryControlTapped control:UIControl){
        guard let pin=view.annotation as? JourneyPin,let photo=pin.metadata["photoID"] as? String,let journey=pin.metadata["journeyID"] as? String else{return}
        finish(["photoID":photo,"journeyID":journey])
    }
}
