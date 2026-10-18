import Foundation
import Testing
@testable import ActivityMap

struct StatsCalendarLayoutTests {
    @Test func weekdayColumnsKeepEveryDayExactlyOnceAcrossLeapAndYearBoundaries() {
        for (start, end) in [("2024-02-28", "2024-03-05"), ("2025-12-31", "2026-01-05"),
                             ("1969-12-28", "1970-01-05"), ("2026-10-18", "2026-10-18")] {
            let layout = StatsCalendarLayout(first: StatsDates.day(start), last: StatsDates.day(end), cellSize: 20)
            let days = layout.weeks.flatMap { week in (0..<7).compactMap { layout.day(week: week, row: $0) } }
            #expect(days == Array(layout.first...layout.last))
            for week in layout.weeks {
                #expect(StatsDates.calendar.component(.weekday, from: StatsDates.date(week)) == 2)
                for row in 0..<7 {
                    if let day = layout.day(week: week, row: row) { #expect(day == week + row) }
                }
            }
        }
        #expect(StatsCalendarLayout(first: 1, last: 0, cellSize: 20).weeks.isEmpty)
    }

    @Test func compactWindowAdaptsWithoutMakingCellsNarrowOrStretchingThem() {
        let today = StatsDates.day("2026-09-22")
        let phone = StatsCalendarLayout.summary(today: today, width: 320)
        let wide = StatsCalendarLayout.summary(today: today, width: 560)
        #expect(phone.weeks.count == 14)
        #expect(wide.weeks.count == 26)
        #expect(wide.first < phone.first)
        for width in [160.0, 320, 560, 1600] {
            let layout = StatsCalendarLayout.summary(today: today, width: width)
            #expect(layout.weeks.count <= 52)
            #expect(layout.cellSize >= 14 && layout.cellSize <= 18)
            #expect(Double(layout.weeks.count) * (layout.cellSize + 2) - 2 + 40 <= width)
            #expect(layout.day(week: StatsDates.monday(today), row: today - StatsDates.monday(today)) == today)
            #expect(layout.day(week: StatsDates.monday(today), row: 6) == nil)
        }
        let largeText = StatsCalendarLayout.summary(today: today, width: 320, scaledCell: 42, weekdayWidth: 76)
        #expect(largeText.cellSize == 42 && largeText.weeks.count < phone.weeks.count)
        #expect(Double(largeText.weeks.count) * 44 - 2 + 88 <= 320)
    }

    @Test func expandedHistoryIncludesSparseYearsAndNeverAddsFutureDays() {
        let today = StatsDates.day("2026-09-22")
        let history = StatsCalendarLayout.history(today: today, earliest: StatsDates.day("2020-02-29"))
        #expect(history.first == StatsDates.day("2020-02-29"))
        #expect(history.weeks.count > 300)
        #expect(history.day(week: history.firstWeek, row: 0) == nil)
        #expect(history.last == today)
        #expect(StatsCalendarLayout.history(today: today, earliest: nil).first == StatsDates.previousYear(today))
    }
}
