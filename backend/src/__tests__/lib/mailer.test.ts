import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

describe("sendEmail via Microsoft Graph", () => {
  const fetchMock = vi.fn();

  beforeAll(() => {
    Object.assign(process.env, {
      GRAPH_TENANT_ID: "tenant-1",
      GRAPH_CLIENT_ID: "client-1",
      GRAPH_CLIENT_SECRET: "secret-1",
      GRAPH_SENDER: "events@example.com",
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterAll(() => {
    for (const k of ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_SENDER"]) delete process.env[k];
    vi.unstubAllGlobals();
  });

  it("fetches one token, then posts each message to the sender's sendMail", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/oauth2/")
        ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }))
        : new Response(null, { status: 202 }),
    );
    const { sendEmail } = await import("../../lib/mailer");

    await sendEmail({ to: "a@gmail.com", subject: "Hi", text: "plain" });
    await sendEmail({ to: "b@gmail.com", subject: "Hi", text: "plain", html: "<b>x</b>" });

    const urls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(urls.filter((u) => u.includes("/oauth2/"))).toEqual([
      "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token",
    ]);
    const sends = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith("/sendMail"));
    expect(sends.map(([url]) => url)).toEqual([
      "https://graph.microsoft.com/v1.0/users/events%40example.com/sendMail",
      "https://graph.microsoft.com/v1.0/users/events%40example.com/sendMail",
    ]);
    const [first, second] = sends.map(([, init]) => JSON.parse((init as RequestInit).body as string).message);
    expect(first).toEqual({
      subject: "Hi",
      body: { contentType: "Text", content: "plain" },
      toRecipients: [{ emailAddress: { address: "a@gmail.com" } }],
    });
    expect(second.body).toEqual({ contentType: "HTML", content: "<b>x</b>" });
    expect((sends[0][1] as RequestInit).headers).toMatchObject({ authorization: "Bearer tok" });
  });

  it("logs and swallows a Graph failure instead of throwing", async () => {
    fetchMock.mockImplementation(async () => new Response("denied", { status: 403 }));
    const { sendEmail } = await import("../../lib/mailer");
    await expect(sendEmail({ to: "c@gmail.com", subject: "Hi", text: "plain" })).resolves.toBeUndefined();
  });
});
