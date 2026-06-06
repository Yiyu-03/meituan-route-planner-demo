import type { LucideIcon } from 'lucide-react'
import {
  Utensils, Coffee, Landmark, Ticket, ShoppingBag, Moon,
  Navigation, CalendarCheck, Phone, BookmarkPlus,
  MapPin, Footprints, Wallet, Clock, Stamp,
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

/** 朱砂印章 logo — not a "rounded square with an icon". */
export function BrandStamp() {
  return (
    <span className="stamp hand inline-flex items-center gap-1 text-[15px]">
      <Stamp size={16} strokeWidth={1.8} aria-hidden />
      漫游·手帐
    </span>
  )
}
