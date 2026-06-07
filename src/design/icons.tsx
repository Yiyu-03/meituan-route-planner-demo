import type { LucideIcon } from 'lucide-react'
import {
  Utensils, Coffee, Landmark, Ticket, ShoppingBag, Moon,
  Navigation, CalendarCheck, Phone, BookmarkPlus,
  MapPin, Footprints, Wallet, Clock,
} from 'lucide-react'
import type { Category } from '../../contract'

const CATEGORY_ICON: Record<Category, LucideIcon> = {
  dining: Utensils,
  cafe: Coffee,
  culture: Landmark,
  entertainment: Ticket,
  shopping: ShoppingBag,
  nightscape: Moon,
}

export function CategoryIcon({ category, size = 18 }: { category: Category; size?: number }) {
  const Icon = CATEGORY_ICON[category]
  return <Icon size={size} strokeWidth={1.7} aria-hidden />
}

/** User-action icons for StopCard (导航/订座/电话/收藏) — spec §5 product review. */
export const ActionIcons = {
  navigate: Navigation,
  book: CalendarCheck,
  call: Phone,
  save: BookmarkPlus,
} satisfies Record<string, LucideIcon>

export const MetaIcons = {
  pin: MapPin,
  walk: Footprints,
  wallet: Wallet,
  clock: Clock,
} satisfies Record<string, LucideIcon>

/**
 * 漫游印记 — a custom maker's chop: a winding dotted trail from a start dot to a
 * destination ring, framed by a double-ruled seal. Reads as "a journey, stamped".
 * Inherits stroke colour from the surrounding text (朱砂 inside `.stamp`).
 */
export function RoamSeal({ size = 18, strokeWidth = 1.5 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      {/* double-ruled chop frame */}
      <rect x="2.4" y="2.4" width="19.2" height="19.2" rx="5" />
      <rect x="4.5" y="4.5" width="15" height="15" rx="3.3" opacity="0.38" />
      {/* winding dotted trail */}
      <path d="M7.4 16.6 C 9.2 13.4, 11.9 14.4, 11.7 11.4 C 11.5 8.6, 14.2 8, 16.4 9" strokeDasharray="0.2 2.6" strokeWidth={strokeWidth + 0.3} />
      {/* start dot */}
      <circle cx="7.4" cy="16.6" r="1.15" fill="currentColor" stroke="none" />
      {/* destination ring */}
      <circle cx="16.6" cy="8.4" r="2.1" />
      <circle cx="16.6" cy="8.4" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 朱砂印章 logo — a custom roam-seal chop + wordmark, not a generic boxed icon. */
export function BrandStamp() {
  return (
    <span className="stamp hand inline-flex items-center gap-1.5 text-[15px]">
      <RoamSeal size={17} strokeWidth={1.6} />
      漫游·手帐
    </span>
  )
}
