import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Progression } from '../api/client';

const colors = ['#e96a63', '#54c7e8', '#56d6a0', '#f3bd56', '#d6dce3'];

export default function ProgressionChart({ progression }: { progression: Progression }) {
  const rows: Array<Record<string, number> & { round: number }> = progression.rounds.map((round) => {
    const values: Record<string, number> = {};
    for (const item of round.values) values[item.id] = item.points;
    return { round: round.round, ...values };
  });
  return <><div className="progression-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 12, right: 16, left: 2, bottom: 0 }}>
    <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
    <XAxis dataKey="round" tick={{ fill: '#8d96a2', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,.12)' }} label={{ value: 'ROUND', position: 'insideBottomRight', offset: -2, fill: '#77818e', fontSize: 8 }} />
    <YAxis tick={{ fill: '#8d96a2', fontSize: 10 }} tickLine={false} axisLine={false} width={37} />
    <Tooltip contentStyle={{ background: '#12161d', border: '1px solid rgba(255,255,255,.16)', borderRadius: 9, color: '#f2f4f7', fontSize: 11 }} labelFormatter={(value) => `Round ${value}`} formatter={(value, name) => [value, progression.series.find((series) => series.id === name)?.name ?? name]} />
    {progression.series.map((series, index) => <Line key={series.id} type="monotone" dataKey={series.id} name={series.name} stroke={colors[index % colors.length]} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls />)}
  </LineChart></ResponsiveContainer></div>
    <div className="chart-legend">{progression.series.map((series, index) => <span key={series.id}><i style={{ background: colors[index % colors.length] }} />{series.name}</span>)}</div>
    <details className="chart-data"><summary>View the points table</summary><div className="table-scroll"><table><thead><tr><th>ROUND</th>{progression.series.map((series) => <th key={series.id}>{series.name}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.round}><td>{row.round}</td>{progression.series.map((series) => <td key={series.id}>{row[series.id] ?? '—'}</td>)}</tr>)}</tbody></table></div></details>
  </>;
}
