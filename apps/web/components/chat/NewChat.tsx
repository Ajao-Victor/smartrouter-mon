'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { clsx } from 'clsx';
import { ArrowUp } from 'lucide-react';

import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { TASK_TYPES, type Option, type TaskType } from '@/lib/api/types';
import { env } from '@/lib/env';

import { useAuth } from '@/hooks/useAuth';
import { useCreateChat } from '@/hooks/useChats';
import { useMe } from '@/hooks/useMe';
import { useAllocationStore } from '@/stores/allocationStore';
import { useComposerStore } from '@/stores/composerStore';
import { toast } from '@/stores/toastStore';

import { ModelOptions } from '@/components/chat/ModelOptions';

export const TASK_LABEL: Record<TaskType, string> = {
  chat: 'Chat',
  writing: 'Writing',
  coding: 'Coding',
  research: 'Research',
  translation: 'Translation',
  image: 'Image',
  music: 'Music',
};

export interface NewChatProps {
  /** Preselected category from `?category=` (validated by the page). */
  initialCategory?: TaskType | null;
}

/** Guest recommendations shown in place (`POST /recommend` → `guest: true`, no quotes). */
interface GuestOptions {
  prompt: string;
  options: Option[];
}

/**
 * "New chat": pick a category or describe the task. Signed in, `POST /chats { taskType?,
 * description?, slider? }` answers with the chat id and quoted options for the workspace.
 *
 * Signed out (Handover "Guest mode"): the same screen works — a description gets recommendations
 * from `POST /recommend` (estimated prices, nothing to pay against). Picking a model or starting
 * the chat keeps what was typed, opens the Privy sign-in modal, and carries on automatically once
 * sign-in completes.
 */
export function NewChat({ initialCategory = null }: NewChatProps) {
  const router = useRouter();
  const me = useMe();
  const auth = useAuth();
  const category = useComposerStore((s) => s.category);
  const setCategory = useComposerStore((s) => s.setCategory);
  const sliderOverride = useComposerStore((s) => s.sliderOverride);
  const paidRunsEnabled = useAllocationStore((s) => s.paidRunsEnabled);
  const [draft, setDraft] = useState('');
  const [guest, setGuest] = useState<GuestOptions | null>(null);
  const [recommending, setRecommending] = useState(false);
  const create = useCreateChat();
  const selected = category ?? initialCategory;
  const description = draft.trim();

  /** Signed in: create the chat; `runModelId` (a guest's pick) is sent as soon as the chat opens. */
  const createChat = async (input: { description: string; taskType: TaskType | null; runModelId?: string | null }) => {
    const slider = sliderOverride ?? me.data?.slider;
    try {
      const res = await create.mutateAsync({
        ...(input.taskType ? { taskType: input.taskType } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(slider ? { slider } : {}),
      });
      const composer = useComposerStore.getState();
      composer.setDraft('');
      composer.selectModel(input.runModelId ?? null);
      if (input.runModelId !== undefined && input.description) {
        composer.setPendingOptions(null);
        composer.setAutoRun({ chatId: res.chatId, prompt: input.description, modelId: input.runModelId });
      } else {
        composer.setPendingOptions(input.description && res.options.length > 0 ? { chatId: res.chatId, prompt: input.description, options: res.options } : null);
        if (input.description && res.options.length === 0) composer.setDraft(input.description);
      }
      router.push(`/chat/${res.chatId}`);
    } catch (err) {
      toast.error('Could not start the chat', isApiError(err) ? err.message : undefined);
    }
  };

  /** Guest: `POST /recommend` works signed out (estimated prices, `quoteId: null`). */
  const recommendAsGuest = async () => {
    const slider = sliderOverride ?? undefined;
    setRecommending(true);
    try {
      const res = await api.catalog.recommend({ prompt: description, ...(slider ? { slider } : {}), ...(selected ? { taskType: selected } : {}) });
      setGuest({ prompt: description, options: res.options });
      if (res.options.length === 0) toast.info('No recommendations yet', 'Sign in and send it — SmartRouter picks a model for you.');
    } catch (err) {
      toast.error('Could not get recommendations', isApiError(err) ? err.message : undefined);
    } finally {
      setRecommending(false);
    }
  };

  const start = async () => {
    if (!description && !selected) {
      toast.warn('Pick a category or describe the task');
      return;
    }
    if (auth.isSignedIn) {
      await createChat({ description, taskType: selected });
      return;
    }
    if (description) {
      await recommendAsGuest();
      return;
    }
    // Category only: sign in, then open the chat.
    const taskType = selected;
    auth.signIn(() => {
      void createChat({ description: '', taskType });
    });
  };

  /** Guest picked a model: keep the message, sign in, then create the chat and send it. */
  const onGuestPick = (o: Option) => {
    if (!guest) return;
    const prompt = guest.prompt;
    const taskType = selected;
    auth.signIn(() => {
      void createChat({ description: prompt, taskType, runModelId: o.modelId });
    });
  };

  const busy = create.isPending || recommending || auth.signingIn;
  const guestOptions = guest && guest.prompt === description ? guest.options.filter((o) => paidRunsEnabled || o.free) : null;

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text-0 sm:text-3xl">What do you want done?</h1>
        <p className="text-sm text-text-2">Describe the task. SmartRouter quotes the best models for it before anything runs.</p>
      </div>

      <form
        className="rounded-xl bg-bg-1 shadow-hairline-strong transition-[box-shadow] focus-within:shadow-glow-accent"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <textarea
          aria-label="Describe the task"
          placeholder="Write a cover letter for a payments engineer role at Paystack…"
          value={draft}
          rows={3}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void start();
            }
          }}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-base leading-6 text-text-0 outline-none placeholder:text-text-2"
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-2">
          <p className="px-2 text-xs text-text-2">{description ? 'You pick the model next — nothing runs before you see the price.' : 'Or just pick a category below.'}</p>
          <button
            type="submit"
            disabled={busy || (!description && !selected)}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-accent px-3 whitespace-nowrap text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-40"
          >
            {create.isPending || recommending ? 'Starting…' : auth.signingIn ? 'Signing in…' : description ? 'Get options' : 'Start chat'}
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </div>
      </form>

      {guestOptions && guestOptions.length > 0 && (
        <ModelOptions
          title="Pick a model for this task"
          description="Estimated prices. Sign in with email or Google to run it — your message is kept and sent right after."
          options={guestOptions}
          onPick={onGuestPick}
          disabled={busy}
        />
      )}

      <div className="flex flex-wrap gap-2" aria-label="Task categories">
        {TASK_TYPES.filter((t) => t !== 'music' || env.flagMusic).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={selected === t}
            onClick={() => {
              setCategory(selected === t ? null : t);
            }}
            className={clsx(
              'h-9 rounded-pill px-3.5 text-sm transition-colors',
              selected === t ? 'bg-accent/20 text-text-0 shadow-hairline-strong' : 'bg-bg-1 text-text-1 shadow-hairline hocus:bg-bg-2 hocus:text-text-0',
            )}
          >
            {TASK_LABEL[t]}
          </button>
        ))}
      </div>
    </section>
  );
}
