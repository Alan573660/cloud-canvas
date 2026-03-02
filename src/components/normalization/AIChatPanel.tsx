/**
 * AIChatPanel - AI чат панель для нормализации
 * 
 * Использует Gemini через Edge proxy (import-normalize)
 * Формирует JSON patches для preview и применения
 */

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { apiInvoke } from '@/lib/api-client';
import { type PatternGroup } from './GroupsSidebar';
import {
  MessageSquare, Send, Mic, MicOff, Loader2, ChevronUp, ChevronDown,
  Sparkles, Check, X, Code, ArrowRight
} from 'lucide-react';

// =========================================
// Types
// =========================================
interface AIChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  importJobId?: string;
  activeGroup: PatternGroup | null;
  onApplyPatch: (patch: AIGeneratedPatch) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  patch?: AIGeneratedPatch;
  timestamp: Date;
}

interface AIGeneratedPatch {
  action: 'set_width' | 'set_color' | 'set_coating' | 'set_decor';
  group_key: string;
  value: unknown;
  affected_count: number;
  preview: Array<{ original: string; modified: string }>;
}

interface AIChatResponse {
  ok: boolean;
  message?: string;
  patch?: AIGeneratedPatch;
  error?: string;
}

// =========================================
// Speech Recognition Types (Web Speech API)
// =========================================
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => ISpeechRecognition;
    webkitSpeechRecognition?: new () => ISpeechRecognition;
  }
}

// =========================================
// Speech Recognition Hook (browser native)
// =========================================
function useSpeechRecognition(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognitionClass) {
        const recognition = new SpeechRecognitionClass();
        recognition.lang = 'ru-RU';
        recognition.continuous = false;
        recognition.interimResults = false;
        
        recognition.onresult = (event: SpeechRecognitionEvent) => {
          const transcript = event.results[0][0].transcript;
          onResult(transcript);
          setIsListening(false);
        };
        
        recognition.onerror = () => {
          setIsListening(false);
        };
        
        recognition.onend = () => {
          setIsListening(false);
        };
        
        recognitionRef.current = recognition;
      }
    }
  }, [onResult]);

  const start = () => {
    if (recognitionRef.current) {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const stop = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  return { isListening, start, stop, supported: !!recognitionRef.current };
}

// =========================================
// Patch Preview Component
// =========================================
function PatchPreview({
  patch,
  onApply,
  onReject,
}: {
  patch: AIGeneratedPatch;
  onApply: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="mt-2 p-2 bg-muted/50 rounded-lg border">
      <div className="flex items-center justify-between mb-2">
        <Badge variant="secondary" className="text-xs">
          <Code className="h-3 w-3 mr-1" />
          {t('normalize.patchPreview', 'Предложение AI')}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {patch.affected_count} {t('normalize.items', 'товаров')}
        </span>
      </div>
      
      {/* Preview rows */}
      <div className="space-y-1 mb-2">
        {patch.preview.slice(0, 3).map((row, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground truncate max-w-[100px]">{row.original}</span>
            <ArrowRight className="h-3 w-3 text-primary shrink-0" />
            <span className="text-green-700 dark:text-green-400 font-mono">{row.modified}</span>
          </div>
        ))}
        {patch.preview.length > 3 && (
          <span className="text-xs text-muted-foreground">+{patch.preview.length - 3} ещё...</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" variant="default" className="flex-1 h-7 text-xs" onClick={onApply}>
          <Check className="h-3 w-3 mr-1" />
          {t('normalize.applyPatch', 'Применить')}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onReject}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// =========================================
// Main Component
// =========================================
export function AIChatPanel({
  open,
  onOpenChange,
  organizationId,
  importJobId,
  activeGroup,
  onApplyPatch,
}: AIChatPanelProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Speech recognition
  const { isListening, start: startListening, stop: stopListening, supported: voiceSupported } = useSpeechRecognition(
    (text) => setInput(prev => prev + ' ' + text)
  );

  // AI chat mutation
  const chatMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const result = await apiInvoke<AIChatResponse>('import-normalize', {
        op: 'chat',
        organization_id: organizationId,
        import_job_id: importJobId || 'current',
        message: userMessage,
        context: activeGroup ? {
          group_type: activeGroup.group_type,
          group_key: activeGroup.group_key,
          affected_count: activeGroup.affected_count,
          examples: activeGroup.examples,
        } : null,
      });

      if (!result.ok) {
        return {
          ok: false,
          message: result.error.message,
          error: result.error.message,
        } as AIChatResponse;
      }

      return result.data;
    },
    onSuccess: (data) => {
      if (data) {
        const assistantMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: data.message || data.error || t('common.error'),
          patch: data.patch,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMessage]);
      }
    },
  });

  // Send message
  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    chatMutation.mutate(input.trim());
    setInput('');
  };

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle patch apply
  const handleApplyPatch = (patch: AIGeneratedPatch) => {
    onApplyPatch(patch);
    // Mark message as applied
    setMessages(prev => prev.map(m => 
      m.patch?.group_key === patch.group_key
        ? { ...m, patch: { ...m.patch, applied: true } as AIGeneratedPatch }
        : m
    ));
  };

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      {/* Toggle Header */}
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "w-full h-10 rounded-none border-t justify-between px-4",
            open && "bg-muted/50"
          )}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">
              {t('normalize.aiChat', 'AI-ассистент')}
            </span>
            {activeGroup && (
              <Badge variant="secondary" className="text-xs">
                {activeGroup.group_key}
              </Badge>
            )}
          </div>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="h-64 border-t flex flex-col">
          {/* Messages */}
          <ScrollArea className="flex-1 p-3" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
                <Sparkles className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">{t('normalize.chatWelcome', 'Задайте вопрос или команду')}</p>
                <p className="text-xs mt-1">
                  {t('normalize.chatHint', 'Например: "Поставь для С20 ширину 1100/1150"')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex",
                      msg.role === 'user' ? "justify-end" : "justify-start"
                    )}
                  >
                    <div className={cn(
                      "max-w-[80%] rounded-lg px-3 py-2",
                      msg.role === 'user'
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}>
                      <p className="text-sm">{msg.content}</p>
                      {msg.patch && (
                        <PatchPreview
                          patch={msg.patch}
                          onApply={() => handleApplyPatch(msg.patch!)}
                          onReject={() => {
                            setMessages(prev => prev.map(m =>
                              m.id === msg.id ? { ...m, patch: undefined } : m
                            ));
                          }}
                        />
                      )}
                    </div>
                  </div>
                ))}
                {chatMutation.isPending && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-3 py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* Input */}
          <div className="p-2 border-t flex items-center gap-2">
            {voiceSupported && (
              <Button
                variant={isListening ? 'destructive' : 'outline'}
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => isListening ? stopListening() : startListening()}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
            )}
            <Input
              placeholder={t('normalize.chatPlaceholder', 'Введите команду или вопрос...')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              className="h-8 text-sm"
            />
            <Button
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleSend}
              disabled={!input.trim() || chatMutation.isPending}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
