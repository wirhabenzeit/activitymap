function decFormatter(unit = '', decimals = 0) {
  return (num: number | undefined) =>
    num == undefined ? null : num.toFixed(decimals) + unit;
}

export const listSettings = {
  defaultState: {
    compact: {
      sorting: [{ id: 'id', desc: true }],
      columnVisibility: {
        select: false,
        id: false,
        time: false,
        sport_type: false,
        moving_time: false,
        average_speed: false,
        elev_high: false,
        elev_low: false,
        weighted_average_watts: false,
        average_watts: false,
        max_watts: false,
        max_heartrate: false,
        kudos_count: false,
        average_heartrate: false,
      },
      summaryRow: false,
    },
    full: {
      sorting: [{ id: 'id', desc: true }],
      columnVisibility: {
        id: false,
        time: false,
        sport_type: false,
        moving_time: false,
        elev_high: false,
        elev_low: false,
        weighted_average_watts: false,
        max_watts: false,
        max_heartrate: false,
        kudos_count: false,
        average_heartrate: false,
      },
      summaryRow: true,
    },
  },
};
