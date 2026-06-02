import { X, BadgeCheck, MapPinned, MessageSquareQuote, ReceiptText, UserRoundCheck } from 'lucide-react';

interface PoiData {
  role: string;
  poi: string;
  eta: string;
  duration: string;
}

interface EvidenceTokens {
  matchScore: string;
  UGCQuote: string;
  history: string;
  tags?: string[];
  price?: string;
  distance?: string;
  queue?: string;
  risk?: string;
}

interface EvidenceCardProps {
  poiData: PoiData | null;
  evidenceTokens: EvidenceTokens;
  onClose?: () => void;
}

export function EvidenceCard({ poiData, evidenceTokens, onClose }: EvidenceCardProps) {
  if (!poiData) return null;

  const rows = [
    { icon: ReceiptText, label: '价格证据', value: evidenceTokens.price ?? '预算内，未发现价格风险。' },
    { icon: MapPinned, label: '距离证据', value: evidenceTokens.distance ?? '移动距离符合本次节奏。' },
    { icon: BadgeCheck, label: '排队证据', value: evidenceTokens.queue ?? '排队压力可控。' },
    { icon: UserRoundCheck, label: '历史证据', value: evidenceTokens.history },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/25 px-3 pb-3 sm:items-center sm:justify-center sm:p-6">
      <section className="max-h-[86vh] w-full overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:max-w-lg">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#8A8F99]">Evidence Card</p>
            <h3 className="truncate text-[20px] font-semibold text-[#111213]">{poiData.role}</h3>
            <p className="mt-0.5 truncate text-[13px] text-[#8A8F99]">{poiData.poi}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-[#F7F8FA]"
            aria-label="关闭证据卡"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="mb-3 rounded-xl border border-gray-200 bg-[#F7F8FA] p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-[#8A8F99]">场景匹配</span>
            <span className="font-mono text-[20px] font-semibold text-[#111213]">{evidenceTokens.matchScore}</span>
          </div>
          <p className="mt-2 text-[13px] leading-5 text-[#111213]">{evidenceTokens.risk}</p>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {(evidenceTokens.tags ?? []).map((tag) => (
            <span key={tag} className="rounded-xl border border-gray-200 bg-white px-2 py-1 text-[12px] text-[#111213] shadow-sm">
              {tag}
            </span>
          ))}
        </div>

        <div className="space-y-2">
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <div key={row.label} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-[#8A8F99]">
                  <Icon size={14} strokeWidth={1.5} className="text-[#FFC300]" />
                  {row.label}
                </div>
                <p className="text-[13px] leading-5 text-[#111213]">{row.value}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-3 rounded-xl border border-gray-200 bg-[#111213] p-3 text-white shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-[12px] text-[#FFC300]">
            <MessageSquareQuote size={14} strokeWidth={1.5} />
            UGC 摘要
          </div>
          <p className="text-[13px] leading-5">{evidenceTokens.UGCQuote}</p>
        </div>
      </section>
    </div>
  );
}
