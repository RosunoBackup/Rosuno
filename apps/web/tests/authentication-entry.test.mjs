// Targeted P2-005 existing-account sign-in and sign-out tests.
//
// They run on Node.js built-ins alone. The application orchestration runs
// against isolated in-memory provider stand-ins and the existing trusted
// claims boundary; no provider, network, or database is contacted. The server
// actions and the sign-in page need Next.js and React to run, so they are
// checked as source contracts.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { types } from "node:util";

import * as entry from "../src/application/authentication-entry.ts";
import { getShellView } from "../src/application/shell.ts";
import { createSupabaseServerSessionSource } from "../src/infrastructure/identity/server-session-source.ts";

const {
  INITIAL_SIGN_IN_STATE,
  signInExistingAccount,
  signOutCurrentSession,
  validateSignIn,
} = entry;

const appRoot = new URL("../", import.meta.url);

function read(relativePath) {
  return readFileSync(new URL(relativePath, appRoot), "utf8");
}

function filesIn(directory) {
  return readdirSync(new URL(directory, appRoot), { recursive: true })
    .map((file) => `${directory}${file.replaceAll("\\", "/")}`)
    .filter((file) => !/(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/.test(file))
    .filter((file) => statSync(new URL(file, appRoot)).isFile())
    .sort();
}

function importsOf(source) {
  return [
    ...source.matchAll(
      /^\s*import\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm,
    ),
  ].map((match) => match[1]);
}

// Source without its comments.
function codeOf(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*\n/gm, "")
    .replace(/\s\/\/ .*$/gm, "");
}

// A value as plain data: its prototype and every own property, so nothing
// hidden (a non-enumerable message, a Proxy) can ride along with a state.
function ownData(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  assert.equal(types.isProxy(value), false);
  return [
    Object.getPrototypeOf(value),
    ...Reflect.ownKeys(value).map((key) => [key, ownData(value[key])]),
  ];
}

function assertFrozenData(value) {
  if (value === null || typeof value !== "object") {
    return;
  }
  assert.ok(Object.isFrozen(value));
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.ok(Object.hasOwn(descriptor, "value"), String(key));
    assertFrozenData(descriptor.value);
  }
}

function assertExactly(actual, expected) {
  assert.deepEqual(actual, expected);
  assert.deepEqual(ownData(actual), ownData(expected));
  assertFrozenData(actual);
}

// Synthetic, test-only values. None is a real account or credential.
const EMAIL = "member@synthetic.invalid";
const PW = "synthetic-pw-7f3a";
const SUBJECT = "synthetic-subject-p2-005";
const DETAIL = "internal 7f3a";

function form(entries) {
  const data = new FormData();
  for (const [name, value] of entries) {
    data.append(name, value);
  }
  return data;
}

const validForm = () =>
  form([
    ["email", EMAIL],
    ["password", PW],
  ]);

// One browser's cookie jar: the provider session it holds, if any.
function browser(session = null) {
  return { session };
}

// The claims client the trusted boundary reads, over a browser's jar.
function claimsClient(jar) {
  return {
    auth: {
      getClaims: async () =>
        jar.session === null
          ? { data: null, error: null }
          : { data: { claims: { sub: jar.session } }, error: null },
    },
  };
}

// The trusted server session source a fresh request would build.
function freshRequestSource(jar) {
  return createSupabaseServerSessionSource(async () => claimsClient(jar));
}

// In-memory provider stand-in for one request. It accepts only the synthetic
// credentials, writes the session into the jar on acceptance, and clears it
// on sign-out. Every call is recorded.
function stubProvider(jar, overrides = {}) {
  const calls = { sources: 0, signIn: [], signOut: 0 };
  const provider = {
    signInWithPassword: async (...args) => {
      calls.signIn.push(args);
      const [{ email, password }] = args;
      if (email !== EMAIL || password !== PW) {
        return "rejected";
      }
      jar.session = SUBJECT;
      return "accepted";
    },
    signOut: async () => {
      calls.signOut += 1;
      jar.session = null;
      return true;
    },
    session: freshRequestSource(jar),
    ...overrides,
  };
  const source = async () => {
    calls.sources += 1;
    return provider;
  };
  return { calls, provider, source };
}

function assertNothingLeaks(state) {
  const serialized = JSON.stringify(ownData(state), (_key, value) =>
    typeof value === "symbol" ? String(value) : value,
  );
  for (const value of [EMAIL, PW, SUBJECT, "7f3a", "synthetic"]) {
    assert.equal(serialized.includes(value), false, value);
  }
}

const thrownValues = [
  new Error(DETAIL),
  Object.assign(new Error("internal"), { code: DETAIL }),
  { detail: DETAIL },
  DETAIL,
  null,
  undefined,
];

test("1. verified provider acceptance signs in, and a fresh trusted read is authenticated", async () => {
  const jar = browser();
  assertExactly(await getShellView(freshRequestSource(jar)), {
    session: "anonymous",
  });
  const { calls, source } = stubProvider(jar);
  const state = await signInExistingAccount(
    source,
    form([
      ["email", `  ${EMAIL}  `],
      ["password", PW],
    ]),
  );
  assertExactly(state, { status: "signed-in" });
  assertNothingLeaks(state);
  // The provider is asked once, with the trimmed email and the password
  // exactly as typed, and nothing else.
  assert.equal(calls.sources, 1);
  assert.equal(calls.signIn.length, 1);
  assert.equal(calls.signIn[0].length, 1);
  assertExactly(calls.signIn[0][0], { email: EMAIL, password: PW });
  assert.equal(calls.signOut, 0);
  // The session lives in the browser's jar. A fresh request reads it through
  // the trusted boundary, and presentation learns only that it is
  // authenticated: never the subject, and never a role or capability.
  const view = await getShellView(freshRequestSource(jar));
  assertExactly(view, { session: "authenticated" });
  assert.equal(JSON.stringify(view).includes(SUBJECT), false);
  // Another browser is untouched.
  assertExactly(await getShellView(freshRequestSource(browser())), {
    session: "anonymous",
  });
  // A password is never trimmed or otherwise changed.
  const spaced = stubProvider(browser());
  await signInExistingAccount(
    spaced.source,
    form([
      ["email", EMAIL],
      ["password", ` ${PW} `],
    ]),
  );
  assertExactly(spaced.calls.signIn[0][0], {
    email: EMAIL,
    password: ` ${PW} `,
  });
});

test("2. only email and password are read; caller-supplied destination or identity is ignored", async () => {
  const jar = browser();
  const { calls, source } = stubProvider(jar);
  const state = await signInExistingAccount(
    source,
    form([
      ["next", "https://elsewhere.invalid/"],
      ["returnTo", "//elsewhere.invalid"],
      ["redirect", "/elsewhere"],
      ["role", "staff"],
      ["capability", "all"],
      ["subject", "client-claimed-subject"],
      ["user_id", "client-claimed-id"],
      ["email", EMAIL],
      ["email", "second@synthetic.invalid"],
      ["password", PW],
      ["password", "second-password"],
    ]),
  );
  // The result is a fixed code: it carries no destination, identity, role,
  // or anything else the caller sent.
  assertExactly(state, { status: "signed-in" });
  assert.deepEqual(Reflect.ownKeys(state), ["status"]);
  assertExactly(calls.signIn[0][0], { email: EMAIL, password: PW });
  // The previous state is not an input: the operation takes only the request's
  // provider source and the submission.
  assert.equal(signInExistingAccount.length, 2);
  assert.equal(signOutCurrentSession.length, 1);
});

test("3. missing or malformed input is refused before the provider is asked", async () => {
  const bothMissing = {
    email: ["Enter your email address."],
    password: ["Enter your password."],
  };
  const cases = [
    [new FormData(), bothMissing],
    [form([["email", "   "]]), bothMissing],
    [
      form([
        ["email", EMAIL],
        ["password", ""],
      ]),
      { password: ["Enter your password."] },
    ],
    [form([["password", PW]]), { email: ["Enter your email address."] }],
    ...[
      "no-at-sign",
      "member@",
      "@synthetic.invalid",
      "two words@synthetic.invalid",
      "member@@synthetic.invalid",
      `${"m".repeat(245)}@synthetic.invalid`,
    ].map((email) => [
      form([
        ["email", email],
        ["password", PW],
      ]),
      { email: ["Enter a valid email address."] },
    ]),
    [
      form([
        ["email", EMAIL],
        ["password", "p".repeat(1025)],
      ]),
      { password: ["Enter a valid password."] },
    ],
    // A file is not a password.
    [
      form([
        ["email", EMAIL],
        ["password", new Blob([PW])],
      ]),
      { password: ["Enter your password."] },
    ],
    // Anything other than form data is an empty submission.
    ...[
      null,
      undefined,
      `email=${EMAIL}&password=${PW}`,
      { email: EMAIL, password: PW },
      new Map([
        ["email", EMAIL],
        ["password", PW],
      ]),
      [
        ["email", EMAIL],
        ["password", PW],
      ],
    ].map((payload) => [payload, bothMissing]),
  ];
  for (const [payload, fieldErrors] of cases) {
    const { calls, source } = stubProvider(browser());
    const state = await signInExistingAccount(source, payload);
    assertExactly(state, { status: "invalid", fieldErrors });
    assertNothingLeaks(state);
    assert.equal(calls.sources, 0);
  }
  // The bounds only refuse malformed submissions; they set no password rule.
  for (const password of ["p", " ", "p".repeat(1024)]) {
    const validation = validateSignIn(
      new Map([
        ["email", EMAIL],
        ["password", password],
      ]),
    );
    assert.equal(validation.ok, true);
    assertExactly(validation.value, { email: EMAIL, password });
  }
  assert.equal(
    validateSignIn(
      new Map([
        ["email", `${"m".repeat(235)}@synthetic.invalid`],
        ["password", PW],
      ]),
    ).ok,
    true,
  );
});

test("4. rejected credentials and an unavailable provider fail without detail or side effects", async () => {
  // Rejection starts no session and leaves any existing one alone.
  for (const existing of [null, "synthetic-existing-session"]) {
    const jar = browser(existing);
    const { calls, source } = stubProvider(jar);
    const state = await signInExistingAccount(
      source,
      form([
        ["email", EMAIL],
        ["password", "not-the-synthetic-password"],
      ]),
    );
    assertExactly(state, { status: "rejected" });
    assertNothingLeaks(state);
    assert.equal(calls.signOut, 0);
    assert.equal(jar.session, existing);
  }
  // A provider that reports it could not answer.
  const jar = browser();
  const unavailable = stubProvider(jar, {
    signInWithPassword: async () => "unavailable",
  });
  assertExactly(await signInExistingAccount(unavailable.source, validForm()), {
    status: "unavailable",
  });
  assert.equal(unavailable.calls.signOut, 0);
  // An unconfigured provider, a failing provider factory, or anything that is
  // not a provider is unavailable.
  const factories = [
    async () => null,
    async () => undefined,
    async () => 42,
    async () => DETAIL,
    ...thrownValues.map((thrown) => async () => {
      throw thrown;
    }),
    () => {
      throw new Error(DETAIL);
    },
  ];
  for (const factory of factories) {
    const state = await signInExistingAccount(factory, validForm());
    assertExactly(state, { status: "unavailable" });
    assertNothingLeaks(state);
  }
});

test("5. thrown, unexpected, or unverified provider results fail closed and clear the partial session", async () => {
  // The provider throws after it may have started a session.
  for (const thrown of thrownValues) {
    const jar = browser();
    const { calls, source } = stubProvider(jar, {
      signInWithPassword: async () => {
        jar.session = SUBJECT;
        throw thrown;
      },
    });
    const state = await signInExistingAccount(source, validForm());
    assertExactly(state, { status: "unavailable" });
    assertNothingLeaks(state);
    assert.equal(calls.signOut, 1);
    assert.equal(jar.session, null);
  }
  // Only the exact "accepted", "rejected", or "unavailable" answers count.
  for (const outcome of [
    "ACCEPTED",
    "accepted ",
    "yes",
    true,
    1,
    { status: "accepted" },
    ["accepted"],
    null,
    undefined,
  ]) {
    const jar = browser();
    const { calls, source } = stubProvider(jar, {
      signInWithPassword: async () => {
        jar.session = SUBJECT;
        return outcome;
      },
    });
    assertExactly(await signInExistingAccount(source, validForm()), {
      status: "unavailable",
    });
    assert.equal(calls.signOut, 1);
    assert.equal(jar.session, null);
  }
  // The provider reports acceptance, but the trusted claims boundary does not
  // verify an authenticated request: missing, errored, blank, or throwing
  // claims, or no client at all.
  const unverified = [
    async () => ({
      auth: { getClaims: async () => ({ data: null, error: null }) },
    }),
    async () => ({
      auth: {
        getClaims: async () => ({
          data: { claims: { sub: SUBJECT } },
          error: new Error(DETAIL),
        }),
      },
    }),
    async () => ({
      auth: {
        getClaims: async () => ({
          data: { claims: { sub: " " } },
          error: null,
        }),
      },
    }),
    async () => ({
      auth: {
        getClaims: async () => {
          throw new Error(DETAIL);
        },
      },
    }),
    async () => null,
  ];
  for (const clientSource of unverified) {
    const jar = browser();
    const { calls, source } = stubProvider(jar, {
      session: createSupabaseServerSessionSource(clientSource),
    });
    const state = await signInExistingAccount(source, validForm());
    assertExactly(state, { status: "unavailable" });
    assertNothingLeaks(state);
    assert.equal(calls.signIn.length, 1);
    assert.equal(calls.signOut, 1);
    assert.equal(jar.session, null);
  }
  // A session port that breaks its contract is not verification either.
  for (const session of [
    { currentSubject: async () => 42 },
    {
      currentSubject: async () => {
        throw new Error(DETAIL);
      },
    },
    { status: "authenticated", subject: SUBJECT },
    null,
  ]) {
    const jar = browser();
    const { calls, source } = stubProvider(jar, { session });
    assertExactly(await signInExistingAccount(source, validForm()), {
      status: "unavailable",
    });
    assert.equal(calls.signOut, 1);
  }
  // When clearing the partial session also fails, the result is still a
  // failure, never success.
  for (const signOut of [
    async () => false,
    async () => {
      throw new Error(DETAIL);
    },
  ]) {
    const { source } = stubProvider(browser(), {
      session: createSupabaseServerSessionSource(async () => null),
      signOut,
    });
    const state = await signInExistingAccount(source, validForm());
    assertExactly(state, { status: "unavailable" });
    assertNothingLeaks(state);
  }
});

test("6. sign-out succeeds only when the provider confirms and a fresh trusted read is anonymous", async () => {
  const jar = browser(SUBJECT);
  const { calls, source } = stubProvider(jar);
  assertExactly(await getShellView(freshRequestSource(jar)), {
    session: "authenticated",
  });
  const state = await signOutCurrentSession(source);
  assertExactly(state, { status: "signed-out" });
  assert.equal(calls.signOut, 1);
  assertExactly(await getShellView(freshRequestSource(jar)), {
    session: "anonymous",
  });
  // The provider does not confirm, or throws.
  for (const signOut of [
    async () => false,
    async () => "true",
    async () => 1,
    async () => undefined,
    async () => ({ error: null }),
    ...thrownValues.map((thrown) => async () => {
      throw thrown;
    }),
  ]) {
    const failing = stubProvider(browser(SUBJECT), { signOut });
    const result = await signOutCurrentSession(failing.source);
    assertExactly(result, { status: "failed" });
    assertNothingLeaks(result);
  }
  // The provider claims success, but a fresh read is still authenticated, or
  // cannot be read at all.
  const lingering = browser(SUBJECT);
  const claimed = stubProvider(lingering, { signOut: async () => true });
  assertExactly(await signOutCurrentSession(claimed.source), {
    status: "failed",
  });
  assert.equal(lingering.session, SUBJECT);
  for (const session of [
    { currentSubject: async () => 42 },
    {
      currentSubject: async () => {
        throw new Error(DETAIL);
      },
    },
    null,
  ]) {
    const unreadable = stubProvider(browser(SUBJECT), { session });
    assertExactly(await signOutCurrentSession(unreadable.source), {
      status: "failed",
    });
  }
  // No configured provider, or a failing factory, cannot sign anyone out.
  for (const factory of [
    async () => null,
    async () => {
      throw new Error(DETAIL);
    },
  ]) {
    assertExactly(await signOutCurrentSession(factory), { status: "failed" });
  }
});

test("7. each request is handled on its own and no state is shared", async () => {
  assertExactly(INITIAL_SIGN_IN_STATE, { status: "idle" });
  // Concurrent submissions from different browsers each get their own
  // provider and their own outcome.
  const first = browser();
  const second = browser();
  const third = browser();
  const [accepted, rejected, invalid] = await Promise.all([
    signInExistingAccount(stubProvider(first).source, validForm()),
    signInExistingAccount(
      stubProvider(second).source,
      form([
        ["email", EMAIL],
        ["password", "not-the-synthetic-password"],
      ]),
    ),
    signInExistingAccount(stubProvider(third).source, new FormData()),
  ]);
  assertExactly(accepted, { status: "signed-in" });
  assertExactly(rejected, { status: "rejected" });
  assert.equal(invalid.status, "invalid");
  assert.equal(first.session, SUBJECT);
  assert.equal(second.session, null);
  assert.equal(third.session, null);
  // Every request asks its source afresh: nothing is cached between calls.
  const shared = stubProvider(browser());
  await signInExistingAccount(shared.source, validForm());
  await signInExistingAccount(shared.source, validForm());
  await signOutCurrentSession(shared.source);
  assert.equal(shared.calls.sources, 3);
  // The module exports only its operations, validation, and initial state.
  assert.deepEqual(Object.keys(entry).sort(), [
    "INITIAL_SIGN_IN_STATE",
    "signInExistingAccount",
    "signOutCurrentSession",
    "validateSignIn",
  ]);
});

test("8. the application boundary is provider-neutral and holds no credential", () => {
  const file = "src/application/authentication-entry.ts";
  const source = read(file);
  const code = codeOf(source);
  assert.deepEqual(importsOf(source), ["./form-operation.ts", "./session.ts"]);
  assert.doesNotMatch(source, /["']use (?:client|server)["']/);
  assert.doesNotMatch(
    code,
    /\bimport\s*\(|\brequire\s*\(|next|react|supabase|postgres|database|\bprocess\b|\bconsole\b|\bfetch\s*\(|cookie|header|localStorage|sessionStorage|indexedDB|globalThis|\bwindow\b|\bdocument\b|import\.meta|Math\.random|\bDate\b|access_?token|refresh_?token|\bjwt\b/i,
  );
  // No business, role, or capability decision is made here.
  assert.doesNotMatch(
    code,
    /attorney|lawyer|\bstaff\b|\bclient\b|\brole\b|capabilit|permission|profile|eligib|jurisdiction|booking|payment|\badmin\b/i,
  );
  // Module-level values are frozen fixed states and input bounds; nothing
  // module-level can hold a credential or a session between requests.
  assert.doesNotMatch(code, /^(?:let|var) /m);
  assert.deepEqual(
    [...code.matchAll(/^(?:export )?const (\w+)/gm)].map((match) => match[1]),
    [
      "INITIAL_SIGN_IN_STATE",
      "REJECTED",
      "UNAVAILABLE",
      "SIGNED_IN",
      "SIGNED_OUT",
      "SIGN_OUT_FAILED",
      "EMAIL_MAX_LENGTH",
      "PASSWORD_MAX_LENGTH",
      "EMAIL_SHAPE",
    ],
  );
  // The fixed result codes are the only states it reports.
  assert.deepEqual(
    [...new Set([...code.matchAll(/status: "([a-z-]+)"/g)].map((m) => m[1]))],
    [
      "idle",
      "invalid",
      "rejected",
      "unavailable",
      "signed-in",
      "signed-out",
      "failed",
    ],
  );
});

test("9. the server actions are POST-only, fixed-destination, and request-scoped", () => {
  const file = "app/sign-in/actions.ts";
  const source = read(file);
  const code = codeOf(source);
  assert.match(source, /^"use server";\n/);
  assert.deepEqual(importsOf(source), [
    "next/cache",
    "next/navigation",
    "../../src/application/authentication-entry.ts",
    "../../src/infrastructure/identity/server-session-source.ts",
    "../../src/infrastructure/identity/supabase-server.ts",
  ]);
  // Exactly two actions, and nothing else, are exported.
  assert.deepEqual(
    [...code.matchAll(/\bexport\b[^\n]*/g)].map((match) => match[0]),
    [
      "export async function signIn(",
      "export async function signOut(): Promise<void> {",
    ],
  );
  // The only destination is the fixed home page, and only after success.
  assert.deepEqual(
    [...code.matchAll(/\b(?:permanentRedirect|redirect)\([^)]*\)/g)].map(
      (match) => match[0],
    ),
    ['redirect("/")', 'redirect("/")'],
  );
  assert.equal(code.match(/revalidatePath\("\/"\);/g)?.length, 2);
  assert.match(
    code,
    /if \(state\.status === "signed-in"\) \{\n {4}revalidatePath\("\/"\);\n {4}redirect\("\/"\);\n {2}\}\n {2}return state;/,
  );
  assert.match(
    code,
    /if \(state\.status !== "signed-out"\) \{\n {4}throw new Error\("Sign-out could not be completed\."\);\n {2}\}\n {2}revalidatePath\("\/"\);\n {2}redirect\("\/"\);/,
  );
  // Nothing the caller sends picks a destination or an identity, and the
  // browser's previous state is never read.
  assert.doesNotMatch(
    code,
    /searchParams|returnTo|callbackUrl|\bnext\b(?!\/)|\bheaders\s*\(|\bcookies\s*\(|formData\.get|\brole\b|capabilit|claims\.sub|\bsubject\b/,
  );
  assert.equal(code.match(/\b_previous\b/g)?.length, 1);
  // The provider is asked for a password sign-in with exactly the email and
  // password, a local sign-out of this session only, and the claims boundary
  // over the same request-scoped client.
  assert.match(
    code,
    /client\.auth\.signInWithPassword\(\{\n {8}email,\n {8}password,\n {6}\}\)/,
  );
  assert.equal(code.match(/\.signInWithPassword\(/g)?.length, 1);
  assert.match(code, /client\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.equal(code.match(/\.signOut\(/g)?.length, 1);
  assert.match(
    code,
    /session: createSupabaseServerSessionSource\(async \(\) => client\)/,
  );
  assert.equal(code.match(/createSupabaseServerClient\(\)/g)?.length, 1);
  // Provider detail is never returned, logged, or trusted beyond its status.
  assert.doesNotMatch(
    code,
    /\bconsole\b|\bprocess\b|getSession|getUser|access_?token|refresh_?token|error\.message|\bdata\b|\.session\b(?!:)/,
  );
  // GET cannot sign out: there is no route handler, and the sign-out form is
  // a POST server action on the home page.
  assert.deepEqual(
    filesIn("app/").filter((path) => /(?:^|\/)route\.[jt]sx?$/.test(path)),
    [],
  );
  assert.deepEqual(filesIn("app/sign-in/"), [
    "app/sign-in/actions.ts",
    "app/sign-in/page.tsx",
  ]);
  const home = read("app/page.tsx");
  assert.equal(home.match(/<form\b[^>]*>/g)?.length, 1);
  assert.match(home, /<form action=\{signOut\}>/);
  assert.doesNotMatch(home, /\bmethod=|href="[^"]*sign-?out/i);
  // The home page reads session state only through the trusted source.
  assert.match(
    home,
    /const view = await getShellView\(SUPABASE_SERVER_SESSION_SOURCE\);/,
  );
});

test("10. the sign-in page is an accessible design-system form that shows only fixed messages", () => {
  const file = "app/sign-in/page.tsx";
  const source = read(file);
  const code = codeOf(source);
  assert.match(source, /^"use client";\n/);
  assert.deepEqual(importsOf(source), [
    "react",
    "../../src/application/authentication-entry.ts",
    "../../src/application/form-operation.ts",
    "../../src/presentation/design-system.tsx",
    "./actions.ts",
  ]);
  assert.match(
    code,
    /useActionState\(\n {4}signIn,\n {4}INITIAL_SIGN_IN_STATE,\n {2}\);/,
  );
  // One semantic form submitted through the server action: no GET method, no
  // client-side handler, and no client-held identity.
  assert.equal(code.match(/<form\b[^>]*>/g)?.length, 1);
  assert.match(code, /<form action=\{formAction\}>/);
  assert.doesNotMatch(
    code,
    /\bmethod=|\bonSubmit\b|\bon[A-Z]\w*=|\bfetch\s*\(|localStorage|sessionStorage|document\.cookie|indexedDB|useEffect|\bdefaultValue\b|\bvalue=|dangerouslySetInnerHTML/,
  );
  // Labelled email and password controls with matching input types,
  // autocomplete tokens, and native required validation.
  assert.match(
    code,
    /<TextField\n\s+id="sign-in-email"\n\s+name="email"\n\s+label="Email address"\n\s+type="email"\n\s+autoComplete="email"\n\s+autoCapitalize="none"\n\s+spellCheck=\{false\}\n\s+required\n\s+errors=\{fieldErrors\.email\}\n\s+\/>/,
  );
  assert.match(
    code,
    /<TextField\n\s+id="sign-in-password"\n\s+name="password"\n\s+label="Password"\n\s+type="password"\n\s+autoComplete="current-password"\n\s+required\n\s+errors=\{fieldErrors\.password\}\n\s+\/>/,
  );
  assert.match(
    code,
    /<Button variant="primary" type="submit" disabled=\{pending\}>\n\s+Sign in\n\s+<\/Button>/,
  );
  // State is read only to choose a fixed message or to present the fixed
  // field messages from validation.
  assert.deepEqual(
    [...new Set([...code.matchAll(/\bstate\.\w+/g)].map((match) => match[0]))],
    ["state.status", "state.fieldErrors"],
  );
  for (const status of ["rejected", "unavailable", "invalid"]) {
    assert.match(
      code,
      new RegExp(
        `\\{state\\.status === "${status}" \\? \\(\\n\\s+<Alert tone="error" title="[^"]+" role="alert">`,
      ),
      status,
    );
  }
  // Every component comes from the design system: no class, inline style,
  // color, or stylesheet of its own. Its only native element is the form.
  const imported = source
    .match(
      /import \{([^}]+)\} from "\.\.\/\.\.\/src\/presentation\/design-system\.tsx";/,
    )[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const used = [
    ...new Set([...code.matchAll(/<([A-Z]\w*)/g)].map((match) => match[1])),
  ].sort();
  assert.deepEqual(used, imported);
  assert.deepEqual(
    [...new Set([...code.matchAll(/<([a-z]\w*)/g)].map((match) => match[1]))],
    ["form"],
  );
  assert.doesNotMatch(
    code,
    /className|\bstyle=|#[0-9a-f]{3,8}\b|rgb\(|hsl\(|\.css|<style\b|https?:/i,
  );
  assert.deepEqual(
    [...code.matchAll(/\bdensity="([^"]+)"/g)].map((match) => match[1]),
    ["public"],
  );
  // The copy holds no record, placeholder, or certification claim.
  assert.doesNotMatch(
    source,
    /\b(?:demo|fake|mock|sample|dummy|lorem|ipsum|todo|fixme)\b|@[a-z0-9-]+\.[a-z]{2,}|WCAG|certif/i,
  );
  assert.doesNotMatch(
    code,
    /attorney|lawyer|\bstaff\b|\brole=(?!"alert")|capabilit|eligib|jurisdiction|booking|payment|subject/i,
  );
});
