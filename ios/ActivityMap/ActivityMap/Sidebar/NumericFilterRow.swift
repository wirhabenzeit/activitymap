import SwiftUI

/// Draft locally while scrubbing; commit on release so large libraries are not
/// filtered on every touch frame. Endpoints keep the range open-ended.
struct NumericFilterRow: View {
    let title: String
    let icon: String
    let unit: String
    let scale: Double
    @Binding var filter: NumericFilter?
    var suggestedMaximum: Double = 100
    var step: Double = 1
    @State private var minimum: Double?
    @State private var maximum: Double?
    @Environment(\.dynamicTypeSize) private var typeSize

    private var ceiling: Double {
        let extent = max(suggestedMaximum, (filter?.maximum ?? 0) / scale, (filter?.minimum ?? 0) / scale, step)
        let quarter = extent / 4
        let magnitude = pow(10, floor(log10(quarter)))
        let rounded = [1.0, 2, 2.5, 5, 10].first { $0 * magnitude >= quarter } ?? 10
        return rounded * magnitude * 4
    }
    private var lower: Double { min(ceiling, minimum ?? 0) }
    private var upper: Double { min(ceiling, maximum ?? ceiling) }
    private var summary: String {
        switch (minimum, maximum) {
        case let (.some(low), .some(high)): "\(format(low))–\(format(high)) \(unit)"
        case let (.some(low), nil): "≥\(format(low)) \(unit)"
        case let (nil, .some(high)): "≤\(format(high)) \(unit)"
        case (nil, nil): "Any"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2)) : AnyLayout(HStackLayout())
                layout {
                    Label(title, systemImage: icon).font(.subheadline.weight(.semibold))
                    if !typeSize.isAccessibilitySize { Spacer(minLength: 4) }
                    Text(summary).font(.subheadline).foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                if filter != nil {
                    Button { filter = nil; loadApplied() } label: {
                        Image(systemName: "arrow.counterclockwise").font(.caption)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Clear \(title.lowercased()) range")
                }
            }
            .frame(minHeight: 44)
            GeometryReader { geometry in
                let width = max(1, geometry.size.width - 44)
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.2)).frame(height: 4)
                        .padding(.horizontal, 22)
                    Capsule().fill(Color.accentColor).frame(width: max(0, (upper - lower) / ceiling * width), height: 4)
                        .offset(x: 22 + lower / ceiling * width)
                    thumb(minimum: true, width: width)
                    thumb(minimum: false, width: width)
                }
                .frame(height: 44)
                .coordinateSpace(name: title)
            }
            .frame(height: 44)
            GeometryReader { geometry in
                let width = max(1, geometry.size.width - 44)
                ForEach(0..<5) { index in
                    if !typeSize.isAccessibilitySize || index.isMultiple(of: 2) {
                        Rectangle().fill(.secondary.opacity(0.4)).frame(width: 1, height: 4)
                            .offset(x: 22 + CGFloat(index) / 4 * width)
                        let labelWidth = geometry.size.width / (typeSize.isAccessibilitySize ? 3 : 5)
                        Text(format(ceiling * Double(index) / 4) + (index == 4 ? " \(unit)" : ""))
                            .font(.caption2).foregroundStyle(.secondary)
                            .lineLimit(1).minimumScaleFactor(0.75)
                            .frame(width: labelWidth, alignment: index == 0 ? .leading : index == 4 ? .trailing : .center)
                            .offset(x: CGFloat(index) / 4 * (geometry.size.width - labelWidth), y: 6)
                    }
                }
            }
            .frame(height: typeSize.isAccessibilitySize ? 40 : 22)
            .accessibilityHidden(true)
        }
        .onAppear { loadApplied() }
        .onChange(of: filter) { _, _ in loadApplied() }
        .onChange(of: scale) { _, _ in loadApplied() }
    }

    private func thumb(minimum: Bool, width: CGFloat) -> some View {
        let value = minimum ? lower : upper
        return Circle().fill(.background).shadow(color: .black.opacity(0.18), radius: 2, y: 1)
            .overlay { Circle().stroke(Color.accentColor, lineWidth: 2) }
            .frame(width: 24, height: 24)
            .frame(width: 44, height: 44).contentShape(Rectangle())
            .offset(x: value / ceiling * width)
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .named(title))
                .onChanged { event in update(minimum: minimum, value: (event.location.x - 22) / width * ceiling) }
                .onEnded { _ in apply() })
            .accessibilityElement()
            .accessibilityLabel("\(title) \(minimum ? "minimum" : "maximum")")
            .accessibilityValue((minimum ? self.minimum : maximum) == nil ? "No limit" : "\(format(value)) \(unit)")
            .accessibilityAdjustableAction { direction in
                update(minimum: minimum, value: value + (direction == .increment ? step : -step))
                apply()
            }
    }

    private func update(minimum: Bool, value: Double) {
        let snapped = min(ceiling, max(0, (value / step).rounded() * step))
        if minimum {
            let bounded = min(snapped, upper)
            self.minimum = bounded == 0 ? nil : bounded
        } else {
            let bounded = max(snapped, lower)
            maximum = bounded == ceiling ? nil : bounded
        }
    }
    private func format(_ value: Double) -> String {
        value.formatted(.number.grouping(.never).precision(.fractionLength(0...12)))
    }
    private func apply() {
        if let low = minimum {
            filter = NumericFilter(value: low * scale, upperLimit: maximum.map { $0 * scale })
        } else if let high = maximum {
            filter = NumericFilter(operatorType: .lte, value: high * scale)
        } else { filter = nil }
    }
    private func loadApplied() {
        minimum = filter?.minimum.map { $0 / scale }
        maximum = filter?.maximum.map { $0 / scale }
    }
}
