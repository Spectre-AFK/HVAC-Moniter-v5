import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { DEMO_SENSORS } from './demoScenarios';

const MARKER_COLORS = { event: '#94a3b8', alert: '#ef4444', cleared: '#10b981' };

export default function DemoChart({ rows, chart, markers = [], focus, isDark, hasTrend }) {
  const axisColor = isDark ? '#94a3b8' : '#64748b';
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 16, right: 28, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#e2e8f0'} />
        <XAxis dataKey="label" axisLine={false} tickLine={false} interval={chart.tickInterval}
          tick={{ fill: axisColor, fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} width={44} domain={chart.domain} ticks={chart.ticks}
          allowDataOverflow tick={{ fill: axisColor, fontSize: 12 }} tickFormatter={(v) => `${v}°`} />
        <Tooltip formatter={(value) => (value == null ? '—' : `${Number(value).toFixed(1)}°F`)}
          contentStyle={{ borderRadius: '12px', backgroundColor: isDark ? '#1e293b' : '#ffffff', borderColor: isDark ? '#334155' : '#e2e8f0' }}
          labelStyle={{ color: isDark ? '#cbd5e1' : '#475569' }}
          itemStyle={{ color: isDark ? '#e2e8f0' : '#1e293b' }} />
        <Legend verticalAlign="top" align="left" height={32} iconType="plainline"
          wrapperStyle={{ fontSize: 12, color: axisColor }} />
        {chart.threshold && (
          <ReferenceLine y={chart.threshold.value} stroke="#ef4444" strokeDasharray="6 4"
            label={{ value: chart.threshold.label, position: 'insideBottomRight', fill: '#ef4444', fontSize: 12 }} />
        )}
        {markers.map((marker) => (
          <ReferenceLine key={marker.label} x={rows[marker.index]?.label} stroke={MARKER_COLORS[marker.kind]}
            strokeDasharray={marker.kind === 'event' ? '2 4' : undefined} strokeWidth={1.5} />
        ))}
        {chart.sensors.map((id) => {
          const sensor = DEMO_SENSORS[id];
          const dimmed = focus && focus !== id;
          return (
            <Line key={id} type="monotone" dataKey={id} name={sensor.name} stroke={sensor.color}
              strokeWidth={focus === id ? 3.5 : 2.5} strokeOpacity={dimmed ? 0.35 : 1}
              dot={chart.dots ? { r: 3.5, strokeWidth: 0, fill: sensor.color } : false}
              connectNulls={false} isAnimationActive={false} />
          );
        })}
        {hasTrend && (
          <Line type="linear" dataKey="trend" name="Trend" stroke={isDark ? '#f8fafc' : '#0f172a'}
            strokeDasharray="5 5" strokeWidth={1.5} dot={false} isAnimationActive={false} legendType="plainline" />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
