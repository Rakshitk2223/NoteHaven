import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Calendar, Library, Monitor, CheckSquare, FileText,
  Cake, Wallet, CreditCard, Settings as SettingsIcon, Plus, Sparkles,
  SunMedium, Moon, FolderLock,
} from "lucide-react";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup,
  CommandItem, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { applyTheme, getCurrentTheme } from "@/lib/themes";
import { getCachedPrefs, applyPreferencesToDOM } from "@/lib/preferences";

type Cmd = { icon: React.ElementType; label: string; perform: () => void; keywords?: string };

/**
 * CommandPalette — ⌘K / Ctrl+K opens an instant fuzzy launcher for every screen
 * plus quick actions. Always mounted (inside the router) so navigation is one
 * keystroke away — a big part of the app feeling snappy instead of click-hunt.
 */
export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  const run = React.useCallback((fn: () => void) => {
    setOpen(false);
    // let the dialog close before navigating to avoid focus-trap flicker
    requestAnimationFrame(fn);
  }, []);

  const go = React.useCallback((path: string) => run(() => navigate(path)), [navigate, run]);

  const toggleMode = React.useCallback(() => {
    run(() => {
      const isDark = document.documentElement.classList.toggle("dark");
      const mode: "light" | "dark" = isDark ? "dark" : "light";
      localStorage.setItem("theme", mode);
      applyTheme(getCurrentTheme(), mode);
      // applyTheme rewrites --primary etc.; re-assert any custom accent/radius.
      applyPreferencesToDOM(getCachedPrefs());
    });
  }, [run]);

  const nav: Cmd[] = [
    { icon: LayoutDashboard, label: "Dashboard", perform: () => go("/dashboard") },
    { icon: Calendar, label: "Calendar", perform: () => go("/calendar") },
    { icon: Library, label: "Library", perform: () => go("/library"), keywords: "prompts snippets code" },
    { icon: Monitor, label: "Media Tracker", perform: () => go("/media"), keywords: "anime manga movies series" },
    { icon: CheckSquare, label: "Tasks", perform: () => go("/tasks"), keywords: "todo" },
    { icon: FileText, label: "Notes", perform: () => go("/notes") },
    { icon: FolderLock, label: "Vault", perform: () => go("/vault"), keywords: "files documents storage drive aadhaar passport" },
    { icon: Cake, label: "Birthdays", perform: () => go("/birthdays") },
    { icon: Wallet, label: "Money Ledger", perform: () => go("/ledger"), keywords: "budget expenses income" },
    { icon: CreditCard, label: "Subscriptions", perform: () => go("/subscriptions") },
    { icon: SettingsIcon, label: "Settings", perform: () => go("/settings"), keywords: "theme preferences" },
  ];

  const actions: Cmd[] = [
    { icon: Plus, label: "New Note", perform: () => go("/notes?new=1"), keywords: "create write" },
    { icon: Plus, label: "New Task", perform: () => go("/tasks?new=1"), keywords: "create add todo" },
    { icon: Plus, label: "Add Media", perform: () => go("/media?new=1"), keywords: "track watch" },
  ];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to… or run a command" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Go to">
          {nav.map((c) => (
            <CommandItem key={c.label} value={`${c.label} ${c.keywords ?? ""}`} onSelect={c.perform}>
              <c.icon />
              <span>{c.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {actions.map((c) => (
            <CommandItem key={c.label} value={`${c.label} ${c.keywords ?? ""}`} onSelect={c.perform}>
              <c.icon />
              <span>{c.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Preferences">
          <CommandItem value="toggle theme dark light mode" onSelect={toggleMode}>
            <Sparkles />
            <span>Toggle light / dark</span>
            <SunMedium className="ml-auto hidden dark:inline" />
            <Moon className="ml-auto inline dark:hidden" />
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export default CommandPalette;
