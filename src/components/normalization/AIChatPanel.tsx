/**
 * AIChatPanel - AI чат панель для нормализации
 * 
 * Uses ai_chat_v2 contract via import-normalize Edge Function.
 * Returns actions[] for preview and batch application.
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
import { hasInvalidConfirmActions, normalizeAndValidateConfirmActions } from '@/lib/confirm-action-guards';
import { type PatternGroup } from './GroupsSidebar';
import type { AiChatV2Result, AiChatV2Action, ConfirmAction } from '@/lib/contract-types';
import {
  MessageSquare, Send, Loader2, ChevronUp, ChevronDown,
  Sparkles, Check, X, Code, ArrowRight, Play, AlertTriangle
} from 'lucide-react';

// =========================================
// Types
// =========================================
interface AIChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  importJobId?: string;
  runId?: string;
  activeGroup: PatternGroup | null;
  onApplyPatch: (actions: AiChatV2Action[]) => void;
  confirmActions?: (actions: ConfirmAction[]) => Promise<unknown>;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: AiChatV2Action[];
  actionsApplied?: boolean;
  missingFields?: string[];
  requiresConfirm?: boolean;
  isError?: boolean;
  timestamp: Date;
}

// =========================================
// Action Preview Component
// =========================================
function ActionPreview({
  actions,
  missingFields,
  requiresConfirm,
  onApply,
  onReject,
  applying,
}: {
  actions: AiChatV2Action[];
  missingFields?: string[];
  requiresConfirm?: boolean;
  onApply: () => void;
  onReject: () => void;
  applying: boolean;
}) {
  const { t } = useTranslation();
  const isBlocked = missingFields && missingFields.length > 0;
  const hasInvalidActions = hasInvalidConfirmActions(actions.map(a => ({ type: a.type, payload: a.payload })));

  return (
    <div className="mt-2 p-2 bg-muted/50 rounded-lg border">
      <div className="flex items-center justify-between mb-2">
        <Badge variant="secondary" className="text-xs">
          <Code className="h-3 w-3 mr-1" />
          {t('normalize.pendingActions', 'Ожидающие изменения')}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {actions.length} {t('normalize.actions', 'действий')}
        </span>
      </div>
      
      {/* Action list */}
      <div className="space-y-1 mb-2">
        {actions.slice(0, 4).map((action, i) => (
          <div key={i} className="text-[10px] font-mono bg-background/50 rounded px-2 py-1 truncate">
            <span className="text-primary font-semibold">{action.type}</span>
            {': '}
            {JSON.stringify(action.payload).substring(0, 80)}
          </div>
        ))}
        {actions.length > 4 && (
          <span className="text-xs text-muted-foreground">+{actions.length - 4} ещё...</span>
        )}
      </div>

      {/* Missing fields / invalid WIDTH warning */}
      {(isBlocked || hasInvalidWidth) && (
        <div className="flex items-center gap-1 text-xs text-destructive mb-2 bg-destructive/5 rounded px-2 py-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {isBlocked
            ? <>{t('normalize.missingFields', 'Требуется уточнение')}: {missingFields!.join(', ')}</>
            : <>WIDTH_MASTER: {t('normalize.profileRequired', 'профиль не указан')}</>
          }
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button 
          size="sm" variant="default" className="flex-1 h-7 text-xs" 
          onClick={onApply}
          disabled={isBlocked || applying || hasInvalidActions}
        >
          {applying ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Check className="h-3 w-3 mr-1" />
          )}
          {requiresConfirm 
            ? t('normalize.confirmAndApply', 'Подтвердить и применить')
            : t('normalize.applyActions', 'Применить')
          }
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
  runId,
  activeGroup,
  onApplyPatch,
  confirmActions: confirmActionsFn,
}: AIChatPanelProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // AI chat mutation — uses ai_chat_v2 contract
  const chatMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const result = await apiInvoke<AiChatV2Result>('import-normalize', {
        op: 'ai_chat_v2',
        organization_id: organizationId,
        import_job_id: importJobId || 'current',
        run_id: runId || null,
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
          assistant_message: result.error.message,
          actions: [],
          error: result.error.message,
        } as AiChatV2Result;
      }

      return result.data;
    },
    onSuccess: (data) => {
      if (!data) return;
      
      // Handle AI disabled / timeout
      if (data.ok === false) {
        let errMsg = data.error || t('common.error');
        if (data.code === 'TIMEOUT') errMsg = '⏱ ИИ не ответил вовремя. Попробуйте ещё раз.';
        if (data.ai_disabled) errMsg = `ИИ отключён: ${data.ai_skip_reason || 'неизвестная причина'}`;
        
        const errorMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ ${errMsg}`,
          isError: true,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
        return;
      }

      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: data.assistant_message || '',
        actions: data.actions && data.actions.length > 0 ? data.actions : undefined,
        missingFields: data.missing_fields,
        requiresConfirm: data.requires_confirm,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
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

  // Handle actions apply via confirmActions batch
  const handleApplyActions = async (actions: AiChatV2Action[], msgIndex: number) => {
    // PR2: Validate WIDTH_MASTER actions have profile
    const invalidWidth = actions.find(a => a.type === 'WIDTH_MASTER' && !a.payload?.profile);
    if (invalidWidth) {
      console.error('[AIChatPanel] WIDTH_MASTER rejected: missing profile', invalidWidth.payload);
      return;
    }

    setApplyingIdx(msgIndex);
    try {
      const confirmPayload: ConfirmAction[] = actions.map(a => ({ type: a.type, payload: a.payload }));
      const guarded = normalizeAndValidateConfirmActions(confirmPayload);
      if (guarded.issues.length > 0) {
        throw new Error(`${guarded.issues[0].type}: ${guarded.issues[0].reason}`);
      }
      if (confirmActionsFn) {
        await confirmActionsFn(guarded.actions);
      }
      
      // Mark as applied
      setMessages(prev => prev.map((m, i) => 
        i === msgIndex ? { ...m, actionsApplied: true } : m
      ));
      
      onApplyPatch(actions);
    } catch (err) {
      console.error('[AIChatPanel] Apply error:', err);
    } finally {
      setApplyingIdx(null);
    }
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
                {messages.map((msg, idx) => (
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
                        : msg.isError
                          ? "bg-destructive/10 text-destructive border border-destructive/20"
                          : "bg-muted"
                    )}>
                      <p className="text-sm whitespace-pre-line">{msg.content}</p>
                      
                      {/* Actions preview */}
                      {msg.actions && msg.actions.length > 0 && !msg.actionsApplied && (
                        <ActionPreview
                          actions={msg.actions}
                          missingFields={msg.missingFields}
                          requiresConfirm={msg.requiresConfirm}
                          onApply={() => handleApplyActions(msg.actions!, idx)}
                          onReject={() => {
                            setMessages(prev => prev.map(m =>
                              m.id === msg.id ? { ...m, actions: undefined } : m
                            ));
                          }}
                          applying={applyingIdx === idx}
                        />
                      )}
                      
                      {/* Applied indicator */}
                      {msg.actionsApplied && (
                        <div className="mt-1 text-[10px] text-primary flex items-center gap-1">
                          <Check className="h-3 w-3" /> Применено!
                        </div>
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
