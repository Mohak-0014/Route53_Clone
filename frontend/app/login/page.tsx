"use client";

import Image from "next/image";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import Checkbox from "@cloudscape-design/components/checkbox";
import Flashbar from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import { useAuth } from "@/components/providers/AuthProvider";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { errorMessage } from "@/lib/api";

const REMEMBER_KEY = "r53.rememberedAccount";

function readRemembered(): string {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeRemembered(accountId: string | null) {
  try {
    if (accountId) window.localStorage.setItem(REMEMBER_KEY, accountId);
    else window.localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Sign-in page laid out like the AWS IAM user sign-in. Authentication itself is mocked. */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { status, login } = useAuth();
  const { items, clearAll } = useNotifications();
  const [accountId, setAccountId] = useState("");
  const [remember, setRemember] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const next = params.get("next");
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/hosted-zones";

  useEffect(() => {
    const saved = readRemembered();
    if (saved) {
      setAccountId(saved);
      setRemember(true);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") router.replace(destination);
  }, [status, destination, router]);

  const submit = async () => {
    setSubmitted(true);
    if (!accountId || !username || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(accountId, username, password);
      writeRemembered(remember ? accountId.trim() : null);
      clearAll();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (status !== "unauthenticated") {
    return (
      <div className="r53-center">
        <Spinner size="large" />
      </div>
    );
  }

  const required = (v: string, label: string) => (submitted && !v ? `${label} is required.` : undefined);

  return (
    <div className="r53-login">
      <header className="r53-login-header">
        <Image src="/route53-icon.svg" alt="" width={32} height={32} priority />
        <span>Route 53 Console</span>
      </header>

      <main className="r53-login-main">
        <section className="r53-login-card" aria-labelledby="signin-title">
          <h1 id="signin-title" className="r53-login-title">
            Sign in as IAM user
          </h1>
          <SpaceBetween size="m">
            {items.length > 0 && <Flashbar items={items} />}
            {error && (
              <Alert type="error" header="Sign-in failed">
                {error}
              </Alert>
            )}
            {notice && (
              <Alert type="info" dismissible onDismiss={() => setNotice(null)}>
                {notice}
              </Alert>
            )}
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <SpaceBetween size="m">
                <FormField
                  label="Account ID (12 digits) or account alias"
                  errorText={required(accountId, "Account ID")}
                  stretch
                >
                  <Input
                    value={accountId}
                    onChange={({ detail }) => setAccountId(detail.value)}
                    autoFocus={!accountId}
                    autoComplete="organization"
                    placeholder="123456789012"
                  />
                </FormField>
                <Checkbox checked={remember} onChange={({ detail }) => setRemember(detail.checked)}>
                  Remember this account
                </Checkbox>
                <FormField label="IAM username" errorText={required(username, "IAM username")} stretch>
                  <Input value={username} onChange={({ detail }) => setUsername(detail.value)} autoComplete="username" />
                </FormField>
                <FormField label="Password" errorText={required(password, "Password")} stretch>
                  <Input
                    type="password"
                    value={password}
                    onChange={({ detail }) => setPassword(detail.value)}
                    autoComplete="current-password"
                  />
                </FormField>
                <button type="submit" className="r53-signin-button" disabled={busy} aria-busy={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </SpaceBetween>
            </form>
            <div className="r53-login-links">
              <button
                type="button"
                className="r53-link-button"
                onClick={() => setNotice("Root user sign-in is not available in this demo. Sign in with the demo IAM user.")}
              >
                Sign in using root user email
              </button>
              <button
                type="button"
                className="r53-link-button"
                onClick={() => setNotice("Authentication is mocked. Use the demo credentials shown on this page.")}
              >
                Forgot password?
              </button>
            </div>
          </SpaceBetween>
        </section>

        <aside className="r53-login-aside">
          <h2>Amazon Route 53</h2>
          <p>
            A highly available and scalable Domain Name System (DNS) web service. Create hosted zones, manage DNS
            records, and route end users to your applications.
          </p>
          <div className="r53-login-demo">
            <strong>Demo credentials</strong>
            <dl>
              <dt>Account ID</dt>
              <dd>123456789012</dd>
              <dt>Administrator</dt>
              <dd>demo / demo1234</dd>
              <dt>Read-only</dt>
              <dd>viewer / viewer1234</dd>
            </dl>
          </div>
        </aside>
      </main>

      <footer className="r53-login-footer">
        This is a mocked sign-in for a Route 53 console clone. No AWS credentials are used.
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
