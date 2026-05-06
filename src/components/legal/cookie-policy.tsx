export default function CookiePolicy() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-gray-200">
      <h1 className="text-3xl font-bold mb-6">Cookie Policy</h1>

      <p className="mb-4 text-sm text-gray-400">
        Last updated: May 7th 2026
      </p>

      <p>
        This website uses cookies and similar technologies for two purposes:
        authentication and analytics. This policy explains what each category
        does and how you can control them.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">Essential Cookies</h2>

      <p>
        These cookies are required to maintain login sessions, authenticate
        users, and protect against security threats. They cannot be disabled
        without breaking the core functionality of the application.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">Analytics Cookies</h2>

      <p>
        This site uses <strong>PostHog</strong> for analytics, which includes
        page view tracking, click and interaction events, scroll depth
        measurement, and session recordings. Analytics data is anonymized —
        no personally identifiable information is stored. PostHog data is
        hosted on EU servers (<code>eu.i.posthog.com</code>) in compliance
        with GDPR.
      </p>

      <p className="mt-4">
        PostHog sets <code>ph_*</code> cookies in your browser to assign you
        an anonymous visitor ID that persists across page loads. This ID is
        not linked to any personal information.
      </p>

      <p className="mt-4">
        Session recording — which captures a replay of your interaction with
        the page — requires your explicit consent and is only enabled when you
        click <strong>&quot;Accept&quot;</strong> on the cookie banner. If you
        click <strong>&quot;Decline&quot;</strong>, session recording is
        disabled. All other anonymous analytics continue as they are covered
        under legitimate interest.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">
        Third-Party Authentication
      </h2>

      <p>
        If you sign in using Google, authentication is handled by Google and
        may involve cookies set by Google&apos;s services.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">Managing Cookies</h2>

      <p>
        You can opt out of session recording at any time by clicking
        &quot;Decline&quot; on the cookie banner. You may also disable cookies
        entirely in your browser settings, though doing so may prevent the
        service from functioning properly.
      </p>
    </div>
  );
}
