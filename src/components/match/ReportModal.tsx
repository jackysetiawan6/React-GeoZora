import { useState, FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { X, Send, AlertTriangle } from 'lucide-react';
import { StreetViewTarget } from '../../lib/MatchGame';
import { cn } from '../../lib/utils';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: StreetViewTarget | null;
}

export default function ReportModal({ isOpen, onClose, target }: ReportModalProps) {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !user) return;

    setSubmitting(true);
    setError(null);

    try {
      const { error: insertError } = await supabase.from('feedbacks').insert({
        user_id: user.isAnonymous ? null : user.uid,
        player_name: user.displayName || 'Guest',
        type: 'report',
        message: message.trim(),
        details: target ? {
          lat: target.lat,
          lng: target.lng,
          heading: target.heading,
          pitch: target.pitch
        } : null,
      });

      if (insertError) throw insertError;
      
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setMessage('');
      }, 2000);
    } catch (err) {
      setError('Failed to submit report. Please try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-2xl w-full max-w-md relative z-10 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-[var(--color-app-border-light)] flex items-center justify-between">
          <h2 className="text-lg font-black text-[var(--color-app-text)] flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" /> Report Issue
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-[var(--color-app-hover)] rounded-full transition-colors"><X className="w-5 h-5 text-[var(--color-app-text-muted)]" /></button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6">
          {success ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Send className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Report Submitted!</h3>
              <p className="text-sm text-[var(--color-app-text-muted)]">Thank you for helping us improve.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[var(--color-app-text-muted)]">
                Is there an issue with this location? Let us know what's wrong (e.g., black screen, indoor location, blurry image).
              </p>
              
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe the issue..."
                rows={4}
                className="w-full bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-xl p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/50 resize-none"
                required
              />

              {error && (
                <div className="text-red-500 text-xs font-medium bg-red-500/10 p-2 rounded">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3 mt-2">
                <button 
                  type="button" 
                  onClick={onClose} 
                  className="px-4 py-2 rounded-xl text-sm font-bold text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="bg-amber-600 hover:bg-amber-700 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 shadow shadow-amber-500/20 transition-all text-sm disabled:opacity-50"
                  disabled={submitting || !message.trim()}
                >
                  {submitting ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
