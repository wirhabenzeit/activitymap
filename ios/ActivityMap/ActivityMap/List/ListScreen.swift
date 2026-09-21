import SwiftUI

struct ListScreen: View {
    @Bindable var store: ActivityStore

    var body: some View {
        List(store.filteredActivities) { activity in
            ActivityRowView(store: store, activity: activity)
        }
        .listStyle(.plain)
    }
}
