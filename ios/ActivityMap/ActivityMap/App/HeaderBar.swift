import SwiftUI

struct HeaderBar: View {
    @Bindable var store: ActivityStore
    @Binding var colorScheme: ColorScheme?

    var body: some View {
        HStack(spacing: 12) {
            Button {
                withAnimation(.snappy) { store.sidebarExpanded.toggle() }
            } label: {
                Image(systemName: "sidebar.left")
            }

            Rectangle()
                .frame(width: 1, height: 24)
                .opacity(0.4)

            Button {
                store.selectedTab = .map
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "map.fill")
                    Text("ActivityMap")
                        .font(.headline)
                }
            }
            .opacity(store.selectedTab == .map ? 1 : 0.6)

            tabButton("List", tab: .list)
            Spacer()

            Button {
                // Share sheet placeholder for the current view/selection.
            } label: {
                Image(systemName: "square.and.arrow.up")
            }

            Button {
                colorScheme = colorScheme == .dark ? .light : .dark
            } label: {
                Image(systemName: colorScheme == .dark ? "moon.fill" : "sun.max.fill")
            }
        }
        .buttonStyle(.plain)
        .font(.body)
        .foregroundStyle(AppTheme.headerForeground)
        .padding(.horizontal, 12)
        .frame(height: 52)
        .background(AppTheme.headerBackground)
    }

    private func tabButton(_ title: String, tab: AppTab) -> some View {
        Button {
            store.selectedTab = tab
        } label: {
            Text(title)
                .fontWeight(.semibold)
        }
        .opacity(store.selectedTab == tab ? 1 : 0.6)
    }
}
