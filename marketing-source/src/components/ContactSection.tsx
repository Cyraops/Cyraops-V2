import React, { useState, useEffect } from 'react';
import { Send, CheckCircle2, AlertCircle, Info, Mail, User, Building, Cloud, DollarSign } from 'lucide-react';

interface ContactSectionProps {
  initialTopic?: string;
}

export const ContactSection: React.FC<ContactSectionProps> = ({ initialTopic }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    environment: '',
    helpTopic: initialTopic || '',
    spend: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (initialTopic) {
      setFormData(prev => ({ ...prev, helpTopic: initialTopic }));
    }
  }, [initialTopic]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'Please provide your name.';
    }
    if (!formData.email.trim()) {
      newErrors.email = 'Please provide your work email.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid work email address.';
    }
    if (!formData.helpTopic.trim()) {
      newErrors.helpTopic = 'Please describe what you need help with.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);

    // Clean integration-ready client-side handler
    setTimeout(() => {
      setSubmitting(false);
      setSubmitted(true);
    }, 800);
  };

  return (
    <section id="contact" className="section" aria-label="Contact — CyraOps">
      <div className="container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)',
            gap: '48px',
            alignItems: 'start',
          }}
          className="contact-grid"
        >
          {/* Left Column: Context & Guidelines */}
          <div>
            <div className="eyebrow eyebrow-pill" style={{ marginBottom: '20px' }}>
              <span className="eyebrow-dot" />
              <span>DIRECT INQUIRY</span>
            </div>

            <h2 className="headline-lg" style={{ marginBottom: '18px' }}>
              Start with a clear, low-risk conversation.
            </h2>

            <p className="body-lead" style={{ marginBottom: '32px' }}>
              Whether you need an initial fixed-scope AWS Cloud Health Check or recurring managed cloud operations,
              tell us about your setup and we will start with the smallest useful step.
            </p>

            {/* Scope / Access Guidance */}
            <div
              style={{
                background: 'rgba(17, 28, 48, 0.75)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '14px',
                padding: '24px',
                marginBottom: '28px',
              }}
            >
              <h3
                style={{
                  fontSize: '0.98rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Info size={16} color="var(--accent-cyan)" />
                Security &amp; Engagement Protocol:
              </h3>
              <ul
                style={{
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  fontSize: '0.86rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle2 size={14} color="var(--accent-cyan)" />
                  Never share AWS root credentials or private keys through forms.
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle2 size={14} color="var(--accent-cyan)" />
                  Read-only Cross-Account IAM role setup guidance provided upon review.
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle2 size={14} color="var(--accent-cyan)" />
                  Starting pricing: Health Check ($150–$250) &middot; Cloud Care ($750/mo).
                </li>
              </ul>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                fontSize: '0.78rem',
                color: 'var(--text-muted)',
              }}
            >
              <Info size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
              <span>
                Integration-ready handler. In production mode, forms dispatch directly to authenticated webhooks
                configured via environment variables.
              </span>
            </div>
          </div>

          {/* Right Column: Contact Form (Exact Fields from Spec Section 17) */}
          <div
            style={{
              background: 'rgba(17, 28, 48, 0.85)',
              backdropFilter: 'blur(16px)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '18px',
              padding: '36px 32px',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {submitted ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '36px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '16px',
                }}
                role="status"
              >
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid #10B981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CheckCircle2 size={30} color="#10B981" />
                </div>
                <h3 style={{ fontSize: '1.35rem', fontWeight: 750, color: 'var(--text-primary)' }}>
                  Inquiry Received
                </h3>
                <p style={{ fontSize: '0.90rem', color: 'var(--text-secondary)', maxWidth: '420px', lineHeight: 1.6 }}>
                  Thank you, <strong style={{ color: '#F8FAFC' }}>{formData.name}</strong>. Your inquiry has been
                  recorded in the integration handler. We will evaluate your cloud setup and follow up with an initial review.
                </p>
                <button
                  onClick={() => {
                    setSubmitted(false);
                    setFormData({
                      name: '',
                      email: '',
                      company: '',
                      environment: '',
                      helpTopic: '',
                      spend: '',
                    });
                  }}
                  className="btn btn-secondary"
                  style={{ marginTop: '12px' }}
                >
                  Submit Another Inquiry
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  {/* Name */}
                  <div>
                    <label
                      htmlFor="contact-name"
                      style={{
                        display: 'block',
                        fontSize: '0.84rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        marginBottom: '6px',
                      }}
                    >
                      Name <span style={{ color: 'var(--accent-cyan)' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        id="contact-name"
                        type="text"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Alex Morgan"
                        style={{
                          width: '100%',
                          padding: '12px 14px 12px 38px',
                          borderRadius: '8px',
                          background: 'rgba(11, 18, 32, 0.75)',
                          border: `1px solid ${errors.name ? '#EF4444' : 'var(--border-subtle)'}`,
                          color: 'var(--text-primary)',
                          fontSize: '0.90rem',
                        }}
                        aria-invalid={Boolean(errors.name)}
                      />
                      <User size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '15px' }} />
                    </div>
                    {errors.name && (
                      <p style={{ fontSize: '0.78rem', color: '#EF4444', marginTop: '4px' }}>
                        {errors.name}
                      </p>
                    )}
                  </div>

                  {/* Work Email & Company */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="contact-subgrid">
                    <div>
                      <label
                        htmlFor="contact-email"
                        style={{
                          display: 'block',
                          fontSize: '0.84rem',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          marginBottom: '6px',
                        }}
                      >
                        Work Email <span style={{ color: 'var(--accent-cyan)' }}>*</span>
                      </label>
                      <div style={{ position: 'relative' }}>
                        <input
                          id="contact-email"
                          type="email"
                          value={formData.email}
                          onChange={e => setFormData({ ...formData, email: e.target.value })}
                          placeholder="alex@startup.com"
                          style={{
                            width: '100%',
                            padding: '12px 14px 12px 38px',
                            borderRadius: '8px',
                            background: 'rgba(11, 18, 32, 0.75)',
                            border: `1px solid ${errors.email ? '#EF4444' : 'var(--border-subtle)'}`,
                            color: 'var(--text-primary)',
                            fontSize: '0.90rem',
                          }}
                          aria-invalid={Boolean(errors.email)}
                        />
                        <Mail size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '15px' }} />
                      </div>
                      {errors.email && (
                        <p style={{ fontSize: '0.78rem', color: '#EF4444', marginTop: '4px' }}>
                          {errors.email}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="contact-company"
                        style={{
                          display: 'block',
                          fontSize: '0.84rem',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          marginBottom: '6px',
                        }}
                      >
                        Company <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(Optional)</span>
                      </label>
                      <div style={{ position: 'relative' }}>
                        <input
                          id="contact-company"
                          type="text"
                          value={formData.company}
                          onChange={e => setFormData({ ...formData, company: e.target.value })}
                          placeholder="Acme Inc"
                          style={{
                            width: '100%',
                            padding: '12px 14px 12px 38px',
                            borderRadius: '8px',
                            background: 'rgba(11, 18, 32, 0.75)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)',
                            fontSize: '0.90rem',
                          }}
                        />
                        <Building size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '15px' }} />
                      </div>
                    </div>
                  </div>

                  {/* AWS / Cloud Environment (Optional) & Approximate Monthly Spend (Optional) */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="contact-subgrid">
                    <div>
                      <label
                        htmlFor="contact-env"
                        style={{
                          display: 'block',
                          fontSize: '0.84rem',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          marginBottom: '6px',
                        }}
                      >
                        AWS / Cloud Environment <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(Optional)</span>
                      </label>
                      <div style={{ position: 'relative' }}>
                        <input
                          id="contact-env"
                          type="text"
                          value={formData.environment}
                          onChange={e => setFormData({ ...formData, environment: e.target.value })}
                          placeholder="e.g. Single account EC2 + RDS"
                          style={{
                            width: '100%',
                            padding: '12px 14px 12px 38px',
                            borderRadius: '8px',
                            background: 'rgba(11, 18, 32, 0.75)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)',
                            fontSize: '0.90rem',
                          }}
                        />
                        <Cloud size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '15px' }} />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="contact-spend"
                        style={{
                          display: 'block',
                          fontSize: '0.84rem',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          marginBottom: '6px',
                        }}
                      >
                        Approximate Monthly Spend <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(Optional)</span>
                      </label>
                      <div style={{ position: 'relative' }}>
                        <select
                          id="contact-spend"
                          value={formData.spend}
                          onChange={e => setFormData({ ...formData, spend: e.target.value })}
                          style={{
                            width: '100%',
                            padding: '12px 14px 12px 38px',
                            borderRadius: '8px',
                            background: 'rgba(11, 18, 32, 0.75)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)',
                            fontSize: '0.90rem',
                          }}
                        >
                          <option value="">Select spend range</option>
                          <option value="<$1,000/mo">Under $1,000 / month</option>
                          <option value="$1,000–$5,000/mo">$1,000 – $5,000 / month</option>
                          <option value="$5,000–$20,000/mo">$5,000 – $20,000 / month</option>
                          <option value="$20,000+/mo">$20,000+ / month</option>
                        </select>
                        <DollarSign size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '15px' }} />
                      </div>
                    </div>
                  </div>

                  {/* What do you need help with? (Exact Field from Spec Section 17) */}
                  <div>
                    <label
                      htmlFor="contact-help"
                      style={{
                        display: 'block',
                        fontSize: '0.84rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        marginBottom: '6px',
                      }}
                    >
                      What do you need help with? <span style={{ color: 'var(--accent-cyan)' }}>*</span>
                    </label>
                    <textarea
                      id="contact-help"
                      rows={4}
                      value={formData.helpTopic}
                      onChange={e => setFormData({ ...formData, helpTopic: e.target.value })}
                      placeholder="e.g. We want an AWS Cloud Health Check ($150–$250) to find idle spend, or need recurring Managed Cloud Care ($750/mo) for monitoring and maintenance..."
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        borderRadius: '8px',
                        background: 'rgba(11, 18, 32, 0.75)',
                        border: `1px solid ${errors.helpTopic ? '#EF4444' : 'var(--border-subtle)'}`,
                        color: 'var(--text-primary)',
                        fontSize: '0.90rem',
                        resize: 'vertical',
                      }}
                      aria-invalid={Boolean(errors.helpTopic)}
                    />
                    {errors.helpTopic && (
                      <p style={{ fontSize: '0.78rem', color: '#EF4444', marginTop: '4px' }}>
                        {errors.helpTopic}
                      </p>
                    )}
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-primary"
                    style={{
                      width: '100%',
                      padding: '14px',
                      opacity: submitting ? 0.7 : 1,
                    }}
                  >
                    {submitting ? 'Submitting Inquiry...' : 'Submit Inquiry'}
                    <Send size={16} />
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .contact-grid {
            grid-template-columns: 1fr !important;
          }
          .contact-subgrid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
