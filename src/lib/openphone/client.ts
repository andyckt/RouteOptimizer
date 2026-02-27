import { getServerEnv } from "@/lib/env";

/**
 * Send SMS via OpenPhone/Quo API.
 * Server-only. Never expose API key to client.
 */
export async function sendSms(params: {
  from: string;
  toE164: string;
  content: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { OPENPHONE_API_KEY } = getServerEnv();
  const apiKey = OPENPHONE_API_KEY.trim();
  if (!apiKey) {
    return { success: false, error: "OPENPHONE_API_KEY is empty" };
  }

  const res = await fetch("https://api.openphone.com/v1/messages", {
    method: "POST",
    headers: {
      // Quo/OpenPhone API does NOT use "Bearer" prefix — send raw API key
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.toE164],
      content: params.content,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    let errMsg = `OpenPhone API ${res.status}`;
    try {
      const json = JSON.parse(text);
      errMsg = (json.message ?? json.errors?.[0]?.message ?? text) || errMsg;
    } catch {
      if (text) errMsg = text.slice(0, 200);
    }
    // Help users fix common 401: invalid/missing API key
    if (res.status === 401) {
      errMsg =
        "Unauthorized — OpenPhone/Quo API key invalid or missing. Check OPENPHONE_API_KEY in .env. Get a key from Quo → Workspace Settings → API tab.";
    }
    return { success: false, error: errMsg };
  }

  const data = (await res.json()) as { data?: { id?: string } };
  return {
    success: true,
    messageId: data.data?.id,
  };
}
