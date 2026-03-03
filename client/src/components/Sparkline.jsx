/**
 * Minimal inline SVG sparkline. Accepts an array of numbers (oldest → newest).
 * Draws a polyline with a subtle gradient fill.
 */
export default function Sparkline({ values = [], width = 80, height = 28, color }) {
  if (!values || values.length < 2) {
    return <span style={{ display: 'inline-block', width, height, opacity: 0.2 }}>—</span>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w;
    const y = pad + (1 - (v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = points.join(' ');

  // Determine color by trend (last vs first)
  const trend = values[values.length - 1] - values[0];
  const lineColor = color ?? (trend > 0 ? '#10b981' : trend < 0 ? '#f87171' : '#6b6b8a');

  // Closed polygon for fill (drop to bottom)
  const lastPt = points[points.length - 1].split(',');
  const firstPt = points[0].split(',');
  const fillPath = `M${firstPt[0]},${height} ${points.map((p) => `L${p}`).join(' ')} L${lastPt[0]},${height} Z`;

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`sg-${lineColor.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#sg-${lineColor.replace('#', '')})`} />
      <polyline
        points={polyline}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Endpoint dot */}
      <circle
        cx={points[points.length - 1].split(',')[0]}
        cy={points[points.length - 1].split(',')[1]}
        r="2"
        fill={lineColor}
      />
    </svg>
  );
}
