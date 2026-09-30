import SwiftUI

/// A single editor for the active filter panel. Drafts apply only when valid;
/// invalid or unfinished input never changes the last applied restriction.
struct NumericFilterRow: View {
    let title: String
    let icon: String
    let unit: String
    let scale: Double
    @Binding var filter: NumericFilter?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var input = ""
    @State private var operatorType: FilterOperator = .gte

    private var parsed: NumericFilterInput { NumericFilterInput.parse(input, scale: scale) }
    private var invalid: Bool {
        if case .invalid = parsed { return true }
        return false
    }
    private var appliedLabel: String {
        guard let filter else { return "Any" }
        let number = (filter.value / scale).formatted(.number.grouping(.never).precision(.fractionLength(0...12)))
        return "\(filter.operatorType.rawValue) \(number) \(unit)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon)
            if dynamicTypeSize.isAccessibilitySize {
                comparison
                valueField
                appliedStatus
                actions
            } else {
                HStack { comparison; valueField }
                HStack { appliedStatus; Spacer(); actions }
            }
            if invalid {
                Text("Enter a nonnegative decimal in \(unit), or clear this filter. The applied filter is unchanged.")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .onAppear { loadApplied() }
        .onChange(of: filter) { _, _ in loadApplied() }
    }

    private var appliedStatus: some View {
        Text("Applied: \(appliedLabel)")
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    private var actions: some View {
        HStack(spacing: 16) {
            Button("Apply") { apply() }
                .frame(minHeight: 44)
                .disabled(invalid)
                .accessibilityLabel("Apply \(title.lowercased()) filter")
            Button("Clear") {
                filter = nil
                input = ""
                operatorType = .gte
            }
            .frame(minHeight: 44)
            .accessibilityLabel("Clear \(title.lowercased()) filter")
        }
    }

    private var comparison: some View {
        Picker("\(title) comparison", selection: $operatorType) {
            Text("≥").tag(FilterOperator.gte)
            Text("≤").tag(FilterOperator.lte)
        }
        .pickerStyle(.segmented)
        .frame(minWidth: 100, maxWidth: 160, minHeight: 44)
        .accessibilityHint("Inclusive minimum or maximum")
    }

    private var valueField: some View {
        HStack {
            TextField("Any", text: $input)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(minHeight: 44)
                .accessibilityLabel("\(title) in \(unit)")
                .onSubmit { if !invalid { apply() } }
            Text(unit).foregroundStyle(.secondary)
        }
    }

    private func apply() {
        switch parsed {
        case .empty: filter = nil
        case .valid(let value): filter = NumericFilter(operatorType: operatorType, value: value)
        case .invalid: break
        }
    }

    private func loadApplied() {
        operatorType = filter?.operatorType ?? .gte
        input = filter.map {
            ($0.value / scale).formatted(.number.grouping(.never).precision(.fractionLength(0...12)))
        } ?? ""
    }
}
