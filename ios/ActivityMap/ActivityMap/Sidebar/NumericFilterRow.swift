import SwiftUI

/// A `>= / <=` numeric filter row, matching the web sidebar's inequality filters
/// (distance, elevation gain, elapsed time). Renders as an icon-only button that
/// opens a popover when collapsed, or inline when the sidebar is expanded.
struct NumericFilterRow: View {
    let icon: String
    let unit: String
    let expanded: Bool
    @Binding var filter: NumericFilter?

    @State private var input: String = ""
    @State private var showPopover = false

    var body: some View {
        if expanded {
            HStack(spacing: 8) {
                operatorButton
                textField
                Text(unit)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(height: 32)
        } else {
            Button {
                showPopover = true
            } label: {
                Image(systemName: icon)
                    .frame(width: 32, height: 32)
            }
            .popover(isPresented: $showPopover) {
                HStack(spacing: 8) {
                    operatorButton
                    textField
                    Text(unit)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding()
                .frame(minWidth: 180)
            }
        }
    }

    private var operatorButton: some View {
        Button {
            let next: FilterOperator = (filter?.operatorType ?? .gte) == .gte ? .lte : .gte
            filter?.operatorType = next
            if filter == nil { filter = NumericFilter(operatorType: next, value: 0) }
        } label: {
            Text((filter?.operatorType ?? .gte).rawValue)
                .font(.caption.monospaced())
                .frame(width: 28, height: 28)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }

    private var textField: some View {
        TextField("0", text: $input)
            #if os(iOS)
            .keyboardType(.decimalPad)
            #endif
            .multilineTextAlignment(.trailing)
            .textFieldStyle(.roundedBorder)
            .onChange(of: input) { _, newValue in
                guard let value = Double(newValue) else {
                    if newValue.isEmpty { filter = nil }
                    return
                }
                filter = NumericFilter(operatorType: filter?.operatorType ?? .gte, value: value)
            }
    }
}
