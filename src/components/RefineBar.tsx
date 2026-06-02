import { useState } from 'react';
import { Card, SectionLabel, Chip } from './ui';

const FALLBACK_QUICK = [
  '换一家评分更高的餐厅',
  '换家更便宜的',
  '预算降到 300',
  '不要太赶',
  '再多逛一个地方',
  '加一个适合拍照的地方',
];

export function RefineBar({
  onRefine, lastMessage, actions,
}: {
  onRefine: (text: string) => void;
  lastMessage?: string;
  actions?: string[];
}) {
  const [text, setText] = useState('');

  const submit = (t: string) => {
    const v = t.trim();
    if (!v) return;
    onRefine(v);
    setText('');
  };

  return (
    <Card className="p-4">
      <SectionLabel hint="只改受影响的节点,其余保留">局部调整 · Replan</SectionLabel>

      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {(actions?.length ? actions : FALLBACK_QUICK).map((q) => (
          <Chip key={q} size="sm" onClick={() => submit(q)}>{q}</Chip>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit(text)}
          placeholder="用一句话描述要改什么,如「把咖啡换成更近的」"
          className="flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] text-ink-800 outline-none placeholder:text-ink-300 focus:border-brand-400 focus:ring-1 focus:ring-brand-200"
        />
        <button
          onClick={() => submit(text)}
          className="rounded-lg bg-ink-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-ink-700"
        >
          应用
        </button>
      </div>

      {lastMessage && (
        <p className="mt-2.5 rounded-lg bg-brand-50 px-3 py-2 text-[12px] leading-snug text-brand-700 animate-fadeUp">
          {lastMessage}
        </p>
      )}
    </Card>
  );
}
