export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-gray-200">
      <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>

      <p className="mb-4 text-sm text-gray-400">
        Last updated: May 7th 2026
      </p>

      <p className="mb-6">
        This service is a personal portfolio project operated by an individual
        developer. Personal data is processed in accordance with the General
        Data Protection Regulation (GDPR).
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">Data Controller</h2>
      <p>The data controller responsible for personal data processing is:</p>
      <ul className="list-disc ml-6 mt-2">
        <li>Name: Hazhir Taher</li>
        <li>
          Email:{" "}
          <a href="mailto:juztz1n@gmail.com" className="text-blue-400">
            juztz1n@gmail.com
          </a>
        </li>
        <li>Location: EU / Sweden</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-2">Data Collected</h2>
      <ul className="list-disc ml-6">
        <li>Email address</li>
        <li>Username / display name</li>
        <li>Encrypted authentication credentials</li>
        <li>User generated files stored in the system</li>
        <li>Friend / connection lists</li>
        <li>Session authentication data</li>
        <li>Anonymous visitor ID (PostHog)</li>
        <li>Page views, click events, and scroll depth (anonymized)</li>
        <li>Session recordings (only when consent is given)</li>
        <li>Device type, browser, and operating system metadata</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-2">Purpose of Processing</h2>
      <p>
        Personal data is processed to provide the functionality of the web
        application, including authentication, file storage, and social
        features.
      </p>
      <p className="mt-4">
        Anonymous analytics data is processed to understand how visitors
        interact with the portfolio and CV, and to improve the experience over
        time. This processing is based on legitimate interest.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">Third-Party Services</h2>
      <ul className="list-disc ml-6">
        <li>Vercel — application hosting</li>
        <li>Turso — database infrastructure</li>
        <li>Google — optional authentication provider</li>
        <li>
          PostHog — analytics, session recording, and anonymous usage tracking
          (EU hosted at <code>eu.i.posthog.com</code>)
        </li>
      </ul>

      <p className="mt-4">
        These providers may process limited data necessary to operate the
        service. PostHog stores analytics data on EU servers and does not share
        it with third parties for advertising purposes.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">Data Retention</h2>
      <p>
        Personal data is retained only as long as necessary to provide the
        service or until the user deletes their account. Anonymous analytics
        data is retained according to PostHog&apos;s default retention policy.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">User Rights</h2>
      <p>
        Under GDPR you may request access, correction, deletion, or restriction
        of your personal data at any time. You can also opt out of session
        recording via the cookie consent banner.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">Security</h2>
      <p>
        Reasonable technical and organizational measures are used to protect
        stored data, but no system can guarantee absolute security.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">Contact</h2>
      <p>
        For privacy requests contact:{" "}
        <a href="mailto:juztz1n@gmail.com" className="text-blue-400">
          juztz1n@gmail.com
        </a>
      </p>
    </div>
  );
}
