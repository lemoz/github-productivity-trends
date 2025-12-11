"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import {
  AI_MILESTONES,
  MILESTONE_COLORS,
  type AIMilestone,
} from "@/config/ai-milestones";
import type { TimeSeriesDataPoint } from "@/types/metrics";

interface TrendLineChartProps {
  data: TimeSeriesDataPoint[];
  dataKey?: string;
  title: string;
  color?: string;
  yAxisLabel?: string;
  showMilestones?: boolean;
  majorMilestonesOnly?: boolean;
  height?: number;
  valueFormatter?: (value: number) => string;
}

export function TrendLineChart({
  data,
  title,
  color = "#3b82f6",
  yAxisLabel,
  showMilestones = true,
  majorMilestonesOnly = true,
  height = 400,
  valueFormatter = (v) => v.toLocaleString(),
}: TrendLineChartProps) {
  // Get date range from data
  const dateRange = useMemo(() => {
    if (!data.length) return { min: new Date(), max: new Date() };
    const dates = data.map((d) => new Date(d.date));
    return {
      min: new Date(Math.min(...dates.map((d) => d.getTime()))),
      max: new Date(Math.max(...dates.map((d) => d.getTime()))),
    };
  }, [data]);

  // Filter milestones to show and map to nearest month
  const visibleMilestones = useMemo(() => {
    if (!showMilestones) return [];
    return AI_MILESTONES.filter((m) => {
      const mDate = new Date(m.date);
      const inRange = mDate >= dateRange.min && mDate <= dateRange.max;
      return majorMilestonesOnly
        ? inRange && m.significance === "major"
        : inRange;
    }).map((m) => {
      // Convert milestone date to first of month to match data format
      const mDate = new Date(m.date);
      const monthStart = `${mDate.getFullYear()}-${String(mDate.getMonth() + 1).padStart(2, "0")}-01`;
      return { ...m, chartDate: monthStart };
    });
  }, [showMilestones, dateRange, majorMilestonesOnly]);

  // Custom tooltip
  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: string;
  }) => {
    if (!active || !payload?.length || !label) return null;

    const milestone = visibleMilestones.find((m) => m.date === label);

    return (
      <div className="rounded-lg border bg-white p-3 shadow-lg">
        <p className="font-medium text-gray-900">
          {format(parseISO(label), "MMM d, yyyy")}
        </p>
        <p className="text-sm text-gray-600">
          {yAxisLabel || "Value"}: {valueFormatter(payload[0].value as number)}
        </p>
        {milestone && (
          <div className="mt-2 border-t pt-2">
            <p
              className="text-sm font-medium"
              style={{ color: MILESTONE_COLORS[milestone.type] }}
            >
              {milestone.name}
            </p>
            <p className="text-xs text-gray-500">{milestone.description}</p>
          </div>
        )}
      </div>
    );
  };

  if (data.length === 0) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border bg-gray-50">
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h3 className="mb-4 text-lg font-semibold text-gray-900">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={data}
          margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200" />
          <XAxis
            dataKey="date"
            tickFormatter={(date) => format(parseISO(date), "MMM yy")}
            angle={-45}
            textAnchor="end"
            height={60}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            label={
              yAxisLabel
                ? {
                    value: yAxisLabel,
                    angle: -90,
                    position: "insideLeft",
                    style: { textAnchor: "middle" },
                  }
                : undefined
            }
            tick={{ fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />

          {/* Main trend line */}
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 6 }}
            name={yAxisLabel || "Value"}
          />

          {/* AI Milestone markers */}
          {visibleMilestones.map((milestone) => (
            <ReferenceLine
              key={milestone.id}
              x={milestone.chartDate}
              stroke={MILESTONE_COLORS[milestone.type]}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: milestone.shortLabel,
                position: "top",
                fill: MILESTONE_COLORS[milestone.type],
                fontSize: 10,
                angle: -90,
                dx: -5,
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Milestone Legend */}
      {showMilestones && visibleMilestones.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {visibleMilestones.map((milestone) => (
            <div
              key={milestone.id}
              className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1"
            >
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: MILESTONE_COLORS[milestone.type] }}
              />
              <span className="text-gray-700">{milestone.shortLabel}</span>
              <span className="text-gray-400">
                {format(parseISO(milestone.date), "MMM yy")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
