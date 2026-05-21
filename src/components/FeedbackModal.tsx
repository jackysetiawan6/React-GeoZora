import { useState, useRef, useEffect } from 'react';
import { X, Send } from 'lucide-react';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { toast } from 'sonner';
import { useFocusTrap } from '../lib/useFocusTrap';

type FeedbackType = 'feedback' | 'bug' | 'feature';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const { user } = useAuth();
  const [type, setType] = useState<FeedbackType>('feedback');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleSubmit = async () => {
    if (!user) {
      toast.error('You must be logged in to submit feedback');
      return;
    }

    if (!message.trim()) {
      toast.error('Please enter a message');
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.from('feedbacks').insert({
        user_id: user.isAnonymous ? null : user.uid,
        player_name: user.displayName || 'Guest',
        type,
        message: message.trim(),
        details: null,
      });

      if (error) throw error;

      toast.success('Thank you! Your feedback has been submitted.');
      setMessage('');
      setType('feedback');
      onClose();
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      toast.error('Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[99] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div 
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-title"
          className="bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200"
        >
          {/* Header */}
          <div className="p-5 border-b border-[var(--color-app-border-light)] flex items-center justify-between">
            <h2 id="feedback-title" className="text-lg font-black text-[var(--color-app-text)]">
              Send Feedback
            </h2>
            <button
              onClick={onClose}
              aria-label="Close modal"
              className="p-1.5 hover:bg-[var(--color-app-hover)] rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-[var(--color-app-text-muted)]" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 flex flex-col gap-4">
            {/* Type Selector */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)]">
                Type
              </span>
              <div className="grid grid-cols-3 gap-2">
                {(['feedback', 'bug', 'feature'] as FeedbackType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    type="button"
                    className={cn(
                      'px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors border',
                      type === t
                        ? 'bg-[var(--color-app-blue)]/20 text-[var(--color-app-blue)] border-[var(--color-app-blue)]/30'
                        : 'bg-[var(--color-app-bg)] text-[var(--color-app-text-muted)] border-[var(--color-app-border)] hover:border-[var(--color-app-border-light)]'
                    )}
                  >
                    {t === 'feedback' && '💬 Feedback'}
                    {t === 'bug' && '🐛 Bug'}
                    {t === 'feature' && '✨ Feature'}
                  </button>
                ))}
              </div>
            </div>

            {/* Message Input */}
            <div className="flex flex-col gap-2">
              <label htmlFor="feedback-message" className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)]">
                Message
              </label>
              <textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell us what's on your mind..."
                className="w-full bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-3 text-sm text-[var(--color-app-text)] placeholder-[var(--color-app-text-muted)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/50"
                rows={4}
                maxLength={500}
              />
              <div className="text-xs text-[var(--color-app-text-muted)]">
                {message.length} / 500
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 bg-[var(--color-app-bg)]/30 border-t border-[var(--color-app-border-light)] flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-bold text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !message.trim()}
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-bold bg-[var(--color-app-blue)] text-white hover:bg-blue-500 transition-colors disabled:opacity-50 flex items-center gap-2 shadow shadow-blue-500/20"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
              {isSubmitting ? 'Sending...' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
