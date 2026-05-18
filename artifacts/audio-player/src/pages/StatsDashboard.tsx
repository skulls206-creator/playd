import { useEffect, useMemo } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { useListeningStats } from '@/lib/listening-stats';
import { useTrackStore } from '@/lib/track-store';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
} from 'recharts';
import {
  Clock, Headphones, BarChart3, RotateCcw, Music, Mic2,
  ArrowLeft,
} from 'lucide-react';

const HOUR_LABELS = ['12a','1a','2a','3a','4a','5a','6a','7a','8a','9a','10a','11a',
  '12p','1p','2p','3p','4p','5p','6p','7p','8p','9p','10p','11p'];
const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const PIE_COLORS = ['#22c55e','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4','#a855f7'];

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  if (totalSeconds < 3600) {
    const m = Math.floor(totalSeconds / 60);
    const s = Math.round(totalSeconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function StatsDashboard() {
  const { stats, loaded, resetStats } = useListeningStats();
  const tracks = useTrackStore(s => s.tracks);
  const { setLibraryFilter } = useAudioPlayer();

  // Load stats on mount
  useEffect(() => {
    if (!loaded) useListeningStats.getState().load();
  }, [loaded]);

  // Resolve top track names from IDs
  const topTrackData = useMemo(() => {
    const topIds = stats.topTrackIds.slice(0, 10);
    return topIds.map(id => {
      const t = tracks.find(tr => tr.id === id);
      return {
        name: t ? `${t.title}${t.artist ? ` — ${t.artist}` : ''}` : stats.trackName[id] || `Track #${id}`,
        seconds: stats.trackTime[id] || 0,
        trackId: id,
      };
    }).filter(d => d.seconds > 0);
  }, [stats.topTrackIds, stats.trackTime, tracks]);

  const topArtistData = useMemo(() => {
    const names = stats.topArtists.slice(0, 10);
    return names.map(name => ({
      name,
      seconds: stats.artistTime[name] || 0,
    })).filter(d => d.seconds > 0);
  }, [stats.topArtists, stats.artistTime]);

  // Prepare hourly activity chart
  const hourlyData = useMemo(() => {
    return HOUR_LABELS.map((label, i) => ({
      hour: label,
      plays: Math.round(stats.hourActivity[i] || 0),
    }));
  }, [stats.hourActivity]);

  const weekdayData = useMemo(() => {
    return DAY_LABELS.map((label, i) => ({
      day: label,
      plays: Math.round(stats.weekdayActivity[i] || 0),
    }));
  }, [stats.weekdayActivity]);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading stats…
      </div>
    );
  }

  const hasData = stats.totalSeconds > 0;
  const totalHours = Math.floor(stats.totalSeconds / 3600);
  const totalMinutes = Math.floor((stats.totalSeconds % 3600) / 60);

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 h-12 border-b border-primary/10 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h1 className="text-sm font-semibold tracking-tight">Listening Stats</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs text-muted-foreground hover:text-destructive gap-1"
          onClick={() => {
            if (confirm('Reset all listening stats? This cannot be undone.')) resetStats();
          }}
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </Button>
      </header>

      {/* No data state */}
      {!hasData && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Headphones className="w-12 h-12 opacity-20" />
          <p className="text-sm">Start listening — stats will appear here</p>
          <p className="text-xs opacity-50">
            Play time is tracked automatically while music is playing
          </p>
        </div>
      )}

      {hasData && (
        <ScrollArea className="flex-1">
          <div className="max-w-4xl mx-auto p-4 space-y-6">

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-card/50 border border-border/30 rounded-lg p-3 text-center">
                <Clock className="w-4 h-4 text-primary mx-auto mb-1" />
                <p className="text-lg font-bold tabular-nums">
                  {totalHours > 0 ? `${totalHours}h ${totalMinutes}m` : `${totalMinutes}m`}
                </p>
                <p className="text-[10px] text-muted-foreground">Total listened</p>
              </div>
              <div className="bg-card/50 border border-border/30 rounded-lg p-3 text-center">
                <Headphones className="w-4 h-4 text-primary mx-auto mb-1" />
                <p className="text-lg font-bold tabular-nums">{stats.sessionCount}</p>
                <p className="text-[10px] text-muted-foreground">Sessions</p>
              </div>
              <div className="bg-card/50 border border-border/30 rounded-lg p-3 text-center">
                <Music className="w-4 h-4 text-primary mx-auto mb-1" />
                <p className="text-lg font-bold tabular-nums">
                  {Object.keys(stats.trackTime).length}
                </p>
                <p className="text-[10px] text-muted-foreground">Unique tracks</p>
              </div>
              <div className="bg-card/50 border border-border/30 rounded-lg p-3 text-center">
                <Mic2 className="w-4 h-4 text-primary mx-auto mb-1" />
                <p className="text-lg font-bold tabular-nums">
                  {Object.keys(stats.artistTime).length}
                </p>
                <p className="text-[10px] text-muted-foreground">Artists</p>
              </div>
            </div>

            {/* Top Tracks */}
            {topTrackData.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <Music className="w-3 h-3" />
                  Top Tracks
                </h2>
                <div className="space-y-1">
                  {topTrackData.map((t, i) => (
                    <div
                      key={t.trackId}
                      className="flex items-center gap-3 px-3 py-2 rounded-md bg-card/30 hover:bg-card/60 transition-colors cursor-pointer group"
                      onClick={() => {
                        // Navigate to the track in the library (approximate)
                        setLibraryFilter({ type: 'all', label: 'All Songs' });
                        // Simple approach: just go back to main view
                        window.history.go(-1);
                      }}
                    >
                      <span className="text-[10px] font-mono text-muted-foreground w-4 text-right shrink-0">
                        {i + 1}
                      </span>
                      <span className="flex-1 text-xs truncate">{t.name}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 rounded-full bg-primary/20" style={{
                          width: `${Math.max(30, (t.seconds / topTrackData[0].seconds) * 80)}px`,
                        }}>
                          <div className="h-full rounded-full bg-primary/60" style={{
                            width: `${(t.seconds / topTrackData[0].seconds) * 100}%`,
                          }} />
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground w-14 text-right">
                          {formatDuration(t.seconds)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Top Artists */}
            {topArtistData.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <Mic2 className="w-3 h-3" />
                  Top Artists
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {topArtistData.map((a, i) => (
                    <div
                      key={a.name}
                      className="flex items-center gap-2 px-3 py-2 rounded-md bg-card/30"
                    >
                      <span className="text-[10px] font-mono text-muted-foreground w-3 shrink-0">
                        {i + 1}
                      </span>
                      <span className="flex-1 text-xs truncate">{a.name}</span>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {formatDuration(a.seconds)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Hourly Activity */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <Clock className="w-3 h-3" />
                Most Active Hours
              </h2>
              <div className="bg-card/30 rounded-lg p-3 border border-border/20" style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                    <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      formatter={(value: number) => [Math.round(value), 'plays']}
                    />
                    <Bar dataKey="plays" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Weekday Activity */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Listening by Day
              </h2>
              <div className="bg-card/30 rounded-lg p-3 border border-border/20" style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekdayData} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                    <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      formatter={(value: number) => [Math.round(value), 'plays']}
                    />
                    <Bar dataKey="plays" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

          </div>
        </ScrollArea>
      )}
    </div>
  );
}
