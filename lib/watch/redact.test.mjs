import { describe, expect, it } from "vitest";
import { clip, redact } from "./redact.mjs";

describe("redact", () => {
  it.each([
    ["an Authorization header", `curl -H "Authorization: Bearer abc.def" https://x`, "abc.def", `"Authorization: [redacted]"`],
    ["a key-like header", `curl -H 'X-Api-Key: zzz123' https://x`, "zzz123", "X-Api-Key: [redacted]"],
    ["a token assignment", "export GITHUB_TOKEN=hunter2", "hunter2", "GITHUB_TOKEN=[redacted]"],
    ["a password assignment, quoted", `DB_PASSWORD="p 4 ss" npm start`, "p 4 ss", `DB_PASSWORD="[redacted]`],
    ["a JSON member", `{"password": "abc123", "user": "bob"}`, "abc123", `"password": "[redacted]"`],
    ["a query parameter", "https://x/api?access_token=abc123&x=1", "abc123", "access_token=[redacted]&x=1"],
    ["a secret flag with a space", "tool --password hunter2 --verbose", "hunter2", "--password [redacted] --verbose"],
    ["a secret flag with =", "tool --api-key=abc123 -v", "abc123", "--api-key=[redacted] -v"],
    ["a URL with credentials", "psql postgres://admin:hunter2@db:5432/app", "hunter2", "postgres://[redacted]@db:5432/app"],
    ["curl -u", "curl -u bob:hunter2 https://x", "hunter2", "-u bob:[redacted]"],
    ["an env file written with >>", `echo "STRIPE_URL=https://x" >> .env`, "https://x", "STRIPE_URL=[redacted]"],
    ["an env file written with tee", "printf 'FOO=bar' | tee -a .env.local", "bar", "FOO=[redacted]"],
    ["a GitHub token alone", "gh auth login --with-token ghp_abcdefghijklmnopqrstuv1234", "ghp_abcdefghijklmnopqrstuv1234", "[redacted]"],
    ["an Anthropic key alone", "echo sk-ant-api03-abcdefghijklmnop", "sk-ant-api03-abcdefghijklmnop", "[redacted]"],
    ["an AWS key id", "aws configure set aws_access_key_id AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP", "[redacted]"],
  ])("hides %s", (_name, text, secret, shown) => {
    const out = redact(text);
    expect(out).not.toContain(secret);
    expect(out).toContain(shown);
  });

  it.each(["npm test", 'git commit -m "fix the auth flow"', "Refresh the token cache", "tool --token -v", "git push origin feat/x"])(
    "leaves %s as it is",
    (text) => {
      expect(redact(text)).toBe(text);
    },
  );

  it("is idempotent", () => {
    const once = redact(`curl -H "Authorization: Bearer x" -u a:b postgres://u:p@h API_KEY=1`);
    expect(redact(once)).toBe(once);
  });

  it("passes a non-string through", () => {
    expect(redact(undefined)).toBeUndefined();
  });
});

describe("clip", () => {
  it("redacts, then cuts with an ellipsis", () => {
    expect(clip("API_KEY=abc " + "x".repeat(50), 20)).toBe("API_KEY=[redacted] …");
    expect(clip("short", 20)).toBe("short");
  });

  it("is undefined for a non-string", () => {
    expect(clip(5)).toBeUndefined();
  });
});
