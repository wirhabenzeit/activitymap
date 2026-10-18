import Foundation

/// Date-only coordinates and one integer size shared by both cell axes.
/// Week columns always start on Monday; only the boundary weeks are partial.
nonisolated struct StatsCalendarLayout: Equatable, Sendable {
    let first: Int
    let last: Int
    let cellSize: Double

    var firstWeek: Int { StatsDates.monday(first) }
    var weeks: [Int] {
        guard first <= last else { return [] }
        return Array(stride(from: firstWeek, through: StatsDates.monday(last), by: 7))
    }
    func day(week: Int, row: Int) -> Int? {
        let day = week + row
        return (0..<7).contains(row) && day >= first && day <= last ? day : nil
    }
    static func summary(today: Int, width: Double, height: Double = 300,
                        scaledCell: Double? = nil, weekdayWidth: Double = 28) -> Self {
        let cell = scaledCell.map { max(14, $0.rounded()) }
            ?? max(14, min(18, floor((height - 152) / 7) - 2))
        // Weekday label, four-point gutter, and four points at each scroll edge.
        let available = max(0, width - weekdayWidth - 12)
        let count = max(1, min(52, Int(floor((available + 2) / (cell + 2)))))
        return .init(first: StatsDates.monday(today) - (count - 1) * 7, last: today, cellSize: cell)
    }
    static func history(today: Int, earliest: Int?, cellSize: Double = 20) -> Self {
        .init(first: min(StatsDates.previousYear(today), earliest ?? today), last: today, cellSize: cellSize)
    }
}
