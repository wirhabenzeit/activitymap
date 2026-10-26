import SwiftUI
import UIKit

/// The accessory belongs to the text input, so UIKit moves it with the keyboard.
/// Disabling both correction and spelling prevents a second QuickType row.
struct KeyboardPlaceSearchInput<Accessory: View>: UIViewRepresentable {
    @Binding var text: String
    var fontSize: CGFloat
    var accessoryHeight: CGFloat
    var showsAccessory: Bool
    var onSubmit: () -> Void
    var onMoveSuggestion: (Int) -> Void
    var onCancel: () -> Void
    var accessory: Accessory

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> KeyboardSearchTextField {
        let field = KeyboardSearchTextField()
        field.placeholder = "Activity names or places"
        field.accessibilityIdentifier = "activity-name-search"
        field.accessibilityLabel = "Search activity names or choose a place"
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.inlinePredictionType = .no
        field.returnKeyType = .search
        field.tintColor = UIColor(AppTheme.accent)
        field.delegate = context.coordinator
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.addAction(UIAction { [weak coordinator = context.coordinator] action in
            guard let field = action.sender as? UITextField else { return }
            coordinator?.parent.text = field.text ?? ""
        }, for: .editingChanged)
        field.inputAccessoryView = showsAccessory ? context.coordinator.accessoryView : nil
        return field
    }

    func updateUIView(_ field: KeyboardSearchTextField, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        if field.text != text, field.markedTextRange == nil || text.isEmpty { field.text = text }
        if field.font?.pointSize != fontSize { field.font = .systemFont(ofSize: fontSize) }
        field.moveSuggestion = onMoveSuggestion
        field.cancelSearch = onCancel
        coordinator.host.rootView = accessory
        let heightChanged = coordinator.accessoryView.rowHeight != accessoryHeight
        if heightChanged { coordinator.accessoryView.rowHeight = accessoryHeight }
        let accessoryChanged = showsAccessory
            ? field.inputAccessoryView !== coordinator.accessoryView
            : field.inputAccessoryView != nil
        if accessoryChanged { field.inputAccessoryView = showsAccessory ? coordinator.accessoryView : nil }
        if (accessoryChanged || heightChanged), field.isFirstResponder { field.reloadInputViews() }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: KeyboardSearchTextField, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 200, height: max(44, (uiView.font?.lineHeight ?? 20) + 10))
    }

    static func dismantleUIView(_ field: KeyboardSearchTextField, coordinator: Coordinator) {
        field.resignFirstResponder()
        field.inputAccessoryView = nil
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: KeyboardPlaceSearchInput
        let host: UIHostingController<Accessory>
        let accessoryView: KeyboardHintInputView

        init(_ parent: KeyboardPlaceSearchInput) {
            self.parent = parent
            host = UIHostingController(rootView: parent.accessory)
            accessoryView = KeyboardHintInputView(height: parent.accessoryHeight)
            super.init()
            host.view.backgroundColor = .clear
            host.view.clipsToBounds = true
            host.view.translatesAutoresizingMaskIntoConstraints = false
            accessoryView.addSubview(host.view)
            NSLayoutConstraint.activate([
                host.view.leadingAnchor.constraint(equalTo: accessoryView.leadingAnchor),
                host.view.trailingAnchor.constraint(equalTo: accessoryView.trailingAnchor),
                host.view.topAnchor.constraint(equalTo: accessoryView.topAnchor),
                host.view.bottomAnchor.constraint(equalTo: accessoryView.bottomAnchor),
            ])
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            guard textField.markedTextRange == nil else { return true }
            parent.onSubmit()
            return false
        }
    }
}

final class KeyboardHintInputView: UIInputView {
    var rowHeight: CGFloat {
        didSet { invalidateIntrinsicContentSize() }
    }

    init(height: CGFloat) {
        rowHeight = height
        super.init(frame: CGRect(x: 0, y: 0, width: 0, height: height), inputViewStyle: .keyboard)
        allowsSelfSizing = true
        clipsToBounds = true
        autoresizingMask = [.flexibleWidth]
        // The keyboard is wider than the search sheet in phone landscape.
        // An accessory has no sheet backdrop outside that sheet's bounds;
        // draw a continuous surface so hints never float over the activity UI.
        backgroundColor = .secondarySystemBackground
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
    override var intrinsicContentSize: CGSize { CGSize(width: UIView.noIntrinsicMetric, height: rowHeight) }
}

final class KeyboardSearchTextField: UITextField {
    var moveSuggestion: ((Int) -> Void)?
    var cancelSearch: (() -> Void)?
    private var needsInitialFocus = true

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil, needsInitialFocus else { return }
        needsInitialFocus = false
        DispatchQueue.main.async { [weak self] in
            guard let self, self.window != nil else { return }
            self.becomeFirstResponder()
        }
    }

    override var keyCommands: [UIKeyCommand]? {
        guard markedTextRange == nil else { return super.keyCommands }
        let commands = [
            UIKeyCommand(input: UIKeyCommand.inputDownArrow, modifierFlags: [], action: #selector(nextHint)),
            UIKeyCommand(input: UIKeyCommand.inputUpArrow, modifierFlags: [], action: #selector(previousHint)),
            UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(cancel)),
        ]
        commands.forEach { $0.wantsPriorityOverSystemBehavior = true }
        return (super.keyCommands ?? []) + commands
    }

    @objc private func nextHint() { moveSuggestion?(1) }
    @objc private func previousHint() { moveSuggestion?(-1) }
    @objc private func cancel() { cancelSearch?() }
}
