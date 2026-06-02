import { BadgeCheck, Clock3, Footprints, Sparkles } from 'lucide-react';

export interface RhythmStop {
  id: string;
  role: string;
  poi: string;
  eta: string;
  duration: string;
  transitToNext?: string;
  isRepaired?: boolean;
}

interface RouteRhythmTimelineProps {
  stops: RhythmStop[];
  onSelectStop?: (stop: RhythmStop) => void;
}

export function RouteRhythmTimeline({ stops, onSelectStop }: RouteRhythmTimelineProps) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#8A8F99]">Rhythm Timeline</p>
          <h2 className="text-[20px] font-semibold leading-tight text-[#111213]">这段出行的情绪节奏</h2>
        </div>
        <Sparkles size={20} strokeWidth={1.5} className="shrink-0 text-[#FFC300]" />
      </div>

      <div className="relative">
        <div className="absolute left-[18px] top-2 h-[calc(100%-16px)] w-px bg-gray-300" />
        <div className="space-y-3">
          {stops.map((stop, index) => (
            <div key={stop.id} className="relative pl-10">
              <span className="absolute left-[11px] top-4 z-10 h-4 w-4 rounded-xl border border-gray-300 bg-white shadow-sm" />
              <button
                type="button"
                onClick={() => onSelectStop?.(stop)}
                className="w-full rounded-xl border border-gray-200 bg-[#FFFFFF] p-3 text-left shadow-sm transition focus:outline-none focus:ring-2 focus:ring-[#FFC300] active:scale-[0.99]"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[18px] font-semibold leading-6 text-[#111213]">{stop.role}</p>
                    <p className="mt-0.5 whitespace-normal break-words text-[13px] leading-5 text-[#8A8F99]">{stop.poi}</p>
                  </div>
                  {stop.isRepaired && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                      <BadgeCheck size={12} strokeWidth={1.5} />
                      repaired
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#111213]">
                  <span className="inline-flex items-center gap-1 rounded-xl bg-[#F7F8FA] px-2 py-1">
                    <Clock3 size={13} strokeWidth={1.5} />
                    {stop.eta}
                  </span>
                  <span className="rounded-xl bg-[#F7F8FA] px-2 py-1">{stop.duration}</span>
                </div>
              </button>

              {stop.transitToNext && index < stops.length - 1 && (
                <div className="ml-2 flex items-center gap-2 py-2 text-[12px] font-medium text-[#8A8F99]">
                  <Footprints size={14} strokeWidth={1.5} />
                  <span>步行 {stop.transitToNext}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
