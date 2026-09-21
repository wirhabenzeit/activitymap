import SwiftUI

struct ActivityRowView: View {
    @Bindable var store: ActivityStore
    let activity: Activity

    @State private var showDetail = false

    private var isSelected: Bool { store.selectedActivityIDs.contains(activity.id) }
    private var isHighlighted: Bool { store.highlightedActivityID == activity.id }

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

            VStack(alignment: .leading, spacing: 2) {
                Text(activity.name)
                    .foregroundStyle(isHighlighted ? AppTheme.headerBackground : .primary)
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
                store.highlightedActivityID = activity.id
                store.selectedTab = .map
            } label: {
                Image(systemName: "map")
            }
            .buttonStyle(.plain)

            Button {
                showDetail = true
            } label: {
                Image(systemName: "info.circle")
            }
            .buttonStyle(.plain)
        }
        .contentShape(Rectangle())
        .sheet(isPresented: $showDetail) {
            ActivityDetailView(activity: activity)
        }
    }
}
