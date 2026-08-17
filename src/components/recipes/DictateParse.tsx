import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Mic, MicOff, Wand2 } from 'lucide-react';
import { parseRecipeText, type ParsedRecipe } from '@/lib/recipe-parse';

// Minimal Web Speech API surface (not in TS DOM lib for all targets).
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlternativeLike }
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const getSpeechRecognition = (): SpeechRecognitionCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

interface DictateParseProps {
  onApply: (parsed: ParsedRecipe) => void;
}

/**
 * "Dictate / paste" mode for the recipe dialog: a free-text area (optionally
 * fed by the Web Speech API) plus a heuristic "Parse into recipe" action.
 */
export function DictateParse({ onApply }: DictateParseProps) {
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const speechCtor = useMemo(getSpeechRecognition, []);

  useEffect(() => () => { recRef.current?.stop(); }, []);

  const stopMic = () => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
    setInterim('');
  };

  const toggleMic = () => {
    if (listening) { stopMic(); return; }
    if (!speechCtor) return;
    const rec = new speechCtor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-IN';
    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const transcript = res[0]?.transcript ?? '';
        if (res.isFinal) {
          const final = transcript.trim();
          if (final) setText((t) => (t ? `${t} ${final}` : final));
        } else {
          interimText += transcript;
        }
      }
      setInterim(interimText.trim());
    };
    rec.onend = () => { setListening(false); setInterim(''); recRef.current = null; };
    rec.onerror = () => { setListening(false); setInterim(''); recRef.current = null; };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-border bg-secondary/30 p-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">Dictate or paste the whole recipe</p>
        {speechCtor && (
          <Button
            type="button"
            size="icon-sm"
            variant={listening ? 'destructive' : 'outline'}
            className={cn('ml-auto', listening && 'animate-pulse')}
            onClick={toggleMic}
            aria-label={listening ? 'Stop dictation' : 'Start dictation'}
            title={listening ? 'Stop dictation' : 'Start dictation'}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}
      </div>
      <Textarea
        rows={5}
        placeholder={'e.g. "Lemon garlic pasta, serves 4, prep 10 minutes, cook 20 minutes. Ingredients: 200g spaghetti, 2 cloves garlic and 1 lemon. Steps: boil the pasta, then sauté the garlic, finally toss together."'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {listening && (
        <p className="text-xs text-muted-foreground">
          Listening…{interim ? ` "${interim}"` : ''}
        </p>
      )}
      {!speechCtor && (
        <p className="text-xs text-muted-foreground">
          Voice capture isn't supported by this browser — your keyboard's dictation works in any text field instead.
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!text.trim()}
          onClick={() => onApply(parseRecipeText(text))}
        >
          <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Parse into recipe
        </Button>
      </div>
    </div>
  );
}
