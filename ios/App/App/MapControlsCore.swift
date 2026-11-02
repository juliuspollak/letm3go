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
