'use client';

import { useState } from 'react';
import { Mail, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Reveal } from '@/components/domain/marketing/reveal';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

/**
 * Deliberately NOT wired to a lead-capture API — no such endpoint exists in
 * this backend (Phase 2 scope never included a marketing CRM/lead pipeline),
 * and faking a "your request was sent" success toast when nothing was
 * actually persisted would be a real dishonesty, not a shortcut. Submitting
 * opens the visitor's own email client via a pre-filled `mailto:` link
 * instead — genuinely delivers the message, no backend required.
 */
export function ContactSection({ content }: { content: FlatLandingPageContent['contact'] }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(content.mailtoSubject);
    const body = encodeURIComponent(`Ім'я: ${name}\nEmail: ${email}\n\n${message}`);
    window.location.href = `mailto:${content.salesEmail}?subject=${subject}&body=${body}`;
  }

  return (
    <section id="contact" className="border-t border-border py-20 sm:py-28">
      <div className="container">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-12 lg:grid-cols-2">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{content.heading}</h2>
            <p className="mt-4 text-lg text-muted-foreground">{content.subheading}</p>

            <div className="mt-8 space-y-4">
              <a href={`mailto:${content.salesEmail}`} className="flex items-center gap-3 text-sm hover:text-primary">
                <Mail className="h-4 w-4 text-muted-foreground" />
                {content.salesEmail}
              </a>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <MessageCircle className="h-4 w-4" />
                {content.responseTimeNote}
              </div>
            </div>
          </Reveal>

          <Reveal delayMs={100}>
            <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
              <div className="space-y-1.5">
                <Label htmlFor="contact-name">Ім&rsquo;я</Label>
                <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-email">Робочий email</Label>
                <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-message">Повідомлення</Label>
                <Textarea
                  id="contact-message"
                  rows={4}
                  placeholder="Розкажіть коротко про ваш бізнес і процеси"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full">
                {content.formSubmitLabel}
              </Button>
            </form>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
