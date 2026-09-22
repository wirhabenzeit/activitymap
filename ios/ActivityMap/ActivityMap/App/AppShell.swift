import SwiftUI

struct AppShell: View {
    @State private var store = ActivityStore()
    @State private var auth = AuthController()
    @State private var showsFilters = false
    @State private var accountDestination: AccountDestination?

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .ignoresSafeArea(edges: store.selectedTab == .map ? .top : [])
                .navigationTitle("ActivityMap")
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
                .task { await auth.restoreSession() }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            Section("Dominik") {
                                Button {
                                    accountDestination = .profile
                                } label: {
                                    Label("Profile", systemImage: "person")
                                }
                            }

                            Button {
                                accountDestination = .settings
                            } label: {
                                Label("Settings", systemImage: "gearshape")
                            }

                            Button {
                                accountDestination = .about
                            } label: {
                                Label("About ActivityMap", systemImage: "info.circle")
                            }
                        } label: {
                            Image(systemName: "person.crop.circle")
                        }
                        .buttonStyle(.glass(.clear))
                        .accessibilityLabel("Account and Settings")
                    }
                    .sharedBackgroundVisibility(.hidden)

                    ToolbarItem(placement: .principal) {
                        modePicker
                    }
                    .sharedBackgroundVisibility(.hidden)

                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            showsFilters.toggle()
                        } label: {
                            Image(systemName: store.activeFilterCount == 0
                                ? "line.3.horizontal.decrease"
                                : "line.3.horizontal.decrease.circle.fill")
                        }
                        .buttonStyle(.glass(.clear))
                        .accessibilityLabel(filterButtonLabel)
                    }
                    .sharedBackgroundVisibility(.hidden)
                }
                .inspector(isPresented: $showsFilters) {
                    NavigationStack {
                        FilterPanel(store: store)
                            .navigationTitle("Filters")
                            .navigationBarTitleDisplayMode(.inline)
                    }
                    .inspectorColumnWidth(min: 300, ideal: 340, max: 400)
                    .presentationDetents([.medium, .large])
                }
                .sheet(item: $accountDestination) { destination in
                    AccountSheet(destination: destination, auth: auth)
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch store.selectedTab {
        case .map: MapScreen(store: store)
        case .list: ListScreen(store: store)
        }
    }

    private var filterButtonLabel: String {
        store.activeFilterCount == 0
            ? "Filters"
            : "Filters, \(store.activeFilterCount) active"
    }

    private var modePicker: some View {
        HStack(spacing: 2) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                Button {
                    store.selectedTab = tab
                } label: {
                    Text(tab.title)
                        .font(.subheadline)
                        .fontWeight(store.selectedTab == tab ? .semibold : .regular)
                        .frame(minWidth: 54)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 7)
                        .background(
                            store.selectedTab == tab ? Color.accentColor.opacity(0.18) : .clear,
                            in: Capsule()
                        )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(store.selectedTab == tab ? .isSelected : [])
            }
        }
        .padding(3)
        .glassEffect(.clear, in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityLabel("View")
    }
}

enum AccountDestination: String, Identifiable {
    case profile
    case settings
    case about

    var id: String { rawValue }
}

#Preview {
    AppShell()
}
