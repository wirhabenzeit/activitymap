import SwiftUI

struct ActivityRowView: View {
    @Bindable var store: ActivityStore
    let activity: Activity

    private var isSelected: Bool { store.selectedActivityIDs.contains(activity.id) }
    private var isActive: Bool { store.activeActivityID == activity.id }
    private var hasGeometry: Bool { !activity.coordinates.isEmpty }

    var body: some View {
        HStack(spacing: 10) {
            Button {
                store.toggleSelection(activity.id)
            } label: {
                Image(systemName: activity.category.symbolName)
                    .foregroundStyle(activity.category.color)
                    .frame(width: 28, height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .strokeBorder(isSelected ? activity.category.color : .clear, lineWidth: 1.5)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isSelected ? "Deselect \(activity.name)" : "Select \(activity.name)")
            .accessibilityAddTraits(isSelected ? .isSelected : [])

            VStack(alignment: .leading, spacing: 2) {
                Text(activity.name)
                    .foregroundStyle(isActive ? AppTheme.headerBackground : .primary)
                    .fontWeight(isActive ? .semibold : .regular)
                    .lineLimit(1)
                Text(Formatters.shortDate(activity.startDate))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(Formatters.distance(activity.distance))
                .font(.caption)
                .foregroundStyle(.secondary)

            Button {
                store.showOnMap(activity.id)
            } label: {
                Image(systemName: hasGeometry ? "map" : "map.slash")
            }
            .buttonStyle(.plain)
            .disabled(!hasGeometry)
            .accessibilityLabel("Show on map")
            .accessibilityHint(hasGeometry ? "" : "This activity has no GPS route.")

            Button {
                store.inspect(activity.id)
            } label: {
                Image(systemName: "info.circle")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Details for \(activity.name)")
        }
        .contentShape(Rectangle())
    }
}
