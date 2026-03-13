import { useState, useEffect, useRef } from "react";
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, Activity,
  Target, AlertCircle, ArrowUpRight, ArrowDownRight,
  ToggleLeft, ToggleRight, Clock, Zap,
} from "lucide-react";

// Simulated data
function generateCandles(count: number) {
  const candles = [];
  let price = 22400;
  for (let i = 0; i < count; i++) {
    const open = price;
    const change = (Math.random() - 0.48) * 80;
    const close = open + change;
    const high = Math.max(open, close) + Math.random() * 40;
    const low = Math.min(open, close) - Math.random() * 40;
    const volume = Math.floor(Math.random() * 50000 + 10000);
    candles.push({ time: Date.now() - (count - i) * 60000, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

const CANDLES = generateCandles(60);
const LAST_PRICE = CANDLES[CANDLES.length - 1].close;
const PRICE_CHANGE = LAST_PRICE - CANDLES[0].open;
const PRICE_CHANGE_PCT = (PRICE_CHANGE / CANDLES[0].open * 100);

const SIGNALS = [
  { asset: "RELIANCE", action: "BUY", confidence: 78, reason: "Bullish divergence on RSI + volume surge", time: "2m ago", strategy: "Momentum" },
  { asset: "TCS", action: "HOLD", confidence: 65, reason: "Consolidation phase, wait for breakout", time: "15m ago", strategy: "Range" },
  { asset: "HDFC BANK", action: "SELL", confidence: 72, reason: "Death cross forming on 4h chart", time: "1h ago", strategy: "Trend" },
  { asset: "INFY", action: "BUY", confidence: 82, reason: "Support bounce with increasing volume", time: "30m ago", strategy: "Support/Resistance" },
];

const POSITIONS = [
  { asset: "RELIANCE", side: "LONG", entry: 2850, current: 2892, pnl: 4200, risk: "Low" },
  { asset: "INFY", side: "LONG", entry: 1580, current: 1565, pnl: -1500, risk: "Medium" },
  { asset: "NIFTY FUT", side: "SHORT", entry: 22450, current: 22380, pnl: 5250, risk: "High" },
  { asset: "GOLD", side: "LONG", entry: 87200, current: 87450, pnl: 2500, risk: "Low" },
  { asset: "USD/INR", side: "SHORT", entry: 83.45, current: 83.52, pnl: -700, risk: "Low" },
];

function MiniChart({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 80},${40 - ((v - min) / range) * 35}`).join(" ");

  return (
    <svg width="80" height="40" className="opacity-60">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}

function CandlestickChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    const prices = CANDLES.flatMap((c) => [c.high, c.low]);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const priceRange = maxPrice - minPrice;
    const padding = 40;
    const chartH = h - padding * 2;
    const candleW = Math.max(2, (w - padding * 2) / CANDLES.length - 2);

    const toY = (price: number) => padding + chartH - ((price - minPrice) / priceRange) * chartH;

    // Background
    ctx.fillStyle = "#0A0A0F";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = padding + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
    }

    // Candles
    CANDLES.forEach((candle, i) => {
      const x = padding + i * ((w - padding * 2) / CANDLES.length) + candleW / 2;
      const isGreen = candle.close >= candle.open;

      // Wick
      ctx.strokeStyle = isGreen ? "#10B981" : "#EF4444";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, toY(candle.high));
      ctx.lineTo(x, toY(candle.low));
      ctx.stroke();

      // Body
      ctx.fillStyle = isGreen ? "#10B981" : "#EF4444";
      const bodyTop = toY(Math.max(candle.open, candle.close));
      const bodyBot = toY(Math.min(candle.open, candle.close));
      const bodyH = Math.max(1, bodyBot - bodyTop);
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
    });

    // Volume bars
    const maxVol = Math.max(...CANDLES.map((c) => c.volume));
    CANDLES.forEach((candle, i) => {
      const x = padding + i * ((w - padding * 2) / CANDLES.length);
      const isGreen = candle.close >= candle.open;
      const volH = (candle.volume / maxVol) * 40;
      ctx.fillStyle = isGreen ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
      ctx.fillRect(x, h - padding - volH, candleW, volH);
    });

    // Price labels
    ctx.fillStyle = "#64748B";
    ctx.font = "10px Inter, system-ui";
    ctx.textAlign = "right";
    for (let i = 0; i < 5; i++) {
      const price = minPrice + (priceRange / 4) * (4 - i);
      const y = padding + (chartH / 4) * i;
      ctx.fillText(price.toFixed(0), padding - 6, y + 3);
    }
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full" style={{ width: "100%", height: "100%" }} />;
}

export default function TradingPage() {
  const [autoTrade, setAutoTrade] = useState(false);
  const [timeframe, setTimeframe] = useState("15m");

  const totalPnl = POSITIONS.reduce((sum, p) => sum + p.pnl, 0);
  const winRate = 67.3;
  const sparkData = CANDLES.slice(-20).map((c) => c.close);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Trading Engine</h1>
            <p className="text-xs text-gray-500">AI-powered market analysis and signals</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="badge-green flex items-center gap-1.5">
            <span className="status-dot-active" /> Markets Open
          </span>
          <button
            onClick={() => setAutoTrade(!autoTrade)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              autoTrade ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-white/[0.04] text-gray-400 border border-white/[0.06]"
            }`}
          >
            {autoTrade ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
            Auto-trade: {autoTrade ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Portfolio Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-hover">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">Portfolio Value</span>
            <DollarSign className="w-4 h-4 text-gray-600" />
          </div>
          <p className="text-2xl font-bold text-white">₹12,45,678</p>
          <div className="flex items-center gap-1 mt-1 text-xs text-emerald-400">
            <ArrowUpRight className="w-3 h-3" /> +₹23,450 (+1.9%)
          </div>
        </div>
        <div className="card-hover">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">Day P&L</span>
            <MiniChart data={sparkData} color={totalPnl >= 0 ? "#10B981" : "#EF4444"} />
          </div>
          <p className={`text-2xl font-bold ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {totalPnl >= 0 ? "+" : ""}₹{Math.abs(totalPnl).toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">From {POSITIONS.length} positions</p>
        </div>
        <div className="card-hover">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">Win Rate</span>
            <Target className="w-4 h-4 text-gray-600" />
          </div>
          <p className="text-2xl font-bold text-white">{winRate}%</p>
          <div className="mt-2 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-astra-500 to-emerald-500 rounded-full" style={{ width: `${winRate}%` }} />
          </div>
        </div>
        <div className="card-hover">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">Active Positions</span>
            <Activity className="w-4 h-4 text-gray-600" />
          </div>
          <p className="text-2xl font-bold text-white">{POSITIONS.length}</p>
          <div className="flex gap-2 mt-1">
            <span className="text-[10px] text-emerald-400">{POSITIONS.filter((p) => p.pnl >= 0).length} winning</span>
            <span className="text-[10px] text-red-400">{POSITIONS.filter((p) => p.pnl < 0).length} losing</span>
          </div>
        </div>
      </div>

      {/* Chart + Signals */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Main Chart */}
        <div className="lg:col-span-3 card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
            <div>
              <h3 className="text-sm font-semibold text-white">NIFTY 50</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-lg font-bold text-white">{LAST_PRICE.toFixed(0)}</span>
                <span className={`text-xs font-medium flex items-center gap-0.5 ${PRICE_CHANGE >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {PRICE_CHANGE >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {PRICE_CHANGE >= 0 ? "+" : ""}{PRICE_CHANGE.toFixed(0)} ({PRICE_CHANGE_PCT.toFixed(2)}%)
                </span>
              </div>
            </div>
            <div className="flex gap-1">
              {["1m", "5m", "15m", "1h", "1D", "1W"].map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                    timeframe === tf ? "bg-astra-500/20 text-astra-400" : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[320px]">
            <CandlestickChart />
          </div>
        </div>

        {/* AI Signals */}
        <div className="lg:col-span-2 card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">AI Signals</h3>
          </div>
          <div className="overflow-y-auto max-h-[360px] divide-y divide-white/[0.04]">
            {SIGNALS.map((signal, i) => (
              <div key={i} className="p-4 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      signal.action === "BUY" ? "bg-emerald-500/10 text-emerald-400" :
                      signal.action === "SELL" ? "bg-red-500/10 text-red-400" :
                      "bg-gray-500/10 text-gray-400"
                    }`}>{signal.action}</span>
                    <span className="text-sm font-semibold text-white">{signal.asset}</span>
                  </div>
                  <span className="text-[10px] text-gray-500">{signal.time}</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">{signal.reason}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500 bg-white/[0.04] px-2 py-0.5 rounded">{signal.strategy}</span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${signal.confidence > 75 ? "bg-emerald-500" : signal.confidence > 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${signal.confidence}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400">{signal.confidence}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Open Positions */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.04] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Open Positions</h3>
          <span className="text-xs text-gray-500">{POSITIONS.length} active</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.04]">
                <th className="table-header">Asset</th>
                <th className="table-header">Side</th>
                <th className="table-header">Entry</th>
                <th className="table-header">Current</th>
                <th className="table-header">P&L</th>
                <th className="table-header">Risk</th>
                <th className="table-header text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {POSITIONS.map((pos, i) => (
                <tr key={i} className="table-row">
                  <td className="table-cell font-medium text-white">{pos.asset}</td>
                  <td className="table-cell">
                    <span className={`text-xs font-medium ${pos.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}>{pos.side}</span>
                  </td>
                  <td className="table-cell text-gray-400 font-mono text-xs">₹{pos.entry.toLocaleString()}</td>
                  <td className="table-cell text-white font-mono text-xs">₹{pos.current.toLocaleString()}</td>
                  <td className="table-cell">
                    <span className={`font-medium text-xs ${pos.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {pos.pnl >= 0 ? "+" : ""}₹{pos.pnl.toLocaleString()}
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${
                      pos.risk === "Low" ? "badge-green" : pos.risk === "Medium" ? "badge-yellow" : "badge-red"
                    }`}>{pos.risk}</span>
                  </td>
                  <td className="table-cell text-right">
                    <button className="btn-ghost text-xs text-gray-400 px-2 py-1">Close</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
