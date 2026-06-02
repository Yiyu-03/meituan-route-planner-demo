import { ArrowRight, History, MapPin, Route, SlidersHorizontal, UserRound } from 'lucide-react';

interface TripIntentInputProps {
  isThinking: boolean;
  activeTags: string[];
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
}

const tagIcons = [UserRound, History, SlidersHorizontal, Route];

export function TripIntentInput({
  isThinking,
  activeTags,
  value = '',
  onChange,
  onSubmit,
}: TripIntentInputProps) {
  return (
    <section className="sticky top-0 z-30 border-b border-gray-200 bg-[#F7F8FA]/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-2 flex flex-wrap gap-2 pb-1">
          {activeTags.map((tag, index) => {
            const Icon = tagIcons[index % tagIcons.length];
            return (
              <span
                key={tag}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-[#111213] shadow-sm"
              >
                <Icon size={13} strokeWidth={1.5} className="text-[#8A8F99]" />
                {tag}
              </span>
            );
          })}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          <div className="flex items-center gap-2">
            <MapPin size={18} strokeWidth={1.5} className="shrink-0 text-[#FFC300]" />
            <textarea
              value={value}
              onChange={(event) => onChange?.(event.target.value)}
              rows={1}
              className="h-11 min-w-0 w-0 flex-1 resize-none overflow-hidden bg-transparent py-2.5 text-[14px] leading-6 text-[#111213] outline-none placeholder:text-[#8A8F99]"
              placeholder="描述一次具体出行，例如：周六晚上和女朋友在外滩约会，人均 400，看夜景，别太赶"
            />
            <button
              type="button"
              onClick={onSubmit}
              disabled={isThinking}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFC300] text-[#111213] shadow-sm transition disabled:opacity-60"
              aria-label="开始规划"
            >
              <ArrowRight size={18} strokeWidth={1.5} className={isThinking ? 'animate-pulse' : ''} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
