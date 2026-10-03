import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

export default function DemoChart({ history, sensors, alertSensor, isDark }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <defs>
          {sensors.map(sensor => (
            <linearGradient key={sensor.id} id={`demo-gradient-${sensor.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={sensor.color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={sensor.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#e2e8f0'} />
        <XAxis dataKey="time" axisLine={false} tickLine={false}
          tick={{ fill: isDark ? '#94a3b8' : '#64748b', fontSize: 12 }} minTickGap={40} />
        <YAxis axisLine={false} tickLine={false} domain={['dataMin - 5', 'dataMax + 5']}
          tick={{ fill: isDark ? '#94a3b8' : '#64748b', fontSize: 12 }} tickFormatter={val => `${val}°`} />
        <Tooltip contentStyle={{ borderRadius: '12px', backgroundColor: isDark ? '#1e293b' : '#ffffff' }}
          labelStyle={{ color: isDark ? '#cbd5e1' : '#475569' }}
          itemStyle={{ color: isDark ? '#e2e8f0' : '#1e293b' }} />
        {alertSensor && <ReferenceLine y={alertSensor.safeMax} stroke="#ef4444" strokeDasharray="6 4"
          ifOverflow="extendDomain" label={{ value: `Safe max ${alertSensor.safeMax}°F`, fill: '#ef4444', fontSize: 11 }} />}
        {sensors.map(sensor => (
          <Area key={sensor.id} type="monotone" dataKey={`sensor${sensor.id}`} name={sensor.name}
            stroke={sensor.color} strokeWidth={alertSensor?.id === sensor.id ? 3.5 : 2}
            fill={`url(#demo-gradient-${sensor.id})`} dot={false} connectNulls={false} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
