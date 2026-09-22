import SwiftUI

struct SyncStatusView: View {
    let sync: SyncController
    let refresh: () async -> Void

    var body: some View {
        HStack(spacing: 10) {
            if sync.status == .syncing { ProgressView().controlSize(.small) }
            Text(sync.status.title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if sync.session != nil {
                Button {
                    Task { await refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Sync activities")
                .disabled(sync.status == .syncing)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.regularMaterial)
    }
}
