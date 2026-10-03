import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { sensorLabel, sensorColor } from './sensors';

export default function TrendChart({ dashboard, names, isDark }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={dashboard.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#e2e8f0'} />
        <XAxis dataKey="time" axisLine={false} tickLine={false}
          tick={{ fill: isDark ? '#94a3b8' : '#64748b', fontSize: 12 }} minTickGap={50} />
        <YAxis axisLine={false} tickLine={false}
          tick={{ fill: isDark ? '#94a3b8' : '#64748b', fontSize: 12 }}
          domain={['dataMin - 2', 'dataMax + 2']} tickFormatter={(val) => `${val}°`} />
        <Tooltip
          labelFormatter={(_label, payload) => payload?.[0]?.payload?.timestamp
            ? new Date(payload[0].payload.timestamp).toLocaleString() : _label}
          contentStyle={{ borderRadius: '12px', border: 'none', backgroundColor: isDark ? '#1e293b' : '#ffffff' }}
          labelStyle={{ color: isDark ? '#cbd5e1' : '#475569', marginBottom: '4px' }}
          itemStyle={{ color: isDark ? '#e2e8f0' : '#1e293b' }} />
        <Legend wrapperStyle={{ fontSize: 12, maxHeight: 96, overflowY: 'auto' }} />
        {dashboard.perSensor.map((sensor) => (
          <Line key={sensor.key} type="monotone" dataKey={sensor.key}
            name={sensorLabel(names, sensor.deviceId, sensor.sensorIndex)}
            stroke={sensorColor(sensor.colorIndex)} strokeWidth={2.5}
            dot={false} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
