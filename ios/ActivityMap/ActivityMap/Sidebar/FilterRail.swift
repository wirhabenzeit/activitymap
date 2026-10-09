import SwiftUI

/// The collapsed iPad filter sidebar, as on the web: one icon per filter, marked
/// while active, each opening only that filter in a popover (#354). Narrow
/// enough that 11-inch portrait still fits List and its adjacent detail. The
/// shell's filter button expands it into the full panel.
struct FilterRail: View {
    @Bindable var store: ActivityStore
    var scope: FilterScope
    @State private var open: FilterPart?

    static let width: CGFloat = 52

    private var activeCount: Int { scope == .stats ? store.activeStatsFilterCount : store.activeFilterCount }

    var body: some View {
        ScrollView {
            VStack(spacing: 4) {
                ForEach(FilterPart.available(in: scope)) { item(for: $0) }
                Divider().padding(.horizontal, 12)
                Button { scope.reset(store) } label: {
                    Image(systemName: "arrow.counterclockwise").frame(width: 44, height: 44)
                }
                .disabled(activeCount == 0)
                .accessibilityLabel(scope == .stats ? "Reset Stats activity filters" : "Reset all filters")
            }
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(width: Self.width)
        .frame(maxHeight: .infinity)
        .background(Color(uiColor: .secondarySystemBackground))
        .tint(AppTheme.accent)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Filters")
        .accessibilityIdentifier("filter-rail")
    }

    private func item(for part: FilterPart) -> some View {
        let active = part.isActive(store)
        return Button { open = part } label: {
            Image(systemName: part.symbol)
                .font(.body.weight(active ? .semibold : .regular))
                .foregroundStyle(active ? AppTheme.accent : Color.secondary)
                .frame(width: 44, height: 44)
                .background(active ? AppTheme.accent.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .topTrailing) {
                    if active { Circle().fill(AppTheme.accent).frame(width: 7, height: 7).offset(x: -5, y: 5) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(part.title) filter")
        .accessibilityValue(active ? "Active" : "Any")
        .accessibilityIdentifier("filter-rail-\(part)")
        .popover(isPresented: Binding(get: { open == part }, set: { if !$0 { open = nil } }),
                 arrowEdge: .leading) {
            NavigationStack {
                FilterPanel(store: store, scope: scope, part: part)
                    .navigationTitle(part.title)
                    .navigationBarTitleDisplayMode(.inline)
            }
            .frame(width: 340, height: Self.popoverHeight(part))
            .tint(AppTheme.accent)
            .presentationCompactAdaptation(.popover)
        }
    }

    private static func popoverHeight(_ part: FilterPart) -> CGFloat {
        switch part {
        case .search: 150
        case .sports: 560
        case .dates: 330
        case .distance, .duration, .elevation: 260
        case .details: 300
        }
    }
}
