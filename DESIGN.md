# DESIGN.md - SABANGDOR

## Identity & Direction
- **Product:** SABANGDOR (takeaway dimsum mentai & bakpao ordering + outlet POS dashboard)
- **Audience:** Takeaway customers on smartphones/desktops and outlet cashier/kitchen staff
- **Visual Language:** Warm-craft culinary takeaway, high-clarity cards on neutral slate ground
- **Dial:** ENERGY 2 / RHYTHM 2 / MOTION 1

## Color Palette (WCAG AA Verified)
- **Ground & Surfaces:** `#F8F9FA` (page ground), `#FFFFFF` (cards & sheets), `#F1F5F9` (subtle controls), `#E2E8F0` (borders)
- **Core Dark & Text:** `#2B1D19` (warm espresso maroon for outlet banners & summary), `#1E293B` (primary ink), `#475569` / `#64748B` (secondary muted ink, >= 4.5:1)
- **Primary Accent:** `#E11D48` (Sabangdor Crimson for primary CTAs & prices, 4.70:1 with white), `#BE123C` (hover & text on `#FEF2F2`/`#FFF1F2` tint, 5.75:1)
- **Semantic Status:** `#047857` (success / confirmation with white text, 5.48:1), `#15803D` on `#DCFCE7` (stock ready), `#B45309` / `#92400E` on `#FEF3C7` (pending warning, >= 4.5:1)

## Typography
- **Typeface:** `Plus Jakarta Sans` (geometric humanist sans with crisp numerals for Indonesian Rupiah pricing)
- **Root Scale:** `16px` base; `12px-14px` secondary metadata; `15px-16px` card titles, prices, and interactive inputs; `20px-28px` page headings

## Layout & Motion
- **Responsive Reflow:** Mobile-first `100%` width single-column -> Tablet (`>= 640px`) 2-column grids -> Desktop (`>= 1024px`, `max-width: 1140px`) 3-column catalog / 2-column POS cards
- **Motion (Dial 1):** Subtle hover transitions and sheet slide-up; all non-essential transitions disabled under `prefers-reduced-motion: reduce`
