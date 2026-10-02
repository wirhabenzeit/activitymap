import SwiftUI

/// Draft locally while scrubbing; commit on release so large libraries are not
/// filtered on every touch frame. Text entry preserves exact/open-ended bounds.
struct NumericFilterRow: View {
    let title: String
    let icon: String
    let unit: String
    let scale: Double
    @Binding var filter: NumericFilter?
    var suggestedMaximum: Double = 100
    var step: Double = 1
    @State private var minimumText = ""
    @State private var maximumText = ""
    @Environment(\.dynamicTypeSize) private var typeSize

    private var ceiling: Double {
        [suggestedMaximum, (filter?.maximum ?? 0) / scale, (filter?.minimum ?? 0) / scale, step]
            .filter { $0.isFinite && $0 > 0 }.max() ?? 100
    }
    private var dirty: Bool {
        minimumText != (filter?.minimum.map { format($0 / scale) } ?? "")
            || maximumText != (filter?.maximum.map { format($0 / scale) } ?? "")
    }
    private func number(_ text: String) -> Double? {
        if case .valid(let value) = NumericFilterInput.parse(text, scale: 1) { return value }
        return nil
    }
    private var lower: Double { min(ceiling, number(minimumText) ?? 0) }
    private var upper: Double { min(ceiling, number(maximumText) ?? ceiling) }
    private var valid: Bool {
        for text in [minimumText, maximumText] {
            if case .invalid = NumericFilterInput.parse(text, scale: scale) { return false }
        }
        return (number(minimumText) ?? 0) <= (number(maximumText) ?? .infinity)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(title, systemImage: icon).font(.subheadline.weight(.semibold))
                Spacer()
                Text(unit).font(.caption).foregroundStyle(.secondary)
            }
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
            let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading)) : AnyLayout(HStackLayout(spacing: 12))
            layout {
                field("From", text: $minimumText)
                field("To", text: $maximumText)
            }
            HStack {
                Button("Clear") { filter = nil; loadApplied() }
                    .disabled(filter == nil && !dirty)
                    .accessibilityLabel("Clear \(title.lowercased()) range")
                Spacer()
                Button("Apply") { apply() }.disabled(!valid || !dirty)
                    .accessibilityLabel("Apply \(title.lowercased()) range")
            }
            .font(.caption).buttonStyle(.borderless)
            .frame(minHeight: 44)
            if !valid {
                Text("Enter a valid range with From no greater than To. The applied range is unchanged.")
                    .font(.caption).foregroundStyle(.red)
            }
        }
        .onAppear { loadApplied() }
        .onChange(of: filter) { _, _ in loadApplied() }
    }

    private func field(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            TextField("Any", text: text)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
                .frame(minHeight: 44)
                .accessibilityLabel("\(title) \(label.lowercased()) in \(unit)")
                .onSubmit { apply() }
        }
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
            .accessibilityValue((minimum ? minimumText : maximumText).isEmpty ? "No limit" : "\(format(value)) \(unit)")
            .accessibilityAdjustableAction { direction in
                update(minimum: minimum, value: value + (direction == .increment ? step : -step))
                apply()
            }
    }

    private func update(minimum: Bool, value: Double) {
        let snapped = min(ceiling, max(0, (value / step).rounded() * step))
        if minimum {
            let bounded = min(snapped, upper)
            minimumText = bounded == 0 ? "" : format(bounded)
        } else {
            let bounded = max(snapped, lower)
            maximumText = bounded == ceiling ? "" : format(bounded)
        }
    }
    private func format(_ value: Double) -> String {
        value.formatted(.number.grouping(.never).precision(.fractionLength(0...12)))
    }
    private func apply() {
        guard valid else { return }
        if let low = number(minimumText) {
            filter = NumericFilter(value: low * scale, upperLimit: number(maximumText).map { $0 * scale })
        } else if let high = number(maximumText) {
            filter = NumericFilter(operatorType: .lte, value: high * scale)
        } else { filter = nil }
    }
    private func loadApplied() {
        minimumText = filter?.minimum.map { format($0 / scale) } ?? ""
        maximumText = filter?.maximum.map { format($0 / scale) } ?? ""
    }
}
