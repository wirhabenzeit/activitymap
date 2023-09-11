const TypePie = () => {
  const statsContext = useContext(StatsContext);
  const values = pieSettings.values;
  const groups = pieSettings.groups;
  const timeGroups = pieSettings.timeGroups;

  return (
    <>
      <TitleBox>
        <Typography variant="h6" key="title">
          Sport
        </Typography>
        <CustomSelect
          key="value"
          propName="value"
          value={statsContext.pie.value}
          name="Value"
          options={values}
          setState={statsContext.setPie}
        />
        <CustomSelect
          key="group"
          propName="group"
          value={statsContext.pie.group}
          name="Sport"
          options={groups}
          setState={statsContext.setPie}
        />
        <CustomPicker
          key="timeGroup"
          propName="timeGroup"
          options={timeGroups}
          value={statsContext.pie.timeGroup}
          range={[2014, 2023]}
          setState={statsContext.setPie}
        />
      </TitleBox>
      {!statsContext.pie.loaded && (
        <Skeleton
          variant="rounded"
          width="90%"
          height="80%"
          sx={{ margin: "auto" }}
        />
      )}
      {statsContext.pie.loaded && (
        <ResponsivePie
          data={statsContext.pie.data}
          margin={{ top: 40, right: 120, bottom: 100, left: 120 }}
          innerRadius={0.6}
          padAngle={0.7}
          cornerRadius={5}
          activeOuterRadiusOffset={8}
          borderWidth={0}
          arcLinkLabelsSkipAngle={10}
          arcLinkLabelsThickness={2}
          arcLinkLabelsColor={{ from: "color" }}
          arcLabelsSkipAngle={20}
          tooltip={({ datum }) => (
            <ChipTooltip
              color={datum.color}
              textRight={datum.formattedValue}
              textLeft={datum.label}
              icon="hiking"
            />
          )}
          colors={(d) => d.data.color}
          valueFormat={statsContext.pie.value.format}
        />
      )}
    </>
  );
};

function YearlySummary() {
  const statsContext = useContext(StatsContext);
  const theme = useTheme();

  const lineDict = d3.rollup(
    statsContext.timeline.data,
    (v) => v[0],
    (d) => d.id
  );
  const groups = timelineSettings.groups;
  const timePeriods = timelineSettings.timePeriods;
  const timeGroups = timelineSettings.timeGroups;
  const values = timelineSettings.values;
  const stats = timelineSettings.stats(statsContext.timeline);
  const years =
    statsContext.data && statsContext.data.length > 0
      ? d3.extent(statsContext.data, (d) => d.date).map((d) => d.getFullYear())
      : [undefined, undefined];

  const LineTooltip = ({ point }) => {
    const lineProps = lineDict.get(point.serieId);
    return (
      <ChipTooltip
        color={lineProps.color}
        icon={lineProps.icon}
        textRight={lineProps.yLabel(point.data.yFormatted)}
        textLeft={lineProps.xLabel(point.data.xFormatted)}
      />
    );
  };

  return (
    <>
      <TitleBox>
        <Typography variant="h6" key="heading">
          Timeline
        </Typography>
        <CustomSelect
          key="timePeriod"
          propName="timePeriod"
          value={statsContext.timeline.timePeriod}
          name="Axis"
          options={timePeriods}
          setState={statsContext.setTimeline}
          headers={[
            { title: "Absolute", filter: (opt) => !opt.relative },
            { title: "Relative", filter: (opt) => opt.relative },
          ]}
        />
        <CustomSelect
          key="group"
          propName="group"
          value={statsContext.timeline.group}
          name="Sport"
          options={groups}
          setState={statsContext.setTimeline}
        />
        <CustomPicker
          key="timeGroup"
          propName="timeGroup"
          options={timeGroups}
          value={statsContext.timeline.timeGroup}
          range={years}
          disabled={!statsContext.timeline.timePeriod.relative}
          setState={statsContext.setTimeline}
        />
        <CustomSelect
          key="stat"
          propName="stat"
          value={statsContext.timeline.stat}
          name="Stat"
          options={stats}
          setState={statsContext.setTimeline}
        />
        <CustomSelect
          key="value"
          propName="value"
          value={statsContext.timeline.value}
          name="Value"
          options={values}
          setState={statsContext.setTimeline}
          disabled={["count", "cumCount"].includes(
            statsContext.timeline.stat.id
          )}
        />
      </TitleBox>
      {!statsContext.timeline.loaded && (
        <Skeleton
          variant="rounded"
          width="90%"
          height="80%"
          sx={{ margin: "auto" }}
        />
      )}
      {statsContext.timeline.loaded && (
        <ResponsiveLine
          animate
          margin={{ top: 10, right: 20, bottom: 100, left: 40 }}
          curve="monotoneX"
          useMesh={true}
          isInteractive={true}
          data={statsContext.timeline.data}
          tooltip={({ point }) => <LineTooltip point={point} />}
          enablePoints={statsContext.timeline.timePeriod.enablePoints}
          yFormat={statsContext.timeline.stat.format}
          xScale={{
            type: "time",
            format: "%Y-%m-%d",
            useUTC: false,
            precision: "day",
          }}
          xFormat="time:%Y-%m-%d"
          axisBottom={{
            tickPadding: 5,
            tickRotation: 0,
            format: statsContext.timeline.timePeriod.format,
            tickValues: 6,
          }}
          axisLeft={{
            tickPadding: 5,
            tickRotation: 0,
            legend: statsContext.timeline.stat.unit,
            format: statsContext.timeline.stat.format,
            tickValues: 5,
          }}
          colors={(d) => addAlpha(d.color, lineDict.get(d.id).alpha)}
          onClick={(d) => lineDict.get(d.serieId).onClick()}
        />
      )}
    </>
  );
}

const ActivityCalendar = () => {
  const statsContext = useContext(StatsContext);
  const values = calendarSettings.values;
  const theme = useTheme();

  return (
    <>
      <TitleBox>
        <Typography variant="h6" key="heading">
          Calendar
        </Typography>
        <CustomSelect
          key="value"
          propName="value"
          value={statsContext.calendar.value}
          name="Value"
          options={values}
          setState={statsContext.setCalendar}
        />
      </TitleBox>
      {statsContext.calendar.data && statsContext.calendar.data.length > 0 && (
        <Box
          sx={{
            height: 140,
            width: 1,
            overflowX: "auto",
            overflowY: "hidden",
            whiteSpace: "noWrap",
          }}
        >
          <ResponsiveTimeRange
            margin={{ top: 40, right: 10, bottom: 10, left: 30 }}
            data={statsContext.calendar.data}
            from={statsContext.calendar.extent[0].toISOString().slice(0, 10)}
            to={statsContext.calendar.extent[1].toISOString().slice(0, 10)}
            emptyColor="#eeeeee"
            colorScale={statsContext.calendar.colorScaleFn([
              "#eeeeee",
              "#61cdbb",
              "#97e3d5",
              "#e8c1a0",
              "#f47560",
              "#000000",
            ])}
            width={
              d3t.timeDay.count(...statsContext.calendar.extent) * 1.8 + 100
            }
            yearSpacing={40}
            dayRadius={4}
            weekdayTicks={[0, 2, 4, 6]}
            monthLegend={(year, month, date) =>
              date.getMonth() % 3 == 0 ? d3tf.timeFormat("%b %Y")(date) : ""
            }
            monthBorderColor="#ffffff"
            dayBorderWidth={2}
            dayBorderColor="#ffffff"
            onClick={statsContext.calendar.onClick}
            tooltip={({ day, color, value }) => (
              <ChipTooltip
                color={color}
                icon="calendar-days"
                textRight={
                  value !== "selected"
                    ? statsContext.calendar.value.format(value)
                    : statsContext.calendar.activitiesByDate
                        .get(day)
                        .map((act) => act.name)
                        .join(", ")
                }
                textLeft={d3tf.timeFormat("%a, %b %d")(new Date(day))}
              />
            )}
          />
        </Box>
      )}
    </>
  );
};
