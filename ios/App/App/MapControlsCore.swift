import CoreGraphics

// Pure layout of the Map page's controls (no UIKit), so it can be tested alone.
struct MapControlFrames:Equatable {
    let filters:CGRect?
    let layers:CGRect
    let expand:CGRect
    // Where the next control may start in the left column: the date bar, then
    // the Following chip.
    let leftColumn:CGFloat
    let compassTop:CGFloat
}

// Filters on the left, Layers on the right, Full screen below Layers. Layers
// keeps its full width: the Filters summary is what gives way on a small screen.
func mapControlFrames(width:CGFloat,top:CGFloat,filtersWidth:CGFloat?,layersWidth:CGFloat,height:CGFloat,inset:CGFloat=12,spacing:CGFloat=8)->MapControlFrames {
    let pill=max(44,height)
    let layers=CGRect(x:width-inset-layersWidth,y:top,width:layersWidth,height:pill)
    let filters=filtersWidth.map {CGRect(x:inset,y:top,width:min($0,max(44,layers.minX-spacing-inset)),height:pill)}
    let expand=CGRect(x:width-inset-44,y:top+pill+spacing,width:44,height:44)
    return MapControlFrames(filters:filters,layers:layers,expand:expand,leftColumn:top+pill+spacing,compassTop:expand.maxY+spacing)
}

// Wraps chips into rows so every choice is visible, with no hidden horizontal scroll.
func wrapMapChips(_ sizes:[CGSize],available:CGFloat,spacing:CGFloat=6)->(frames:[CGRect],height:CGFloat) {
    var frames:[CGRect]=[]
    var x:CGFloat=0,y:CGFloat=0,row:CGFloat=0
    for size in sizes {
        let width=min(available,size.width)
        if x>0 && x+width>available {x=0;y+=row+spacing;row=0}
        frames.append(CGRect(x:x,y:y,width:width,height:size.height))
        x+=width+spacing;row=max(row,size.height)
    }
    return (frames,y+row)
}

// Who receives a touch that lands on the Activity Details screen. The native map
// sits behind the web content, so this is decided at touch-down, before UIKit picks
// a view; the sheet and the map then each run their own gestures undisturbed.
enum MapTouchOwner:Equatable {case map,web}
struct MapTouchBoundary:Equatable {
    // Viewport points above the sheet's top edge.
    var height:CGFloat
    // The sheet is being dragged or animated, so height may be slightly old.
    var moving=false
    // A flick moves about this far between two reports. While the sheet moves the
    // doubt falls to the sheet: a late map touch is lost, a sheet touch never is.
    static let movingGuard:CGFloat=96
    // SwipeBack listens for touches starting here, as on every other detail page.
    static let backSwipeEdge:CGFloat=32
    // active is the surface already holding a finger: every later finger joins it,
    // so a pinch can cross the sheet's edge and a sheet drag stays exclusive.
    func owner(x:CGFloat,y:CGFloat,active:MapTouchOwner?)->MapTouchOwner {
        if let active=active {return active}
        if x<=Self.backSwipeEdge {return .web}
        return y<height-(moving ? Self.movingGuard : 0) ? .map : .web
    }
}
