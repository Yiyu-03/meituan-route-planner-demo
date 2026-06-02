import { FormEvent, useState } from 'react';
import { LoaderCircle, Send, WandSparkles } from 'lucide-react';

interface LiveReplanBarProps {
  onReplanSubmit: (text: string) => Promise<void> | void;
}

export function LiveReplanBar({ onReplanSubmit }: LiveReplanBarProps) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || loading) return;
    setLoading(true);
    await onReplanSubmit(value);
    setText('');
    setLoading(false);
  };

  return (
    <form
      onSubmit={submit}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-[#F7F8FA]/95 px-3 py-3 backdrop-blur"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
        <WandSparkles size={18} strokeWidth={1.5} className="shrink-0 text-[#FFC300]" />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-[#111213] outline-none placeholder:text-[#8A8F99]"
          placeholder="试试：少走路 / 下雨 / 预算200"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#111213] text-white shadow-sm disabled:opacity-70"
          aria-label="提交实时调整"
        >
          {loading ? (
            <LoaderCircle size={17} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <Send size={16} strokeWidth={1.5} />
          )}
        </button>
      </div>
    </form>
  );
}
