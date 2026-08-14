# NoteHaven — Complete UI/UX Refactor Brief

**Role:** You are a senior product designer + frontend engineer. You are refactoring the **entire presentation layer** of an existing React + Vite + Tailwind + Supabase app called **NoteHaven** to an enterprise-grade, streaming-platform aesthetic (Netflix / Amazon Prime Video class).

**This is a presentation-layer rebuild, not a rewrite.** You will strip and rebuild styling, theming, layout, spacing, and motion. You will NOT touch business logic, data flow, or backend.

---

## 0. Hard Constraints (read first, violate none)

1. **Do not modify:** Supabase queries/clients, auth flow, routing logic, React state, data fetching, environment variables, API keys, or any business logic. You may change the *markup and classNames* a component renders; you may not change *what data it loads or how*.
2. **Git safety protocol — mandatory:**
   - Before any change: `git add -A && git commit -m "checkpoint: pre-refactor baseline"` so there is a clean fallback.
   - Commit after **every phase below** with a descriptive message (`refactor(tokens): ...`, `refactor(buttons): ...`, etc.).
   - Never squash or rewrite history. Each phase = one fallback point.
3. **Remove ALL existing theme code.** Delete the 5 legacy themes (Netflix-as-red-tint, Zen Garden, Ocean Breeze, Sunset Glow, Forest Mist) and any CSS, theme objects, or context tied to them. Rebuild the theme system from scratch per Phase 1.
4. **Token-driven only.** No hardcoded hex/px in components. Every color, space, radius, shadow, font size pulls from the token layer. This is non-negotiable — it is what makes themes swappable and the app consistent.
5. **No regressions.** Every screen that worked before works after. Test each route after its phase.

---

## 1. The Core Aesthetic Principle (this is the whole point)

The current "Netflix" theme fails because **red is used as a theme color** — on toggles, switches, accents, everywhere. Real Netflix is a **near-black neutral canvas where the accent appears ~5% of the time** (one primary button, one progress bar, the logo). The premium feel comes from **restraint and consistency, not from more color.**

Apply this law everywhere:

> **The canvas is neutral greyscale. The accent color is a guest, not the host. It appears only on: the single primary CTA per screen, destructive confirmation, active-state indicators, and focus rings. Nowhere else.**

Surfaces are **mostly flat** (like real Netflix/Prime). **Glassmorphism is a signature finish reserved for floating layers only** — modals, dropdowns, command/search bar, sticky top nav, toasts, popovers. Never on base page surfaces, never on cards in a list. This keeps it "a unique feature, not the eye-straining primary target."

---

## 2. Theme System — exactly 4 themes, dark-first

Ship **two families, two modes each = 4 themes.** Default for all users = **Netflix Dark.**

- **Netflix Dark** (default) · **Netflix Light**
- **Prime Dark** · **Prime Light**

Light modes are **secondary** — they must work and look clean, but dark is the design star. Spend optimization effort on dark; make light correct and uncramped, not lavish.

Implement as CSS custom properties on `:root` / `[data-theme="..."]`, consumed through Tailwind via `bg-[var(--surface)]` style tokens or a Tailwind theme-extend that maps to the vars. **Only the primitive *values* change per theme — never the structure, spacing, radii, or component anatomy.**

### Token values (use these exact values)

```css
/* ============ NETFLIX DARK (default) ============ */
[data-theme="netflix-dark"] {
  --canvas:        #141414;  /* page background */
  --surface-1:     #1b1b1b;  /* cards, panels */
  --surface-2:     #232323;  /* raised / hover */
  --surface-3:     #2b2b2b;  /* inputs, wells */
  --border:        rgba(255,255,255,0.08);
  --border-strong: rgba(255,255,255,0.14);
  --text-1:        #ffffff;  /* headings, key numbers */
  --text-2:        #b3b3b3;  /* body */
  --text-3:        #6e6e6e;  /* muted / captions */
  --accent:        #E50914;  /* Netflix red — USE SPARINGLY */
  --accent-hover:  #f6121d;
  --accent-text:   #ffffff;  /* text on accent fill */
  --focus-ring:    rgba(229,9,20,0.55);
  --success:       #46d369;  /* Netflix's progress green */
  --warning:       #e8b219;
  --danger:        #E50914;  /* same as accent in Netflix world */
}

/* ============ NETFLIX LIGHT ============ */
[data-theme="netflix-light"] {
  --canvas:        #f4f4f4;
  --surface-1:     #ffffff;
  --surface-2:     #fafafa;
  --surface-3:     #eeeeee;
  --border:        rgba(0,0,0,0.08);
  --border-strong: rgba(0,0,0,0.14);
  --text-1:        #141414;
  --text-2:        #4d4d4d;
  --text-3:        #8a8a8a;
  --accent:        #E50914;
  --accent-hover:  #c40812;
  --accent-text:   #ffffff;
  --focus-ring:    rgba(229,9,20,0.45);
  --success:       #1e9e4a;
  --warning:       #b8860b;
  --danger:        #E50914;
}

/* ============ PRIME DARK ============ */
[data-theme="prime-dark"] {
  --canvas:        #0F171E;  /* Prime Video slate-navy */
  --surface-1:     #1A242F;
  --surface-2:     #232F3E;
  --surface-3:     #2b3a4a;
  --border:        rgba(255,255,255,0.09);
  --border-strong: rgba(255,255,255,0.16);
  --text-1:        #ffffff;
  --text-2:        #aab7c4;
  --text-3:        #6b7c8c;
  --accent:        #00A8E1;  /* Prime Video cyan-blue */
  --accent-hover:  #1ec0f5;
  --accent-text:   #001018;  /* dark text reads better on bright cyan */
  --focus-ring:    rgba(0,168,225,0.55);
  --success:       #2bc48a;
  --warning:       #f0a93b;
  --danger:        #ff5a5f;  /* distinct red — Prime accent is blue, so danger needs its own */
}

/* ============ PRIME LIGHT ============ */
[data-theme="prime-light"] {
  --canvas:        #f2f4f6;
  --surface-1:     #ffffff;
  --surface-2:     #fafbfc;
  --surface-3:     #eef1f4;
  --border:        rgba(0,0,0,0.08);
  --border-strong: rgba(0,0,0,0.14);
  --text-1:        #0F171E;
  --text-2:        #44535f;
  --text-3:        #8595a3;
  --accent:        #007fa8;  /* darkened cyan for contrast on white */
  --accent-hover:  #00638a;
  --accent-text:   #ffffff;
  --focus-ring:    rgba(0,127,168,0.45);
  --success:       #1d9e6b;
  --warning:       #c47d12;
  --danger:        #d83a3f;
}
```

**Theme switcher (Settings):** keep the existing dropdown UX, but it now lists only these 4. The mode toggle (Light/Dark) switches *within* the selected family. Persist choice (localStorage or your existing mechanism — do not change the storage logic, only the values it stores).

---

## 3. Spacing, Radius, Shadow, Type — the rhythm tokens

These are **identical across all 4 themes.** They are what makes the app feel like one system.

```css
:root {
  /* 8-pt spacing scale — use ONLY these */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;

  /* Radius scale */
  --radius-sm: 8px;   /* buttons, inputs, chips */
  --radius-md: 12px;  /* cards, list items */
  --radius-lg: 16px;  /* large panels, sheets */
  --radius-xl: 20px;  /* modals */
  --radius-full: 999px;

  /* Elevation (flat surfaces use 0–2; floating glass uses 3) */
  --shadow-1: 0 1px 2px rgba(0,0,0,0.20);
  --shadow-2: 0 4px 12px rgba(0,0,0,0.28);
  --shadow-3: 0 16px 48px rgba(0,0,0,0.45);  /* modals/dropdowns */

  /* Motion — iOS spring feel */
  --ease-spring: cubic-bezier(0.32, 0.72, 0, 1);
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 140ms; --dur-base: 220ms; --dur-slow: 320ms;
}
```

**Typography:** Use **Inter** (variable) as the UI font — it's the closest free analog to Netflix Sans / Amazon Ember and reads as premium. Load it self-hosted or via fontsource. Apply a strict type scale:

| Token | Size / Line / Weight | Use |
|---|---|---|
| `display` | 32px / 1.1 / 700, tracking -0.02em | Big stat numbers (₹14,000 · 1000 items) |
| `h1` | 24px / 1.2 / 700 | Page titles (Dashboard, Tasks) |
| `h2` | 18px / 1.3 / 600 | Section headers (Pinned Items, Buckets) |
| `body` | 14px / 1.5 / 400 | Default text |
| `label` | 13px / 1.4 / 500 | Field labels, card subtitles |
| `caption` | 12px / 1.4 / 500 | Meta, timestamps, badges |

**Critical:** all numeric/stat displays use `font-variant-numeric: tabular-nums;` so dashboard numbers align like a real product. Headings get tight letter-spacing; body stays default.

---

## 4. The Glass Recipe (floating layers ONLY)

Apply to: modals, dropdowns/selects, the search/command bar, sticky top nav, toasts, popovers, context menus. **Never** on `--canvas` or on list cards.

```css
.glass {
  background: color-mix(in srgb, var(--surface-1) 72%, transparent);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-3),
              inset 0 1px 0 rgba(255,255,255,0.06); /* top inner highlight = the "liquid" edge */
  border-radius: var(--radius-xl);
}
```

**Legibility guards (mandatory):**
- Provide an `@supports not (backdrop-filter: blur(1px))` fallback that sets a **solid** `var(--surface-1)` background. Glass must never become unreadable.
- When glass floats over busy content (e.g. a modal over the dashboard), render a **scrim** behind it: `background: rgba(0,0,0,0.5)` for dark families, `rgba(0,0,0,0.25)` for light.
- Body text inside glass uses `--text-1`, never `--text-2`, to survive the blur.

---

## 5. The Button System — ONE family, consistent everywhere

This is the second-biggest fix. Today buttons are mixed shapes/sizes/fills and stand out like sore thumbs. Build **one `<Button>` primitive** with variants and sizes. Every button in the app routes through it. No raw `<button className="bg-green...">` anywhere.

**Anatomy (identical for all variants):** height by size, `--radius-sm`, horizontal padding `--space-4`, font 14px/600, icon+label gap `--space-2`, `transition: all var(--dur-fast) var(--ease-spring)`, `:active { transform: scale(0.97) }`, visible `--focus-ring` on `:focus-visible`.

**Sizes:** `sm` = 32px h, `md` = 40px h (default), `lg` = 48px h.

**Variants:**
| Variant | Look | When to use |
|---|---|---|
| `primary` | `--accent` fill, `--accent-text`, no border | **Exactly ONE per screen** — the main action |
| `secondary` | `--surface-2` fill, `--border` 1px, `--text-1` | Common neutral actions (Filter, Export, Add Tag) |
| `ghost` | transparent, `--text-2`, hover → `--surface-2` bg | Tertiary / toolbar / "View All →" |
| `destructive` | `--danger` fill or `--danger` text+border | Delete / cancel-subscription confirmations only |
| `icon` | 40×40 square, `--radius-sm`, ghost styling | Icon-only toolbar actions (edit, delete, share icons) |

**The accent rule, enforced:** on any given screen, only the single most important action is `primary` (accent-filled). Everything else is `secondary` or `ghost`. This is why Netflix's "Play" pops — it's the only filled control on screen. Audit every screen for this.

---

## 6. Other Primitives (build once, reuse)

- **Card:** `--surface-1` bg, `--border` 1px, `--radius-md`, padding `--space-5`, `--shadow-1`. Hover (if interactive): lift to `--surface-2` + `--shadow-2` + 1px translateY, spring eased. ALL cards (stat, media, bucket, birthday, subscription, note) use this — same padding, radius, border. No exceptions.
- **Badge/Chip — fix the chaos:** one shape (`--radius-full`, 12px/500, padding `2px 10px`), and **semantic color only**: neutral (default, `--surface-3` bg / `--text-2`), success (`--success`), warning (`--warning`), danger (`--danger`), accent (active filter). Map current badges by *meaning*: Active/On-track → success; Overdue/Will-Cancel/Upcoming-due → warning; Cancelled/error → danger; selected filter (JDrama etc.) → accent; type labels (Manga, Service, Spending) → neutral. No more random teal/amber/green with no logic.
- **Input/Select/Search:** `--surface-3` bg, `--border` 1px, `--radius-sm`, 40px h, `--text-1`, placeholder `--text-3`, focus → `--border-strong` + `--focus-ring`. Search bar gets a leading magnifier icon in `--text-3`.
- **Modal/Dropdown/Toast:** glass per §4, spring enter (fade + 8px rise + scale 0.98→1 over `--dur-base`), scrim behind modals.
- **Empty states** (e.g. Tasks "no tasks yet"): centered icon in `--surface-3` circle, `h2` line, one `secondary` button. Make them feel intentional, not like a void.

---

## 7. Per-Screen Layout & Button Placement Grammar

**Global placement law (apply to every screen):**
1. **Page header row:** title (`h1`) on the left; the **single `primary` action on the far right.** Always top-right. (Add Entry, Add Subscription, Add Birthday, New note, Add Task.)
2. **Secondary header actions** sit left of the primary, as `secondary`/`icon` buttons (Export, Filters, view-toggle, Manage).
3. **Filters/search:** full-width or left-aligned row directly **below** the header, never mixed into it.
4. **Destructive actions** are never in the header — they live **inline & contextual** next to the item they affect, as `icon`/`destructive`, often revealed on hover.
5. **"View All →"** and navigational links are `ghost`, bottom-right of their section.
6. Left nav rail unchanged in structure; restyle to tokens (active item = `--surface-2` bg + `--accent` 3px left indicator + `--text-1`; inactive = `--text-2`).

**Screen-by-screen:**

- **Dashboard:** Header "Good morning, r4k5h1t" left; the Tasks-Done % ring + settings `icon` button top-right. 4 stat cards in one row (equal width, `display` numbers, tabular-nums). Pinned Items + Calendar as two equal panels. Recent Notes / Birthdays / Currently-Watching as a 3-card row, each with a `ghost` "View All →" bottom-right. No primary button here — it's a read surface.
- **Notes:** Three-pane (rail · list · editor). List header: "Notes" left, `primary` **+ New** top-right. Search + `secondary` Filter below. Editor header: title + tag chips left; `icon` actions (pin, palette, delete, share) clustered top-right, evenly spaced, identical 40×40. The floating formatting toolbar can be subtle glass.
- **Library:** Tabs (Prompts / Code Snippets) as a segmented control (one pill bg, accent active segment). `primary` **+ New File** + `icon` new-folder top-right of the file list. Code viewer header: file meta left; **Copy / Reveal / Edit** as `secondary` + overflow `icon` top-right — all same height, currently they vary.
- **Calendar:** "June 2026" + prev/next `icon` buttons left; **Today** `secondary` + **Month/Week** segmented control right. Category filter checkboxes as a chip row below header (each chip neutral, accent when active). Event pills inside cells use semantic colors, not all-green.
- **Media Tracker:** "Media Tracker" left; view-toggle (grid/list) + `primary` **+ Add** + `secondary` **Filters** top-right (in that order, equal height). Stat cards row. Category filter chips row (selected = accent, others neutral). Cards uniform; the −/episode/+ stepper is one neutral pill.
- **Tasks:** "Tasks" left, `primary` **+ Add Task** top-right. `secondary` Filter below-left. The add-task input + due-date + tag form as one aligned row. Rebuild the empty state per §6.
- **Money Ledger:** title + subtitle left; **Export** `secondary` + `primary` **+ Add Entry** top-right. Income/Expense/Balance stat cards (display numbers, success/danger/neutral text — not all the same). Bucket cards uniform with a small semantic dot + neutral type-tag. **Manage** as `secondary` on the Buckets section header. Charts: restyle donut + bars to token colors (income=success, expense=danger), add proper labels.
- **Birthdays:** "Birthdays" left; search input + `primary` **+ Add Birthday** top-right. Upcoming / Recent / All sections; all cards identical anatomy; the "in N days" / "N days ago" badges use neutral or warning (imminent) semantics, not random blue/green.
- **Subscriptions:** title+subtitle left, `primary` **+ Add Subscription** top-right. 4 stat cards. List rows: name + type-chip + price left; status badge (Active=success, Overdue/Will-Cancel=warning) + edit/delete `icon` buttons right, evenly spaced and hover-revealed.
- **Settings:** Sectioned glass-free cards (Appearance, Account, Sidebar Order, Profile). Theme dropdown lists the 4 themes with a small swatch trio preview; mode toggle below it. **Save** = `primary` (one per form); **Sign Out** = `destructive` ghost (text+icon, no fill). **Reset** = `secondary`.

---

## 8. Motion & Polish (the "WOW" layer — do not skip)

This is what turns "consistent" into "wow." Apply globally, spring-eased, **fast and subtle — never bouncy or slow:**

- **Route transitions:** content fades + rises 8px over `--dur-base` on mount.
- **Cards:** stagger-fade in lists (each item +30ms delay, cap ~8). Hover lift per §6.
- **Buttons:** `scale(0.97)` on press; accent buttons get a faint glow on hover (`box-shadow` in accent at low alpha).
- **Modals/dropdowns:** scale 0.98→1 + fade + scrim fade, spring.
- **Theme switch:** crossfade `--canvas`/`--surface` over `--dur-slow` so swapping themes feels liquid, not a hard flash.
- **Toasts:** slide-in from bottom-right on spring, auto-dismiss.
- **Number counters:** stat numbers count up on first load (`--dur-slow`).
- **Respect `prefers-reduced-motion`:** disable transforms/counters, keep instant opacity. Mandatory.
- **Focus-visible rings** everywhere for keyboard users. Maintain WCAG AA contrast (text on accent, text in glass) — verify, don't assume.

---

## 9. Execution Order (commit after each)

1. **Phase 0** — baseline commit.
2. **Phase 1 — Tokens:** strip all legacy theme code; create the token layer (§2, §3) + Tailwind mapping; wire the 4-theme switcher. Default = netflix-dark. *Commit.*
3. **Phase 2 — Typography & global resets:** Inter, type scale, tabular-nums, base canvas/text. *Commit.*
4. **Phase 3 — Primitives:** Button, Card, Badge, Input/Select/Search, Modal, Toast, EmptyState (§5, §6). *Commit.*
5. **Phase 4 — Glass:** apply §4 to floating layers + legibility guards. *Commit.*
6. **Phase 5 — Screens:** refactor each route to §7, replacing all ad-hoc buttons/cards with primitives, one screen per commit.
7. **Phase 6 — Motion & a11y:** §8 across the app. *Commit.*
8. **Phase 7 — Audit pass:** verify the accent-restraint law (one primary/screen), button uniformity, card uniformity, badge semantics, spacing on the 8-pt grid, AA contrast, reduced-motion, all 4 themes, every route still loads its real data. *Final commit.*

---

## 10. Definition of Done (the WOW bar)

- Netflix Dark looks like a **calm near-black product with red as a rare accent** — not "dark mode painted red."
- Every button on every screen is visibly the **same family**; the eye finds the one primary action instantly.
- Floating layers have a tasteful **liquid-glass** feel; base surfaces are clean and flat.
- Switching to Prime feels like a **different premium product**, not a recolor of the same skin.
- Spacing, radii, and type are **uniform** — nothing is a sore thumb.
- Interactions feel **smooth and spring-driven**; nothing janky, nothing gaudy.
- Zero backend/logic/route changes; every screen loads its real data exactly as before.
