import { GitCompareArrows, ShieldCheck } from 'lucide-react';

interface RepairPatchPanelProps {
  oldNode: string;
  newNode: string;
  triggerReason: string;
}

export function RepairPatchPanel({ oldNode, newNode, triggerReason }: RepairPatchPanelProps) {
  return (
    <section className="rounded-xl border border-orange-200 bg-orange-50 p-3 shadow-sm">
      <div className="mb-2 flex items-start gap-2">
        <GitCompareArrows size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-orange-600" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[#111213]">Repair Patch · 局部修复</p>
          <p className="mt-0.5 text-[12px] leading-5 text-[#6B5A2A]">{triggerReason}</p>
        </div>
      </div>

      <div className="grid gap-2">
        <div className="rounded-xl border border-red-200 bg-white px-3 py-2 text-[13px] shadow-sm">
          <span className="mr-2 font-mono text-red-500">-</span>
          <span className="text-red-600 line-through decoration-red-500 decoration-2">{oldNode}</span>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-[13px] shadow-sm">
          <span className="mr-2 font-mono text-emerald-600">+</span>
          <span className="font-medium text-emerald-700">{newNode}</span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
        <ShieldCheck size={14} strokeWidth={1.5} />
        其余路线骨架保持不变，已重新校验预算与步行阈值。
      </div>
    </section>
  );
}
