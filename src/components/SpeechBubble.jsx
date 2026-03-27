import { Paper, Text } from '@mantine/core';

const assistantToneClasses = {
  neutral: {
    bubble: 'border-cyan-200/12 bg-slate-950/58 text-slate-50',
    label: 'text-cyan-100/70',
  },
  success: {
    bubble: 'border-emerald-300/20 bg-emerald-500/10 text-emerald-50',
    label: 'text-emerald-100/85',
  },
  pending: {
    bubble: 'border-amber-300/20 bg-amber-500/10 text-amber-50',
    label: 'text-amber-100/85',
  },
  error: {
    bubble: 'border-rose-300/20 bg-rose-500/10 text-rose-50',
    label: 'text-rose-100/85',
  },
};

function SpeechBubble({
  speaker,
  label,
  message,
  centered = false,
  tone = 'neutral',
  compact = false,
  streaming = false,
}) {
  const isAssistant = speaker === 'assistant';
  const alignmentClass = centered
    ? 'justify-center'
    : isAssistant
      ? 'justify-start'
      : 'justify-end';
  const assistantClasses =
    assistantToneClasses[tone] || assistantToneClasses.neutral;
  const bubbleWidthClass = centered
    ? 'max-w-3xl'
    : compact
      ? 'max-w-[88%]'
      : 'max-w-full';

  return (
    <div className={`flex w-full ${alignmentClass}`}>
      <Paper
        radius={compact ? '24px' : '28px'}
        p={compact ? 'md' : 'lg'}
        shadow="md"
        className={`border backdrop-blur ${
          isAssistant
            ? `${bubbleWidthClass} ${assistantClasses.bubble}`
            : `${bubbleWidthClass} border-cyan-300/20 bg-cyan-400/10 text-cyan-50`
        }`}
      >
        <Text
          className={`${compact ? 'text-[0.68rem]' : 'text-xs'} font-semibold uppercase tracking-[0.3em] ${
            isAssistant ? assistantClasses.label : 'text-cyan-100'
          }`}
        >
          {label}
        </Text>
        <Text
          className={`mt-3 whitespace-pre-wrap ${
            compact
              ? 'text-sm leading-6 sm:text-[0.96rem]'
              : 'text-lg leading-relaxed sm:text-xl'
          }`}
        >
          {message}
          {streaming ? (
            <span className="ml-1 inline-block h-4 w-[2px] animate-pulse bg-current align-middle opacity-85" />
          ) : null}
        </Text>
      </Paper>
    </div>
  );
}

export default SpeechBubble;
