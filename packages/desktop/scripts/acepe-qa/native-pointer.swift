import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let x = Double(CommandLine.arguments[1]),
      let y = Double(CommandLine.arguments[2]),
      x.isFinite,
      y.isFinite else {
    FileHandle.standardError.write(Data("Expected finite x and y coordinates.\n".utf8))
    exit(64)
}

let point = CGPoint(x: x, y: y)
let warpResult = CGWarpMouseCursorPosition(point)
guard warpResult == .success else {
    FileHandle.standardError.write(Data("Unable to warp the macOS pointer.\n".utf8))
    exit(1)
}
guard let event = CGEvent(
    mouseEventSource: nil,
    mouseType: .mouseMoved,
    mouseCursorPosition: point,
    mouseButton: .left
) else {
    FileHandle.standardError.write(Data("Unable to create a CoreGraphics mouse event.\n".utf8))
    exit(1)
}

event.post(tap: .cghidEventTap)
