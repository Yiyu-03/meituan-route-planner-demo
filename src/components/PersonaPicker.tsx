import { PERSONAS } from '../data/personas';

export function PersonaPicker({
  value, onChange,
}: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {PERSONAS.map((p) => {
        const active = p.id === value;
        return (
          <button
            key={p.id}
            onClick={() => onChange(p.id)}
            className={`group rounded-xl border p-3 text-left transition-all ${
              active
                ? 'border-brand-400 bg-brand-50 shadow-sm ring-1 ring-brand-300'
                : 'border-ink-100 bg-white hover:border-ink-300 hover:shadow-card'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-lg">{p.emoji}</span>
              <span className={`text-sm font-semibold ${active ? 'text-ink-900' : 'text-ink-700'}`}>
                {p.label}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink-400">{p.blurb}</p>
          </button>
        );
      })}
    </div>
  );
}
