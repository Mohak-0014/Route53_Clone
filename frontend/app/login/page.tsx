"use client";

import Image from "next/image";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import Container from "@cloudscape-design/components/container";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Flashbar from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import { useAuth } from "@/components/providers/AuthProvider";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { api, ApiError, errorMessage } from "@/lib/api";

const REMEMBER_KEY = "r53.rememberedAccount";
/** Show the "server is starting" note when sign-in takes longer than this (free-tier cold start). */
const SLOW_SIGN_IN_MS = 4000;

const DEMO_ACCOUNT_ID = "123456789012";
const DEMO_USERS = [
  { label: "Administrator", username: "demo", password: "demo1234" },
  { label: "Read-only", username: "viewer", password: "viewer1234" },
];

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

/** A demo value in monospace with a copy button, for the credentials box. */
function Copyable({ text, label }: { text: string; label: string }) {
  return (
    <span className="r53-copyable">
      <Box variant="code" fontSize="body-s">
        {text}
      </Box>
      <CopyToClipboard
        variant="icon"
        textToCopy={text}
        copyButtonAriaLabel={`Copy ${label}`}
        copySuccessText={`${label} copied`}
        copyErrorText="Failed to copy"
      />
    </span>
  );
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
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const next = params.get("next");
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/hosted-zones";

  useEffect(() => {
    // Start waking the (possibly sleeping) demo API while the user types.
    api.warmUp();
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
    const slowTimer = setTimeout(() => setSlow(true), SLOW_SIGN_IN_MS);
    try {
      await login(accountId, username, password);
      writeRemembered(remember ? accountId.trim() : null);
      clearAll();
    } catch (e) {
      const unreachable = e instanceof ApiError && (e.code === "Timeout" || e.code === "NetworkError");
      setError({ message: errorMessage(e), retry: unreachable });
      setBusy(false);
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
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
        <div className="r53-login-card">
          <Container header={<Header variant="h1">Sign in as IAM user</Header>}>
            <SpaceBetween size="m">
              {items.length > 0 && <Flashbar items={items} />}
              {error && (
                <Alert
                  type="error"
                  header={error.retry ? "Couldn't reach the demo server" : "Sign-in failed"}
                  action={error.retry ? <Button onClick={submit}>Retry</Button> : undefined}
                >
                  {error.message}
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
                      placeholder={DEMO_ACCOUNT_ID}
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
                    {busy && <Spinner />}
                    {busy ? "Signing in…" : "Sign in"}
                  </button>
                  {slow && (
                    <Alert type="info">
                      Starting the demo server… the first sign-in after a period of inactivity can take up to a minute.
                    </Alert>
                  )}
                </SpaceBetween>
              </form>
              <div className="r53-login-links">
                <SpaceBetween size="xs">
                  <Link
                    onFollow={() =>
                      setNotice("Root user sign-in is not available in this demo. Sign in with the demo IAM user.")
                    }
                  >
                    Sign in using root user email
                  </Link>
                  <Link onFollow={() => setNotice("Authentication is mocked. Use the demo credentials shown on this page.")}>
                    Forgot password?
                  </Link>
                </SpaceBetween>
              </div>
            </SpaceBetween>
          </Container>
        </div>

        <aside className="r53-login-card" aria-label="About this demo">
          <Container
            header={
              <Header
                variant="h1"
                description="A highly available and scalable Domain Name System (DNS) web service. Create hosted zones, manage DNS records, and route end users to your applications."
              >
                Amazon Route 53
              </Header>
            }
          >
            <Alert type="info" header="Demo credentials">
              <KeyValuePairs
                columns={1}
                items={[
                  { label: "Account ID", value: <Copyable text={DEMO_ACCOUNT_ID} label="Account ID" /> },
                  ...DEMO_USERS.map((u) => ({
                    label: u.label,
                    value: (
                      <SpaceBetween direction="horizontal" size="s">
                        <Copyable text={u.username} label={`${u.label} username`} />
                        <Copyable text={u.password} label={`${u.label} password`} />
                      </SpaceBetween>
                    ),
                  })),
                ]}
              />
            </Alert>
          </Container>
        </aside>
      </main>

      <footer className="r53-login-footer">
        <Box color="text-body-secondary" fontSize="body-s" textAlign="center">
          This is a mocked sign-in for a Route 53 console clone. No AWS credentials are used.
        </Box>
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
