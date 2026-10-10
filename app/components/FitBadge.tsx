import { FIT_LABEL, type Fit } from "@/lib/catalog";

const tone: Record<Fit, string> = {
  good: "text-ok",
  tight: "text-danger",
  "too-big": "text-danger line-through decoration-1",
};

// How well a model fits this Mac's memory (see fitFor).
export function FitBadge({ fit }: { fit: Fit }) {
  return <span className={`shrink-0 text-[11px] font-medium ${tone[fit]}`}>{FIT_LABEL[fit]}</span>;
}
