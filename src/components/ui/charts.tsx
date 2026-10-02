"use client";
import * as React from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import { Card, CardBody, CardHeader } from "./primitives";
import { EmptyState } from "./empty";

export const PALETTE = ["#2F7D63", "#B08D45", "#4C7A93", "#B5483E", "#7E8744", "#6FA39C", "#C9895C", "#7A817C"];
const axis = { stroke: "rgb(var(--border))" };
const tick = { fill: "rgb(var(--muted-foreground))", fontSize: 12 };

interface Series {
  key: string;
  label: string;
  color?: string;
}

function TooltipBox({ active, payload, label, fmt, labelFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 text-xs shadow-pop">
      <p className="mb-1 font-medium">{labelFmt ? labelFmt(label) : label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey ?? p.name} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium tabular">{fmt ? fmt(p.value, p.dataKey) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Wrapper providing title, unit, empty state and an accessible text alternative (screen-reader data table). */
export function ChartCard({ title, description, unit, empty, loading, data, columns, children, height = 260, action }: { title: string; description?: string; unit?: string; empty?: string; loading?: boolean; data: any[]; columns: { key: string; label: string; fmt?: (v: any) => string }[]; children: React.ReactNode; height?: number; action?: React.ReactNode }) {
  const summary = data.length ? `${title}${unit ? ` (${unit})` : ""}. ${data.length} data points.` : `${title}: no data`;
  return (
    <Card>
      <CardHeader title={title} description={description ? `${description}${unit ? ` · ${unit}` : ""}` : unit} action={action} />
      <CardBody>
        {loading ? (
          <div className="skeleton w-full" style={{ height }} aria-hidden />
        ) : data.length === 0 ? (
          <EmptyState className="py-8" icon={<BarChart3 className="h-5 w-5" />} title={empty ?? "No data for this period"} description="Charts appear once there is recorded data in the selected range." />
        ) : (
          <figure aria-label={summary} role="group" className="m-0">
            <div style={{ height }} aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                {children as any}
              </ResponsiveContainer>
            </div>
            <figcaption className="sr-only">
              <table>
                <caption>{summary}</caption>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 60).map((r, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c.key}>{c.fmt ? c.fmt(r[c.key]) : String(r[c.key] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </figcaption>
          </figure>
        )}
      </CardBody>
    </Card>
  );
}

export function StackedBars({ data, xKey, series, fmt, xFmt }: { data: any[]; xKey: string; series: Series[]; fmt?: (v: number) => string; xFmt?: (v: any) => string }) {
  return (
    <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
      <CartesianGrid vertical={false} strokeDasharray="3 3" {...axis} />
      <XAxis dataKey={xKey} tick={tick} tickLine={false} axisLine={axis} tickFormatter={xFmt} interval="preserveStartEnd" minTickGap={12} />
      <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={(v) => (fmt ? fmt(v).replace(/\.00$/, "") : String(v))} width={56} />
      <Tooltip content={<TooltipBox fmt={fmt} labelFmt={xFmt} />} cursor={{ fill: "rgb(var(--muted) / 0.5)" }} />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
      {series.map((s, i) => (
        <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color ?? PALETTE[i % PALETTE.length]} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={36} />
      ))}
    </BarChart>
  );
}

export function Lines({ data, xKey, series, fmt, xFmt, area }: { data: any[]; xKey: string; series: Series[]; fmt?: (v: number, k?: string) => string; xFmt?: (v: any) => string; area?: boolean }) {
  const Chart: any = area ? AreaChart : LineChart;
  return (
    <Chart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
      <CartesianGrid vertical={false} strokeDasharray="3 3" {...axis} />
      <XAxis dataKey={xKey} tick={tick} tickLine={false} axisLine={axis} tickFormatter={xFmt} minTickGap={24} />
      <YAxis tick={tick} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => (fmt ? fmt(v) : String(v))} domain={["auto", "auto"]} />
      <Tooltip content={<TooltipBox fmt={fmt} labelFmt={xFmt} />} />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
      {series.map((s, i) =>
        area ? (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? PALETTE[i % PALETTE.length]} fill={s.color ?? PALETTE[i % PALETTE.length]} fillOpacity={0.15} strokeWidth={2} connectNulls />
        ) : (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? PALETTE[i % PALETTE.length]} strokeWidth={2} dot={data.length < 25} connectNulls />
        ),
      )}
    </Chart>
  );
}

export function Donut({ data, nameKey, valueKey, fmt }: { data: any[]; nameKey: string; valueKey: string; fmt?: (v: number) => string }) {
  return (
    <PieChart>
      <Pie data={data} dataKey={valueKey} nameKey={nameKey} cx="50%" cy="42%" innerRadius="40%" outerRadius="68%" paddingAngle={2} stroke="rgb(var(--card))">
        {data.map((_, i) => (
          <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
        ))}
      </Pie>
      <Tooltip content={<TooltipBox fmt={fmt} />} />
      <Legend wrapperStyle={{ fontSize: 12 }} />
    </PieChart>
  );
}
