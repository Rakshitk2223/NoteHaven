// "Link your library" run state for the UI: the resolver engine (loaded lazily,
// it pulls in the edge search), its live progress, and the counts the More row,
// the pill and the "Needs a pick" chip show.
//
// It survives a tab close: the intent ("running" / "paused") is kept on this
// device, and the resolver resumes from the proposals it already saved. It
// follows his eyes: a tab hidden for a while lets go (lib/media-resolve), and
// any visible tab with the intent "running" picks the run up.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { runUpdatePass } from '../update-pass';
import type { ResolverProgress } from '@/lib/media-resolve';
import { type LinkState, buildLinkView, loadLinkState, unlinkedCount, type QueueItem } from './link-data';

type ResolveModule = typeof import('@/lib/media-resolve');
type Intent = 'running' | 'paused' | null;

const INTENT_KEY = 'mediaLinkRun:v1';
const readIntent = (): Intent => {
  try { const v = localStorage.getItem(INTENT_KEY); return v === 'running' || v === 'paused' ? v : null; } catch { return null; }
};
const writeIntent = (v: Intent) => {
  try { if (v) localStorage.setItem(INTENT_KEY, v); else localStorage.removeItem(INTENT_KEY); } catch { /* per-device only */ }
};

export interface LinkRun {
  ready: boolean;
  progress: ResolverProgress | null;
  intent: Intent;
  unlinked: number;
  /** done / total for the pill. */
  counts: { done: number; total: number } | null;
  queue: QueueItem[];
  /** Proposals the resolver auto-matched (band 'auto'), undecided and current: U3-4's list. */
  autoMatched: QueueItem[];
  /** Rows whose best candidate is the same work as another of his rows, or one already linked. */
  duplicateIds: Set<number>;
  /** Works already linked to one of his titles (source:source_id): can't be picked again. */
  takenWorks: Set<string>;
  start: () => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  /** Re-read rows + proposals (after a decision or an apply). */
  refresh: () => Promise<void>;
}

const ACTIVE = new Set(['running', 'waiting', 'paused']);

export function useLinkRun(enabled: boolean): LinkRun {
  const [mod, setMod] = useState<ResolveModule | null>(null);
  const [progress, setProgress] = useState<ResolverProgress | null>(null);
  const [state, setState] = useState<LinkState | null>(null);
  const [intent, setIntentState] = useState<Intent>(readIntent);
  const lastDone = useRef(-1);
  const lastState = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const setIntent = useCallback((v: Intent) => { writeIntent(v); setIntentState(v); }, []);
  const refresh = useCallback(async () => {
    try { setState(await loadLinkState()); } catch (e) { console.error('Link state load failed:', e); }
  }, []);

  // Load the engine + state once the feature is live (migration 29).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void import('@/lib/media-resolve').then((m) => { if (!cancelled) setMod(m); });
    void refresh();
    return () => { cancelled = true; };
  }, [enabled, refresh]);

  // Live progress; re-read the counts as proposals land (not every tick) and when a run stops.
  useEffect(() => {
    if (!mod) return;
    const r = mod.getResolver();
    setProgress(r.getProgress());
    return r.subscribe((p) => {
      setProgress(p);
      const moved = p.state !== lastState.current;
      lastState.current = p.state;
      if (p.done - lastDone.current >= 10 || (moved && !ACTIVE.has(p.state))) { lastDone.current = p.done; void refresh(); }
      if (moved && (p.state === 'done' || p.state === 'cancelled')) {
        setIntent(null);
        // Linking let go of the sources: give what he approved meanwhile its details.
        void runUpdatePass(queryClient, { wait: true });
      }
    });
  }, [mod, refresh, setIntent, queryClient]);

  // Resume after a tab close (not when he'd paused it).
  const resumed = useRef(false);
  useEffect(() => {
    if (!mod || resumed.current) return;
    resumed.current = true;
    if (intent === 'running' && !ACTIVE.has(mod.getResolver().getProgress().state)) void mod.getResolver().start();
  }, [mod, intent]);

  // Pick the run up in whichever tab he's looking at: on becoming visible, and every
  // few seconds while another tab holds it (it lets go 15 s after being hidden).
  useEffect(() => {
    if (!mod || intent !== 'running') return;
    const r = mod.getResolver();
    const take = () => {
      if (document.visibilityState === 'visible' && !r.isRunning()) void r.start();
    };
    document.addEventListener('visibilitychange', take);
    // While another tab runs it, re-read the counts every 30 s so the pill still moves here.
    let ticks = 0;
    const t = window.setInterval(() => {
      if (!r.getProgress().runningElsewhere) return;
      take();
      if (++ticks % 6 === 0) void refresh();
    }, 5000);
    return () => { document.removeEventListener('visibilitychange', take); window.clearInterval(t); };
  }, [mod, intent, refresh]);

  const start = useCallback(() => { if (!mod) return; setIntent('running'); void mod.getResolver().start(); }, [mod, setIntent]);
  const pause = useCallback(() => { if (!mod) return; setIntent('paused'); mod.getResolver().pause(); }, [mod, setIntent]);
  const resume = useCallback(() => {
    if (!mod) return;
    setIntent('running');
    const r = mod.getResolver();
    // Paused in this tab → resume; paused before a reload (engine idle) → start picks up where it stopped.
    if (r.getProgress().state === 'paused') r.resume(); else void r.start();
  }, [mod, setIntent]);
  const cancel = useCallback(() => { if (!mod) return; setIntent(null); mod.getResolver().cancel(); }, [mod, setIntent]);

  // One view for the pill, the chips, the queue and the auto list (duplicates never auto-link).
  const view = mod && state ? buildLinkView(state, mod.isCurrent, mod.findDuplicates) : null;
  // "812/1,259" even when no run is live in this tab (paused before a reload, say).
  const counts = progress && ACTIVE.has(progress.state) ? { done: progress.done, total: progress.total }
    : mod && state ? mod.tally(state.rows, state.proposals) : null;

  return {
    ready: !!mod && !!state,
    progress,
    intent,
    unlinked: state ? unlinkedCount(state) : 0,
    counts,
    queue: view?.queue ?? [],
    autoMatched: view?.autoMatched ?? [],
    duplicateIds: view?.duplicateIds ?? new Set(),
    takenWorks: view?.takenWorks ?? new Set(),
    start, pause, resume, cancel, refresh,
  };
}
